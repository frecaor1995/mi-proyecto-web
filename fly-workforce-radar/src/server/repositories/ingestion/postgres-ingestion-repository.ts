import type {
  IngestionAttemptRecord,
  PersistDemandSignalInput,
} from "../../../domain/ingestion";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { IngestionRepository } from "./ingestion-repository";

export class PostgresIngestionRepository implements IngestionRepository {
  constructor(private readonly client: SqlClient) {}

  async upsertDemandSignal(input: PersistDemandSignalInput): Promise<string> {
    const signal = input.signal;
    const result = await this.client.query<{ id: string }>(
      `insert into demand_signals (
         title, original_title, role_type, unresolved_publisher_name, publisher_type,
         city, county, state, pay_currency, base_pay_min, base_pay_max, pay_period,
         overtime_available, overtime_terms, per_diem_available, per_diem_amount,
         per_diem_frequency, schedule, headcount_estimate, published_at,
         first_seen_at, last_seen_at, source_id, raw_evidence_id,
         external_posting_id, source_identity_key, parser_version,
         source_compensation_text, normalized_metadata
       ) values (
         $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $20, $21, $22, $23, $24, $25, $26, $27::jsonb
       )
       on conflict (source_id, source_identity_key)
         where source_id is not null and source_identity_key is not null
       do update set
         title = excluded.title,
         original_title = excluded.original_title,
         role_type = excluded.role_type,
         unresolved_publisher_name = coalesce(excluded.unresolved_publisher_name, demand_signals.unresolved_publisher_name),
         publisher_type = coalesce(excluded.publisher_type, demand_signals.publisher_type),
         city = coalesce(excluded.city, demand_signals.city),
         county = coalesce(excluded.county, demand_signals.county),
         state = coalesce(excluded.state, demand_signals.state),
         pay_currency = coalesce(excluded.pay_currency, demand_signals.pay_currency),
         base_pay_min = coalesce(excluded.base_pay_min, demand_signals.base_pay_min),
         base_pay_max = coalesce(excluded.base_pay_max, demand_signals.base_pay_max),
         pay_period = coalesce(excluded.pay_period, demand_signals.pay_period),
         overtime_available = coalesce(excluded.overtime_available, demand_signals.overtime_available),
         overtime_terms = coalesce(excluded.overtime_terms, demand_signals.overtime_terms),
         per_diem_available = coalesce(excluded.per_diem_available, demand_signals.per_diem_available),
         per_diem_amount = coalesce(excluded.per_diem_amount, demand_signals.per_diem_amount),
         per_diem_frequency = coalesce(excluded.per_diem_frequency, demand_signals.per_diem_frequency),
         schedule = coalesce(excluded.schedule, demand_signals.schedule),
         headcount_estimate = coalesce(excluded.headcount_estimate, demand_signals.headcount_estimate),
         published_at = coalesce(excluded.published_at, demand_signals.published_at),
         last_seen_at = excluded.last_seen_at,
         raw_evidence_id = excluded.raw_evidence_id,
         external_posting_id = coalesce(excluded.external_posting_id, demand_signals.external_posting_id),
         parser_version = excluded.parser_version,
         source_compensation_text = coalesce(excluded.source_compensation_text, demand_signals.source_compensation_text),
         normalized_metadata = demand_signals.normalized_metadata || excluded.normalized_metadata,
         updated_at = now()
       returning id`,
      [
        signal.originalTitle,
        signal.roleType,
        signal.unresolvedPublisherName,
        signal.publisherType,
        signal.city,
        signal.county,
        signal.state,
        signal.payCurrency,
        signal.basePayMin,
        signal.basePayMax,
        signal.payPeriod,
        signal.overtimeAvailable,
        signal.overtimeTerms,
        signal.perDiemAvailable,
        signal.perDiemAmount,
        signal.perDiemFrequency,
        signal.schedule,
        signal.headcountEstimate,
        signal.publishedAt?.toISOString() ?? null,
        input.observedAt.toISOString(),
        input.sourceId,
        input.rawEvidenceId,
        signal.externalPostingId,
        input.sourceIdentityKey,
        input.parserVersion,
        signal.sourceCompensationText,
        JSON.stringify(signal.metadata),
      ],
    );
    return result.rows[0].id;
  }

  async recordAttempt(input: IngestionAttemptRecord): Promise<string> {
    const result = await this.client.query<{ id: string }>(
      `insert into ingestion_attempts (
         source_id, requested_method, policy_result, policy_decision_id, adapter_id,
         requested_target, status, started_at, ended_at, raw_evidence_id,
         demand_signal_id, external_posting_id, source_identity_key, failure_reason,
         parser_version, metadata
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
       returning id`,
      [
        input.sourceId,
        input.requestedMethod,
        input.policyResult,
        input.policyDecisionId,
        input.adapterId,
        input.requestedTarget,
        input.status,
        input.startedAt.toISOString(),
        input.endedAt.toISOString(),
        input.rawEvidenceId,
        input.demandSignalId,
        input.externalPostingId,
        input.sourceIdentityKey,
        input.failureReason,
        input.parserVersion,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0].id;
  }
}
