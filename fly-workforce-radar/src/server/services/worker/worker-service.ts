import {
  MATCHING_INPUT_KNOWN_GAPS, knownFact, unknownFact, granted, redacted,
  type AddWorkerContactRouteInput, type AddWorkerCredentialInput, type AddWorkerSkillInput, type AddWorkerTradeOccupationInput,
  type AddWorkerWorkHistoryInput, type AppendWorkerAvailabilityInput, type AppendWorkerCompensationExpectationInput,
  type AppendWorkerLocationInput, type CreateWorkerInput, type Fact, type MatchingReadyWorkerInput,
  type UpdateWorkerContactConsentInput, type UpdateWorkerCredentialVerificationInput, type UpdateWorkerInput,
  type UpdateWorkerWorkHistoryInput, type WorkerAvailabilityRecord, type WorkerCompensationExpectationRecord,
  type WorkerContactRouteRecord, type WorkerCredentialRecord, type WorkerLocationRecord, type WorkerProfile,
  type WorkerRecord, type WorkerSearchFilter, type WorkerSkillRecord, type WorkerTradeOccupationRecord,
  type WorkerWorkHistoryRecord,
} from "../../../domain/worker";
import type { OperatorPermission } from "../../../domain/operator";
import { authorizeOperator } from "../../auth/authorization";
import type { ServerSession } from "../../auth/session";
import type { TransactionRunner } from "../../database/transaction";
import type { OperatorRepository } from "../../repositories/operator/operator-repository";
import { PostgresWorkerRepository } from "../../repositories/worker/postgres-worker-repository";
import type { WorkerRepository } from "../../repositories/worker/worker-repository";

export type WorkerOperationResult<T> =
  | { readonly kind: "UNAUTHENTICATED" }
  | { readonly kind: "UNAUTHORIZED" }
  | { readonly kind: "VALIDATION_ERROR"; readonly detail: string }
  | { readonly kind: "OK"; readonly value: T };

export interface WorkerServiceDeps {
  readonly repository: WorkerRepository;
  readonly transactionRunner: TransactionRunner;
  readonly getSession?: () => Promise<ServerSession | null>;
  readonly operatorRepository?: OperatorRepository | null;
}

/** Postgres error shape carries a SQLSTATE `code`; never re-surface the raw
 * driver message, which could echo a submitted value (worker name, phone,
 * a taxonomy code) back into an error a caller might log or display. */
function mapDatabaseError(error: unknown): WorkerOperationResult<never> {
  const code = (error as { code?: string } | null | undefined)?.code;
  if (code === "23503") return { kind: "VALIDATION_ERROR", detail: "Referenced taxonomy code or worker record does not exist" };
  if (code === "23514") return { kind: "VALIDATION_ERROR", detail: "Value violates a required data constraint" };
  if (code === "23505") return { kind: "VALIDATION_ERROR", detail: "This record already exists" };
  throw error;
}

const ok = <T>(value: T): WorkerOperationResult<T> => ({ kind: "OK", value });
const invalid = (detail: string): WorkerOperationResult<never> => ({ kind: "VALIDATION_ERROR", detail });

export class WorkerService {
  private readonly repository: WorkerRepository;
  constructor(private readonly deps: WorkerServiceDeps) {
    this.repository = deps.repository;
  }

  /** Resolves the caller once; returns the authorized operator's full
   * permission set so callers needing more than one permission (the
   * profile read model, the matching-ready DTO) never make a second
   * round trip just to check an additional permission. */
  private async authorize(permission: OperatorPermission): Promise<
    | { readonly ok: true; readonly permissions: readonly OperatorPermission[] }
    | { readonly ok: false; readonly result: WorkerOperationResult<never> }
  > {
    const auth = await authorizeOperator(permission, { getSession: this.deps.getSession, repository: this.deps.operatorRepository });
    if (auth.state === "UNAUTHENTICATED") return { ok: false, result: { kind: "UNAUTHENTICATED" } };
    if (auth.state === "AUTHENTICATED_BUT_UNAUTHORIZED") return { ok: false, result: { kind: "UNAUTHORIZED" } };
    return { ok: true, permissions: auth.operator.permissions };
  }

