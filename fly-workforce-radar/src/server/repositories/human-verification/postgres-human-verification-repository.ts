import type {
  CreateHumanInteractionInput, CreateHumanResponseAssessmentInput, CreateHumanVerificationTaskEventInput,
  HumanInteraction, HumanResponseAssessment, HumanVerificationTask, HumanVerificationTaskEvent,
  HumanVerificationTaskStatus,
} from "../../../domain/human-verification";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { HumanVerificationRepository, PersistHumanVerificationTaskInput } from "./human-verification-repository";

type Row = Record<string, unknown>;
const date = (value: unknown) => value == null ? null : new Date(String(value));
const object = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const taskColumns = "id,company_id,opportunity_id,project_id,claim_id,blocker_code,contact_person_id,contact_route_id,follow_up_question,preferred_method,assigned_operator_id,due_at,parent_task_id,trade_id,occupation_id,scope,packet_snapshot,target_type,target_id,verification_objective,question_type,primary_question,status,deduplication_key,created_by,created_at,rule_version,closed_at";

function task(row: Row): HumanVerificationTask {
  return {
    id: String(row.id), companyId: String(row.company_id), opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    projectId: row.project_id ? String(row.project_id) : null, claimId: row.claim_id ? String(row.claim_id) : null,
    blockerCode: row.blocker_code ? String(row.blocker_code) : null, contactPersonId: row.contact_person_id ? String(row.contact_person_id) : null,
    contactRouteId: row.contact_route_id ? String(row.contact_route_id) : null, followUpQuestion: row.follow_up_question ? String(row.follow_up_question) : null,
    preferredMethod: row.preferred_method as HumanVerificationTask["preferredMethod"], assignedOperatorId: row.assigned_operator_id ? String(row.assigned_operator_id) : null,
    dueAt: date(row.due_at), parentTaskId: row.parent_task_id ? String(row.parent_task_id) : null,
    tradeId: row.trade_id as HumanVerificationTask["tradeId"], occupationId: row.occupation_id as HumanVerificationTask["occupationId"],
    scope: object(row.scope), packetSnapshot: object(row.packet_snapshot), targetType: row.target_type as HumanVerificationTask["targetType"],
    targetId: String(row.target_id), verificationObjective: String(row.verification_objective), questionType: row.question_type as HumanVerificationTask["questionType"],
    primaryQuestion: String(row.primary_question), status: row.status as HumanVerificationTaskStatus, deduplicationKey: String(row.deduplication_key),
    createdBy: String(row.created_by), createdAt: date(row.created_at)!, ruleVersion: String(row.rule_version), closedAt: date(row.closed_at),
  } as HumanVerificationTask;
}
function interaction(row: Row): HumanInteraction {
  return {
    id: String(row.id), verificationTaskId: String(row.verification_task_id), contactRouteId: row.contact_route_id ? String(row.contact_route_id) : null,
    contactPersonId: row.contact_person_id ? String(row.contact_person_id) : null, companyRepresentedId: row.company_represented_id ? String(row.company_represented_id) : null,
    interactionMethod: row.interaction_method as HumanInteraction["interactionMethod"], interactionOutcome: row.interaction_outcome as HumanInteraction["interactionOutcome"],
    direction: row.direction as HumanInteraction["direction"], attemptedAt: date(row.attempted_at)!, operatorId: String(row.operator_id), routeSnapshot: object(row.route_snapshot),
    reachedHuman: Boolean(row.reached_human), personNameSnapshot: row.person_name_snapshot ? String(row.person_name_snapshot) : null,
    personTitleSnapshot: row.person_title_snapshot ? String(row.person_title_snapshot) : null, departmentSnapshot: row.department_snapshot ? String(row.department_snapshot) : null,
    companyRepresentedText: row.company_represented_text ? String(row.company_represented_text) : null, responseVerbatim: row.response_verbatim ? String(row.response_verbatim) : null,
    responseSummary: row.response_summary ? String(row.response_summary) : null, effectiveDateStated: date(row.effective_date_stated),
    artifactStorageReference: row.artifact_storage_reference ? String(row.artifact_storage_reference) : null,
    consentOrRecordingNote: row.consent_or_recording_note ? String(row.consent_or_recording_note) : null, metadata: object(row.metadata), createdAt: date(row.created_at)!,
  };
}
function assessment(row: Row): HumanResponseAssessment {
  return {
    id: String(row.id), interactionId: String(row.interaction_id), companyId: row.company_id ? String(row.company_id) : null,
    projectId: row.project_id ? String(row.project_id) : null, opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    proposedEvidenceId: row.proposed_evidence_id ? String(row.proposed_evidence_id) : null, supersedesAssessmentId: row.supersedes_assessment_id ? String(row.supersedes_assessment_id) : null,
    answerDisposition: row.answer_disposition as HumanResponseAssessment["answerDisposition"], commercialMechanism: row.commercial_mechanism as HumanResponseAssessment["commercialMechanism"],
    authorityLevel: row.authority_level as HumanResponseAssessment["authorityLevel"], authorityBasis: String(row.authority_basis), scope: object(row.scope),
    geographicScope: row.geographic_scope ? String(row.geographic_scope) : null, tradeId: row.trade_id as HumanResponseAssessment["tradeId"], occupationId: row.occupation_id as HumanResponseAssessment["occupationId"],
    effectiveFrom: date(row.effective_from), effectiveUntil: date(row.effective_until), confidence: Number(row.confidence),
    supportedClaimCandidates: Array.isArray(row.supported_claim_candidates) ? row.supported_claim_candidates as HumanResponseAssessment["supportedClaimCandidates"] : [],
    unsupportedClaims: strings(row.unsupported_claims), unresolvedClaims: strings(row.unresolved_claims), conflictIds: strings(row.conflict_ids),
    followUpRequired: Boolean(row.follow_up_required), followUpTarget: row.follow_up_target ? String(row.follow_up_target) : null,
    assessmentNotes: row.assessment_notes ? String(row.assessment_notes) : null, assessedBy: String(row.assessed_by), assessorKind: row.assessor_kind as HumanResponseAssessment["assessorKind"],
    assessedAt: date(row.assessed_at)!, approvalState: row.approval_state as HumanResponseAssessment["approvalState"], approvedBy: row.approved_by ? String(row.approved_by) : null,
    ruleVersion: String(row.rule_version), createdAt: date(row.created_at)!,
  };
}
function event(row: Row): HumanVerificationTaskEvent {
  return { id: String(row.id), verificationTaskId: String(row.verification_task_id), interactionId: row.interaction_id ? String(row.interaction_id) : null,
    assessmentId: row.assessment_id ? String(row.assessment_id) : null, eventType: row.event_type as HumanVerificationTaskEvent["eventType"],
    oldState: row.old_state as HumanVerificationTaskEvent["oldState"], newState: row.new_state as HumanVerificationTaskEvent["newState"],
    reason: String(row.reason), operatorId: String(row.operator_id), occurredAt: date(row.occurred_at)!, evidenceIds: strings(row.evidence_ids),
    claimIds: strings(row.claim_ids), metadata: object(row.metadata), createdAt: date(row.created_at)!, };
}

