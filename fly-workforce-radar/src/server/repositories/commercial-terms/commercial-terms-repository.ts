import type { CommercialContextType, CommercialTermsVersionRecord, CreateCommercialTermsVersionInput } from "../../../domain/commercial-economics-persistence";

export interface CommercialTermsRepository {
  createVersion(input: CreateCommercialTermsVersionInput): Promise<CommercialTermsVersionRecord>;
  /** The newest version for this context not superseded by any other version; null if none exists. */
  getCurrent(contextType: CommercialContextType, contextId: string): Promise<CommercialTermsVersionRecord | null>;
  listHistory(contextType: CommercialContextType, contextId: string): Promise<CommercialTermsVersionRecord[]>;
  getById(id: string): Promise<CommercialTermsVersionRecord | null>;
}
