import { createHash } from "node:crypto";
import type { SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { manualSourceId } from "../discovery-intelligence/assisted-posting-capture";
import {
  normalizeCorporateEmail, normalizeCorporatePhone, validateCompanyCall, validateCorporateChannel, validateNextAction,
  type CompanyCallInput, type CorporateChannelInput, type NextActionInput,
} from "../../domain/company-contact-desk";

/**
 * Contact Intelligence company contact desk: corporate channels (contact_routes without a person, evidenced by the
 * official source), company-level calls (contact_interactions.company_id) and company next actions. Nothing here
 * fetches a URL, creates a person, a contact candidate or an opportunity, or counts DEMO records as real.
 */
export class ContactDeskError extends Error {
  constructor(readonly errors: Readonly<Record<string, string>>) { super(`Invalid contact desk input: ${Object.keys(errors).join(", ")}`); }
}

async function activeCompany(db: SqlClient, companyId: string) {
  const row = (await db.query<{ id: string; name: string }>("select id,coalesce(common_name,legal_name) name from companies where id=$1 and merged_into_company_id is null", [companyId])).rows[0];
  if (!row) throw new ContactDeskError({ companyId: "notFound" });
  return row;
}

export async function recordCorporateChannel(db: SqlClient, input: CorporateChannelInput, operatorId: string, now = new Date()) {
  const errors = validateCorporateChannel(input, now);
  if (Object.keys(errors).length) throw new ContactDeskError(errors);
  await activeCompany(db, input.companyId);
  const phone = input.routeType.endsWith("_PHONE");
  const normalized = (phone ? normalizeCorporatePhone(input.value) : normalizeCorporateEmail(input.value))!;
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`corporate-channel:${input.companyId}:${normalized}`]);
  const existing = (await db.query<{ id: string }>(
    "select id from contact_routes where company_id=$1 and contact_person_id is null and normalized_target=$2 and superseded_by_route_id is null limit 1", [input.companyId, normalized])).rows[0];
  if (existing) return { outcome: "DUPLICATE" as const, routeId: existing.id, evidenceId: null };
  const metadata = { kind: "CORPORATE_CHANNEL", companyId: input.companyId, routeType: input.routeType, value: input.value.trim(), normalizedTarget: normalized,
    locationLabel: input.locationLabel?.trim() || null, sourceNote: input.sourceNote?.trim() || null, observedOn: input.observedOn,
    verificationBasis: "PUBLISHED_ON_OFFICIAL_SITE", callVerified: false, personal: false, supplierChannelConfirmed: false, recordedByOperatorId: operatorId, recordedAt: now.toISOString() };
  const payload = JSON.stringify(metadata);
  const observedAt = `${input.observedOn}T12:00:00.000Z`;
  const evidence = (await db.query<{ id: string }>(
    `insert into raw_evidence(source_id,source_url,captured_at,capture_method,content_hash,extractor_version,metadata,content_type,payload_size_bytes)
     values($1,$2,$3,'MANUAL',$4,'corporate-channel@1',$5::jsonb,'application/json',$6) returning id`,
    [await manualSourceId(db, now), input.sourceUrl.trim(), observedAt, createHash("sha256").update(payload).digest("hex"), payload, Buffer.byteLength(payload)])).rows[0];
  // VERIFIED here means "published on the official source on this date" (evidence + date); it is not a call-tested channel.
  const route = (await db.query<{ id: string }>(
    `insert into contact_routes(company_id,contact_person_id,route_type,target,observed_target,normalized_target,lifecycle,first_seen_at,last_seen_at,verification_state,evidence_id,last_verified_at,route_metadata)
     values($1,null,$2::contact_route_type,$3,$3,$4,'ACTIVE',$5,$5,'VERIFIED',$6,$5,$7::jsonb) returning id`,
    [input.companyId, input.routeType, input.value.trim(), normalized, observedAt, evidence.id,
      JSON.stringify({ verificationBasis: "PUBLISHED_ON_OFFICIAL_SITE", callVerified: false, personal: false, supplierChannelConfirmed: false, sourceUrl: input.sourceUrl.trim(),
        locationLabel: input.locationLabel?.trim() || null, sourceNote: input.sourceNote?.trim() || null, recordedByOperatorId: operatorId })])).rows[0];
  return { outcome: "CREATED" as const, routeId: route.id, evidenceId: evidence.id };
}