  /* -------------------------------------------------------------- */
  /* workforce_workers                                                */
  /* -------------------------------------------------------------- */

  async createWorker(input: CreateWorkerInput): Promise<WorkerOperationResult<WorkerRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.displayName.trim().length === 0) return invalid("displayName must not be empty");
    if ((input.profileVerificationState ?? "UNVERIFIED") === "VERIFIED" && !input.verifiedAt) {
      return invalid("A VERIFIED profile requires verifiedAt");
    }
    try {
      return ok(await this.repository.createWorker(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /** Atomic convenience operation: a worker plus its initial PRIMARY
   * trade/occupation, or neither. Demonstrates the one place in this
   * domain where two tables must succeed or fail together. */
  async createWorkerWithPrimaryTrade(
    worker: CreateWorkerInput,
    trade: { readonly tradeCode: string; readonly occupationCode: string; readonly experienceMonths?: number | null },
  ): Promise<WorkerOperationResult<{ readonly worker: WorkerRecord; readonly tradeOccupation: WorkerTradeOccupationRecord }>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (worker.displayName.trim().length === 0) return invalid("displayName must not be empty");
    if (trade.experienceMonths != null && trade.experienceMonths < 0) return invalid("experienceMonths must not be negative");
    try {
      return await this.deps.transactionRunner(async (client) => {
        const repository = new PostgresWorkerRepository(client);
        const createdWorker = await repository.createWorker(worker);
        const tradeOccupation = await repository.addTradeOccupation({
          workerId: createdWorker.id, tradeCode: trade.tradeCode, occupationCode: trade.occupationCode,
          roleDesignation: "PRIMARY", experienceMonths: trade.experienceMonths ?? null,
        });
        return ok({ worker: createdWorker, tradeOccupation });
      });
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async getWorker(id: string): Promise<WorkerOperationResult<WorkerRecord | null>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.findWorkerById(id));
  }

  async searchWorkers(filter: WorkerSearchFilter): Promise<WorkerOperationResult<WorkerRecord[]>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    if (filter.limit <= 0 || filter.limit > 200) return invalid("limit must be between 1 and 200");
    if (filter.offset < 0) return invalid("offset must not be negative");
    return ok(await this.repository.searchWorkers(filter));
  }

  async updateWorker(id: string, patch: UpdateWorkerInput): Promise<WorkerOperationResult<WorkerRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (patch.displayName !== undefined && patch.displayName.trim().length === 0) return invalid("displayName must not be empty");
    if (patch.profileVerificationState === "VERIFIED" && !patch.verifiedAt) return invalid("A VERIFIED profile requires verifiedAt");
    try {
      return ok(await this.repository.updateWorker(id, patch));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /**
   * WORKFORCE-TALENT-A4-R10. Deliberately narrower than updateWorker: these
   * are the only two lifecycle transitions any UI/action may perform (no
   * arbitrary lifecycleStatus editing), and each checks the worker's
   * current status before mutating so a stale/duplicate submission cannot
   * silently no-op past an already-completed transition.
   */
  async archiveWorker(id: string): Promise<WorkerOperationResult<WorkerRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    const current = await this.repository.findWorkerById(id);
    if (!current) return invalid("Worker not found");
    if (current.lifecycleStatus !== "ACTIVE") return invalid("Only an ACTIVE worker can be archived");
    try {
      return ok(await this.repository.updateWorker(id, { lifecycleStatus: "ARCHIVED" }));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async reactivateWorker(id: string): Promise<WorkerOperationResult<WorkerRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    const current = await this.repository.findWorkerById(id);
    if (!current) return invalid("Worker not found");
    if (current.lifecycleStatus !== "ARCHIVED") return invalid("Only an ARCHIVED worker can be reactivated");
    try {
      return ok(await this.repository.updateWorker(id, { lifecycleStatus: "ACTIVE" }));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* trade / occupation                                               */
  /* -------------------------------------------------------------- */

  async listTradeOccupations(workerId: string): Promise<WorkerOperationResult<WorkerTradeOccupationRecord[]>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listTradeOccupations(workerId));
  }

  async addTradeOccupation(input: AddWorkerTradeOccupationInput): Promise<WorkerOperationResult<WorkerTradeOccupationRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.experienceMonths != null && input.experienceMonths < 0) return invalid("experienceMonths must not be negative");
    try {
      return ok(await this.repository.addTradeOccupation(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateTradeOccupationExperience(workerId: string, tradeCode: string, occupationCode: string, experienceMonths: number | null): Promise<WorkerOperationResult<WorkerTradeOccupationRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (experienceMonths != null && experienceMonths < 0) return invalid("experienceMonths must not be negative");
    try {
      return ok(await this.repository.updateTradeOccupationExperience(workerId, tradeCode, occupationCode, experienceMonths));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async removeTradeOccupation(workerId: string, tradeCode: string, occupationCode: string): Promise<WorkerOperationResult<void>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    await this.repository.removeTradeOccupation(workerId, tradeCode, occupationCode);
    return ok(undefined);
  }

  /* -------------------------------------------------------------- */
  /* skills                                                           */
  /* -------------------------------------------------------------- */

  async listSkills(workerId: string): Promise<WorkerOperationResult<WorkerSkillRecord[]>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listSkills(workerId));
  }

  async addSkill(input: AddWorkerSkillInput): Promise<WorkerOperationResult<WorkerSkillRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    try {
      return ok(await this.repository.addSkill(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async removeSkill(workerId: string, skillCode: string): Promise<WorkerOperationResult<void>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    await this.repository.removeSkill(workerId, skillCode);
    return ok(undefined);
  }

  /* -------------------------------------------------------------- */
  /* credentials -- raw_identifier never leaves this layer            */
  /* -------------------------------------------------------------- */

  async listCredentials(workerId: string): Promise<WorkerOperationResult<WorkerCredentialRecord[]>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listCredentials(workerId));
  }

  async addCredential(input: AddWorkerCredentialInput): Promise<WorkerOperationResult<WorkerCredentialRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.verificationState === "VERIFIED" && !input.verifiedAt) return invalid("A VERIFIED credential requires verifiedAt");
    if (input.issuedAt && input.expiresAt && input.expiresAt < input.issuedAt) return invalid("expiresAt must not precede issuedAt");
    try {
      return ok(await this.repository.addCredential(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateCredentialVerification(input: UpdateWorkerCredentialVerificationInput): Promise<WorkerOperationResult<WorkerCredentialRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.verificationState === "VERIFIED" && !input.verifiedAt) return invalid("A VERIFIED credential requires verifiedAt");
    try {
      return ok(await this.repository.updateCredentialVerification(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* availability -- append-only; UNKNOWN is a first-class state      */
  /* -------------------------------------------------------------- */

  async getCurrentAvailability(workerId: string): Promise<WorkerOperationResult<Fact<WorkerAvailabilityRecord>>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    const row = await this.repository.getCurrentAvailability(workerId);
    return ok(row ? knownFact(row) : unknownFact());
  }

  async appendAvailability(input: AppendWorkerAvailabilityInput): Promise<WorkerOperationResult<WorkerAvailabilityRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.availableFrom && input.availableUntil && input.availableUntil < input.availableFrom) return invalid("availableUntil must not precede availableFrom");
    try {
      return ok(await this.repository.appendAvailability(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* locations -- append-only, coarse only                            */
  /* -------------------------------------------------------------- */

  async getCurrentLocation(workerId: string): Promise<WorkerOperationResult<Fact<WorkerLocationRecord>>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    const row = await this.repository.getCurrentLocation(workerId);
    return ok(row ? knownFact(row) : unknownFact());
  }

  async appendLocation(input: AppendWorkerLocationInput): Promise<WorkerOperationResult<WorkerLocationRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.travelRadiusMiles != null && input.travelRadiusMiles < 0) return invalid("travelRadiusMiles must not be negative");
    try {
      return ok(await this.repository.appendLocation(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* work history                                                     */
  /* -------------------------------------------------------------- */

  async listWorkHistory(workerId: string): Promise<WorkerOperationResult<WorkerWorkHistoryRecord[]>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listWorkHistory(workerId));
  }

  async addWorkHistory(input: AddWorkerWorkHistoryInput): Promise<WorkerOperationResult<WorkerWorkHistoryRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    if (input.startDate && input.endDate && input.endDate < input.startDate) return invalid("endDate must not precede startDate");
    if (input.occupationCode && !input.tradeCode) return invalid("occupationCode requires tradeCode");
    try {
      return ok(await this.repository.addWorkHistory(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateWorkHistory(input: UpdateWorkerWorkHistoryInput): Promise<WorkerOperationResult<WorkerWorkHistoryRecord>> {
    const auth = await this.authorize("worker_profile.write");
    if (!auth.ok) return auth.result;
    try {
      return ok(await this.repository.updateWorkHistory(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* contact routes -- highest sensitivity, fail-closed consent        */
  /* -------------------------------------------------------------- */

  async listContactRoutes(workerId: string): Promise<WorkerOperationResult<WorkerContactRouteRecord[]>> {
    const auth = await this.authorize("worker_contact.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listContactRoutes(workerId));
  }

  async addContactRoute(input: AddWorkerContactRouteInput): Promise<WorkerOperationResult<WorkerContactRouteRecord>> {
    const auth = await this.authorize("worker_contact.write");
    if (!auth.ok) return auth.result;
    if (input.target.trim().length === 0) return invalid("target must not be empty");
    if (input.consentState === "GRANTED" && !input.consentCapturedAt) return invalid("GRANTED consent requires consentCapturedAt");
    try {
      return ok(await this.repository.addContactRoute(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async updateContactConsent(input: UpdateWorkerContactConsentInput): Promise<WorkerOperationResult<WorkerContactRouteRecord>> {
    const auth = await this.authorize("worker_contact.write");
    if (!auth.ok) return auth.result;
    if (input.consentState === "GRANTED" && !input.consentCapturedAt) return invalid("GRANTED consent requires consentCapturedAt");
    try {
      return ok(await this.repository.updateContactConsent(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  async deactivateContactRoute(id: string): Promise<WorkerOperationResult<WorkerContactRouteRecord>> {
    const auth = await this.authorize("worker_contact.write");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.deactivateContactRoute(id));
  }

  /* -------------------------------------------------------------- */
  /* compensation -- append-only, separate permission boundary         */
  /* -------------------------------------------------------------- */

  async listCompensationExpectations(workerId: string): Promise<WorkerOperationResult<WorkerCompensationExpectationRecord[]>> {
    const auth = await this.authorize("worker_compensation.read");
    if (!auth.ok) return auth.result;
    return ok(await this.repository.listCompensationExpectations(workerId));
  }

  async appendCompensationExpectation(input: AppendWorkerCompensationExpectationInput): Promise<WorkerOperationResult<WorkerCompensationExpectationRecord>> {
    const auth = await this.authorize("worker_compensation.write");
    if (!auth.ok) return auth.result;
    if (input.rateMin != null && input.rateMin < 0) return invalid("rateMin must not be negative");
    if (input.rateMin != null && input.ratePreferred != null && input.ratePreferred < input.rateMin) return invalid("ratePreferred must not be below rateMin");
    try {
      return ok(await this.repository.appendCompensationExpectation(input));
    } catch (error) {
      return mapDatabaseError(error);
    }
  }

  /* -------------------------------------------------------------- */
  /* canonical read model -- the only shape UI/service callers see    */
  /* -------------------------------------------------------------- */

  async getWorkerProfile(workerId: string): Promise<WorkerOperationResult<WorkerProfile | null>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;

    const workerRecord = await this.repository.findWorkerById(workerId);
    if (!workerRecord) return ok(null);

    const [tradeOccupations, skills, credentials, availabilityRow, locationRow, workHistory] = await Promise.all([
      this.repository.listTradeOccupations(workerId),
      this.repository.listSkills(workerId),
      this.repository.listCredentials(workerId),
      this.repository.getCurrentAvailability(workerId),
      this.repository.getCurrentLocation(workerId),
      this.repository.listWorkHistory(workerId),
    ]);

    const contact = auth.permissions.includes("worker_contact.read")
      ? granted({ routes: await this.repository.listContactRoutes(workerId) })
      : redacted<{ routes: readonly WorkerContactRouteRecord[] }>();

    const compensation = auth.permissions.includes("worker_compensation.read")
      ? granted(await this.repository.listCompensationExpectations(workerId))
      : redacted<readonly WorkerCompensationExpectationRecord[]>();

    return ok({
      worker: workerRecord,
      tradeOccupations,
      skills,
      credentials,
      currentAvailability: availabilityRow ? knownFact(availabilityRow) : unknownFact(),
      currentLocation: locationRow ? knownFact(locationRow) : unknownFact(),
      workHistory,
      contact,
      compensation,
    });
  }

  /* -------------------------------------------------------------- */
  /* matching-ready boundary -- consumed only by a future engine       */
  /* -------------------------------------------------------------- */

  /** Requires BOTH worker_profile.read and worker_compensation.read: a
   * matching engine fundamentally needs compensation to do its job, so
   * this DTO is never built with compensation silently redacted -- a
   * caller lacking that permission is denied the whole operation, not
   * handed a half-populated DTO a real matcher could misuse. */
  async buildMatchingReadyInput(workerId: string): Promise<WorkerOperationResult<MatchingReadyWorkerInput | null>> {
    const auth = await this.authorize("worker_profile.read");
    if (!auth.ok) return auth.result;
    if (!auth.permissions.includes("worker_compensation.read")) return { kind: "UNAUTHORIZED" };

    const workerRecord = await this.repository.findWorkerById(workerId);
    if (!workerRecord) return ok(null);

    const [tradeOccupations, skills, credentials, availabilityRow, locationRow, compensationRow] = await Promise.all([
      this.repository.listTradeOccupations(workerId),
      this.repository.listSkills(workerId),
      this.repository.listCredentials(workerId),
      this.repository.getCurrentAvailability(workerId),
      this.repository.getCurrentLocation(workerId),
      this.repository.getCurrentCompensationExpectation(workerId),
    ]);

    return ok({
      workerId,
      tradeOccupations: tradeOccupations.map((t) => ({ tradeCode: t.tradeCode, occupationCode: t.occupationCode, roleDesignation: t.roleDesignation, experienceMonths: t.experienceMonths })),
      skills: skills.map((s) => ({ skillCode: s.skillCode, verificationState: s.verificationState })),
      credentials: credentials.map((c) => ({ credentialCode: c.credentialCode, verificationState: c.verificationState, expiresAt: c.expiresAt })),
      availability: availabilityRow ? knownFact({ status: availabilityRow.status, availableFrom: availabilityRow.availableFrom }) : unknownFact(),
      location: locationRow
        ? knownFact({ city: locationRow.city, region: locationRow.region, country: locationRow.country, travelWilling: locationRow.travelWilling, travelRadiusMiles: locationRow.travelRadiusMiles, relocationWilling: locationRow.relocationWilling })
        : unknownFact(),
      compensation: compensationRow
        ? knownFact({ rateType: compensationRow.rateType, rateMin: compensationRow.rateMin, ratePreferred: compensationRow.ratePreferred, currency: compensationRow.currency, perDiemRequired: compensationRow.perDiemRequired, negotiable: compensationRow.negotiable })
        : unknownFact(),
      knownGaps: MATCHING_INPUT_KNOWN_GAPS,
    });
  }
}
