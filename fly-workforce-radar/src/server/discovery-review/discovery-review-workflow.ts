import { createHash } from "node:crypto";
import { classifyDiscoveryQuantity, canonicalHeadcount } from "../../domain/discovery-quantity";
import { interpretStoredDemand, resolveObservationCompany, type StoredDiscoveryObservation } from "../../domain/discovery-company-intelligence";
import { normalizeCompanyName } from "../services/company/company-name-normalization";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { toSafeEvidenceText } from "../../domain/safe-evidence-text";
import { postingVerificationGate } from "../discovery-intelligence/posting-verification";

export const COMPANY_REVIEW_OUTCOMES = ["LINK", "CREATE", "DEFER", "REJECT_MATCH", "UNSUPPORTED", "NOT_ACTIONABLE", "KEEP_UNRESOLVED"] as const;
export type CompanyReviewOutcome = (typeof COMPANY_REVIEW_OUTCOMES)[number];
export const DEMAND_REVIEW_OUTCOMES = ["VERIFY", "REJECT", "DEFER"] as const;
export type DemandReviewOutcome = (typeof DEMAND_REVIEW_OUTCOMES)[number];

type ObservationRow = {
  observation_id: string; candidate_id: string; title: string; description: string | null; normalized_url: string;
  source_domain: string; source_id: string; evidence_id: string | null; observed_company: string | null; recorded_location: string | null;
  observation_identity: string; observation_state: string; source_type: string; platform: string | null; health_status: string;
  first_seen_at: string | Date; last_seen_at: string | Date; published_at: string | Date | null; metadata: Record<string, unknown>;
};

export interface DiscoveryReviewCase {
  readonly observationId: string; readonly candidateId: string; readonly title: string; readonly description: string | null;
  readonly url: string; readonly source: string; readonly observedCompany: string | null; readonly location: string | null;
  readonly profession: string | null; readonly level: string; readonly quantity: ReturnType<typeof classifyDiscoveryQuantity>;
  readonly companyDecision: { outcome: string; companyId: string | null; companyName: string | null; reason: string; decidedAt: string } | null;
  readonly demandDecision: { decision: string; demandSignalId: string; reason: string; decidedAt: string; opportunityId: string | null } | null;
  readonly companies: readonly { id: string; name: string }[]; readonly contactIntelligenceAvailable: boolean;
}

async function observation(client: SqlClient, candidateId: string): Promise<ObservationRow | null> {
  const result = await client.query<ObservationRow>(`select o.id observation_id,o.candidate_id,c.title,c.provider_description description,o.normalized_url,
    c.source_domain,w.source_id,o.evidence_id,coalesce(r.correlation_metadata->>'company',r.search_request->>'company',ev.metadata->'posting'->>'employerName') observed_company,
    ev.metadata->'posting'->>'location' recorded_location,
    o.observation_identity,o.state observation_state,w.source_type,w.platform,w.health_status,
    o.first_seen_at,o.last_seen_at,o.published_at,o.metadata
    from discovery_watch_observations o join discovery_watch_sources w on w.id=o.watch_source_id
    join company_discovery_candidates c on c.id=o.candidate_id
    join company_discovery_runs r on r.id=c.run_id
    -- operator-recorded postings (ASSISTED_MANUAL / EMAIL_ALERT): employer and location as recorded from the official posting
    left join raw_evidence ev on ev.id=o.evidence_id and ev.metadata->>'provenance' in ('ASSISTED_MANUAL','EMAIL_ALERT')
    where o.candidate_id=$1 order by o.captured_at desc,o.id limit 1`, [candidateId]);
  return result.rows[0] ?? null;
}

