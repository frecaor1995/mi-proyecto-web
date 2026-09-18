import { knownFact, unknownFact, type Fact } from "../../../domain/worker";
import type {
  DemandCredentialRequirementRecord, DemandSkillRequirementRecord, MatchingReadyDemandInput,
  SetDemandRequirementsInput,
} from "../../../domain/demand-matching";
import type { OperatorPermission } from "../../../domain/operator";
import { authorizeOperator } from "../../auth/authorization";
import type { ServerSession } from "../../auth/session";
import type { TransactionRunner } from "../../database/transaction";
import type { OperatorRepository } from "../../repositories/operator/operator-repository";
import { PostgresDemandRequirementRepository } from "../../repositories/demand/postgres-demand-requirement-repository";
import type { DemandRequirementRepository } from "../../repositories/demand/demand-requirement-repository";

export type DemandRequirementOperationResult<T> =
  | { readonly kind: "UNAUTHENTICATED" }
  | { readonly kind: "UNAUTHORIZED" }
  | { readonly kind: "VALIDATION_ERROR"; readonly detail: string }
  | { readonly kind: "OK"; readonly value: T };

export interface DemandRequirementServiceDeps {
  readonly repository: DemandRequirementRepository;
  readonly transactionRunner: TransactionRunner;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

function mapDatabaseError(error: unknown): DemandRequirementOperationResult<never> {
  const code = (error as { code?: string } | null | undefined)?.code;
  if (code === "23503") return { kind: "VALIDATION_ERROR", detail: "Referenced demand signal, skill, or credential code does not exist" };
  if (code === "23514") return { kind: "VALIDATION_ERROR", detail: "Value violates a required data constraint" };
  if (code === "23505") return { kind: "VALIDATION_ERROR", detail: "This record already exists" };
  throw error;
}

const ok = <T>(value: T): DemandRequirementOperationResult<T> => ({ kind: "OK", value });
const invalid = (detail: string): DemandRequirementOperationResult<never> => ({ kind: "VALIDATION_ERROR", detail });

/**
 * MATCHING-B1-C. Accepts already-structured (skillCode/credentialCode,
 * requirementLevel) pairs -- deliberately extraction-agnostic. Whatever
 * upstream mechanism determines a requirement (deterministic parsing,
 * operator entry, a future controlled extraction step) is entirely outside
 * this service's concern; it never imports or depends on any capture/parse/
 * AI module.
 */
export class DemandRequirementService {
  private readonly repository: DemandRequirementRepository;
  constructor(private readonly deps: DemandRequirementServiceDeps) {
    this.repository = deps.repository;
  }

  private async authorize(permission: OperatorPermission): Promise<
    | { readonly ok: true; readonly permissions: readonly OperatorPermission[] }
    | { readonly ok: false; readonly result: DemandRequirementOperationResult<never> }
  > {
    const auth = await authorizeOperator(permission, { getSession: this.deps.getSession, repository: this.deps.operatorRepository });
    if (auth.state === "UNAUTHENTICATED") return { ok: false, result: { kind: "UNAUTHENTICATED" } };
    if (auth.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { ok: false, result: { kind: "UNAUTHORIZED" } };
    return { ok: true, permissions: auth.operator.permissions };
  }

  /** Replace semantics, atomic: the demand's requirement rows end up
   * exactly matching `input.skills`/`input.credentials`. Delete-then-insert
   * runs inside one transactionRunner-provided connection, mirroring
   * WorkerService.createWorkerWithPrimaryTrade's own transaction pattern. */
  async setDemandRequirements(input: SetDemandRequirementsInput): Promise<DemandRequirementOperationResult<void>> {
    const auth = await this.authorize("demand_requirement.write");
    if (!auth.ok) return auth.result;
    for (const skill of input.skills) {
      if (skill.skillCode.trim().length === 0) return invalid("skillCode must not be empty");
    }
    for (const credential of input.credentials) {
      if (credential.credentialCode.trim().length === 0) return invalid("credentialCode must not be empty");
    }
    try {
      return await this.deps.transactionRunner(async (client) => {
        const repository = new PostgresDemandRequirementRepository(client);
        await repository.setDemandRequirements(input);
        return ok(undefined);
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async listSkillRequirements(demandSignalId: string): Promise<DemandRequirementOperationResult<DemandSkillRequirementRecord[]>> {
    const auth = await this.authorize("demand_requirement.write");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listSkillRequirements(demandSignalId));
  }

  async listCredentialRequirements(demandSignalId: string): Promise<DemandRequirementOperationResult<DemandCredentialRequirementRecord[]>> {
    const auth = await this.authorize("demand_requirement.write");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listCredentialRequirements(demandSignalId));
  }

  /**
   * MATCHING-B1-C / C8. Assembles the canonical sanitized DemandMatchingInput.
   * role_type is never read here (mirrors WorkerService.buildMatchingReadyInput's
   * own "never leak a sensitive/legacy field" discipline). Returns OK(null)
   * when the demand signal doesn't exist, matching buildMatchingReadyInput's
   * own null-for-missing-record convention exactly.
   */
  async getMatchingReadyInput(demandSignalId: string): Promise<DemandRequirementOperationResult<MatchingReadyDemandInput | null>> {
    const auth = await this.authorize("demand_requirement.write");
    if (!auth.ok) return auth.result;

    const core = await this.repository.getMatchingCore(demandSignalId);
    if (!core) return ok(null);

    const [skillRequirements, credentialRequirements, compensation] = await Promise.all([
      this.repository.listSkillRequirements(demandSignalId),
      this.repository.listCredentialRequirements(demandSignalId),
      this.repository.getCompensation(demandSignalId),
    ]);

    const compensationFact: Fact<{ payCurrency: string | null; basePayMin: number | null; basePayMax: number | null; payPeriod: string | null }> =
      compensation && (compensation.payCurrency !== null || compensation.basePayMin !== null || compensation.basePayMax !== null || compensation.payPeriod !== null)
        ? knownFact(compensation)
        : unknownFact();

    return ok({
      demandSignalId: core.demandSignalId,
      tradeCode: core.tradeCode,
      occupationCode: core.occupationCode,
      minimumExperienceMonths: core.minimumExperienceMonths,
      skills: skillRequirements.map((s) => ({ skillCode: s.skillCode, requirementLevel: s.requirementLevel })),
      credentials: credentialRequirements.map((c) => ({ credentialCode: c.credentialCode, requirementLevel: c.requirementLevel, jurisdiction: c.jurisdiction })),
      startDate: core.startDate,
      compensation: compensationFact,
    });
  }
}
