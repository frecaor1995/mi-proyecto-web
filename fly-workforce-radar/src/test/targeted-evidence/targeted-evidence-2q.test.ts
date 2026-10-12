import{describe,expect,it}from"vitest";
import{FACTS,FACTS_2Q,TARGETED_SOURCES,TARGETED_SOURCES_2Q}from"../../server/services/targeted-evidence/targeted-evidence-facts";

/**
 * Phase 2Q. Proves the scoped Port Arthur RFP re-verification is structurally
 * sound and, critically, that it did NOT overwrite Phase 2H's original capture --
 * both facts must coexist, with different observedAt values and (deliberately)
 * different contactPerson values, for a human to reconcile.
 */

describe("Phase 2Q: Port Arthur RFP re-verification fact",()=>{
  it("re-verifies the exact same endpoint Phase 2H already approved, not a new source",()=>{
    expect(TARGETED_SOURCES_2Q[0].endpoint).toBe(TARGETED_SOURCES[0].endpoint);
  });
  it("Phase 2H's original fact is byte-for-byte unchanged by this addition",()=>{
    expect(FACTS[0].contactPerson).toBe("Rebecca Underhill, Director of Accounting");
    expect(FACTS[0].contactRoute).toBe("Rebecca@portpa.com / 409-983-2011");
  });
  it("the Phase 2Q re-verification captures a different contactPerson than Phase 2H -- a real discrepancy, preserved rather than silently resolved",()=>{
    expect(FACTS_2Q[0].contactPerson).toBe("Kaylynn Rizzotto, Director of Accounting");
    expect(FACTS_2Q[0].contactPerson).not.toBe(FACTS[0].contactPerson);
  });
  it("the Phase 2Q fact is observed strictly after the Phase 2H fact",()=>{
    expect(FACTS_2Q[0].observedAt.getTime()).toBeGreaterThan(FACTS[0].observedAt.getTime());
  });
  it("buyer and AF-01 candidates are unchanged from Phase 2H -- this re-verification found nothing bearing on either",()=>{
    expect(FACTS_2Q[0].buyerCandidate).toBe(FACTS[0].buyerCandidate);
    expect(FACTS_2Q[0].af01Candidate).toBe(FACTS[0].af01Candidate);
  });
  it("the re-verification explicitly documents the submission deadline in its support text",()=>{
    expect(FACTS_2Q[0].support).toMatch(/4\/22\/26/);
  });
  it("remains UNVERIFIED -- an automated re-fetch is not human verification",()=>{
    expect(FACTS_2Q[0].verification).toBe("UNVERIFIED");
  });
  it("is correctly linked to the real tracked opportunity",()=>{
    expect(FACTS_2Q[0].opportunityId).toBe("qual-beaumont-port-arthur");
  });
});
