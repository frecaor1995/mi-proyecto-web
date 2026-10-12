import { describe, expect, it } from "vitest";
import {
  isDemoLocalLabel, isWorkerEligibleForOpportunity, matchingUniverseForOpportunity, workerPopulation,
} from "../../domain/workforce-population";

describe("REAL opportunity workforce isolation", () => {
  it("classifies by the canonical DEMO LOCAL marker without IDs, fixed counts, or manual lists", () => {
    expect(workerPopulation("DEMO LOCAL — Marco")).toBe("DEMO_LOCAL");
    expect(workerPopulation("Real electrician")).toBe("REAL");
    expect(isDemoLocalLabel("  demo local test worker")).toBe(true);
  });

  it("keeps every DEMO worker out of a REAL commercial opportunity universe", () => {
    const workers = [
      ...Array.from({ length: 31 }, (_, index) => `REAL worker ${index + 1}`),
      ...Array.from({ length: 10 }, (_, index) => `DEMO LOCAL worker ${index + 1}`),
    ];
    const eligible = workers.filter((name) => isWorkerEligibleForOpportunity(name, "Houston commercial electricians"));
    expect(matchingUniverseForOpportunity("Houston commercial electricians")).toBe("REAL");
    expect(eligible).toHaveLength(31);
    expect(eligible.some(isDemoLocalLabel)).toBe(false);
  });

  it("preserves existing all-worker demo behavior for an explicit DEMO LOCAL opportunity", () => {
    expect(matchingUniverseForOpportunity("DEMO LOCAL Houston expansion")).toBe("ALL");
    expect(isWorkerEligibleForOpportunity("DEMO LOCAL worker", "DEMO LOCAL Houston expansion")).toBe(true);
  });
});
