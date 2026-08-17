import type {
  CapturePolicyDecisionRecord,
  CreateSourceInput,
  RecordCapturePolicyDecisionInput,
  SourceHealthStatus,
  SourceRecord,
  SourceYieldMeasurementInput,
} from "../../../domain/source";
import type { CaptureMethod } from "../../../domain/source";
import type { SqlClient } from "../evidence/postgres-evidence-repository";
import type { SourceRepository } from "./source-repository";

interface SourceRow {
  id: string;
  name: string;
  source_type: string | null;
  domain: string | null;
  base_url: string | null;
  access_classification: SourceRecord["accessClassification"];
  enabled: boolean;
  requires_auth: boolean | null;
  paywalled: boolean | null;
  robots_review_status: SourceRecord["robotsReviewStatus"];
  robots_review_notes: string | null;
  tos_review_status: SourceRecord["tosReviewStatus"];
  tos_review_notes: string | null;
  last_compliance_review_at: string | Date | null;
  next_compliance_review_due_at: string | Date | null;
  health_status: SourceRecord["healthStatus"];
  first_seen_at: string | Date | null;
  last_seen_at: string | Date | null;
  source_metadata: Record<string, unknown>;
}

interface DecisionRow {
  id: string;
  source_id: string;
  capture_method: CapturePolicyDecisionRecord["captureMethod"];
  decision: CapturePolicyDecisionRecord["decision"];
  reason: string;
  reviewed_at: string | Date;
  reviewed_by: string;
  valid_until: string | Date | null;
  review_due_at: string | Date | null;
  policy_version: string;
  supersedes_decision_id: string | null;
  notes: string | null;
}

const sourceColumns = `
  id, name, source_type, domain, base_url, access_classification, enabled,
  requires_auth, paywalled, robots_review_status, robots_review_notes,
  tos_review_status, tos_review_notes, last_compliance_review_at,
  next_compliance_review_due_at, health_status, first_seen_at, last_seen_at,
  source_metadata
`;

const decisionColumns = `
  id, source_id, capture_method, decision, reason, reviewed_at, reviewed_by,
  valid_until, review_due_at, policy_version, supersedes_decision_id, notes
`;

const toDate = (value: string | Date | null) => (value === null ? null : new Date(value));

function mapSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    domain: row.domain,
    baseUrl: row.base_url,
    accessClassification: row.access_classification,
    enabled: row.enabled,
    requiresAuth: row.requires_auth,
    paywalled: row.paywalled,
    robotsReviewStatus: row.robots_review_status,
    robotsReviewNotes: row.robots_review_notes,
    tosReviewStatus: row.tos_review_status,
    tosReviewNotes: row.tos_review_notes,
    lastComplianceReviewAt: toDate(row.last_compliance_review_at),
    nextComplianceReviewDueAt: toDate(row.next_compliance_review_due_at),
    healthStatus: row.health_status,
    firstSeenAt: toDate(row.first_seen_at),
    lastSeenAt: toDate(row.last_seen_at),
    sourceMetadata: row.source_metadata,
  };
}

function mapDecision(row: DecisionRow): CapturePolicyDecisionRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    captureMethod: row.capture_method,
    decision: row.decision,
    reason: row.reason,
    reviewedAt: new Date(row.reviewed_at),
    reviewedBy: row.reviewed_by,
    validUntil: toDate(row.valid_until),
    reviewDueAt: toDate(row.review_due_at),
    policyVersion: row.policy_version,
    supersedesDecisionId: row.supersedes_decision_id,
    notes: row.notes,
  };
}

export class PostgresSourceRepository implements SourceRepository {
  constructor(private readonly client: SqlClient) {}

