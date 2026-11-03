import type {
  IngestionAttemptRecord,
  PersistDemandSignalInput,
} from "../../../domain/ingestion";

export interface IngestionRepository {
  upsertDemandSignal(input: PersistDemandSignalInput): Promise<string>;
  recordAttempt(input: IngestionAttemptRecord): Promise<string>;
}
