import type {
  AddWorkerContactRouteInput, AddWorkerCredentialInput, AddWorkerSkillInput, AddWorkerTradeOccupationInput,
  AddWorkerWorkHistoryInput, AppendWorkerAvailabilityInput, AppendWorkerCompensationExpectationInput,
  AppendWorkerLocationInput, CreateWorkerInput, UpdateWorkerContactConsentInput, UpdateWorkerCredentialVerificationInput,
  UpdateWorkerInput, UpdateWorkerWorkHistoryInput, WorkerAvailabilityRecord, WorkerCompensationExpectationRecord,
  WorkerContactRouteRecord, WorkerCredentialRecord, WorkerLocationRecord, WorkerRecord, WorkerSearchFilter,
  WorkerSkillRecord, WorkerTradeOccupationRecord, WorkerWorkHistoryRecord,
} from "../../../domain/worker";
import type { WorkerIntelligenceFacts,WorkerLevelCode,ExplicitState,PerDiemState,ToolsState,ShiftCode,WorkerConsentPurpose,WorkerConsentState } from "../../../domain/workforce-intelligence";
import type { VerificationState } from "../../../domain/verification";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { WorkerRepository } from "./worker-repository";

const d = (v: string | Date | null): Date | null => (v === null ? null : new Date(v));

interface WorkerRow {
  id: string; display_name: string; lifecycle_status: WorkerRecord["lifecycleStatus"];
  profile_verification_state: VerificationState; verified_at: string | Date | null;
  source_of_record: WorkerRecord["sourceOfRecord"]; first_seen_at: string | Date; last_seen_at: string | Date | null;
  created_at: string | Date; updated_at: string | Date;
}
const WORKER_COLS = "id,display_name,lifecycle_status,profile_verification_state,verified_at,source_of_record,first_seen_at,last_seen_at,created_at,updated_at";
const worker = (r: WorkerRow): WorkerRecord => ({
  id: r.id, displayName: r.display_name, lifecycleStatus: r.lifecycle_status, profileVerificationState: r.profile_verification_state,
  verifiedAt: d(r.verified_at), sourceOfRecord: r.source_of_record, firstSeenAt: new Date(r.first_seen_at), lastSeenAt: d(r.last_seen_at),
  createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
});

interface TradeOccupationRow {
  worker_id: string; trade_code: string; occupation_code: string; role_designation: WorkerTradeOccupationRecord["roleDesignation"];
  experience_months: number | null; verification_state: VerificationState; source_evidence_id: string | null; created_at: string | Date;
}
const TRADE_OCCUPATION_COLS = "worker_id,trade_code,occupation_code,role_designation,experience_months,verification_state,source_evidence_id,created_at";
const tradeOccupation = (r: TradeOccupationRow): WorkerTradeOccupationRecord => ({
  workerId: r.worker_id, tradeCode: r.trade_code, occupationCode: r.occupation_code, roleDesignation: r.role_designation,
  experienceMonths: r.experience_months, verificationState: r.verification_state, sourceEvidenceId: r.source_evidence_id, createdAt: new Date(r.created_at),
});

interface SkillRow {
  worker_id: string; skill_code: string; verification_state: VerificationState; source_evidence_id: string | null;
  self_reported_note: string | null; created_at: string | Date;
}
const SKILL_COLS = "worker_id,skill_code,verification_state,source_evidence_id,self_reported_note,created_at";
const skill = (r: SkillRow): WorkerSkillRecord => ({
  workerId: r.worker_id, skillCode: r.skill_code, verificationState: r.verification_state, sourceEvidenceId: r.source_evidence_id,
  selfReportedNote: r.self_reported_note, createdAt: new Date(r.created_at),
});