  async create(input: CreateSourceInput): Promise<SourceRecord> {
    const result = await this.client.query<SourceRow>(
      `insert into sources (
         name, source_type, domain, base_url, access_classification, enabled,
         requires_auth, paywalled, robots_review_status, robots_review_notes,
         tos_review_status, tos_review_notes, last_compliance_review_at,
         next_compliance_review_due_at, first_seen_at, last_seen_at, source_metadata
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
       ) returning ${sourceColumns}`,
      [
        input.name,
        input.sourceType ?? null,
        input.domain ?? null,
        input.baseUrl ?? null,
        input.accessClassification ?? "UNKNOWN",
        input.enabled ?? true,
        input.requiresAuth ?? null,
        input.paywalled ?? null,
        input.robotsReviewStatus ?? "NOT_REVIEWED",
        input.robotsReviewNotes ?? null,
        input.tosReviewStatus ?? "NOT_REVIEWED",
        input.tosReviewNotes ?? null,
        input.lastComplianceReviewAt?.toISOString() ?? null,
        input.nextComplianceReviewDueAt?.toISOString() ?? null,
        input.firstSeenAt?.toISOString() ?? null,
        input.lastSeenAt?.toISOString() ?? null,
        JSON.stringify(input.sourceMetadata ?? {}),
      ],
    );
    return mapSource(result.rows[0]);
  }

  async getById(id: string): Promise<SourceRecord | null> {
    const result = await this.client.query<SourceRow>(
      `select ${sourceColumns} from sources where id = $1`,
      [id],
    );
    return result.rows[0] ? mapSource(result.rows[0]) : null;
  }

  async getCurrentDecision(sourceId: string, method: CaptureMethod) {
    const result = await this.client.query<DecisionRow>(
      `select ${decisionColumns}
         from source_capture_policy_decisions d
        where d.source_id = $1
          and d.capture_method = $2
          and not exists (
            select 1 from source_capture_policy_decisions newer
             where newer.supersedes_decision_id = d.id
          )
        order by d.reviewed_at desc, d.created_at desc, d.id desc
        limit 1`,
      [sourceId, method],
    );
    return result.rows[0] ? mapDecision(result.rows[0]) : null;
  }

  async listDecisionHistory(sourceId: string, method: CaptureMethod) {
    const result = await this.client.query<DecisionRow>(
      `select ${decisionColumns}
         from source_capture_policy_decisions
        where source_id = $1 and capture_method = $2
        order by reviewed_at, created_at, id`,
      [sourceId, method],
    );
    return result.rows.map(mapDecision);
  }

  async recordDecision(input: RecordCapturePolicyDecisionInput) {
    const result = await this.client.query<DecisionRow>(
      `insert into source_capture_policy_decisions (
         source_id, capture_method, decision, reason, reviewed_at, reviewed_by,
         valid_until, review_due_at, policy_version, supersedes_decision_id, notes
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning ${decisionColumns}`,
      [
        input.sourceId,
        input.captureMethod,
        input.decision,
        input.reason,
        input.reviewedAt.toISOString(),
        input.reviewedBy,
        input.validUntil?.toISOString() ?? null,
        input.reviewDueAt?.toISOString() ?? null,
        input.policyVersion,
        input.supersedesDecisionId ?? null,
        input.notes ?? null,
      ],
    );
    return mapDecision(result.rows[0]);
  }

  async recordHealth(sourceId: string, status: SourceHealthStatus, observedAt: Date, reason?: string) {
    const result = await this.client.query<{ id: string }>(
      `insert into source_health_events (source_id, health_status, observed_at, reason)
       values ($1, $2, $3, $4) returning id`,
      [sourceId, status, observedAt.toISOString(), reason ?? null],
    );
    return result.rows[0].id;
  }

  async recordYield(input: SourceYieldMeasurementInput) {
    const result = await this.client.query<{ id: string }>(
      `insert into source_yield_measurements (
         source_id, opportunities_observed, validated_signals, verified_contacts,
         buyer_routes_found, hot_a_count, hot_b_count, noise_count,
         last_measurement_at, metadata
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) returning id`,
      [
        input.sourceId,
        input.opportunitiesObserved ?? 0,
        input.validatedSignals ?? 0,
        input.verifiedContacts ?? 0,
        input.buyerRoutesFound ?? 0,
        input.hotACount ?? 0,
        input.hotBCount ?? 0,
        input.noiseCount ?? 0,
        input.lastMeasurementAt.toISOString(),
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0].id;
  }
}
