import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { COMPANY_ATS_CATALOG } from "../../domain/company-ats-catalog";
import { classifyPostingLevel } from "../../domain/posting-level";
import { latestSupplierAnswer, supplierAnswerEffect, type RecordedSupplierAnswer } from "../../domain/external-supplier-answer";
import {
  classifyStaffingDemand, comparePriority, staffingPriority, type CompanyStaffingEvidence, type DemandAssessment, type ExplicitRequestEvidence,
  type PainEvidence, type PostingEvidence, type ProjectEvidence, type StaffingPriority,
} from "../../domain/staffing-demand";
import { loadSupplierAnswers } from "../discovery-intelligence/external-supplier-answers";
import { loadProjectSignals, type ProjectSignalView } from "./project-signals";

/**
 * Staffing commercial intelligence read model: one row per company, built only from evidence that already exists
 * (verified postings, imported project signals, Phase 3A needs and follow-up, supplier answers, external-labor
 * acceptance, contacts, aggregate workforce supply). Read-only: it never creates or changes anything.
 */
export interface StaffingCompany {
  readonly key: string;
  readonly name: string;
  readonly companyId: string | null;
  readonly catalogKey: string | null;
  readonly catalogRank: number | null;
  readonly dataClass: "REAL" | "DEMO";
  readonly demand: DemandAssessment;
  readonly priority: StaffingPriority;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
  readonly evidence: { readonly postingsVerified: number; readonly postingsTotal: number; readonly projects: readonly ProjectEvidence[]; readonly pains: number; readonly explicitRequests: readonly ExplicitRequestEvidence[] };
  readonly supplierAnswer: RecordedSupplierAnswer | null;
  readonly manpowerAcceptance: string | null;
  readonly contacts: { readonly people: number; readonly verifiedRoutes: number };
  readonly networkWorkers: number;
  readonly lastConversation: { readonly date: string; readonly kind: "SUPPLIER_ANSWER" | "ACTIVITY"; readonly summary: string | null } | null;
  /** Next action a person recorded (latest answer or follow-up), shown before the computed suggestion. */
  readonly humanNextAction: { readonly text: string; readonly due: string | null } | null;
  readonly commercialResult: string | null;
}

export interface StaffingSnapshot {
  readonly companies: readonly StaffingCompany[];
  readonly projects: readonly ProjectSignalView[];
  readonly metrics: {
    readonly real: { readonly companies: number; readonly high: number; readonly medium: number; readonly low: number; readonly insufficient: number; readonly explicit: number; readonly inferred: number;
      readonly projectsReceived: number; readonly projectsPendingLink: number; readonly verifiedContacts: number; readonly pendingConversations: number; readonly staffRequests: number };
    readonly demo: { readonly companies: number; readonly projectsReceived: number };
  };
}

const normalize = (value: string) => value.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|co|corp|group|ltd|lp)\b/g, " ").replace(/\s+/g, " ").trim();
const isDemoName = (value: string) => /\bDEMO LOCAL\b/i.test(value);
const iso = (value: unknown) => new Date(String(value)).toISOString();
const str = (value: unknown) => (value == null || value === "" ? null : String(value));