interface CredentialRow {
  id:string;
  worker_id: string; credential_code: string; verification_state: VerificationState; verified_at: string | Date | null;
  issued_at: string | Date | null; expires_at: string | Date | null; issuing_authority: string | null;
  jurisdiction:string|null;lifecycle_status:WorkerCredentialRecord["lifecycleStatus"];source_evidence_id: string | null; created_at: string | Date;
}
/** Deliberately excludes raw_identifier -- matches the database's own column-level grant exactly. */
const CREDENTIAL_SAFE_COLS = "id,worker_id,credential_code,verification_state,verified_at,issued_at,expires_at,issuing_authority,jurisdiction,lifecycle_status,source_evidence_id,created_at";
const credential = (r: CredentialRow): WorkerCredentialRecord => ({
  id:r.id,workerId: r.worker_id, credentialCode: r.credential_code, verificationState: r.verification_state, verifiedAt: d(r.verified_at),
  issuedAt: d(r.issued_at), expiresAt: d(r.expires_at), issuingAuthority: r.issuing_authority,jurisdiction:r.jurisdiction,lifecycleStatus:r.lifecycle_status, sourceEvidenceId: r.source_evidence_id,
  createdAt: new Date(r.created_at),
});

interface AvailabilityRow {
  id: string; worker_id: string; status: WorkerAvailabilityRecord["status"]; available_from: string | Date | null;
  available_until: string | Date | null; source: WorkerAvailabilityRecord["source"]; effective_at: string | Date;
  verification_state: VerificationState; created_at: string | Date;
}
const AVAILABILITY_COLS = "id,worker_id,status,available_from,available_until,source,effective_at,verification_state,created_at";
const availability = (r: AvailabilityRow): WorkerAvailabilityRecord => ({
  id: r.id, workerId: r.worker_id, status: r.status, availableFrom: d(r.available_from), availableUntil: d(r.available_until),
  source: r.source, effectiveAt: new Date(r.effective_at), verificationState: r.verification_state, createdAt: new Date(r.created_at),
});

interface LocationRow {
  id: string; worker_id: string; city: string | null; region: string | null; country: string | null;
  travel_willing: boolean; travel_radius_miles: number | null; relocation_willing: boolean;
  effective_at: string | Date; source: WorkerLocationRecord["source"]; created_at: string | Date;
}
const LOCATION_COLS = "id,worker_id,city,region,country,travel_willing,travel_radius_miles,relocation_willing,effective_at,source,created_at";
const location = (r: LocationRow): WorkerLocationRecord => ({
  id: r.id, workerId: r.worker_id, city: r.city, region: r.region, country: r.country, travelWilling: r.travel_willing,
  travelRadiusMiles: r.travel_radius_miles, relocationWilling: r.relocation_willing, effectiveAt: new Date(r.effective_at),
  source: r.source, createdAt: new Date(r.created_at),
});

interface WorkHistoryRow {
  id: string; worker_id: string; employer_label: string; project_label: string | null; occupation_code: string | null;
  trade_code: string | null; start_date: string | Date | null; end_date: string | Date | null;
  verification_state: VerificationState; source_evidence_id: string | null; created_at: string | Date;
}
const WORK_HISTORY_COLS = "id,worker_id,employer_label,project_label,occupation_code,trade_code,start_date,end_date,verification_state,source_evidence_id,created_at";
const workHistory = (r: WorkHistoryRow): WorkerWorkHistoryRecord => ({
  id: r.id, workerId: r.worker_id, employerLabel: r.employer_label, projectLabel: r.project_label, occupationCode: r.occupation_code,
  tradeCode: r.trade_code, startDate: d(r.start_date), endDate: d(r.end_date), verificationState: r.verification_state,
  sourceEvidenceId: r.source_evidence_id, createdAt: new Date(r.created_at),
});

interface ContactRouteRow {
  id: string; worker_id: string; route_type: WorkerContactRouteRecord["routeType"]; target: string; preferred: boolean;
  verification_state: VerificationState; consent_state: WorkerContactRouteRecord["consentState"];
  consent_captured_at: string | Date | null; consent_source: string | null;
  lifecycle_status: WorkerContactRouteRecord["lifecycleStatus"]; created_at: string | Date; updated_at: string | Date;
}
const CONTACT_ROUTE_COLS = "id,worker_id,route_type,target,preferred,verification_state,consent_state,consent_captured_at,consent_source,lifecycle_status,created_at,updated_at";
const contactRoute = (r: ContactRouteRow): WorkerContactRouteRecord => ({
  id: r.id, workerId: r.worker_id, routeType: r.route_type, target: r.target, preferred: r.preferred,
  verificationState: r.verification_state, consentState: r.consent_state, consentCapturedAt: d(r.consent_captured_at),
  consentSource: r.consent_source, lifecycleStatus: r.lifecycle_status, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
});

