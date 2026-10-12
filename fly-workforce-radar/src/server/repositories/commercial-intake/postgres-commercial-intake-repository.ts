import { createHash } from "node:crypto";
import type { CommercialIntakeActivation, CommercialIntakeInput } from "../../../domain/commercial-intake";
import { EvidenceCaptureService } from "../../services/evidence/capture-evidence";
import { CompanyResolutionService } from "../../services/company/company-resolution-service";
import { OpportunityService } from "../../services/opportunity/opportunity-service";
import { PostgresCompanyRepository } from "../company/postgres-company-repository";
import { PostgresDemandRequirementRepository } from "../demand/postgres-demand-requirement-repository";
import { PostgresEvidenceRepository, type SqlClient } from "../evidence/postgres-evidence-repository";
import { PostgresOpportunityRepository } from "../opportunity/postgres-opportunity-repository";
import { PostgresSourceRepository } from "../source/postgres-source-repository";

const MANUAL_SOURCE_NAME = "Fly Workforce Radar manual commercial intake";
const PARSER_VERSION = "commercial-intake@1.0.0";

interface ExistingRow { opportunity_id: string; demand_signal_id: string; evidence_id: string; unresolved_company_context: string | null }

export class PostgresCommercialIntakeRepository {
  constructor(private readonly client: SqlClient) {}

  async activate(input: CommercialIntakeInput, actorOperatorId: string, observedAt: Date): Promise<CommercialIntakeActivation> {
    const identity = `commercial-intake:${actorOperatorId}:${input.idempotencyKey}`;
    await this.client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [identity]);
    const existing = await this.client.query<ExistingRow>(
      `select ods.opportunity_id, d.id demand_signal_id, d.raw_evidence_id evidence_id, o.unresolved_company_context
         from demand_signals d join opportunity_demand_signals ods on ods.demand_signal_id=d.id
         join opportunities o on o.id=ods.opportunity_id
        where d.source_identity_key=$1 limit 1`, [identity],
    );
    if (existing.rows[0]) return {
      opportunityId: existing.rows[0].opportunity_id, demandSignalId: existing.rows[0].demand_signal_id,
      evidenceId: existing.rows[0].evidence_id, replayed: true,
      companyResolution: existing.rows[0].unresolved_company_context ? "UNRESOLVED" : "RESOLVED", gaps: [],
    };

    await this.client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [MANUAL_SOURCE_NAME]);
    const sourceRepository = new PostgresSourceRepository(this.client);
    const source = await sourceRepository.findByName(MANUAL_SOURCE_NAME) ?? await sourceRepository.create({
      name: MANUAL_SOURCE_NAME, sourceType: "OTHER", accessClassification: "RESTRICTED", enabled: true,
      requiresAuth: true, paywalled: false, sourceMetadata: { purpose: "operator-recorded inbound commercial evidence" },
      firstSeenAt: observedAt, lastSeenAt: observedAt,
    });
    const payload = JSON.stringify({
      sourceType: input.sourceType, sourceReference: input.sourceReference, summary: input.evidenceSummary,
      customer: input.customerName, opportunity: input.opportunityTitle, project: input.projectName,
      location: { city: input.city, state: input.state }, demand: {
        tradeCode: input.tradeCode, occupationCode: input.occupationCode, headcount: input.headcount,
        minimumExperienceMonths: input.minimumExperienceMonths, startDate: input.startDate, schedule: input.schedule,
        skills: input.skills, credentials: input.credentials,
      }, recordedByOperatorId: actorOperatorId, recordedAt: observedAt.toISOString(),
    });
    const evidenceRepository = new PostgresEvidenceRepository(this.client);
    const evidence = await new EvidenceCaptureService(evidenceRepository).capture({
      sourceId: source.id, sourceUrl: input.sourceReference?.trim() || `urn:fly-workforce-radar:${identity}`,
      capturedAt: observedAt, captureMethod: "MANUAL", payload, contentType: "application/json",
      extractorVersion: PARSER_VERSION, metadata: { sourceType: input.sourceType, operatorRecorded: true, actorOperatorId },
    });

    const companyResolution = await new CompanyResolutionService(new PostgresCompanyRepository(this.client)).resolve({
      observedText: input.customerName, actor: `operator:${actorOperatorId}`, at: observedAt, evidenceId: evidence.id,
    });
    const project = input.projectName || input.city || input.state
      ? (await this.client.query<{ id: string }>(
          `insert into projects(name,location_text,city,state,first_seen_at,last_seen_at)
           values($1,$2,$3,$4,$5,$5) returning id`,
          [input.projectName, [input.city, input.state].filter(Boolean).join(", ") || null, input.city, input.state, observedAt.toISOString()],
        )).rows[0]
      : null;
    const demand = await this.client.query<{ id: string }>(
      `insert into demand_signals(title,original_title,role_type,publisher_company_id,unresolved_publisher_name,
         city,state,schedule,headcount_estimate,first_seen_at,last_seen_at,stale_after,source_id,raw_evidence_id,
         source_identity_key,parser_version,trade_code,occupation_code,minimum_experience_months,start_date)
       values($1,$1,'OTHER',$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [input.opportunityTitle, companyResolution.companyId, companyResolution.companyId ? null : input.customerName.trim(),
       input.city, input.state, input.schedule, input.headcount, observedAt.toISOString(),
       new Date(observedAt.getTime() + 90 * 86400000).toISOString(), source.id, evidence.id, identity, PARSER_VERSION,
       input.tradeCode, input.occupationCode, input.minimumExperienceMonths, input.startDate],
    );
    const demandId = demand.rows[0].id;
    await evidenceRepository.link(evidence.id, { kind: "DEMAND_SIGNAL", id: demandId }, "DERIVED_FROM");
    await new PostgresDemandRequirementRepository(this.client).setDemandRequirements({
      demandSignalId: demandId,
      skills: input.skills.map((item) => ({ skillCode: item.code, requirementLevel: item.level, sourceLabel: input.evidenceSummary, rawEvidenceId: evidence.id })),
      credentials: input.credentials.map((item) => ({ credentialCode: item.code, requirementLevel: item.level, sourceRequirementText: input.evidenceSummary, rawEvidenceId: evidence.id })),
    });
    const opportunityService = new OpportunityService(new PostgresOpportunityRepository(this.client), () => observedAt);
    const opportunity = await opportunityService.create({
      demandSignalIds: [demandId], companyId: companyResolution.companyId,
      unresolvedCompanyContext: companyResolution.companyId ? null : input.customerName.trim(), projectId: project?.id ?? null,
      title: input.opportunityTitle.trim(), evidenceIds: [evidence.id], observedAt,
      staleAfter: new Date(observedAt.getTime() + 90 * 86400000),
      metadata: { origin: "COMMERCIAL_INTAKE", idempotencyFingerprint: createHash("sha256").update(identity).digest("hex"), actorOperatorId },
    });
    await evidenceRepository.link(evidence.id, { kind: "OPPORTUNITY", id: opportunity.id }, "SUPPORTS");
    const graph = await opportunityService.graph(opportunity.id, observedAt);
    return { opportunityId: opportunity.id, demandSignalId: demandId, evidenceId: evidence.id, replayed: false,
      companyResolution: companyResolution.companyId ? "RESOLVED" : "UNRESOLVED", gaps: graph.gaps };
  }
}