export async function loadDiscoveryReviewCase(client: SqlClient, candidateId: string): Promise<DiscoveryReviewCase | null> {
  const row = await observation(client, candidateId); if (!row) return null;
  const [companies, resolution, demand] = await Promise.all([
    client.query<{ id: string; name: string }>(`select id,coalesce(common_name,legal_name) name from companies where merged_into_company_id is null order by coalesce(common_name,legal_name),id limit 250`),
    client.query<{ result: string; candidate_company_id: string | null; company_name: string | null; reason: string; resolved_at: string | Date; confidence_metadata: Record<string, unknown> }>(`select a.result,a.candidate_company_id,coalesce(c.common_name,c.legal_name) company_name,a.reason,a.resolved_at,a.confidence_metadata
      from company_resolution_audits a left join companies c on c.id=a.candidate_company_id
      where a.discovery_watch_observation_id=$1 order by a.resolved_at desc,a.created_at desc,a.id desc limit 1`, [row.observation_id]),
    client.query<{ decision: string; demand_signal_id: string; reason: string; decided_at: string | Date; opportunity_id: string | null }>(`select h.decision,x.demand_signal_id,h.reason,h.decided_at,ods.opportunity_id
      from discovery_observation_demand_signals x join human_verification_decisions h on h.target_type='DEMAND_SIGNAL' and h.target_id=x.demand_signal_id
      left join opportunity_demand_signals ods on ods.demand_signal_id=x.demand_signal_id
      where x.discovery_watch_observation_id=$1 order by h.decided_at desc,h.created_at desc limit 1`, [row.observation_id]),
  ]);
  const latest = resolution.rows[0]; const demandLatest = demand.rows[0];
  const quantity = classifyDiscoveryQuantity({ title: row.title, description: row.description, domain: row.source_domain, url: row.normalized_url });
  const storedObservation:StoredDiscoveryObservation={id:row.observation_id,identity:row.observation_identity,title:row.title,description:row.description,normalizedUrl:row.normalized_url,domain:row.source_domain,sourceType:row.source_type,platform:row.platform,explicitCompanyId:null,level:typeof row.metadata?.electricalLevel==="string"?row.metadata.electricalLevel as StoredDiscoveryObservation["level"]:"UNKNOWN",watchState:row.observation_state,watchHealth:row.health_status,firstSeenAt:new Date(row.first_seen_at).toISOString(),lastSeenAt:new Date(row.last_seen_at).toISOString(),publishedAt:row.published_at?new Date(row.published_at).toISOString():null,canonicalEvidence:Boolean(row.evidence_id)};
  const interpretedDemand=interpretStoredDemand(storedObservation);const resolvedIdentity=resolveObservationCompany(storedObservation,[]);
  const companyId = latest?.candidate_company_id ?? null;
  const contacts = companyId ? await client.query<{ present: boolean }>(`select exists(select 1 from contact_routes where company_id=$1 union all select 1 from contact_investigations where company_id=$1) present`, [companyId]) : { rows: [] };
  return { observationId: row.observation_id, candidateId, title: toSafeEvidenceText(row.title) ?? "Stored Discovery observation", description: toSafeEvidenceText(row.description), url: row.normalized_url, source: row.source_domain,
    observedCompany: row.observed_company??resolvedIdentity.observedCompany, location: interpretedDemand.location ?? row.recorded_location,
    profession: interpretedDemand.profession, level: interpretedDemand.level, quantity,
    companyDecision: latest ? { outcome: String(latest.confidence_metadata?.operatorOutcome ?? latest.result), companyId, companyName: latest.company_name, reason: latest.reason, decidedAt: new Date(latest.resolved_at).toISOString() } : null,
    demandDecision: demandLatest ? { decision: demandLatest.decision, demandSignalId: demandLatest.demand_signal_id, reason: demandLatest.reason, decidedAt: new Date(demandLatest.decided_at).toISOString(), opportunityId: demandLatest.opportunity_id } : null,
    companies: companies.rows, contactIntelligenceAvailable: Boolean(contacts.rows[0]?.present) };
}