interface CompensationRow {
  id: string; worker_id: string; rate_type: WorkerCompensationExpectationRecord["rateType"]; rate_min: string | number | null;
  rate_preferred: string | number | null; currency: string; per_diem_required: boolean | null; overtime_expectation: string | null;
  travel_pay_expectation: string | null; negotiable: boolean; effective_at: string | Date; created_at: string | Date;
}
const COMPENSATION_COLS = "id,worker_id,rate_type,rate_min,rate_preferred,currency,per_diem_required,overtime_expectation,travel_pay_expectation,negotiable,effective_at,created_at";
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
const compensation = (r: CompensationRow): WorkerCompensationExpectationRecord => ({
  id: r.id, workerId: r.worker_id, rateType: r.rate_type, rateMin: num(r.rate_min), ratePreferred: num(r.rate_preferred),
  currency: r.currency, perDiemRequired: r.per_diem_required, overtimeExpectation: r.overtime_expectation,
  travelPayExpectation: r.travel_pay_expectation, negotiable: r.negotiable, effectiveAt: new Date(r.effective_at), createdAt: new Date(r.created_at),
});

export class PostgresWorkerRepository implements WorkerRepository {
  constructor(private readonly client: SqlClient) {}

  async createWorker(i: CreateWorkerInput): Promise<WorkerRecord> {
    const q = await this.client.query<WorkerRow>(
      `insert into workforce_workers(display_name,source_of_record,lifecycle_status,profile_verification_state,verified_at)
       values($1,$2,$3,$4,$5) returning ${WORKER_COLS}`,
      [i.displayName, i.sourceOfRecord, i.lifecycleStatus ?? "ACTIVE", i.profileVerificationState ?? "UNVERIFIED", i.verifiedAt?.toISOString() ?? null],
    );
    return worker(q.rows[0]);
  }

  async findWorkerById(id: string): Promise<WorkerRecord | null> {
    const q = await this.client.query<WorkerRow>(`select ${WORKER_COLS} from workforce_workers where id=$1`, [id]);
    return q.rows[0] ? worker(q.rows[0]) : null;
  }

  async searchWorkers(f: WorkerSearchFilter): Promise<WorkerRecord[]> {
    if (f.tradeCode || f.occupationCode) {
      const q = await this.client.query<WorkerRow>(
        `select distinct ${WORKER_COLS.split(",").map((c) => `w.${c}`).join(",")} from workforce_workers w
         join worker_trade_occupations t on t.worker_id=w.id
         where ($1::text is null or w.lifecycle_status=$1)
           and ($2::text is null or t.trade_code=$2)
           and ($3::text is null or t.occupation_code=$3)
           and ($4::text is null or ($4='REAL' and w.display_name !~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)') or ($4='DEMO_LOCAL' and w.display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)'))
         order by w.id limit $5 offset $6`,
        [f.lifecycleStatus ?? null, f.tradeCode ?? null, f.occupationCode ?? null, f.population ?? null, f.limit, f.offset],
      );
      return q.rows.map(worker);
    }
    const q = await this.client.query<WorkerRow>(
      `select ${WORKER_COLS} from workforce_workers
       where ($1::text is null or lifecycle_status=$1)
         and ($2::text is null or ($2='REAL' and display_name !~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)') or ($2='DEMO_LOCAL' and display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)'))
       order by id limit $3 offset $4`,
      [f.lifecycleStatus ?? null, f.population ?? null, f.limit, f.offset],
    );
    return q.rows.map(worker);
  }

  async countWorkers(f: Pick<WorkerSearchFilter, "lifecycleStatus" | "tradeCode" | "occupationCode">): Promise<{ total: number; real: number; demo: number }> {
    const q = await this.client.query<{ total: string | number; real: string | number; demo: string | number }>(
      `select count(*)::int total,
         count(*) filter (where display_name !~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)')::int real,
         count(*) filter (where display_name ~* '(^|[^[:alnum:]_])demo([^[:alnum:]_]|$)')::int demo
       from workforce_workers w
       where ($1::text is null or w.lifecycle_status=$1)
         and ($2::text is null or exists (select 1 from worker_trade_occupations t where t.worker_id=w.id and t.trade_code=$2 and ($3::text is null or t.occupation_code=$3)))
         and ($2::text is not null or $3::text is null or exists (select 1 from worker_trade_occupations t where t.worker_id=w.id and t.occupation_code=$3))`,
      [f.lifecycleStatus ?? null, f.tradeCode ?? null, f.occupationCode ?? null],
    );
    const row = q.rows[0];
    return { total: Number(row?.total ?? 0), real: Number(row?.real ?? 0), demo: Number(row?.demo ?? 0) };
  }

