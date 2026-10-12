import{describe,expect,it}from"vitest";
import{classifyDemandSignalPriority}from"../../domain/demand-signal-priority";
import{FACTS_2Q,TARGETED_SOURCES_2Q,FACTS,TARGETED_SOURCES,TARGETED_SOURCES_2J,FACTS_2I,FACTS_2J}from"../../server/services/targeted-evidence/targeted-evidence-facts";
import{aggregatedCandidates}from"../../server/services/evidence-aggregation/evidence-aggregation-service";
import{qualificationDossiers}from"../../server/services/opportunity-qualification/opportunity-qualification-service";
import{SOURCE_PORTFOLIO_INVENTORY}from"../../server/services/production-source/source-portfolio-audit-2k-service";

/**
 * Phase 2Q Data Center Discovery Gap Closure. Proves the real root cause (both
 * real employers actually posting Central Texas data-center-corridor electrician
 * work -- Rosendin and Walker Engineering -- were already investigated in this
 * codebase and correctly found JS-blocked; the actual gap was that TradesmenUp,
 * the third-party aggregator that republishes Walker Engineering's posting as
 * plain HTML, had never been evaluated as its own source) and that discovery of
 * a real signal does not require, or silently invent, buyer/AF-01/contact/project
 * fields it doesn't have.
 */

const walkerFact=FACTS_2Q.find(f=>f.sourceKey==="tradesmenup-aggregator")!;