export async function recordCompanyReview(client: SqlClient, input: { candidateId: string; outcome: CompanyReviewOutcome; selectedCompanyId?: string; companyName?: string; reason: string; operatorId: string; now: Date }) {
  const row = await observation(client, input.candidateId); if (!row) throw new Error("Discovery observation not found");
  const observed = row.observed_company?.trim() || row.title.trim(); const normalized = normalizeCompanyName(observed);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`discovery-company-review:${row.observation_id}`]);
  let companyId = input.selectedCompanyId?.trim() || null;
  if (input.outcome === "CREATE") {
    const name = input.companyName?.trim() || observed; const key = normalizeCompanyName(name); if (!key) throw new Error("Company name is required");
    const existing = await client.query<{ id: string }>(`select id from companies where merged_into_company_id is null and (normalized_common_name=$1 or normalized_legal_name=$1) order by id limit 1`, [key]);
    companyId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(`insert into companies(common_name,normalized_common_name,normalized_legal_name,first_seen_at,last_seen_at) values($1,$2,$2,$3,$3) returning id`, [name, key, input.now.toISOString()])).rows[0].id;
  }
  if ((input.outcome === "LINK" || input.outcome === "CREATE") && !companyId) throw new Error("Select a canonical company");
  if (companyId) { const exists = await client.query<{ id: string }>("select id from companies where id=$1 and merged_into_company_id is null", [companyId]); if (!exists.rows[0]) throw new Error("Canonical company not found"); }
  const result = companyId ? "RESOLVED_EXACT" : "UNRESOLVED";
  const method = companyId ? "MANUAL_OVERRIDE" : input.outcome === "UNSUPPORTED" || input.outcome === "NOT_ACTIONABLE" ? "PLACEHOLDER_REJECTED" : "NO_MATCH";
  const prior = await client.query<{ id: string }>(`select id from company_resolution_audits where discovery_watch_observation_id=$1 and result=$2::company_resolution_result and method=$3::company_resolution_method and candidate_company_id is not distinct from $4::uuid and reason=$5 and confidence_metadata->>'operatorOutcome'=$6 order by resolved_at desc limit 1`, [row.observation_id,result,method,companyId,input.reason,input.outcome]);
  if (prior.rows[0]) return { auditId: prior.rows[0].id, companyId, replayed: true };
  const audit = await client.query<{ id: string }>(`insert into company_resolution_audits(observed_text,normalized_text,result,method,candidate_company_id,candidate_company_ids,actor,resolved_at,evidence_id,reason,confidence_metadata,discovery_candidate_id,discovery_watch_observation_id)
    values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13) returning id`, [observed,normalized||null,result,method,companyId,JSON.stringify(companyId?[companyId]:[]),`operator:${input.operatorId}`,input.now.toISOString(),row.evidence_id,input.reason,JSON.stringify({operatorOutcome:input.outcome}),row.candidate_id,row.observation_id]);
  return { auditId: audit.rows[0].id, companyId, replayed: false };
}

async function ensureEvidence(client: SqlClient, row: ObservationRow, operatorId: string, now: Date) {
  if (row.evidence_id) return row.evidence_id;
  const payload = JSON.stringify({ title: row.title, excerpt: row.description, url: row.normalized_url, observationId: row.observation_id });
  const hash = createHash("sha256").update(payload).digest("hex");
  const existing = await client.query<{ id: string }>("select id from raw_evidence where source_id=$1 and source_url=$2 and content_hash=$3 order by captured_at desc limit 1", [row.source_id,row.normalized_url,hash]);
  if (existing.rows[0]) return existing.rows[0].id;
  return (await client.query<{ id: string }>(`insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata) values($1,$2,$3,'HUMAN_REVIEW',$4,'discovery-review@1.3-r1',$5::jsonb) returning id`, [row.source_id,row.normalized_url,now.toISOString(),hash,JSON.stringify({observationId:row.observation_id,reviewedByOperatorId:operatorId,minimalStoredExcerpt:true})])).rows[0].id;
}