  async updateWorker(id: string, p: UpdateWorkerInput): Promise<WorkerRecord> {
    const q = await this.client.query<WorkerRow>(
      `update workforce_workers set
         display_name=coalesce($2,display_name),
         profile_verification_state=coalesce($3,profile_verification_state),
         verified_at=coalesce($4,verified_at),
         last_seen_at=coalesce($5,last_seen_at),
         lifecycle_status=coalesce($6,lifecycle_status),
         updated_at=now()
       where id=$1 returning ${WORKER_COLS}`,
      [id, p.displayName ?? null, p.profileVerificationState ?? null, p.verifiedAt?.toISOString() ?? null, p.lastSeenAt?.toISOString() ?? null, p.lifecycleStatus ?? null],
    );
    if (!q.rows[0]) throw new Error("Worker not found");
    return worker(q.rows[0]);
  }

  async listTradeOccupations(workerId: string): Promise<WorkerTradeOccupationRecord[]> {
    const q = await this.client.query<TradeOccupationRow>(
      `select ${TRADE_OCCUPATION_COLS} from worker_trade_occupations where worker_id=$1 order by role_designation,trade_code,occupation_code`,
      [workerId],
    );
    return q.rows.map(tradeOccupation);
  }

  async addTradeOccupation(i: AddWorkerTradeOccupationInput): Promise<WorkerTradeOccupationRecord> {
    const q = await this.client.query<TradeOccupationRow>(
      `insert into worker_trade_occupations(worker_id,trade_code,occupation_code,role_designation,experience_months,verification_state,source_evidence_id)
       values($1,$2,$3,$4,$5,$6,$7) returning ${TRADE_OCCUPATION_COLS}`,
      [i.workerId, i.tradeCode, i.occupationCode, i.roleDesignation, i.experienceMonths ?? null, i.verificationState ?? "UNVERIFIED", i.sourceEvidenceId ?? null],
    );
    return tradeOccupation(q.rows[0]);
  }

  async updateTradeOccupationExperience(workerId: string, tradeCode: string, occupationCode: string, experienceMonths: number | null): Promise<WorkerTradeOccupationRecord> {
    const q = await this.client.query<TradeOccupationRow>(
      `update worker_trade_occupations set experience_months=$4 where worker_id=$1 and trade_code=$2 and occupation_code=$3 returning ${TRADE_OCCUPATION_COLS}`,
      [workerId, tradeCode, occupationCode, experienceMonths],
    );
    if (!q.rows[0]) throw new Error("Worker trade/occupation association not found");
    return tradeOccupation(q.rows[0]);
  }

  async removeTradeOccupation(workerId: string, tradeCode: string, occupationCode: string): Promise<void> {
    await this.client.query(`delete from worker_trade_occupations where worker_id=$1 and trade_code=$2 and occupation_code=$3`, [workerId, tradeCode, occupationCode]);
  }

  async listSkills(workerId: string): Promise<WorkerSkillRecord[]> {
    const q = await this.client.query<SkillRow>(`select ${SKILL_COLS} from worker_skills where worker_id=$1 order by skill_code`, [workerId]);
    return q.rows.map(skill);
  }

  async addSkill(i: AddWorkerSkillInput): Promise<WorkerSkillRecord> {
    const q = await this.client.query<SkillRow>(
      `insert into worker_skills(worker_id,skill_code,verification_state,source_evidence_id,self_reported_note)
       values($1,$2,$3,$4,$5) returning ${SKILL_COLS}`,
      [i.workerId, i.skillCode, i.verificationState ?? "UNVERIFIED", i.sourceEvidenceId ?? null, i.selfReportedNote ?? null],
    );
    return skill(q.rows[0]);
  }