export async function recordCompanyCall(db: SqlClient, input: CompanyCallInput, operatorId: string, now = new Date()) {
  const errors = validateCompanyCall(input, now);
  if (Object.keys(errors).length) throw new ContactDeskError(errors);
  await activeCompany(db, input.companyId);
  if (input.contactRouteId) {
    const route = await db.query<{ id: string }>("select id from contact_routes where id=$1 and company_id=$2", [input.contactRouteId, input.companyId]);
    if (!route.rows[0]) throw new ContactDeskError({ contactRouteId: "notThisCompany" });
  }
  const row = (await db.query<{ id: string }>(
    `insert into contact_interactions(candidate_id,company_id,contact_route_id,person_reached,contact_date,channel,handles_external_workforce,notes,recorded_by_operator_id,
       call_outcome,external_supplier_answer,counterpart_name,counterpart_role,is_demo)
     values(null,$1,$2,$3,$4,'PHONE','UNKNOWN',$5,$6,$7,$8,$9,$10,$11) returning id`,
    [input.companyId, input.contactRouteId, input.callOutcome === "REACHED", input.contactDate, input.notes?.trim() || null, operatorId, input.callOutcome, input.supplierAnswer,
      input.counterpartName?.trim() || null, input.counterpartRole?.trim() || null, input.isDemo])).rows[0];
  return { interactionId: row.id };
}

