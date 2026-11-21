import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { manualSourceId } from "../discovery-intelligence/assisted-posting-capture";
import { contextNamesCompany, isAggregatorUrl, sourceHost, validateOpportunityCompanyLink, type OpportunityCompanyLinkInput } from "../../domain/opportunity-company-link";

/**
 * Human opportunity → company link (opportunity_companies), evidenced by an append-only raw_evidence record.
 * One company per opportunity (the existing rule of the commercial intake). Nothing here fetches a URL, creates an
 * opportunity, edits the demand or its pay, or links anything without an explicit human confirmation.
 */
export class OpportunityCompanyLinkError extends Error {
  constructor(readonly errors: Readonly<Record<string, string>>) { super(`Invalid opportunity-company link: ${Object.keys(errors).join(", ")}`); }
}

const DEMO_NAME = /\bDEMO LOCAL\b/i;
const isDemoText = (...values: (string | null | undefined)[]) => values.some((v) => DEMO_NAME.test(v ?? ""));

export interface LinkSource { readonly url: string; readonly host: string | null; readonly aggregator: boolean }
export interface LinkCandidateView {
  readonly opportunityId: string; readonly title: string | null; readonly companyContext: string | null; readonly lifecycle: string;
  readonly isDemo: boolean; readonly suggested: boolean; readonly aggregatorSource: boolean; readonly sources: readonly LinkSource[];
  readonly demandTitles: readonly string[]; readonly publishedPay: string | null;
}
export interface LinkedOpportunityView { readonly opportunityId: string; readonly title: string | null; readonly linkReason: string; readonly linkedOn: string; readonly aggregatorSource: boolean }

async function company(db: SqlClient, companyId: string) {
  const row = (await db.query<{ id: string; name: string }>("select id,coalesce(common_name,legal_name) name from companies where id=$1 and merged_into_company_id is null", [companyId])).rows[0];
  if (!row) throw new OpportunityCompanyLinkError({ companyId: "notFound" });
  return { ...row, isDemo: isDemoText(row.name) };
}