  async removeSkill(workerId: string, skillCode: string): Promise<void> {
    await this.client.query(`delete from worker_skills where worker_id=$1 and skill_code=$2`, [workerId, skillCode]);
  }

  async listCredentials(workerId: string): Promise<WorkerCredentialRecord[]> {
    const q = await this.client.query<CredentialRow>(`select ${CREDENTIAL_SAFE_COLS} from worker_credentials where worker_id=$1 order by credential_code`, [workerId]);
    return q.rows.map(credential);
  }

  async addCredential(i: AddWorkerCredentialInput): Promise<WorkerCredentialRecord> {
    const q = await this.client.query<CredentialRow>(
      `insert into worker_credentials(worker_id,credential_code,verification_state,verified_at,issued_at,expires_at,issuing_authority,jurisdiction,raw_identifier,source_evidence_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${CREDENTIAL_SAFE_COLS}`,
      [
        i.workerId, i.credentialCode, i.verificationState ?? "UNVERIFIED", i.verifiedAt?.toISOString() ?? null,
        i.issuedAt?.toISOString() ?? null, i.expiresAt?.toISOString() ?? null, i.issuingAuthority ?? null,i.jurisdiction??null,
        i.rawIdentifier ?? null, i.sourceEvidenceId ?? null,
      ],
    );
    return credential(q.rows[0]);
  }

  async updateCredentialVerification(i: UpdateWorkerCredentialVerificationInput): Promise<WorkerCredentialRecord> {
    const q = await this.client.query<CredentialRow>(
      `update worker_credentials set verification_state=$3,verified_at=$4
       where worker_id=$1 and (${i.credentialId ? "id=$2::uuid" : "credential_code=$2"}) returning ${CREDENTIAL_SAFE_COLS}`,
      [i.workerId, i.credentialId ?? i.credentialCode, i.verificationState, i.verifiedAt?.toISOString() ?? null],
    );
    if (!q.rows[0]) throw new Error("Worker credential not found");
    return credential(q.rows[0]);
  }

  async getIntelligenceFacts(workerId:string):Promise<WorkerIntelligenceFacts>{
    const [level,credentials,mobility,conditions,shifts,consents,documents]=await Promise.all([
      this.client.query<Record<string,unknown>>(`select level_code,verification_state from worker_level_assignments where worker_id=$1 order by effective_at desc,created_at desc limit 1`,[workerId]),
      this.listCredentials(workerId),
      this.client.query<Record<string,unknown>>(`select coalesce(in_state_travel_state,'UNKNOWN') in_state,coalesce(out_of_state_travel_state,'UNKNOWN') out_state,coalesce(relocation_state,'UNKNOWN') relocation from worker_locations where worker_id=$1 order by effective_at desc,created_at desc limit 1`,[workerId]),
      this.client.query<Record<string,unknown>>(`select * from worker_work_conditions where worker_id=$1 order by effective_at desc,created_at desc limit 1`,[workerId]),
      this.client.query<Record<string,unknown>>(`select shift_code,verification_state from worker_shift_capabilities where worker_id=$1 order by shift_code`,[workerId]),
      this.client.query<Record<string,unknown>>(`select distinct on(purpose) purpose,state,effective_at from worker_consents where worker_id=$1 order by purpose,effective_at desc,created_at desc`,[workerId]),
      this.client.query<Record<string,unknown>>(`select distinct on(document_type) document_type,readiness_state,expires_at,verification_state from worker_document_readiness where worker_id=$1 order by document_type,effective_at desc,created_at desc`,[workerId]),
    ]);
    const l=level.rows[0],m=mobility.rows[0],c=conditions.rows[0];
    return{level:l?{code:String(l.level_code) as WorkerLevelCode,verificationState:String(l.verification_state) as VerificationState}:null,credentials:credentials.map(x=>({id:x.id??"",credentialCode:x.credentialCode,jurisdiction:x.jurisdiction??null,verificationState:x.verificationState,expiresAt:x.expiresAt,lifecycleStatus:x.lifecycleStatus??"UNKNOWN"})),mobility:m?{inStateTravel:String(m.in_state) as ExplicitState,outOfStateTravel:String(m.out_state) as ExplicitState,relocation:String(m.relocation) as ExplicitState}:null,conditions:c?{perDiem:String(c.per_diem_state) as PerDiemState,transportation:String(c.transportation_state) as ExplicitState,tools:String(c.tools_state) as ToolsState,maximumHoursPerWeek:c.maximum_hours_per_week==null?null:Number(c.maximum_hours_per_week),overtime:String(c.overtime_state) as ExplicitState,verificationState:String(c.verification_state) as VerificationState}:null,shifts:shifts.rows.map(x=>({code:String(x.shift_code) as ShiftCode,verificationState:String(x.verification_state) as VerificationState})),consents:consents.rows.map(x=>({purpose:String(x.purpose) as WorkerConsentPurpose,state:String(x.state) as WorkerConsentState,effectiveAt:new Date(String(x.effective_at))})),documents:documents.rows.map(x=>({documentType:String(x.document_type),readinessState:String(x.readiness_state) as WorkerIntelligenceFacts["documents"][number]["readinessState"],expiresAt:d(x.expires_at as string|null),verificationState:String(x.verification_state) as VerificationState}))};
  }

