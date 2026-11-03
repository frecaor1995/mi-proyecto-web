import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { CaptureBudget, canonicalPostingUrl, deduplicatePostings, postingIdentity, requireCaptureAuthorization, type CapturedPosting, type PostingCaptureRequest, type SourceAccessDecision } from "../../domain/individual-posting-capture";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { stripTags } from "../adapters/production/listing-html";

const MAX_BYTES = 750_000, MAX_REDIRECTS = 2;
const unsafeAddress = (address: string) => isIP(address) === 4
  ? /^(?:0|10|127|169\.254|192\.168)\./.test(address) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(address) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
  : isIP(address) !== 6 || /^(?:::|::1$|f[cd]|fe[89ab]|ff|2001:db8)/i.test(address);
const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export interface CaptureTransport { fetch(url: string): Promise<{ status: number; url: string; contentType: string; body: string; redirect: string | null }>; }
export class SafePublicTransport implements CaptureTransport {
  /** preserveExactUrl: request the validated URL exactly as authorized (e.g. a trailing-slash listing) instead of its canonical form. */
  constructor(private readonly options: { readonly preserveExactUrl?: boolean } = {}) {}
  async fetch(input: string) {
    const normalized = canonicalPostingUrl(input); if (!normalized) throw new Error("UNSAFE_URL");
    const target = this.options.preserveExactUrl ? new URL(input).toString() : normalized;
    if (new URL(target).hostname.toLowerCase() !== new URL(normalized).hostname) throw new Error("UNSAFE_URL");
    const addresses = await lookup(new URL(normalized).hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => unsafeAddress(address))) throw new Error("UNSAFE_DESTINATION");
    const response = await fetch(target, { redirect: "manual", cache: "no-store", credentials: "omit", headers: { Accept: "text/html,application/json", "User-Agent": "FlyWorkforceRadar/Recipe-1.1" }, signal: AbortSignal.timeout(8_000) });
    const declared = Number(response.headers.get("content-length") ?? 0); if (declared > MAX_BYTES) throw new Error("RESPONSE_TOO_LARGE");
    const body = await response.text(); if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("RESPONSE_TOO_LARGE");
    return { status: response.status, url: response.url || normalized, contentType: response.headers.get("content-type") ?? "", body, redirect: response.headers.get("location") };
  }
}

function jsonLd(body: string) {
  const matches = [...body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return matches.flatMap((match) => { try { const value=JSON.parse(match[1]); return Array.isArray(value) ? value : [value]; } catch { return []; } }).flatMap((value) => value?.["@graph"] ?? [value]).find((value: Record<string, unknown>) => value?.["@type"] === "JobPosting") as Record<string, unknown> | undefined;
}
const textOnly = (value: unknown) => clean(value)?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 1200) ?? null;
export function parseJobPosting(body: string, sourceUrl: string, capturedAt: string, parentAggregateObservationId: string | null): CapturedPosting | null {
  // JazzHR detail pages always go through the JazzHR parser: the external ID is the URL's posting ID, never a JSON-LD
  // identifier and never the company's board slug.
  if(isJazzHrHost(sourceUrl))return parseStrikeJazzHrPosting(body,sourceUrl,capturedAt,parentAggregateObservationId);
  const item=jsonLd(body); if(!item)return null; const location=item.jobLocation as Record<string, unknown>|undefined; const address=location?.address as Record<string, unknown>|undefined;
  const organization=item.hiringOrganization as Record<string, unknown>|undefined; const title=clean(item.title); const description=textOnly(item.description);
  const locality=[clean(address?.addressLocality),clean(address?.addressRegion)].filter(Boolean).join(", ")||null;
  if(!title || !/(electrician|electrical apprentice|electrical helper)/i.test(`${title} ${description ?? ""}`) || !/houston/i.test(`${locality ?? ""} ${description ?? ""}`))return null;
  const normalizedUrl=canonicalPostingUrl(sourceUrl); if(!normalizedUrl)return null;
  return { sourceUrl,normalizedUrl,externalPostingId:clean(item.identifier && typeof item.identifier==="object" ? (item.identifier as Record<string,unknown>).value : item.identifier),employerName:clean(organization?.name),title,
    profession:/apprentice|helper/i.test(title)?"ELECTRICAL APPRENTICE":"ELECTRICIAN",professionalLevel:/apprentice|helper/i.test(title)?"APPRENTICE":null,location:locality,compensation:null,perDiem:null,experience:null,licenses:[],certifications:[],postingDate:clean(item.datePosted),
    explicitEmployerHeadcount:null,applicationUrl:canonicalPostingUrl(clean(item.url)??sourceUrl),relationship:organization?.name?"DIRECT_HIRE_POSTING":"UNKNOWN",vendorAcceptance:"UNKNOWN",capturedAt,evidenceExcerpt:(description??title).slice(0,600),evidenceCompleteness:organization?.name&&locality?"COMPLETE":"PARTIAL",parentAggregateObservationId };
}

