import type { BurdenProfileScope } from "../../../domain/burden-profile";
import type { BurdenProfileVersionRecord, CreateBurdenProfileVersionInput } from "../../../domain/commercial-economics-persistence";

export interface BurdenProfileRepository {
  createVersion(input: CreateBurdenProfileVersionInput): Promise<BurdenProfileVersionRecord>;
  getById(id: string): Promise<BurdenProfileVersionRecord | null>;
  /** The newest version at exactly this scope not superseded by any other version; null if none exists. 4C does not implement hierarchy resolution (falling back from TRADE_OCCUPATION to JURISDICTION to PLATFORM_DEFAULT) -- only exact-scope lookup. */
  getCurrentForScope(scope: BurdenProfileScope): Promise<BurdenProfileVersionRecord | null>;
  listHistoryForScope(scope: BurdenProfileScope): Promise<BurdenProfileVersionRecord[]>;
}
