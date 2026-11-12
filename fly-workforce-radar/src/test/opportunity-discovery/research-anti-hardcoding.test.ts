import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Anti-overfitting control: Contact Intelligence production code must not contain the golden-case or validation-
 * company names, people, phone numbers, addresses, institution domains or company-specific query branches.
 * Test files and fixtures (src/test/**) are excluded: validation companies may appear there as organizations under test.
 */
const ROOT = resolve(process.cwd(), "src");
const SCOPE = [
  "domain/research-pivots.ts", "domain/buyer-intelligence.ts", "domain/contact-investigation.ts",
  "server/contact-intelligence", "components/opportunity-discovery/buyer-workspace.tsx", "components/opportunity-discovery/buyer-forms.tsx",
  "components/opportunity-discovery/contact-workspace.tsx", "components/opportunity-discovery/contact-forms.tsx", "components/opportunity-discovery/discovery-copy.ts",
  "app/contacts/page.tsx",
];
const FORBIDDEN: readonly [string, RegExp][] = [
  ["golden company", /zachry/i], ["golden brand", /\bjvic\b/i], ["golden person", /kuntz/i], ["golden phone", /568[-. )]*2612/],
  ["golden address", /red bluff/i], ["golden institution domain", /brazoriacountyeda|pasadenachamber|sachamber|sanantonioedf|chamberspace|gbria/i],
  ["validation company", /\bmmr\b|mmrgrp|link staffing|linkstaffing|ies holdings|ies-co\.com/i],
  ["validation people", /\b(fixturo|rowan sampleford|emerson fixtureman|jamie dummett)\b/i],
  ["validation phones", /880[-. )]*5090|455[-. )]*6700|860[-. )]*1500|588[-. )]*5000/],
];

const files = (path: string): string[] => {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => files(join(path, entry)));
};

describe("anti-hardcoding source scan (Contact Intelligence production code)", () => {
  const scanned = SCOPE.flatMap(files).filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(`${join("src", "test")}`));
  it("scans the research engine, domain, actions, loaders and UI", () => {
    expect(scanned.some((f) => f.endsWith("research-engine.ts"))).toBe(true);
    expect(scanned.length).toBeGreaterThanOrEqual(15);
  });
  it.each(FORBIDDEN)("contains no %s", (_label, pattern) => {
    const hits = scanned.flatMap((file) => readFileSync(file, "utf8").split("\n").map((line, i) => [file, i + 1, line] as const))
      .filter(([, , line]) => pattern.test(line)).map(([file, n, line]) => `${file.slice(ROOT.length + 1)}:${n}: ${line.trim().slice(0, 120)}`);
    expect(hits).toEqual([]);
  });
});
