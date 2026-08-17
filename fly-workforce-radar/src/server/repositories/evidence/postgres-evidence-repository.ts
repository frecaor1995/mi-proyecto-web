import type {
  CreateEvidenceRecord,
  EvidenceLinkRecord,
  EvidenceLinkType,
  EvidenceRecord,
  EvidenceStatus,
  EvidenceTarget,
} from "../../../domain/evidence";
import type { EvidenceRepository } from "./evidence-repository";

interface QueryResult<Row> {
  rows: Row[];
}

export interface SqlClient {
  query<Row>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

interface EvidenceRow {
  id: string;
  source_id: string;
  source_url: string;
  captured_at: string | Date;
  capture_method: string;
  content_hash: string;
  payload_size_bytes: number | string | null;
  content_type: string | null;
  extractor_version: string | null;
  storage_reference: string | null;
  http_metadata: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

interface EvidenceLinkRow {
  id: string;
  evidence_id: string;
  link_type: EvidenceLinkType;
  demand_signal_id: string | null;
  claim_id: string | null;
  company_role_id: string | null;
  vendor_route_id: string | null;
  contact_person_id: string | null;
  contact_route_id: string | null;
  project_id: string | null;
  opportunity_id: string | null;
  created_at: string | Date;
}

const evidenceColumns = `
  id, source_id, source_url, captured_at, capture_method, content_hash,
  payload_size_bytes, content_type, extractor_version, storage_reference,
  http_metadata, metadata
`;

const targetColumns: Record<EvidenceTarget["kind"], string> = {
  DEMAND_SIGNAL: "demand_signal_id",
  CLAIM: "claim_id",
  COMPANY_ROLE: "company_role_id",
  VENDOR_ROUTE: "vendor_route_id",
  CONTACT_PERSON: "contact_person_id",
  CONTACT_ROUTE: "contact_route_id",
  PROJECT: "project_id",
  OPPORTUNITY: "opportunity_id",
};

const targetKinds = Object.entries(targetColumns) as [EvidenceTarget["kind"], string][];

function mapEvidence(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    capturedAt: new Date(row.captured_at),
    captureMethod: row.capture_method,
    contentHash: row.content_hash,
    payloadSizeBytes: row.payload_size_bytes === null ? null : Number(row.payload_size_bytes),
    contentType: row.content_type,
    extractorVersion: row.extractor_version,
    storageReference: row.storage_reference,
    httpMetadata: row.http_metadata,
    metadata: row.metadata,
  };
}

function mapEvidenceLink(row: EvidenceLinkRow): EvidenceLinkRecord {
  const target = targetKinds.find(([, column]) => row[column as keyof EvidenceLinkRow] !== null);
  if (!target) throw new Error(`Evidence link ${row.id} has no target`);
  const [kind, column] = target;
  return {
    id: row.id,
    evidenceId: row.evidence_id,
    linkType: row.link_type,
    target: { kind, id: row[column as keyof EvidenceLinkRow] as string } as EvidenceTarget,
    createdAt: new Date(row.created_at),
  };
}

export class PostgresEvidenceRepository implements EvidenceRepository {
  constructor(private readonly client: SqlClient) {}

  async create(input: CreateEvidenceRecord): Promise<EvidenceRecord> {
    const result = await this.client.query<EvidenceRow>(
      `insert into raw_evidence (
         source_id, source_url, captured_at, capture_method, storage_reference,
         content_hash, extractor_version, metadata, content_type,
         payload_size_bytes, http_metadata
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb)
       returning ${evidenceColumns}`,
      [
        input.sourceId,
        input.sourceUrl,
        input.capturedAt.toISOString(),
        input.captureMethod,
        input.storageReference ?? null,
        input.contentHash,
        input.extractorVersion ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.contentType ?? null,
        input.payloadSizeBytes,
        input.httpMetadata === undefined ? null : JSON.stringify(input.httpMetadata),
      ],
    );
    return mapEvidence(result.rows[0]);
  }

  async getById(id: string): Promise<EvidenceRecord | null> {
    const result = await this.client.query<EvidenceRow>(
      `select ${evidenceColumns} from raw_evidence where id = $1`,
      [id],
    );
    return result.rows[0] ? mapEvidence(result.rows[0]) : null;
  }

  async findByContentHash(contentHash: string): Promise<EvidenceRecord[]> {
    const result = await this.client.query<EvidenceRow>(
      `select ${evidenceColumns}
         from raw_evidence
        where content_hash = $1
        order by captured_at, id`,
      [contentHash],
    );
    return result.rows.map(mapEvidence);
  }

  async listBySource(sourceId: string): Promise<EvidenceRecord[]> {
    const result = await this.client.query<EvidenceRow>(
      `select ${evidenceColumns}
         from raw_evidence
        where source_id = $1
        order by captured_at, id`,
      [sourceId],
    );
    return result.rows.map(mapEvidence);
  }

  async link(
    evidenceId: string,
    target: EvidenceTarget,
    linkType: EvidenceLinkType = "SUPPORTS",
  ): Promise<string> {
    const targetColumn = targetColumns[target.kind];
    const result = await this.client.query<{ id: string }>(
      `insert into evidence_links (evidence_id, link_type, ${targetColumn})
       values ($1, $2, $3) returning id`,
      [evidenceId, linkType, target.id],
    );
    return result.rows[0].id;
  }

  async listLinksByEvidence(evidenceId: string): Promise<EvidenceLinkRecord[]> {
    const result = await this.client.query<EvidenceLinkRow>(
      `select id, evidence_id, link_type, demand_signal_id, claim_id, company_role_id,
              vendor_route_id, contact_person_id, contact_route_id, project_id,
              opportunity_id, created_at
         from evidence_links
        where evidence_id = $1
        order by created_at, id`,
      [evidenceId],
    );
    return result.rows.map(mapEvidenceLink);
  }

  async recordStatus(evidenceId: string, status: EvidenceStatus, reason?: string): Promise<string> {
    const result = await this.client.query<{ id: string }>(
      `insert into evidence_status_events (evidence_id, status, reason)
       values ($1, $2, $3) returning id`,
      [evidenceId, status, reason ?? null],
    );
    return result.rows[0].id;
  }

  async supersede(
    supersededEvidenceId: string,
    supersedingEvidenceId: string,
    reason?: string,
  ): Promise<void> {
    await this.client.query(
      `insert into evidence_supersessions
         (superseded_evidence_id, superseding_evidence_id, reason)
       values ($1, $2, $3)`,
      [supersededEvidenceId, supersedingEvidenceId, reason ?? null],
    );
    await this.recordStatus(supersededEvidenceId, "SUPERSEDED", reason);
  }
}