async function opportunitySources(db: SqlClient, opportunityIds: readonly string[]) {
  if (!opportunityIds.length) return new Map<string, { sources: LinkSource[]; demandTitles: string[]; pay: string | null }>();
  const rows = (await db.query<{ opportunity_id: string; source_url: string | null; demand_title: string | null; pay: string | null }>(
    `select x.opportunity_id,x.source_url,x.demand_title,x.pay from (
       select od.opportunity_id,e.source_url,d.title demand_title,
              case when d.base_pay_min is not null or d.base_pay_max is not null then concat_ws(' – ',d.base_pay_min::text,d.base_pay_max::text)||coalesce(' / '||lower(d.pay_period::text),'') end pay
         from opportunity_demand_signals od join demand_signals d on d.id=od.demand_signal_id left join raw_evidence e on e.id=d.raw_evidence_id
        where od.opportunity_id=any($1::uuid[])
       union all
       select oe.opportunity_id,e.source_url,null,null from opportunity_evidence oe join raw_evidence e on e.id=oe.evidence_id where oe.opportunity_id=any($1::uuid[])) x`, [opportunityIds])).rows;
  const by = new Map<string, { sources: LinkSource[]; demandTitles: string[]; pay: string | null }>();
  for (const r of rows) {
    const entry = by.get(r.opportunity_id) ?? { sources: [], demandTitles: [], pay: null };
    if (r.source_url && /^https?:\/\//i.test(r.source_url) && !entry.sources.some((s) => s.url === r.source_url)) entry.sources.push({ url: r.source_url, host: sourceHost(r.source_url), aggregator: isAggregatorUrl(r.source_url) });
    if (r.demand_title && !entry.demandTitles.includes(r.demand_title)) entry.demandTitles.push(r.demand_title);
    if (r.pay && !entry.pay) entry.pay = r.pay;
    by.set(r.opportunity_id, entry);
  }
  return by;
}

/** Unlinked opportunities of the same data class (REAL with REAL, DEMO with DEMO) and this company's current links. */
export async function loadOpportunityCompanyLinks(db: SqlClient, companyId: string) {
  const c = await company(db, companyId);
  const [unlinked, linked] = await Promise.all([
    db.query<{ id: string; title: string | null; unresolved_company_context: string | null; lifecycle: string }>(
      `select o.id,o.title,o.unresolved_company_context,o.lifecycle::text lifecycle from opportunities o
        where not exists (select 1 from opportunity_companies oc where oc.opportunity_id=o.id) order by o.created_at desc`),
    db.query<{ opportunity_id: string; title: string | null; link_reason: string; linked_on: string; metadata: Record<string, unknown> | null }>(
      `select oc.opportunity_id,o.title,oc.link_reason,to_char(oc.created_at at time zone 'UTC','YYYY-MM-DD') linked_on,e.metadata
         from opportunity_companies oc join opportunities o on o.id=oc.opportunity_id left join raw_evidence e on e.id=oc.evidence_id
        where oc.company_id=$1 order by oc.created_at desc`, [companyId]),
  ]);
  const candidates = unlinked.rows.filter((o) => isDemoText(o.title, o.unresolved_company_context) === c.isDemo);
  const sources = await opportunitySources(db, candidates.map((o) => o.id));
  const views = candidates.map((o): LinkCandidateView => {
    const s = sources.get(o.id) ?? { sources: [], demandTitles: [], pay: null };
    return { opportunityId: o.id, title: o.title, companyContext: o.unresolved_company_context, lifecycle: o.lifecycle, isDemo: c.isDemo,
      suggested: contextNamesCompany(o.unresolved_company_context, c.name), aggregatorSource: s.sources.some((x) => x.aggregator), sources: s.sources, demandTitles: s.demandTitles, publishedPay: s.pay };
  }).sort((a, b) => Number(b.suggested) - Number(a.suggested));
  return {
    companyName: c.name, companyIsDemo: c.isDemo, candidates: views,
    linked: linked.rows.map((r): LinkedOpportunityView => ({ opportunityId: r.opportunity_id, title: r.title, linkReason: r.link_reason, linkedOn: r.linked_on, aggregatorSource: r.metadata?.aggregatorSource === true })),
  };
}

export async function linkOpportunityToCompany(db: SqlClient, input: OpportunityCompanyLinkInput, operatorId: string, now = new Date()) {
  if (!input.opportunityId || !input.companyId) throw new OpportunityCompanyLinkError(validateOpportunityCompanyLink(input, { opportunityIsDemo: false, companyIsDemo: false, aggregatorSource: false, existingLink: "NONE" }));
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`opportunity-company-link:${input.opportunityId}`]);
  const c = await company(db, input.companyId);
  const o = (await db.query<{ id: string; title: string | null; unresolved_company_context: string | null }>("select id,title,unresolved_company_context from opportunities where id=$1", [input.opportunityId])).rows[0];
  if (!o) throw new OpportunityCompanyLinkError({ opportunityId: "notFound" });
  const existing = (await db.query<{ company_id: string }>("select company_id from opportunity_companies where opportunity_id=$1", [input.opportunityId])).rows;
  const src = (await opportunitySources(db, [input.opportunityId])).get(input.opportunityId) ?? { sources: [], demandTitles: [], pay: null };
  const aggregatorSource = src.sources.some((s) => s.aggregator);
  const errors = validateOpportunityCompanyLink(input, {
    opportunityIsDemo: isDemoText(o.title, o.unresolved_company_context), companyIsDemo: c.isDemo, aggregatorSource,
    existingLink: existing.some((e) => e.company_id === input.companyId) ? "SAME_COMPANY" : existing.length ? "OTHER_COMPANY" : "NONE",
  });
  if (Object.keys(errors).length) throw new OpportunityCompanyLinkError(errors);

  const metadata = {
    kind: "OPPORTUNITY_COMPANY_LINK", opportunityId: o.id, opportunityTitle: o.title, companyId: c.id, companyName: c.name,
    unresolvedCompanyContext: o.unresolved_company_context, reason: input.reason.trim(), evidenceNote: input.evidenceNote?.trim() || null,
    sourceUrls: src.sources.map((s) => s.url), aggregatorSource, aggregatorAcknowledged: aggregatorSource ? input.aggregatorAcknowledged : null,
    // the link names the company; it does not make the company the publisher, nor the published pay the company's pay
    payAttributedToCompany: false, publisherConfirmed: false, humanConfirmed: true, recordedByOperatorId: operatorId, recordedAt: now.toISOString(),
  };
  const payload = JSON.stringify(metadata);
  const evidence = (await db.query<{ id: string }>(
    `insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata,content_type,payload_size_bytes)
     values($1,$2,$3,'MANUAL',$4,'opportunity-company-link@1',$5::jsonb,'application/json',$6) returning id`,
    [await manualSourceId(db, now), `urn:fly-workforce-radar:opportunity-company-link:${o.id}:${c.id}`, now.toISOString(),
      createHash("sha256").update(payload).digest("hex"), payload, Buffer.byteLength(payload)])).rows[0];
  const inserted = await db.query<{ opportunity_id: string }>(
    `insert into opportunity_companies(opportunity_id,company_id,link_reason,evidence_id)
     select $1,$2,$3,$4 where not exists (select 1 from opportunity_companies where opportunity_id=$1) returning opportunity_id`,
    [o.id, c.id, input.reason.trim(), evidence.id]);
  if (!inserted.rows[0]) throw new OpportunityCompanyLinkError({ opportunityId: "alreadyLinked" });
  return { opportunityId: o.id, companyId: c.id, evidenceId: evidence.id, aggregatorSource };
}