/** JazzHR public boards live on {board}.applytojob.com; only the board → employer mappings below are evidenced locally. */
const JAZZHR_BOARDS: Readonly<Record<string, string>> = { strike: "Strike" };
const jazzHrBoard = (sourceUrl: string) => { try { const host = new URL(sourceUrl).hostname.toLowerCase(); return host.endsWith(".applytojob.com") ? host.slice(0, -".applytojob.com".length) : null; } catch { return null; } };
export const isJazzHrHost = (sourceUrl: string) => jazzHrBoard(sourceUrl) !== null;
/** Watch-source platform from the host: only platforms identifiable from the URL itself; otherwise unknown (null). */
export const platformForHost = (sourceUrl: string) => (isJazzHrHost(sourceUrl) ? "JAZZHR" : null);

/**
 * JazzHR individual posting (detail page: {board}.applytojob.com/apply/{postingId}/{slug}).
 * The external posting ID comes ONLY from the URL path; the board slug (e.g. "strike") identifies the company's catalog.
 * Fields are read when present (title, location, description; date only from the page's own JobPosting markup) and
 * stay null otherwise — compensation, per diem, headcount and vendor acceptance are never inferred.
 */
export function parseStrikeJazzHrPosting(body:string,sourceUrl:string,capturedAt:string,parentAggregateObservationId:string|null):CapturedPosting|null{
  const url=canonicalPostingUrl(sourceUrl);const board=url?jazzHrBoard(url):null;if(!url||!board||!JAZZHR_BOARDS[board])return null;
  const externalPostingId=new URL(url).pathname.match(/^\/apply\/([A-Za-z0-9]{6,})(?:\/|$)/)?.[1]??null;if(!externalPostingId)return null;
  const ld=jsonLd(body);const plain=stripTags(body);
  const rawTitle=clean(ld?.title)??body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??null;
  const cleanTitle=rawTitle?stripTags(rawTitle).replace(/\s+[|\-–]\s+Strike.*$/i,"").replace(/\s+/g," ").trim():null;
  // Location: the page's own Location attribute first, then the JobPosting address; never the employer's other offices.
  const attrLocation=body.match(/<[^>]+title=["']Location["'][^>]*>([\s\S]*?)<\/[a-z]+>/i)?.[1];
  const address=(ld?.jobLocation as Record<string,unknown>|undefined)?.address as Record<string,unknown>|undefined;
  const ldLocation=[clean(address?.addressLocality),clean(address?.addressRegion)].filter(Boolean).join(", ")||null;
  const location=(attrLocation?stripTags(attrLocation).replace(/\s+/g," ").trim():null)||ldLocation||plain.match(/\b(Houston|Baytown|Pasadena|Deer Park|La Porte|Pearland|Channelview),?\s*(?:Texas|TX)\b/i)?.[0]||null;
  if(!cleanTitle||!/(electrician|electrical apprentice|electrical helper)/i.test(cleanTitle))return null;
  if(!location||!/\b(Houston|Baytown|Pasadena|Deer Park|La Porte|Pearland|Channelview)\b/i.test(location))return null;
  const descriptionHtml=body.match(/<div[^>]+id=["']job-description["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div[^>]+(?:class|id)=["'][^"']*(?:apply|job-application)[^"']*["'])/i)?.[1];
  const description=textOnly(ld?.description)??(descriptionHtml?stripTags(descriptionHtml).replace(/\s+/g," ").trim().slice(0,1200)||null:null);
  const postingDate=clean(ld?.datePosted);
  const apprentice=/apprentice|helper/i.test(cleanTitle);
  const normalizedLocation=location.replace(/\s*,?\s*Texas\b/i,", TX");
  return{sourceUrl,normalizedUrl:url,externalPostingId,employerName:JAZZHR_BOARDS[board],title:cleanTitle,profession:apprentice?"ELECTRICAL APPRENTICE":"ELECTRICIAN",
    professionalLevel:apprentice?"APPRENTICE":/journeyman/i.test(cleanTitle)?"JOURNEYMAN":null,location:normalizedLocation,compensation:null,perDiem:null,experience:null,licenses:[],certifications:[],postingDate,
    explicitEmployerHeadcount:null,applicationUrl:url,relationship:"DIRECT_HIRE_POSTING",vendorAcceptance:"UNKNOWN",capturedAt,evidenceExcerpt:(description??plain).slice(0,600),
    evidenceCompleteness:description&&postingDate?"COMPLETE":"PARTIAL",parentAggregateObservationId};
}

export type PersistedPolicyState = "ALLOWED" | "PERSISTED_ALLOW_REQUIRED" | "POLICY_EXPIRED" | "POLICY_NOT_ALLOWED";
/**
 * The access decision in force is the LATEST non-superseded HTTP_FETCH decision recorded for the enabled source of this
 * host (append-only source_capture_policy_decisions). An older ALLOW never outranks a newer DENY/REVIEW_REQUIRED, an
 * expired ALLOW does not authorize, and a policy documented only in code is not a persisted authorization.
 */
export async function resolvePersistedCapturePolicy(db:SqlClient,host:string,now:Date):Promise<{state:PersistedPolicyState;sourceId:string|null;decisionId:string|null}>{
  const latest=(await db.query<{id:string;source_id:string;decision:string;valid_until:string|Date|null}>(`select p.id,p.source_id,p.decision::text as decision,p.valid_until from source_capture_policy_decisions p join sources s on s.id=p.source_id
     where s.enabled=true and lower(s.domain)=lower($1) and p.capture_method='HTTP_FETCH' and p.reviewed_at<=$2
       and not exists(select 1 from source_capture_policy_decisions newer where newer.supersedes_decision_id=p.id)
     order by p.reviewed_at desc,p.created_at desc,p.id desc limit 1`,[host,now.toISOString()])).rows[0];
  if(!latest)return{state:"PERSISTED_ALLOW_REQUIRED",sourceId:null,decisionId:null};
  if(latest.decision!=="ALLOWED")return{state:"POLICY_NOT_ALLOWED",sourceId:latest.source_id,decisionId:latest.id};
  if(latest.valid_until!==null&&new Date(latest.valid_until).getTime()<now.getTime())return{state:"POLICY_EXPIRED",sourceId:latest.source_id,decisionId:latest.id};
  return{state:"ALLOWED",sourceId:latest.source_id,decisionId:latest.id};
}

export class IndividualPostingCaptureCoordinator {
  constructor(private readonly db: SqlClient,private readonly transport:CaptureTransport=new SafePublicTransport(),private readonly now=()=>new Date()){}
  async run(request:PostingCaptureRequest,access:SourceAccessDecision,knownCostUsd:number|null){requireCaptureAuthorization(request,access);const host=new URL(request.source).hostname;const policy=await resolvePersistedCapturePolicy(this.db,host,this.now());if(policy.state!=="ALLOWED")throw new Error(policy.state);const budget=new CaptureBudget({externalRequests:request.maximumExternalRequests,postings:request.maximumResults,additionalCostUsd:request.costCeilingUsd});
    let current=request.source; let response; for(let redirect=0;redirect<=MAX_REDIRECTS;redirect+=1){budget.reserveRequest(knownCostUsd);response=await this.transport.fetch(current);if(response.status>=300&&response.status<400&&response.redirect){if(redirect===MAX_REDIRECTS)throw new Error("REDIRECT_LIMIT");current=new URL(response.redirect,current).toString();continue}break}
    if(!response||response.status<200||response.status>=300)throw new Error(`SOURCE_HTTP_${response?.status??"UNKNOWN"}`);const parsed=parseJobPosting(response.body,response.url,this.now().toISOString(),request.parentAggregateObservationId);const {unique,duplicates}=deduplicatePostings(parsed?[parsed]:[],new URL(request.source).hostname);
    const persisted=[];for(const posting of unique){budget.acceptPosting();persisted.push(await this.persist(posting,request,response.contentType,policy.sourceId!));}return {ledger:budget.snapshot(),postings:persisted,duplicates,sourceFailures:0};}
  private async persist(posting:CapturedPosting,request:PostingCaptureRequest,contentType:string,authorizedSourceId:string){
    // Persist against the exact source whose ALLOW decision authorized this capture.
    return persistIndividualPosting(this.db,{posting,identitySource:new URL(request.source).hostname,sourceId:authorizedSourceId,runId:request.runId,contentType,captureMethod:"HTTP_FETCH",
      extractorVersion:"recipe-1.1@1",relevanceReason:"Recipe 1.1 owner-authorized individual posting capture",automationPolicy:"AUTOMATABLE",allowedMethod:"HTTP_FETCH",
      policyReason:"Persisted source policy ALLOW required before every capture",
      metadata:{recipeIdentity:request.recipeIdentity,runId:request.runId,queryId:request.queryId,operatorAuthorization:request.operatorAuthorization,captureMethod:request.captureMethod}});
  }
}

/** How an individual posting entered the system. Automated captures need a persisted ALLOW; assisted ones never visit the URL. */
export type PostingProvenance = "AUTOMATED_HTTP" | "ASSISTED_MANUAL" | "EMAIL_ALERT";
export interface PersistPostingArgs {
  readonly posting: CapturedPosting;
  /** Host used for the posting identity (same rule for every channel, so channels deduplicate against each other). */
  readonly identitySource: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly contentType: string;
  readonly captureMethod: "HTTP_FETCH" | "MANUAL";
  readonly extractorVersion: string;
  readonly relevanceReason: string;
  readonly automationPolicy: "AUTOMATABLE" | "MANUAL_FIRST";
  readonly allowedMethod: "HTTP_FETCH" | "MANUAL";
  readonly policyReason: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Candidate title shown in Radar/Human Review; defaults to the posting title. Built only from recorded facts. */
  readonly candidateTitle?: string;
}

/**
 * Shared persistence for one individual posting: raw_evidence → discovery candidate → dated watch observation →
 * Human Review (/radar/{candidateId}). Idempotent for the same content and observation time; candidates are append-only
 * for the runtime role (a replay reuses the row). Never creates a company, an opportunity or a client.
 */
export async function persistIndividualPosting(db:SqlClient,args:PersistPostingArgs){
  const {posting}=args;
  const identity=postingIdentity(args.identitySource,posting.externalPostingId,posting.normalizedUrl);
  const stablePosting={...posting,capturedAt:undefined};
  const metadata={recipe11:true,postingIdentity:identity,posting,...args.metadata};
  const hash=createHash("sha256").update(JSON.stringify({stablePosting,evidenceExcerpt:posting.evidenceExcerpt})).digest("hex");
  const evidence=await db.query<{id:string}>(`with existing as(select id from raw_evidence where source_id=$1 and content_hash=$4 order by captured_at desc limit 1),inserted as(insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata,content_type,payload_size_bytes,http_metadata) select $1,$2,$3,$9::capture_method,$4,$10,$5::jsonb,$6,$7,$8::jsonb where not exists(select 1 from existing) returning id) select id from existing union all select id from inserted limit 1`,
    [args.sourceId,posting.sourceUrl,posting.capturedAt,hash,JSON.stringify(metadata),args.contentType,Buffer.byteLength(posting.evidenceExcerpt),JSON.stringify(args.captureMethod==="HTTP_FETCH"?{status:200}:{}),args.captureMethod,args.extractorVersion]);
  await db.query("insert into company_discovery_run_sources(run_id,source_id,status) values($1,$2,'COMPLETED') on conflict(run_id,source_id) do update set status='COMPLETED'",[args.runId,args.sourceId]);
  const candidate=await db.query<{id:string}>(`insert into company_discovery_candidates(run_id,discovery_source_id,query_kind,title,candidate_url,normalized_candidate_url,source_domain,provider_description,relevance_reason,provider_rank,provider_metadata,canonical_evidence_id,human_review_required,strategy_kind,observation_state,observation_first_seen_at,observation_last_seen_at) values($1,$2,'ELECTRICAL_HIRING',$3,$4,$5,$6,$7,$11,1,$8::jsonb,$9,true,'ATS_CAREER_DISCOVERY','NEW',$10,$10) on conflict(run_id,normalized_candidate_url) do nothing returning id`,
    [args.runId,args.sourceId,(args.candidateTitle??posting.title??"Unresolved electrical posting").slice(0,300),posting.sourceUrl,posting.normalizedUrl,new URL(posting.normalizedUrl).hostname,posting.evidenceExcerpt,JSON.stringify({recipe11:true,postingIdentity:identity,externalPostingId:posting.externalPostingId,provenance:args.metadata.provenance??"AUTOMATED_HTTP"}),evidence.rows[0].id,posting.capturedAt,args.relevanceReason]);
  // Candidates are append-only for the runtime role: a replay in the same run reuses the existing row (no UPDATE).
  if(!candidate.rows[0])candidate.rows.push((await db.query<{id:string}>("select id from company_discovery_candidates where run_id=$1 and normalized_candidate_url=$2",[args.runId,posting.normalizedUrl])).rows[0]);
  const recipe=await db.query<{id:string}>("select id from discovery_recipes where recipe_key='electrical-entry-ats-texas' order by version desc limit 1");
  const watch=await db.query<{id:string}>(`insert into discovery_watch_sources(source_id,recipe_id,strategy_kind,source_url,normalized_source_url,source_type,platform,automation_policy,allowed_method,policy_reason,policy_reviewed_at,watch_tier,cadence_hours,next_eligible_at,health_status) values($1,$2,'ATS_CAREER_DISCOVERY',$3,$4,'ATS_PUBLIC_BOARD',$7,$8,$9,$10,$5,'A',168,$6,'HEALTHY') on conflict(normalized_source_url) do update set updated_at=now() returning id`,
    [args.sourceId,recipe.rows[0]?.id??null,posting.sourceUrl,posting.normalizedUrl,posting.capturedAt,new Date(new Date(posting.capturedAt).getTime()+168*3600000).toISOString(),platformForHost(posting.sourceUrl),args.automationPolicy,args.allowedMethod,args.policyReason]);
  await db.query(`insert into discovery_watch_observations(watch_source_id,observation_identity,normalized_url,external_posting_id,content_hash,state,first_seen_at,last_seen_at,captured_at,candidate_id,evidence_id,metadata) values($1,$2,$3,$4,$5,'NEW',$6,$6,$6,$7,$8,$9::jsonb) on conflict(watch_source_id,observation_identity,captured_at) do update set evidence_id=excluded.evidence_id,candidate_id=excluded.candidate_id`,
    [watch.rows[0].id,identity,posting.normalizedUrl,posting.externalPostingId,hash,posting.capturedAt,candidate.rows[0].id,evidence.rows[0].id,JSON.stringify({recipe11:true,canonicalEvidence:true,electricalLevel:posting.professionalLevel??"UNKNOWN",parentAggregateObservationId:posting.parentAggregateObservationId,provenance:args.metadata.provenance??"AUTOMATED_HTTP"})]);
  return {...posting,identity,evidenceId:evidence.rows[0].id,candidateId:candidate.rows[0].id,watchSourceId:watch.rows[0].id,reviewHref:`/radar/${candidate.rows[0].id}`};
}