export async function recordDemandReview(client: SqlClient, input: { candidateId: string; outcome: DemandReviewOutcome; reason: string; operatorId: string; now: Date }) {
  const row = await observation(client,input.candidateId); if(!row) throw new Error("Discovery observation not found");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`discovery-demand-review:${row.observation_id}`]);
  const resolution = await client.query<{ id:string; candidate_company_id:string }>(`select id,candidate_company_id from company_resolution_audits where discovery_watch_observation_id=$1 and result in('RESOLVED_EXACT','RESOLVED_ALIAS') and candidate_company_id is not null order by resolved_at desc,created_at desc limit 1`,[row.observation_id]);
  if(!resolution.rows[0]) throw new Error("Resolve the canonical company before demand review");
  const evidenceId = await ensureEvidence(client,row,input.operatorId,input.now);
  const quantity = classifyDiscoveryQuantity({title:row.title,description:row.description,domain:row.source_domain,url:row.normalized_url});
  const ruleVersion="discovery-quantity@1.0.0";
  const quantityRow = await client.query<{id:string}>(`insert into discovery_quantity_observations(discovery_watch_observation_id,candidate_id,quantity_type,quantity_value,quantity_scope,source_excerpt,evidence_id,extraction_method,extraction_rule_version,verification_state,first_observed_at,last_observed_at)
    values($1,$2,$3,$4,$5,$6,$7,'DETERMINISTIC_RULE',$8,'UNVERIFIED',$9,$10) on conflict do nothing returning id`,[row.observation_id,row.candidate_id,quantity.type,quantity.value,quantity.scope,(row.description||row.title).slice(0,1000),evidenceId,ruleVersion,new Date(row.first_seen_at).toISOString(),new Date(row.last_seen_at).toISOString()]);
  const quantityId = quantityRow.rows[0]?.id ?? (await client.query<{id:string}>(`select id from discovery_quantity_observations where discovery_watch_observation_id=$1 and quantity_type=$2 and quantity_scope=$3 and coalesce(quantity_value,-1)=coalesce($4::integer,-1) and extraction_rule_version=$5`,[row.observation_id,quantity.type,quantity.scope,quantity.value,ruleVersion])).rows[0].id;
  const link = await client.query<{demand_signal_id:string}>("select demand_signal_id from discovery_observation_demand_signals where discovery_watch_observation_id=$1",[row.observation_id]);
  let demandId = link.rows[0]?.demand_signal_id;
  if(!demandId){
    const headcount = canonicalHeadcount(quantity,input.outcome==="VERIFY");
    demandId=(await client.query<{id:string}>(`insert into demand_signals(title,original_title,role_type,publisher_company_id,city,state,headcount_estimate,published_at,first_seen_at,last_seen_at,stale_after,source_id,raw_evidence_id,source_identity_key,parser_version,trade_code,verification_state,last_verified_at,evidence_tier)
      values($1,$1,'OTHER',$2,null,null,$3,$4,$5,$6,$7,$8,$9,$10,'discovery-review@1.3-r1',$11,'UNVERIFIED',null,'HUMAN_REVIEWED_SOURCE') returning id`,[row.title,resolution.rows[0].candidate_company_id,headcount,row.published_at?new Date(row.published_at).toISOString():null,new Date(row.first_seen_at).toISOString(),new Date(row.last_seen_at).toISOString(),new Date(input.now.getTime()+90*86400000).toISOString(),row.source_id,evidenceId,`discovery-observation:${row.observation_id}`,typeof row.metadata?.tradeCode==="string"?row.metadata.tradeCode:null])).rows[0].id;
    await client.query(`insert into discovery_observation_demand_signals(discovery_watch_observation_id,candidate_id,demand_signal_id,company_resolution_audit_id,quantity_observation_id,linked_by_operator_id,linked_at) values($1,$2,$3,$4,$5,$6,$7)`,[row.observation_id,row.candidate_id,demandId,resolution.rows[0].id,quantityId,input.operatorId,input.now.toISOString()]);
  }
  const decision=input.outcome==="VERIFY"?"VERIFY":input.outcome==="REJECT"?"REJECT":"DEFER";
  const prior=await client.query<{id:string}>(`select id from human_verification_decisions where target_type='DEMAND_SIGNAL' and target_id=$1 and decision=$2::human_verification_decision and reason=$3 order by decided_at desc limit 1`,[demandId,decision,input.reason]);
  if(prior.rows[0]) return {demandSignalId:demandId,replayed:true};
  const storedPrevious=(await client.query<{verification_state:string|null}>("select verification_state from demand_signals where id=$1",[demandId])).rows[0]?.verification_state??null;
  const previous=storedPrevious==="VERIFIED"||storedPrevious==="REJECTED"||storedPrevious==="STALE"?storedPrevious:"UNVERIFIED";
  const resulting=decision==="VERIFY"?"VERIFIED":decision==="REJECT"?"REJECTED":previous;
  const review=await client.query<{id:string}>(`insert into human_verification_decisions(target_type,target_id,decision,reviewer_id,reason,decided_at,previous_state,resulting_state,primary_evidence_id,rule_version,metadata) values('DEMAND_SIGNAL',$1,$2,$3,$4,$5,$6::verification_state,$7::verification_state,$8,'discovery-demand-review@1.3-r1',$9::jsonb) returning id`,[demandId,decision,input.operatorId,input.reason,input.now.toISOString(),previous,resulting,evidenceId,JSON.stringify({observationId:row.observation_id,companyResolutionAuditId:resolution.rows[0].id,quantityType:quantity.type})]);
  await client.query("insert into human_verification_decision_evidence(decision_id,evidence_id) values($1,$2)",[review.rows[0].id,evidenceId]);
  if(decision!=="DEFER") await client.query("update demand_signals set verification_state=$2,last_verified_at=case when $2='VERIFIED' then $3 else last_verified_at end,updated_at=$3 where id=$1",[demandId,decision==="REJECT"?"DISPUTED":"VERIFIED",input.now.toISOString()]);
  return {demandSignalId:demandId,replayed:false};
}