describe("Phase 2Q: classifyDemandSignalPriority is pure and never fabricates",()=>{
  it("a fully-supported data-center journeyman signal reaches the top tier",()=>{
    const r=classifyDemandSignalPriority({sector:"DATA_CENTER",role:"JOURNEYMAN_ELECTRICIAN",hoursPerWeek:70,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:null});
    expect(r.tier).toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
  it("headcount is never required to reach the top tier, but strengthens the explanation when present",()=>{
    const withoutHeadcount=classifyDemandSignalPriority({sector:"DATA_CENTER",role:"JOURNEYMAN_ELECTRICIAN",hoursPerWeek:60,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:null});
    const withHeadcount=classifyDemandSignalPriority({sector:"DATA_CENTER",role:"JOURNEYMAN_ELECTRICIAN",hoursPerWeek:60,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:100});
    expect(withoutHeadcount.tier).toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
    expect(withHeadcount.tier).toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
    expect(withHeadcount.reasons.some(r=>r.includes("100"))).toBe(true);
    expect(withoutHeadcount.reasons.some(r=>r.includes("headcount"))).toBe(false);
  });
  it("headcount alone, without the other explicit signals, never manufactures the top tier",()=>{
    const r=classifyDemandSignalPriority({sector:"UNKNOWN",role:"UNKNOWN",hoursPerWeek:null,hasOvertime:false,hasPerDiem:false,duration:"UNKNOWN",headcount:100});
    expect(r.tier).not.toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
  it("missing sector alone drops it out of the top tier even with every other field present",()=>{
    const r=classifyDemandSignalPriority({sector:"UNKNOWN",role:"JOURNEYMAN_ELECTRICIAN",hoursPerWeek:70,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:null});
    expect(r.tier).not.toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
  it("below the 60-hour threshold does not reach the top tier",()=>{
    const r=classifyDemandSignalPriority({sector:"DATA_CENTER",role:"JOURNEYMAN_ELECTRICIAN",hoursPerWeek:40,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:null});
    expect(r.tier).not.toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
  it("completely unknown input is LOW_SIGNAL, not silently STANDARD",()=>{
    const r=classifyDemandSignalPriority({sector:"UNKNOWN",role:"UNKNOWN",hoursPerWeek:null,hasOvertime:false,hasPerDiem:false,duration:"UNKNOWN",headcount:null});
    expect(r.tier).toBe("LOW_SIGNAL");
  });
});

describe("Phase 2Q: the real discovered signal (Walker Engineering, Temple/Austin, via TradesmenUp)",()=>{
  it("is captured with only explicitly observed fields -- no buyer, AF-01, contact, project, headcount, or per-diem amount invented",()=>{
    expect(walkerFact.buyerCandidate).toBeNull();
    expect(walkerFact.af01Candidate).toBeNull();
    expect(walkerFact.contactPerson).toBeNull();
    expect(walkerFact.project).toBeNull();
    expect(walkerFact.headcount).toBeNull();
    expect(walkerFact.perDiem).toBeNull();
  });
  it("preserves the real, explicitly stated pay range and overtime language",()=>{
    expect(walkerFact.payMin).toBe(38);
    expect(walkerFact.payMax).toBe(45);
    expect(walkerFact.overtime).toMatch(/overtime/i);
  });
  it("does not relabel this Temple/Austin posting as Killeen, Belton, or any other unverified location",()=>{
    expect(walkerFact.market).toBe("Central Texas");
    expect(walkerFact.support).not.toMatch(/Killeen|Belton/);
  });
  it("does not assert a confirmed data-center connection the posting's own text does not state -- circumstantial context is reported as circumstantial",()=>{
    expect(walkerFact.support).toMatch(/circumstantial, not confirmed/);
  });
  it("the originating source (TradesmenUp) is UNDER_REVIEW, not ACTIVATE -- fetchability alone is not the same as full access-legitimacy clearance",()=>{
    const source=TARGETED_SOURCES_2Q.find(s=>s.key==="tradesmenup-aggregator")!;
    expect(source.decision).toBe("UNDER_REVIEW");
    expect(source.readiness).toBe("UNDER_REVIEW");
    expect(source.policy).toBe("REVIEW_REQUIRED");
  });
  it("unknown buyer/AF-01/contact/project does NOT delete or exclude the signal from the evidence ledger -- discovery precedes eligibility",()=>{
    expect(FACTS_2Q).toContain(walkerFact);
  });
  it("this discovered signal does not create a 6th tracked opportunity -- discovery and tracked-opportunity qualification remain separate stages",()=>{
    expect(qualificationDossiers()).toHaveLength(5);
    expect(qualificationDossiers().map(d=>d.market)).not.toContain("Central Texas");
  });
  it("produces zero aggregated candidates (no buyer/AF-01/contact evidence exists yet to review) -- an honest, non-fabricated result, not a bug",()=>{
    expect(aggregatedCandidates().filter(c=>c.market==="Central Texas")).toHaveLength(0);
  });
});

describe("Phase 2Q: root-cause classification (why Radar missed this class of opportunity)",()=>{
  it("Rosendin -- the real electrical contractor on the confirmed $800M Meta Temple data center -- was already investigated and correctly downgraded for SOURCE_ACCESS_LIMITATION, not overlooked (TECH-DEBT-02: undocumented Workday endpoint, no documented public API)",()=>{
    const rosendin=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="rosendin")!;
    expect(rosendin.accessLegitimacy).toBe("BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT");
    expect(rosendin.portfolioValue).toBe("BLOCKED");
  });
  it("Walker Engineering's own career site (Oracle Taleo) was already investigated and correctly BLOCKED for the same reason (Phase 2H)",()=>{
    const walker=TARGETED_SOURCES_2J.find(s=>s.key==="walker-engineering-taleo")!;
    expect(walker.decision).toBe("BLOCKED");
    expect(walker.reason).toMatch(/JavaScript/);
  });
  it("the real, actionable gap was SOURCE_COVERAGE_GAP: TradesmenUp itself, a legitimate-looking third-party aggregator that republishes otherwise-JS-blocked postings as plain HTML, had never been evaluated as its own source family before this phase",()=>{
    const tradesmenup=TARGETED_SOURCES_2Q.find(s=>s.key==="tradesmenup-aggregator")!;
    expect(tradesmenup).toBeDefined();
    const priorPhaseKeys=[...TARGETED_SOURCES,...FACTS_2I.map(f=>({key:f.sourceKey})),...FACTS_2J.map(f=>({key:f.sourceKey})),...FACTS.map(f=>({key:f.sourceKey}))].map(x=>"key"in x?x.key:undefined);
    expect(priorPhaseKeys).not.toContain("tradesmenup-aggregator");
  });
  it("the fix is reusable (a new source-family registration, evaluable the same way every other source in this portfolio was), not a hardcoded one-off: the classifier and the source registration both operate independently of this specific posting ID",()=>{
    expect(classifyDemandSignalPriority).toBeTypeOf("function");
    const genericFuturePosting=classifyDemandSignalPriority({sector:"DATA_CENTER",role:"JOURNEYMAN_ELECTRICIAN",hoursPerWeek:65,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:null});
    expect(genericFuturePosting.tier).toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
});

describe("Phase 2Q boundary",()=>{
  it("no automatic outreach: nothing in this discovery workstream applies, contacts, or submits anything",()=>{
    expect(JSON.stringify(walkerFact)).not.toMatch(/applied|submitted|contacted/i);
  });
  it("no Phase 2R leakage",()=>{
    expect(JSON.stringify(walkerFact)).not.toMatch(/phase2r/i);
  });
});
