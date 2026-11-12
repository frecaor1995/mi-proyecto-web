import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveWorkerReadiness, type WorkerIntelligenceFacts } from "../../domain/workforce-intelligence";

const panel = readFileSync("src/components/workforce/worker-intelligence-panel.tsx", "utf8");
const actions = readFileSync("src/server/workforce/workforce-intelligence-actions.ts", "utf8");
const readModel = readFileSync("src/server/workforce/get-workforce-intelligence.ts", "utf8");
const emptyFacts: WorkerIntelligenceFacts = { canonicalAssignment: { tradeCode: "WELDING", occupationCode: "WELDER", verificationState: "UNVERIFIED" }, level: null, credentials: [], mobility: null, conditions: null, shifts: [], consents: [], documents: [] };

describe("Phase 4A owner acceptance R1", () => {
  it("flows the canonical trade and occupation into the intelligence read model", () => {
    expect(readModel).toContain("worker_trade_occupations");
    expect(readModel).toContain("canonical_assignment");
    expect(panel).toContain("facts.canonicalAssignment");
  });

  it("keeps canonical occupation distinct from an absent worker level", () => {
    expect(emptyFacts.canonicalAssignment).toMatchObject({ tradeCode: "WELDING", occupationCode: "WELDER" });
    expect(emptyFacts.level).toBeNull();
    expect(panel).toContain('"UNKNOWN · NOT RECORDED"');
  });

  it("never renders Apprentice as the missing-level default", () => {
    expect(panel).toContain('name="levelCode" defaultValue="" required');
    expect(panel).toContain('<option value="" disabled>Select level</option>');
    expect(panel).not.toContain('defaultValue="APPRENTICE"');
    expect(actions).toContain("if(!level||!");
  });

  it("uses explicit unknown defaults for mobility and work conditions", () => {
    expect(panel).toContain('value ?? "UNKNOWN"');
    expect(panel).toContain('conditions?.transportation ?? "UNKNOWN"');
    expect(panel).toContain('conditions?.tools ?? "UNKNOWN"');
    expect(panel).toContain('conditions?.perDiem ?? "UNKNOWN"');
    expect(panel).toContain('name="overtime" value={conditions?.overtime}');
    expect(panel).toContain("defaultChecked={facts.shifts.some");
  });

  it("requires explicit purpose and credential selections", () => {
    expect(panel).toContain('<option value="" disabled>Select purpose</option>');
    expect(panel).toContain('<option value="" disabled>Select credential</option>');
    expect(actions).toContain('if(!purpose||!["DATA_USE","CANDIDATE_PRESENTATION"].includes(purpose))return');
  });

  it("does not write all-unknown mobility or work-condition forms", () => {
    expect(actions).toContain('if(inState==="UNKNOWN"&&outState==="UNKNOWN"&&relocation==="UNKNOWN")return');
    expect(actions).toContain('&&hours===null&&shifts.length===0)return');
  });

  it("does not improve readiness merely because canonical trade is known", () => {
    const readiness = deriveWorkerReadiness({ lifecycle: "ACTIVE", profileVerificationState: "UNVERIFIED", availability: "AVAILABLE", facts: emptyFacts });
    expect(readiness.blockers).toEqual(expect.arrayContaining(["DATA_USE_CONSENT_MISSING", "PRESENTATION_CONSENT_MISSING", "PROFILE_UNVERIFIED"]));
  });
});