export type PromotionBlocker = "POSTING_NOT_VERIFIED" | "COMPANY_NOT_CONFIRMED" | "DEMAND_NOT_VERIFIED";
/**
 * Promotion guard for governed Discovery items. A recorded posting needs a current verification of this observation;
 * every governed item needs its latest company decision resolved to a canonical company and its latest demand decision
 * VERIFY. Returns the first missing requirement, or null when promotion may proceed (still an explicit human action).
 */
export async function promotionBlocker(client: SqlClient, candidateId: string): Promise<PromotionBlocker | null> {
  const gate = await postingVerificationGate(client, candidateId);
  if (gate === "PENDING" || gate === "SUPERSEDED") return "POSTING_NOT_VERIFIED";
  const row = await observation(client, candidateId); if (!row) return "COMPANY_NOT_CONFIRMED";
  const company = (await client.query<{ company_id: string | null }>(`select candidate_company_id company_id from company_resolution_audits where discovery_watch_observation_id=$1
    order by resolved_at desc,created_at desc,id desc limit 1`, [row.observation_id])).rows[0];
  if (!company?.company_id) return "COMPANY_NOT_CONFIRMED";
  const demand = (await client.query<{ decision: string; company_id: string | null }>(`select h.decision::text decision,d.publisher_company_id company_id from discovery_observation_demand_signals x
    join demand_signals d on d.id=x.demand_signal_id join human_verification_decisions h on h.target_type='DEMAND_SIGNAL' and h.target_id=x.demand_signal_id
    where x.discovery_watch_observation_id=$1 order by h.decided_at desc,h.created_at desc limit 1`, [row.observation_id])).rows[0];
  if (demand?.decision !== "VERIFY" || demand.company_id !== company.company_id) return "DEMAND_NOT_VERIFIED";
  return null;
}