export async function loadStaffingIntelligence(db: SqlClient, now = new Date(), only?: { readonly companyId: string }): Promise<StaffingSnapshot> {
  const [postings, pains, activities, acceptance, people, routes, supply, companies, projects, answers] = await Promise.all([
    db.query<Record<string, unknown>>(`select distinct on (o.observation_identity) o.observation_identity identity,o.captured_at,e.metadata->'posting' posting,
        coalesce(e.metadata->>'dataClass','REAL') data_class,
        (select min(o2.captured_at) from discovery_watch_observations o2 where o2.observation_identity=o.observation_identity) first_seen,
        (select r.decision from discovery_signal_reviews r where r.candidate_id=o.candidate_id and r.decision<>'PROMOTED' order by r.decided_at desc,r.id desc limit 1) posting_decision,
        (select a.candidate_company_id from company_resolution_audits a where a.discovery_watch_observation_id=o.id order by a.resolved_at desc,a.created_at desc,a.id desc limit 1) company_id,
        (select h.decision::text from discovery_observation_demand_signals x join human_verification_decisions h on h.target_type='DEMAND_SIGNAL' and h.target_id=x.demand_signal_id
          where x.discovery_watch_observation_id=o.id order by h.decided_at desc,h.created_at desc limit 1) demand_decision
      from discovery_watch_observations o join raw_evidence e on e.id=o.evidence_id
      where e.metadata->>'recipe11'='true' order by o.observation_identity,o.captured_at desc,e.created_at desc`),
    db.query<Record<string, unknown>>(`select company_id,pain_type,status,coalesce(observed_at,recorded_at) at,summary,needed_headcount,needed_role_text from commercial_pain_signals where company_id is not null`),
    db.query<Record<string, unknown>>(`select a.company_id,a.activity_type,a.outcome,a.result,a.performed_at,a.next_action,a.next_action_due,a.notes,a.staff_request_demand_signal_id,
        d.headcount_estimate,d.title demand_title from commercial_activities a left join demand_signals d on d.id=a.staff_request_demand_signal_id where a.company_id is not null`),
    db.query<Record<string, unknown>>(`select distinct on (company_id) company_id,result::text result from manpower_acceptance_evaluations where company_id is not null order by company_id,evaluated_at desc`),
    db.query<Record<string, unknown>>(`select company_id,count(*)::int n from contact_people where company_id is not null group by company_id`),
    db.query<Record<string, unknown>>(`select company_id,count(*)::int n from contact_routes where company_id is not null and verification_state='VERIFIED' group by company_id`),
    db.query<{ real: string | number }>(`select count(distinct w.id) real from worker_trade_occupations t join workforce_workers w on w.id=t.worker_id
        where t.trade_code='ELECTRICAL' and w.lifecycle_status='ACTIVE' and w.display_name not ilike 'DEMO LOCAL%'`),
    db.query<{ id: string; name: string }>("select id,coalesce(common_name,legal_name) name from companies where merged_into_company_id is null"),
    loadProjectSignals(db),
    loadSupplierAnswers(db),
  ]);
  const electricalWorkers = Number(supply.rows[0]?.real ?? 0);
  const companyById = new Map(companies.rows.map((c) => [c.id, c.name]));
  const companyByName = new Map(companies.rows.map((c) => [normalize(c.name), c.id]));
  const catalogByName = new Map(COMPANY_ATS_CATALOG.map((t) => [normalize(t.name), t]));

  // ---- subjects: one per company (canonical id when known, else catalog key, else exact normalized name)
  interface Subject { key: string; name: string; companyId: string | null; catalogKey: string | null; catalogRank: number | null }
  const subjects = new Map<string, Subject>();
  const subjectFor = (input: { companyId?: string | null; name?: string | null; catalogKey?: string | null }): Subject | null => {
    const catalog = input.catalogKey ? COMPANY_ATS_CATALOG.find((t) => t.key === input.catalogKey) ?? null : input.name ? catalogByName.get(normalize(input.name)) ?? null : null;
    const companyId = input.companyId ?? (catalog ? companyByName.get(normalize(catalog.name)) ?? null : null) ?? (input.name ? companyByName.get(normalize(input.name)) ?? null : null);
    const name = (companyId ? companyById.get(companyId) : null) ?? catalog?.name ?? input.name ?? null;
    if (!name) return null;
    const key = companyId ? `company:${companyId}` : catalog ? `catalog:${catalog.key}` : `name:${normalize(name)}`;
    const existing = subjects.get(key);
    if (existing) { if (!existing.catalogKey && catalog) Object.assign(existing, { catalogKey: catalog.key, catalogRank: catalog.commercialPriority?.rank ?? null }); return existing; }
    const subject = { key, name, companyId, catalogKey: catalog?.key ?? null, catalogRank: catalog?.commercialPriority?.rank ?? null };
    subjects.set(key, subject);
    return subject;
  };
  for (const t of COMPANY_ATS_CATALOG.filter((t) => t.commercialPriority)) subjectFor({ catalogKey: t.key });

  const evidence = new Map<string, { postings: PostingEvidence[]; projects: ProjectEvidence[]; pains: PainEvidence[]; explicit: ExplicitRequestEvidence[]; demo: boolean; dates: string[] }>();
  const bucket = (s: Subject) => { if (!evidence.has(s.key)) evidence.set(s.key, { postings: [], projects: [], pains: [], explicit: [], demo: isDemoName(s.name), dates: [] }); return evidence.get(s.key)!; };

  for (const row of postings.rows) {
    const p = (row.posting ?? {}) as Record<string, unknown>;
    const s = subjectFor({ companyId: str(row.company_id), name: str(p.employerName) });
    if (!s) continue;
    const b = bucket(s);
    if (row.data_class === "DEMO") b.demo = true;
    const licenses = Array.isArray(p.licenses) ? p.licenses.map(String) : [];
    b.postings.push({ identity: String(row.identity), title: str(p.title), location: str(p.location), observedAt: iso(row.first_seen), postingVerified: row.posting_decision === "VERIFIED",
      demandVerified: row.demand_decision === "VERIFY", directHire: true, experience: str(p.experience), licenses, compensation: str(p.compensation),
      levelClass: classifyPostingLevel({ title: str(p.title), experience: str(p.experience), licenses }) });
    b.dates.push(iso(row.captured_at));
  }
  for (const signal of projects) {
    if (!signal.link) continue; // unconfirmed records are listed separately; they are not company evidence yet
    const s = subjectFor({ companyId: signal.link.companyId });
    if (!s) continue;
    const b = bucket(s);
    if (signal.dataClass === "DEMO") b.demo = true;
    const r = signal.record;
    b.projects.push({ evidenceId: signal.evidenceId, projectName: r.project.name.value, stage: r.company.stage, contractStatus: r.contractStatus, startDate: r.startDate, duration: r.duration,
      location: [r.project.city.value, r.project.state.value].filter(Boolean).join(", ") || null, trades: r.project.trades.value ?? [], observedAt: r.observedAt, linkConfirmed: true });
    b.dates.push(r.observedAt);
  }
  for (const row of pains.rows) {
    const s = subjectFor({ companyId: str(row.company_id) }); if (!s) continue;
    const b = bucket(s);
    b.pains.push({ type: String(row.pain_type), verified: row.status === "VERIFIED", observedAt: iso(row.at), summary: String(row.summary ?? "") });
    if (row.pain_type === "INBOUND_REQUEST" && row.status === "VERIFIED") b.explicit.push({ kind: "VERIFIED_INBOUND_REQUEST", evidenceRef: `pain:${String(row.at)}`, date: iso(row.at), headcount: row.needed_headcount == null ? null : Number(row.needed_headcount), role: str(row.needed_role_text) });
    b.dates.push(iso(row.at));
  }
  const activitiesBy = new Map<string, Record<string, unknown>[]>();
  for (const row of activities.rows) {
    const s = subjectFor({ companyId: str(row.company_id) }); if (!s) continue;
    activitiesBy.set(s.key, [...(activitiesBy.get(s.key) ?? []), row]);
    const b = bucket(s);
    if (row.outcome === "STAFF_REQUEST" || row.activity_type === "STAFF_REQUEST_RECEIVED") b.explicit.push({ kind: "STAFF_REQUEST", evidenceRef: `activity:${String(row.staff_request_demand_signal_id ?? "")}`, date: iso(row.performed_at),
      headcount: row.headcount_estimate == null ? null : Number(row.headcount_estimate), role: str(row.demand_title) });
    b.dates.push(iso(row.performed_at));
  }
  const answersBy = new Map<string, RecordedSupplierAnswer[]>();
  for (const a of answers) { const s = subjectFor({ companyId: a.companyId, catalogKey: a.catalogKey, name: a.companyName }); if (s) { answersBy.set(s.key, [...(answersBy.get(s.key) ?? []), a]); bucket(s).dates.push(a.recordedAt); } }
  const acceptanceBy = new Map(acceptance.rows.map((r) => [String(r.company_id), String(r.result)]));
  const peopleBy = new Map(people.rows.map((r) => [String(r.company_id), Number(r.n)]));
  const routesBy = new Map(routes.rows.map((r) => [String(r.company_id), Number(r.n)]));

  const result: StaffingCompany[] = [...subjects.values()].filter((s) => !only || s.companyId === only.companyId).map((s) => {
    const b = bucket(s);
    const ev: CompanyStaffingEvidence = { explicitRequests: b.explicit, postings: b.postings, projects: b.projects, pains: b.pains };
    const answer = latestSupplierAnswer(answersBy.get(s.key) ?? []);
    const demand = classifyStaffingDemand(ev, answer?.answer ?? null);
    const accept = s.companyId ? acceptanceBy.get(s.companyId) ?? null : null;
    const electrical = b.postings.some((p) => /electric/i.test(p.title ?? "")) || b.projects.some((p) => p.trades.some((t) => /electric/i.test(t)));
    const verifiedRoutes = s.companyId ? routesBy.get(s.companyId) ?? 0 : 0;
    const lastEvidenceAt = b.dates.sort().at(-1) ?? null;
    const priority = staffingPriority({ demand, evidence: ev, supplierAnswer: answer?.answer ?? null, supplierAnswerHasEvidence: Boolean(answer && supplierAnswerEffect(answer).commercialSignal),
      manpowerAcceptance: accept === "VERIFIED_POSITIVE" || accept === "VERIFIED_NEGATIVE" ? accept : accept ? "OTHER" : null, verifiableContacts: verifiedRoutes,
      networkWorkers: electrical ? electricalWorkers : 0, lastEvidenceAt, now });
    const acts = (activitiesBy.get(s.key) ?? []).sort((x, y) => iso(y.performed_at).localeCompare(iso(x.performed_at)));
    const lastActivity = acts[0] ?? null;
    const lastConversation = [
      answer && answer.answer !== "NOT_INVESTIGATED" ? { date: answer.conversationDate ?? answer.recordedAt.slice(0, 10), kind: "SUPPLIER_ANSWER" as const, summary: answer.summary } : null,
      lastActivity ? { date: iso(lastActivity.performed_at).slice(0, 10), kind: "ACTIVITY" as const, summary: str(lastActivity.notes) ?? str(lastActivity.outcome) } : null,
    ].filter((x): x is NonNullable<typeof x> => Boolean(x)).sort((x, y) => y.date.localeCompare(x.date))[0] ?? null;
    const humanNext = [
      answer?.nextAction ? { text: answer.nextAction, due: null, at: answer.recordedAt } : null,
      ...acts.filter((a) => a.next_action).map((a) => ({ text: String(a.next_action), due: a.next_action_due ? String(a.next_action_due).slice(0, 10) : null, at: iso(a.performed_at) })),
    ].filter((x): x is NonNullable<typeof x> => Boolean(x)).sort((x, y) => y.at.localeCompare(x.at))[0] ?? null;
    const confidence = priority.confirmed.length >= 3 ? "HIGH" as const : priority.confirmed.length + priority.inferences.length >= 2 ? "MEDIUM" as const : "LOW" as const;
    return {
      key: s.key, name: s.name, companyId: s.companyId, catalogKey: s.catalogKey, catalogRank: s.catalogRank, dataClass: (b.demo || isDemoName(s.name) ? "DEMO" : "REAL") as "REAL" | "DEMO",
      demand, priority, confidence,
      evidence: { postingsVerified: b.postings.filter((p) => p.postingVerified).length, postingsTotal: b.postings.length, projects: b.projects, pains: b.pains.length, explicitRequests: b.explicit },
      supplierAnswer: answer, manpowerAcceptance: accept, contacts: { people: s.companyId ? peopleBy.get(s.companyId) ?? 0 : 0, verifiedRoutes },
      networkWorkers: electrical ? electricalWorkers : 0, lastConversation, humanNextAction: humanNext ? { text: humanNext.text, due: humanNext.due } : null,
      commercialResult: str(acts.find((a) => a.result)?.result),
    };
  }).sort((a, b) => comparePriority(a.priority.tier, b.priority.tier) || (a.catalogRank ?? 99) - (b.catalogRank ?? 99) || a.name.localeCompare(b.name));

  const real = result.filter((c) => c.dataClass === "REAL"), demo = result.filter((c) => c.dataClass === "DEMO");
  const realProjects = projects.filter((p) => p.dataClass === "REAL");
  return {
    companies: result,
    projects: only ? projects.filter((p) => p.link?.companyId === only.companyId || p.suggestedCompany?.id === only.companyId) : projects,
    metrics: {
      real: {
        companies: real.length, high: real.filter((c) => c.priority.tier === "HIGH").length, medium: real.filter((c) => c.priority.tier === "MEDIUM").length,
        low: real.filter((c) => c.priority.tier === "LOW").length, insufficient: real.filter((c) => c.priority.tier === "INSUFFICIENT_DATA").length,
        explicit: real.filter((c) => c.demand.demandClass === "EXPLICIT").length, inferred: real.filter((c) => c.demand.demandClass === "INFERRED").length,
        projectsReceived: realProjects.length, projectsPendingLink: realProjects.filter((p) => !p.link).length,
        verifiedContacts: real.reduce((n, c) => n + c.contacts.verifiedRoutes, 0),
        pendingConversations: real.filter((c) => !c.supplierAnswer || c.supplierAnswer.answer === "NO_RESPONSE" || c.supplierAnswer.answer === "NOT_INVESTIGATED").length,
        staffRequests: real.reduce((n, c) => n + c.evidence.explicitRequests.length, 0),
      },
      demo: { companies: demo.length, projectsReceived: projects.length - realProjects.length },
    },
  };
}