export async function createCompanyNextAction(db: SqlClient, input: NextActionInput & { readonly sourceInteractionId?: string | null }, operatorId: string) {
  const errors = validateNextAction(input);
  if (Object.keys(errors).length) throw new ContactDeskError(errors);
  await activeCompany(db, input.companyId);
  const owner = await db.query<{ id: string }>("select id from workforce_operators where id=$1 and status='ACTIVE'", [input.ownerOperatorId]);
  if (!owner.rows[0]) throw new ContactDeskError({ ownerOperatorId: "notFound" });
  const row = (await db.query<{ id: string }>(
    `insert into company_next_actions(company_id,action,due_date,owner_operator_id,source_interaction_id,is_demo,created_by_operator_id) values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [input.companyId, input.action.trim(), input.dueDate, input.ownerOperatorId, input.sourceInteractionId ?? null, input.isDemo, operatorId])).rows[0];
  return { actionId: row.id };
}

export async function resolveCompanyNextAction(db: SqlClient, input: { readonly actionId: string; readonly status: "DONE" | "CANCELLED"; readonly note: string | null }, operatorId: string, now = new Date()) {
  const updated = await db.query<{ id: string }>(
    "update company_next_actions set status=$2,resolved_at=$3,resolved_by_operator_id=$4,resolution_note=$5 where id=$1 and status='OPEN' returning id",
    [input.actionId, input.status, now.toISOString(), operatorId, input.note?.trim() || null]);
  if (!updated.rows[0]) throw new ContactDeskError({ actionId: "notOpen" });
  return { actionId: updated.rows[0].id };
}

export interface CorporateChannelView { readonly id: string; readonly routeType: string; readonly target: string; readonly sourceUrl: string | null; readonly observedOn: string | null; readonly locationLabel: string | null; readonly verificationState: string }
export interface CompanyCallView { readonly id: string; readonly contactDate: string; readonly callOutcome: string; readonly supplierAnswer: string; readonly counterpartName: string | null; readonly counterpartRole: string | null; readonly notes: string | null; readonly channel: string | null; readonly isDemo: boolean; readonly recordedBy: string | null; readonly recordedAt: string }
export interface CompanyNextActionView { readonly id: string; readonly companyId: string; readonly companyName: string; readonly action: string; readonly dueDate: string; readonly owner: string | null; readonly status: string; readonly isDemo: boolean; readonly createdAt: string; readonly resolutionNote: string | null }

const day = (value: unknown) => (value == null ? null : (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10));

export async function loadCompanyContactDesk(db: SqlClient, companyId: string) {
  const [channels, calls, actions, operators] = await Promise.all([
    db.query<Record<string, unknown>>(`select r.id,r.route_type::text route_type,r.target,r.verification_state::text verification_state,r.route_metadata,e.source_url,to_char(r.first_seen_at at time zone 'UTC','YYYY-MM-DD') first_seen_at
        from contact_routes r left join raw_evidence e on e.id=r.evidence_id where r.company_id=$1 and r.contact_person_id is null and r.superseded_by_route_id is null order by r.created_at`, [companyId]),
    db.query<Record<string, unknown>>(`select i.id,to_char(i.contact_date,'YYYY-MM-DD') contact_date,i.call_outcome,i.external_supplier_answer,i.counterpart_name,i.counterpart_role,i.notes,i.is_demo,i.recorded_at,r.target channel,
        coalesce(o.display_name,o.email) recorded_by from contact_interactions i left join contact_routes r on r.id=i.contact_route_id left join workforce_operators o on o.id=i.recorded_by_operator_id
        where i.company_id=$1 order by i.recorded_at desc,i.id desc`, [companyId]),
    loadCompanyNextActions(db, { companyId }),
    db.query<{ id: string; name: string }>("select id,coalesce(display_name,email) name from workforce_operators where status='ACTIVE' order by 2"),
  ]);
  return {
    channels: channels.rows.map((r): CorporateChannelView => { const m = (r.route_metadata ?? {}) as Record<string, unknown>;
      return { id: String(r.id), routeType: String(r.route_type), target: String(r.target), sourceUrl: r.source_url == null ? (m.sourceUrl as string | null) ?? null : String(r.source_url),
        observedOn: day(r.first_seen_at), locationLabel: (m.locationLabel as string | null) ?? null, verificationState: String(r.verification_state) }; }),
    calls: calls.rows.map((r): CompanyCallView => ({ id: String(r.id), contactDate: day(r.contact_date)!, callOutcome: String(r.call_outcome), supplierAnswer: String(r.external_supplier_answer),
      counterpartName: r.counterpart_name == null ? null : String(r.counterpart_name), counterpartRole: r.counterpart_role == null ? null : String(r.counterpart_role), notes: r.notes == null ? null : String(r.notes),
      channel: r.channel == null ? null : String(r.channel), isDemo: Boolean(r.is_demo), recordedBy: r.recorded_by == null ? null : String(r.recorded_by), recordedAt: new Date(String(r.recorded_at)).toISOString() })),
    actions,
    operators: operators.rows,
  };
}

/** Company next actions; `pendingOn` limits to OPEN actions due on or before that day (the "pending today" view). */
export async function loadCompanyNextActions(db: SqlClient, filter: { readonly companyId?: string; readonly pendingOn?: string }): Promise<readonly CompanyNextActionView[]> {
  const rows = (await db.query<Record<string, unknown>>(
    `select a.id,a.company_id,coalesce(c.common_name,c.legal_name) company_name,a.action,to_char(a.due_date,'YYYY-MM-DD') due_date,a.status,a.is_demo,a.created_at,a.resolution_note,coalesce(o.display_name,o.email) owner
       from company_next_actions a join companies c on c.id=a.company_id left join workforce_operators o on o.id=a.owner_operator_id
      where ($1::uuid is null or a.company_id=$1) and ($2::date is null or (a.status='OPEN' and a.due_date<=$2::date))
      order by (a.status='OPEN') desc,a.due_date,a.created_at`, [filter.companyId ?? null, filter.pendingOn ?? null])).rows;
  return rows.map((r) => ({ id: String(r.id), companyId: String(r.company_id), companyName: String(r.company_name), action: String(r.action), dueDate: day(r.due_date)!, owner: r.owner == null ? null : String(r.owner),
    status: String(r.status), isDemo: Boolean(r.is_demo), createdAt: new Date(String(r.created_at)).toISOString(), resolutionNote: r.resolution_note == null ? null : String(r.resolution_note) }));
}
