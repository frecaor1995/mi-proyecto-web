import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isEligibleForMatching } from "../../server/matching/eligibility";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

/**
 * MATCHING-B1-C. Pure function -- eligibility to be MATCHED, never
 * consulting contact consent (that's a Contact/Selection concern, not a
 * qualification one).
 */
describe("MATCHING-B1-C matching eligibility policy", () => {
  it("13. ACTIVE worker is eligible", () => {
    expect(isEligibleForMatching("ACTIVE")).toBe(true);
  });

  it("14. INACTIVE worker is ineligible", () => {
    expect(isEligibleForMatching("INACTIVE")).toBe(false);
  });

  it("15. ARCHIVED worker is ineligible", () => {
    expect(isEligibleForMatching("ARCHIVED")).toBe(false);
  });

  it("16. the eligibility policy's executable code never reads or references contact consent -- structurally, not just by convention", async () => {
    expect(isEligibleForMatching.length).toBe(1); // single lifecycleStatus parameter only
    const source = await read("src/server/matching/eligibility.ts");
    // Strip /** ... */ and // comments -- the doc comment legitimately explains
    // WHY consent is excluded, which would otherwise false-fail this check.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/consent|worker_contact/i);
  });
});
