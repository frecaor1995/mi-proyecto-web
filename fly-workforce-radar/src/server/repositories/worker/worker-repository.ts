import type {
  AddWorkerContactRouteInput, AddWorkerCredentialInput, AddWorkerSkillInput, AddWorkerTradeOccupationInput,
  AddWorkerWorkHistoryInput, AppendWorkerAvailabilityInput, AppendWorkerCompensationExpectationInput,
  AppendWorkerLocationInput, CreateWorkerInput, UpdateWorkerContactConsentInput, UpdateWorkerCredentialVerificationInput,
  UpdateWorkerInput, UpdateWorkerWorkHistoryInput, WorkerAvailabilityRecord, WorkerCompensationExpectationRecord,
  WorkerContactRouteRecord, WorkerCredentialRecord, WorkerLocationRecord, WorkerRecord, WorkerSearchFilter,
  WorkerSkillRecord, WorkerTradeOccupationRecord, WorkerWorkHistoryRecord,
} from "../../../domain/worker";

/**
 * WORKFORCE-TALENT-A3 repository surface over the nine A2-B canonical
 * worker tables. Every read here uses an explicit column list -- never
 * `select *` -- so `worker_credentials.raw_identifier` can never leak
 * through this repository even by accident (the database's own column-
 * level grant is the enforced boundary; this is defense in depth on top of
 * it, not a substitute for it).
 */
export interface WorkerRepository {
  // workforce_workers
  createWorker(input: CreateWorkerInput): Promise<WorkerRecord>;
  findWorkerById(id: string): Promise<WorkerRecord | null>;
  searchWorkers(filter: WorkerSearchFilter): Promise<WorkerRecord[]>;
  updateWorker(id: string, patch: UpdateWorkerInput): Promise<WorkerRecord>;

  // worker_trade_occupations
  listTradeOccupations(workerId: string): Promise<WorkerTradeOccupationRecord[]>;
  addTradeOccupation(input: AddWorkerTradeOccupationInput): Promise<WorkerTradeOccupationRecord>;
  updateTradeOccupationExperience(workerId: string, tradeCode: string, occupationCode: string, experienceMonths: number | null): Promise<WorkerTradeOccupationRecord>;
  removeTradeOccupation(workerId: string, tradeCode: string, occupationCode: string): Promise<void>;

  // worker_skills
  listSkills(workerId: string): Promise<WorkerSkillRecord[]>;
  addSkill(input: AddWorkerSkillInput): Promise<WorkerSkillRecord>;
  removeSkill(workerId: string, skillCode: string): Promise<void>;

  // worker_credentials -- SAFE shape only; raw_identifier is write-only
  listCredentials(workerId: string): Promise<WorkerCredentialRecord[]>;
  addCredential(input: AddWorkerCredentialInput): Promise<WorkerCredentialRecord>;
  updateCredentialVerification(input: UpdateWorkerCredentialVerificationInput): Promise<WorkerCredentialRecord>;

  // worker_availability -- append-only
  getCurrentAvailability(workerId: string): Promise<WorkerAvailabilityRecord | null>;
  appendAvailability(input: AppendWorkerAvailabilityInput): Promise<WorkerAvailabilityRecord>;

  // worker_locations -- append-only, coarse only
  getCurrentLocation(workerId: string): Promise<WorkerLocationRecord | null>;
  appendLocation(input: AppendWorkerLocationInput): Promise<WorkerLocationRecord>;

  // worker_work_history
  listWorkHistory(workerId: string): Promise<WorkerWorkHistoryRecord[]>;
  addWorkHistory(input: AddWorkerWorkHistoryInput): Promise<WorkerWorkHistoryRecord>;
  updateWorkHistory(input: UpdateWorkerWorkHistoryInput): Promise<WorkerWorkHistoryRecord>;

  // worker_contact_routes -- highest sensitivity; permission enforcement lives in the service layer, not here
  listContactRoutes(workerId: string): Promise<WorkerContactRouteRecord[]>;
  addContactRoute(input: AddWorkerContactRouteInput): Promise<WorkerContactRouteRecord>;
  updateContactConsent(input: UpdateWorkerContactConsentInput): Promise<WorkerContactRouteRecord>;
  deactivateContactRoute(id: string): Promise<WorkerContactRouteRecord>;

  // worker_compensation_expectations -- append-only, separate permission
  getCurrentCompensationExpectation(workerId: string): Promise<WorkerCompensationExpectationRecord | null>;
  listCompensationExpectations(workerId: string): Promise<WorkerCompensationExpectationRecord[]>;
  appendCompensationExpectation(input: AppendWorkerCompensationExpectationInput): Promise<WorkerCompensationExpectationRecord>;
}