  async getCurrentAvailability(workerId: string): Promise<WorkerAvailabilityRecord | null> {
    const q = await this.client.query<AvailabilityRow>(
      `select ${AVAILABILITY_COLS} from worker_availability where worker_id=$1 order by effective_at desc, created_at desc limit 1`,
      [workerId],
    );
    return q.rows[0] ? availability(q.rows[0]) : null;
  }

  async appendAvailability(i: AppendWorkerAvailabilityInput): Promise<WorkerAvailabilityRecord> {
    const q = await this.client.query<AvailabilityRow>(
      `insert into worker_availability(worker_id,status,available_from,available_until,source,verification_state)
       values($1,$2,$3,$4,$5,$6) returning ${AVAILABILITY_COLS}`,
      [i.workerId, i.status, i.availableFrom?.toISOString() ?? null, i.availableUntil?.toISOString() ?? null, i.source, i.verificationState ?? "UNVERIFIED"],
    );
    return availability(q.rows[0]);
  }

  async getCurrentLocation(workerId: string): Promise<WorkerLocationRecord | null> {
    const q = await this.client.query<LocationRow>(
      `select ${LOCATION_COLS} from worker_locations where worker_id=$1 order by effective_at desc, created_at desc limit 1`,
      [workerId],
    );
    return q.rows[0] ? location(q.rows[0]) : null;
  }

  async appendLocation(i: AppendWorkerLocationInput): Promise<WorkerLocationRecord> {
    const q = await this.client.query<LocationRow>(
      `insert into worker_locations(worker_id,city,region,country,travel_willing,travel_radius_miles,relocation_willing,source)
       values($1,$2,$3,$4,$5,$6,$7,$8) returning ${LOCATION_COLS}`,
      [i.workerId, i.city ?? null, i.region ?? null, i.country ?? null, i.travelWilling ?? false, i.travelRadiusMiles ?? null, i.relocationWilling ?? false, i.source],
    );
    return location(q.rows[0]);
  }

  async listWorkHistory(workerId: string): Promise<WorkerWorkHistoryRecord[]> {
    const q = await this.client.query<WorkHistoryRow>(`select ${WORK_HISTORY_COLS} from worker_work_history where worker_id=$1 order by start_date nulls last, id`, [workerId]);
    return q.rows.map(workHistory);
  }

  async addWorkHistory(i: AddWorkerWorkHistoryInput): Promise<WorkerWorkHistoryRecord> {
    const q = await this.client.query<WorkHistoryRow>(
      `insert into worker_work_history(worker_id,employer_label,project_label,occupation_code,trade_code,start_date,end_date,verification_state,source_evidence_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${WORK_HISTORY_COLS}`,
      [
        i.workerId, i.employerLabel, i.projectLabel ?? null, i.occupationCode ?? null, i.tradeCode ?? null,
        i.startDate?.toISOString().slice(0, 10) ?? null, i.endDate?.toISOString().slice(0, 10) ?? null,
        i.verificationState ?? "UNVERIFIED", i.sourceEvidenceId ?? null,
      ],
    );
    return workHistory(q.rows[0]);
  }