export class PostgresHumanVerificationRepository implements HumanVerificationRepository {
  constructor(private readonly client: SqlClient) {}
  async findOpenTaskByDeduplicationKey(key: string) { const q = await this.client.query<Row>(`select ${taskColumns} from human_verification_tasks where deduplication_key=$1 and status in('OPEN','ASSIGNED','ATTEMPTED','AWAITING_RESPONSE','FOLLOW_UP_REQUIRED','READY_FOR_ASSESSMENT','READY_FOR_APPROVAL') limit 1`, [key]); return q.rows[0] ? task(q.rows[0]) : null }
  async getTask(id: string) { const q = await this.client.query<Row>(`select ${taskColumns} from human_verification_tasks where id=$1`, [id]); return q.rows[0] ? task(q.rows[0]) : null }
  async createTask(input: PersistHumanVerificationTaskInput) {
    await this.client.query("begin");
    try {
      const q = await this.client.query<Row>(`insert into human_verification_tasks(company_id,opportunity_id,project_id,claim_id,blocker_code,contact_person_id,contact_route_id,follow_up_question,preferred_method,assigned_operator_id,due_at,parent_task_id,trade_id,occupation_id,scope,packet_snapshot,target_type,target_id,verification_objective,question_type,primary_question,deduplication_key,created_by,rule_version)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24)returning ${taskColumns}`,
        [input.companyId,input.opportunityId??null,input.projectId??null,input.claimId??null,input.blockerCode??null,input.contactPersonId??null,input.contactRouteId??null,input.followUpQuestion??null,input.preferredMethod??null,input.assignedOperatorId??null,input.dueAt?.toISOString()??null,input.parentTaskId??null,input.tradeId??null,input.occupationId??null,JSON.stringify(input.scope),JSON.stringify(input.packetSnapshot??{}),input.targetType,input.targetId,input.verificationObjective,input.questionType,input.primaryQuestion,input.deduplicationKey,input.createdBy,input.ruleVersion]);
      await this.client.query("insert into human_verification_task_events(verification_task_id,event_type,old_state,new_state,reason,operator_id,occurred_at)values($1,'CREATED',null,'OPEN','Task created',$2,$3)",[q.rows[0].id,input.createdBy,q.rows[0].created_at]);
      await this.client.query("commit"); return task(q.rows[0]);
    } catch(error) { await this.client.query("rollback"); throw error }
  }
  async transitionTask(id: string,status: HumanVerificationTaskStatus,input: Omit<CreateHumanVerificationTaskEventInput,"verificationTaskId">) {
    await this.client.query("begin"); try {
      await this.client.query("insert into human_verification_task_events(verification_task_id,event_type,old_state,new_state,reason,operator_id,occurred_at,interaction_id,assessment_id,evidence_ids,claim_ids,metadata)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11::uuid[],$12::jsonb)",[id,input.eventType,input.oldState,input.newState,input.reason,input.operatorId,input.occurredAt.toISOString(),input.interactionId??null,input.assessmentId??null,input.evidenceIds??[],input.claimIds??[],JSON.stringify(input.metadata??{})]);
      const q=await this.client.query<Row>(`update human_verification_tasks set status=$2::human_verification_task_status,closed_at=case when $2::human_verification_task_status in('COMPLETED','CANCELLED','DUPLICATE','UNRESOLVABLE')then $3::timestamptz else null end where id=$1 returning ${taskColumns}`,[id,status,input.occurredAt.toISOString()]);
      await this.client.query("commit"); return task(q.rows[0]);
    }catch(error){await this.client.query("rollback");throw error}
  }
  async createInteraction(input:CreateHumanInteractionInput){const q=await this.client.query<Row>("insert into human_interactions(verification_task_id,interaction_method,interaction_outcome,attempted_at,operator_id,route_snapshot,reached_human,contact_route_id,contact_person_id,direction,person_name_snapshot,person_title_snapshot,department_snapshot,company_represented_id,company_represented_text,response_verbatim,response_summary,effective_date_stated,artifact_storage_reference,consent_or_recording_note,metadata)values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)returning *",[input.verificationTaskId,input.interactionMethod,input.interactionOutcome,input.attemptedAt.toISOString(),input.operatorId,JSON.stringify(input.routeSnapshot),input.reachedHuman,input.contactRouteId??null,input.contactPersonId??null,input.direction??null,input.personNameSnapshot??null,input.personTitleSnapshot??null,input.departmentSnapshot??null,input.companyRepresentedId??null,input.companyRepresentedText??null,input.responseVerbatim??null,input.responseSummary??null,input.effectiveDateStated?.toISOString()??null,input.artifactStorageReference??null,input.consentOrRecordingNote??null,JSON.stringify(input.metadata??{})]);return interaction(q.rows[0])}
  async listInteractions(taskId:string){const q=await this.client.query<Row>("select * from human_interactions where verification_task_id=$1 order by attempted_at,created_at,id",[taskId]);return q.rows.map(interaction)}
  async createAssessment(input:CreateHumanResponseAssessmentInput){const q=await this.client.query<Row>("insert into human_response_assessments(interaction_id,answer_disposition,commercial_mechanism,authority_level,authority_basis,scope,confidence,assessed_by,assessor_kind,assessed_at,approval_state,approved_by,rule_version,company_id,project_id,opportunity_id,trade_id,occupation_id,geographic_scope,effective_from,effective_until,supported_claim_candidates,unsupported_claims,unresolved_claims,proposed_evidence_id,conflict_ids,follow_up_required,follow_up_target,supersedes_assessment_id,assessment_notes)values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::text[],$24::text[],$25,$26::uuid[],$27,$28,$29,$30)returning *",[input.interactionId,input.answerDisposition,input.commercialMechanism??null,input.authorityLevel,input.authorityBasis,JSON.stringify(input.scope),input.confidence,input.assessedBy,input.assessorKind,input.assessedAt.toISOString(),input.approvalState,input.approvedBy??null,input.ruleVersion,input.companyId??null,input.projectId??null,input.opportunityId??null,input.tradeId??null,input.occupationId??null,input.geographicScope??null,input.effectiveFrom?.toISOString()??null,input.effectiveUntil?.toISOString()??null,JSON.stringify(input.supportedClaimCandidates??[]),input.unsupportedClaims??[],input.unresolvedClaims??[],input.proposedEvidenceId??null,input.conflictIds??[],input.followUpRequired??false,input.followUpTarget??null,input.supersedesAssessmentId??null,input.assessmentNotes??null]);return assessment(q.rows[0])}
  async listAssessments(interactionId:string){const q=await this.client.query<Row>("select * from human_response_assessments where interaction_id=$1 order by assessed_at,created_at,id",[interactionId]);return q.rows.map(assessment)}
  async createTaskEvent(input:CreateHumanVerificationTaskEventInput){const q=await this.client.query<Row>("insert into human_verification_task_events(verification_task_id,event_type,old_state,new_state,reason,operator_id,occurred_at,interaction_id,assessment_id,evidence_ids,claim_ids,metadata)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11::uuid[],$12::jsonb)returning *",[input.verificationTaskId,input.eventType,input.oldState,input.newState,input.reason,input.operatorId,input.occurredAt.toISOString(),input.interactionId??null,input.assessmentId??null,input.evidenceIds??[],input.claimIds??[],JSON.stringify(input.metadata??{})]);return event(q.rows[0])}
  async listTaskEvents(taskId:string){const q=await this.client.query<Row>("select * from human_verification_task_events where verification_task_id=$1 order by occurred_at,created_at,id",[taskId]);return q.rows.map(event)}
}