  async updateWorkHistory(i: UpdateWorkerWorkHistoryInput): Promise<WorkerWorkHistoryRecord> {
    const q = await this.client.query<WorkHistoryRow>(
      `update worker_work_history set
         project_label=coalesce($2,project_label),
         end_date=coalesce($3,end_date),
         verification_state=coalesce($4,verification_state)
       where id=$1 returning ${WORK_HISTORY_COLS}`,
      [i.id, i.projectLabel ?? null, i.endDate?.toISOString().slice(0, 10) ?? null, i.verificationState ?? null],
    );
    if (!q.rows[0]) throw new Error("Worker work history entry not found");
    return workHistory(q.rows[0]);
  }

  async listContactRoutes(workerId: string): Promise<WorkerContactRouteRecord[]> {
    const q = await this.client.query<ContactRouteRow>(`select ${CONTACT_ROUTE_COLS} from worker_contact_routes where worker_id=$1 order by preferred desc,route_type`, [workerId]);
    return q.rows.map(contactRoute);
  }

  async addContactRoute(i: AddWorkerContactRouteInput): Promise<WorkerContactRouteRecord> {
    const q = await this.client.query<ContactRouteRow>(
      `insert into worker_contact_routes(worker_id,route_type,target,preferred,consent_state,consent_captured_at,consent_source)
       values($1,$2,$3,$4,$5,$6,$7) returning ${CONTACT_ROUTE_COLS}`,
      [i.workerId, i.routeType, i.target, i.preferred ?? false, i.consentState ?? "UNKNOWN", i.consentCapturedAt?.toISOString() ?? null, i.consentSource ?? null],
    );
    return contactRoute(q.rows[0]);
  }

  async updateContactConsent(i: UpdateWorkerContactConsentInput): Promise<WorkerContactRouteRecord> {
    const q = await this.client.query<ContactRouteRow>(
      `update worker_contact_routes set consent_state=$2,consent_captured_at=$3,consent_source=coalesce($4,consent_source),updated_at=now()
       where id=$1 returning ${CONTACT_ROUTE_COLS}`,
      [i.id, i.consentState, i.consentCapturedAt?.toISOString() ?? null, i.consentSource ?? null],
    );
    if (!q.rows[0]) throw new Error("Worker contact route not found");
    return contactRoute(q.rows[0]);
  }

  async deactivateContactRoute(id: string): Promise<WorkerContactRouteRecord> {
    const q = await this.client.query<ContactRouteRow>(
      `update worker_contact_routes set lifecycle_status='INACTIVE',updated_at=now() where id=$1 returning ${CONTACT_ROUTE_COLS}`,
      [id],
    );
    if (!q.rows[0]) throw new Error("Worker contact route not found");
    return contactRoute(q.rows[0]);
  }

  async getCurrentCompensationExpectation(workerId: string): Promise<WorkerCompensationExpectationRecord | null> {
    const q = await this.client.query<CompensationRow>(
      `select ${COMPENSATION_COLS} from worker_compensation_expectations where worker_id=$1 order by effective_at desc, created_at desc limit 1`,
      [workerId],
    );
    return q.rows[0] ? compensation(q.rows[0]) : null;
  }

  async listCompensationExpectations(workerId: string): Promise<WorkerCompensationExpectationRecord[]> {
    const q = await this.client.query<CompensationRow>(
      `select ${COMPENSATION_COLS} from worker_compensation_expectations where worker_id=$1 order by effective_at desc, created_at desc`,
      [workerId],
    );
    return q.rows.map(compensation);
  }

  async appendCompensationExpectation(i: AppendWorkerCompensationExpectationInput): Promise<WorkerCompensationExpectationRecord> {
    const q = await this.client.query<CompensationRow>(
      `insert into worker_compensation_expectations(worker_id,rate_type,rate_min,rate_preferred,currency,per_diem_required,overtime_expectation,travel_pay_expectation,negotiable)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COMPENSATION_COLS}`,
      [
        i.workerId, i.rateType, i.rateMin ?? null, i.ratePreferred ?? null, i.currency ?? "USD",
        i.perDiemRequired ?? null, i.overtimeExpectation ?? null, i.travelPayExpectation ?? null, i.negotiable ?? true,
      ],
    );
    return compensation(q.rows[0]);
  }
}
