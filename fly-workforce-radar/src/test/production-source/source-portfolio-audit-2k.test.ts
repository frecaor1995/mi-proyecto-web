import{describe,expect,it}from"vitest";
import{ELIGIBILITY_REASONS}from"../../domain/eligibility";
import{ACCESS_LEGITIMACY_CATEGORIES}from"../../domain/source-portfolio-audit";
import{HOT_GAP_FINDINGS,SOURCE_PORTFOLIO_INVENTORY,TECH_DEBT_02_RESOLUTION,marketCoverageMatrix,phase2kSummary,reconstructTrueInventory}from"../../server/services/production-source/source-portfolio-audit-2k-service";
import{TARGETED_SOURCES}from"../../server/services/targeted-evidence/targeted-evidence-closure-service";
import{TARGETED_SOURCES_2J}from"../../server/services/targeted-evidence/targeted-evidence-closure-2j-service";

const recon=reconstructTrueInventory(),summary=phase2kSummary();

describe("Phase 2K: true source inventory reconstruction",()=>{
  it("finds the phase-chain narrative's raw activated count is 26, matching the sum of every origin's ACTIVATE entries",()=>expect(recon.rawEntries).toBe(26));
  it("finds the true distinct-endpoint production source count is 25, not the narrative's 26",()=>{
    expect(recon.uniqueByEndpoint).toBe(25);
    expect(recon.narrativeClaimed).toBe(26);
    expect(recon.narrativeAccurate).toBe(false);
  });
  it("identifies exactly one duplicate endpoint: Strike Midland Journeyman activated twice under two keys",()=>{
    expect(recon.duplicates).toHaveLength(1);
    expect(recon.duplicates[0].endpoint).toBe("https://strike.applytojob.com/apply/L3Wr0FKloj/Journeyman-Electrician");
    expect(recon.duplicates[0].keys.sort()).toEqual(["strike-midland","strike-midland-journeyman-electrician"]);
  });
  it("explains the discrepancy in prose rather than silently forcing the number to match",()=>{
    expect(recon.narrativeDiscrepancyReason).toMatch(/25, not 26/);
    expect(recon.narrativeDiscrepancyReason).toMatch(/strike-midland/);
  });
  it("does not report the narrative as accurate when a real duplicate exists",()=>expect(recon.narrativeAccurate).toBe(recon.uniqueByEndpoint===recon.narrativeClaimed));
  it("reconstructs the inventory from the real registries, not just the targeted-evidence phase chain: includes the three Phase 2B standalone adapters absent from any declarative registry",()=>{
    expect(SOURCE_PORTFOLIO_INVENTORY.some(x=>x.key==="rosendin"&&x.origin==="PHASE_2B_STANDALONE_ADAPTER")).toBe(true);
    expect(SOURCE_PORTFOLIO_INVENTORY.some(x=>x.key==="bechtel"&&x.origin==="PHASE_2B_STANDALONE_ADAPTER")).toBe(true);
    expect(SOURCE_PORTFOLIO_INVENTORY.some(x=>x.key==="tpwd"&&x.origin==="PHASE_2B_STANDALONE_ADAPTER")).toBe(true);
  });
  it("covers every origin across the true production-source registry",()=>{
    const origins=new Set(SOURCE_PORTFOLIO_INVENTORY.map(x=>x.origin));
    expect(origins).toEqual(new Set(["PHASE_2B_STANDALONE_ADAPTER","PHASE_2C_MULTI_SOURCE","PHASE_2D_COMMERCIAL_INTELLIGENCE","PHASE_2F_HOT_EVIDENCE","PHASE_2H_TARGETED_EVIDENCE","PHASE_2I_TARGETED_EVIDENCE","PHASE_2J_TARGETED_EVIDENCE"]));
  });
});

describe("Phase 2K: access-legitimacy classification",()=>{
  it("uses only the defined access-legitimacy taxonomy",()=>expect(SOURCE_PORTFOLIO_INVENTORY.every(x=>(ACCESS_LEGITIMACY_CATEGORIES as readonly string[]).includes(x.accessLegitimacy))).toBe(true));
  it("classifies every currently-ACTIVATE source explicitly: none fall through to UNCLEAR",()=>{
    const activeUnclear=SOURCE_PORTFOLIO_INVENTORY.filter(x=>x.decision==="ACTIVATE"&&x.accessLegitimacy==="UNCLEAR");
    expect(activeUnclear).toHaveLength(0);
  });
  it("does not equate publicly reachable with approved: rosendin is ACTIVATE-decision but its access legitimacy is BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT, not a SUPPORTED/legitimate category",()=>{
    const rosendin=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="rosendin")!;
    expect(rosendin.decision).toBe("ACTIVATE");
    expect(rosendin.accessLegitimacy).toBe("BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT");
  });
  it("classifies genuinely public, documented-pattern career/procurement pages as PUBLIC_SERVER_RENDERED_PAGE, distinct from Rosendin's undocumented endpoint",()=>{
    for(const key of["bechtel","tpwd","strike-midland","port-freeport-notices","trillium-amarillo-journeyman-791374"])
      expect(SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key===key)?.accessLegitimacy).toBe("PUBLIC_SERVER_RENDERED_PAGE");
  });
  it("classifies the Port Arthur RFP PDF as PUBLIC_STATIC_DOCUMENT, not a server-rendered page",()=>expect(SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="port-arthur-temp-staffing-2026")?.accessLegitimacy).toBe("PUBLIC_STATIC_DOCUMENT"));
  it("classifies every BLOCKED-decision source as BLOCKED access legitimacy, never silently SUPPORTED",()=>expect(SOURCE_PORTFOLIO_INVENTORY.filter(x=>x.decision==="BLOCKED").every(x=>x.accessLegitimacy==="BLOCKED")).toBe(true));
  it("classifies WorkInTexas as SESSION_DEPENDENT everywhere it appears, never assumed BLOCKED or a legitimate SUPPORTED category",()=>{
    const workInTexasKeys=["workintexas","workintexas-2f","workintexas-public-detail"];
    for(const key of workInTexasKeys)expect(SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key===key)?.accessLegitimacy).toBe("SESSION_DEPENDENT");
  });
  it("keeps genuinely untested platforms (UltiPro, ApplicantPro) UNCLEAR rather than forcing BLOCKED or a legitimate SUPPORTED category",()=>{
    expect(SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="austin-industries-ultipro")?.accessLegitimacy).toBe("UNCLEAR");
    expect(SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="turner-industries-applicantpro")?.accessLegitimacy).toBe("UNCLEAR");
  });
  it("never fabricates a bypass in any legitimacy rationale (rationales that affirmatively state 'no bypass attempted' are the honest, expected case, not a violation)",()=>expect(SOURCE_PORTFOLIO_INVENTORY.every(x=>!/\bbypassed\b|\bbypassing\b|session token workaround|captcha solve/i.test(x.legitimacyRationale))).toBe(true));
});

describe("Phase 2K: TECH-DEBT-02 resolution (Rosendin / Workday wday/cxs)",()=>{
  it("resolves to exactly one of the five defined outcomes",()=>expect(["RESOLVED_COMPLIANT_ROUTE","RECLASSIFIED_UNDER_REVIEW","BLOCKED","RETIRED","UNRESOLVED_MANAGER_DECISION_REQUIRED"]).toContain(TECH_DEBT_02_RESOLUTION.outcome));
  it("resolves to BLOCKED after investigation found no compliant route",()=>expect(TECH_DEBT_02_RESOLUTION.outcome).toBe("BLOCKED"));
  it("documents concrete investigation findings, not a generic statement",()=>{
    expect(TECH_DEBT_02_RESOLUTION.findings.length).toBeGreaterThanOrEqual(3);
    expect(TECH_DEBT_02_RESOLUTION.findings.join(" ")).toMatch(/wday\/cxs/);
    expect(TECH_DEBT_02_RESOLUTION.findings.join(" ")).toMatch(/join-our-team\/apply-now/);
  });
  it("preserves historical evidence and leaves the adapter code untouched",()=>{
    expect(TECH_DEBT_02_RESOLUTION.historicalEvidencePreserved).toBe(true);
    expect(TECH_DEBT_02_RESOLUTION.downstreamAction).toMatch(/unmodified/);
  });
  it("downgrades rather than upholds under genuine uncertainty: Rosendin's portfolio value is BLOCKED, not HIGH_VALUE or SUPPORTING",()=>{
    const rosendin=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="rosendin")!;
    expect(rosendin.portfolioValue).toBe("BLOCKED");
  });
  it("is reflected in the Phase 2K summary",()=>expect(summary.techDebt02Outcome).toBe("BLOCKED"));
});

describe("Phase 2K: portfolio-value classification separates observed contribution from theoretical capability",()=>{
  it("uses only the defined portfolio-value taxonomy",()=>{
    const values=new Set(["HIGH_VALUE","SUPPORTING","LOW_YIELD","UNDER_REVIEW","BLOCKED","RETIRED"]);
    expect(SOURCE_PORTFOLIO_INVENTORY.every(x=>values.has(x.portfolioValue))).toBe(true);
  });
  it("marks an ACTIVATE source with zero observed evidence in any ledger as UNDER_REVIEW, not HIGH_VALUE, even though it was declared active with documented capability",()=>{
    const bechtel=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="bechtel")!;
    expect(bechtel.observedEvidenceCount).toBe(0);
    expect(bechtel.portfolioValue).toBe("UNDER_REVIEW");
  });
  it("marks a source with only demand-level observed evidence as SUPPORTING, not HIGH_VALUE: demand alone is not scarce",()=>{
    const strikeHouston=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="strike-houston-journeyman-electrician")!;
    expect(strikeHouston.observedEvidenceCount).toBeGreaterThan(0);
    expect(strikeHouston.closesScarceGap).toBe(false);
    expect(strikeHouston.portfolioValue).toBe("SUPPORTING");
  });
  it("marks a source that closes a buyer/AF-01/contact gap as HIGH_VALUE",()=>{
    const portArthur=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="port-arthur-temp-staffing-2026")!;
    expect(portArthur.closesScarceGap).toBe(true);
    expect(portArthur.portfolioValue).toBe("HIGH_VALUE");
  });
  it("does not count a generic 'Public assignment page' placeholder as closing the scarce contact gap",()=>{
    const strikeBaytown=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="strike-baytown-journeyman-electrician")!;
    expect(strikeBaytown.closesScarceGap).toBe(false);
  });
  it("marks the two confirmed-dead historical postings RETIRED without altering their preserved UNDER_REVIEW registry decision",()=>{
    const trillium=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="trillium-midland-794201")!,nes=SOURCE_PORTFOLIO_INVENTORY.find(x=>x.key==="nes-houston-27773")!;
    expect(trillium.portfolioValue).toBe("RETIRED");
    expect(nes.portfolioValue).toBe("RETIRED");
    expect(TARGETED_SOURCES.find(x=>x.key==="trillium-midland-794201")).toMatchObject({decision:"UNDER_REVIEW",readiness:"UNDER_REVIEW",policy:"REVIEW_REQUIRED"});
    expect(TARGETED_SOURCES.find(x=>x.key==="nes-houston-27773")).toMatchObject({decision:"UNDER_REVIEW",readiness:"UNDER_REVIEW",policy:"REVIEW_REQUIRED"});
  });
  it("reports the full evaluated-universe portfolio breakdown, which sums to the total inventory",()=>{
    expect(summary.inventoryTotalEvaluated).toBe(SOURCE_PORTFOLIO_INVENTORY.length);
    expect(summary.inventoryHighValue+summary.inventorySupporting+summary.inventoryLowYield+summary.inventoryUnderReview+summary.inventoryBlocked+summary.inventoryRetired).toBe(summary.inventoryTotalEvaluated);
  });
  it("reports the ACTIVATE-scoped portfolio breakdown, which sums to the raw activated count",()=>{
    expect(summary.portfolioHighValue+summary.portfolioSupporting+summary.portfolioLowYield+summary.portfolioUnderReview+summary.portfolioBlocked+summary.portfolioRetired).toBe(summary.sourcesRawActivated);
  });
});

describe("Phase 2K: market coverage matrix",()=>{
  const matrix=marketCoverageMatrix();
  it("covers all eight canonical Texas markets from the brief",()=>expect(matrix.map(x=>x.market)).toEqual(["Houston / Gulf Coast","Freeport","Beaumont / Port Arthur","Corpus Christi","Permian Basin","Texas Panhandle","Dallas–Fort Worth","Texas (statewide)"]));
  it("identifies AF-01 as the largest gap in Freeport and Corpus Christi",()=>{
    expect(matrix.find(x=>x.market==="Freeport")?.largestGap).toBe("af01");
    expect(matrix.find(x=>x.market==="Corpus Christi")?.largestGap).toBe("af01");
  });
  it("identifies headcount as the largest gap in Permian Basin and Texas Panhandle, where buyer/AF-01/contact/economics are otherwise known",()=>{
    expect(matrix.find(x=>x.market==="Permian Basin")?.largestGap).toBe("headcount");
    expect(matrix.find(x=>x.market==="Texas Panhandle")?.largestGap).toBe("headcount");
  });
  it("finds headcount is missing in every market that has any observed evidence at all: no source in this codebase has ever captured a headcount value",()=>{
    for(const entry of matrix)if(entry.observedEvidenceCount>0)expect(entry.evidenceClassesMissing).toContain("headcount");
  });
  it("finds DFW and statewide markets have zero observed evidence despite nominal source coverage, because their nominal sources have zero observed contribution",()=>{
    const dfw=matrix.find(x=>x.market==="Dallas–Fort Worth")!,statewide=matrix.find(x=>x.market==="Texas (statewide)")!;
    expect(dfw.observedEvidenceCount).toBe(0);
    expect(dfw.largestGap).toBe("demand");
    expect(statewide.observedEvidenceCount).toBe(0);
    expect(statewide.largestGap).toBe("demand");
  });
});

describe("Phase 2K: real HOT gap analysis grounded in actual eligibility reason codes",()=>{
  it("covers all three eligibility types",()=>expect(HOT_GAP_FINDINGS.map(x=>x.eligibilityType)).toEqual(["VAMO_ELIGIBLE","HOT_A_ELIGIBLE","HOT_B_ELIGIBLE"]));
  it("cites only real eligibility reason codes as structural blockers",()=>{
    for(const finding of HOT_GAP_FINDINGS)for(const blocker of finding.structuralBlockers)expect(ELIGIBILITY_REASONS as readonly string[]).toContain(blocker);
  });
  it("never cites compensation, per diem or headcount as a structural eligibility blocker: they are enrichment gaps, not blockers, per the real ELIGIBILITY_REASONS list",()=>{
    expect(ELIGIBILITY_REASONS).not.toContain("COMPENSATION_REQUIRED");
    expect(ELIGIBILITY_REASONS).not.toContain("PER_DIEM_REQUIRED");
    expect(ELIGIBILITY_REASONS).not.toContain("HEADCOUNT_REQUIRED");
    for(const finding of HOT_GAP_FINDINGS){
      expect(finding.structuralBlockers).not.toContain("COMPENSATION_REQUIRED");
      expect(finding.enrichmentGapsNotBlocking).toEqual(expect.arrayContaining(["compensation","perDiem","headcount"]));
    }
  });
  it("explains HOT_A's real blocker: no AF-01 candidate is ever promoted to a VERIFIED acceptance record",()=>{
    const hotA=HOT_GAP_FINDINGS.find(x=>x.eligibilityType==="HOT_A_ELIGIBLE")!;
    expect(hotA.structuralBlockers).toContain("MANPOWER_ACCEPTANCE_REQUIRED");
    expect(hotA.blockerExplanations.join(" ")).toMatch(/acceptance/);
  });
  it("explains HOT_B's real blocker: recruiter contacts exist in evidence but are never wired into the opportunity graph",()=>{
    const hotB=HOT_GAP_FINDINGS.find(x=>x.eligibilityType==="HOT_B_ELIGIBLE")!;
    expect(hotB.structuralBlockers).toContain("HOT_B_INTELLIGENCE_PATH_PRESENT");
    expect(hotB.blockerExplanations.join(" ")).toMatch(/Roberto Venegas/);
  });
  it("reports zero real HOT in the phase 2K summary, matching Phase 2J's own honest finding",()=>expect(summary).toMatchObject({vamo:0,hotA:0,hotB:0}));
});

describe("Phase 2K: no fabrication invariants",()=>{
  it("assigns no source a fabricated VERIFIED or Grade A/B/C status anywhere in the inventory",()=>expect(SOURCE_PORTFOLIO_INVENTORY.every(x=>!("verified"in x)&&!("grade"in x))).toBe(true));
  it("does not modify Phase 2H/2J's existing decision/readiness/policy on any TargetedSource record",()=>{
    expect(TARGETED_SOURCES.filter(x=>x.decision==="ACTIVATE").map(x=>x.key)).toEqual(["port-arthur-temp-staffing-2026"]);
    expect(TARGETED_SOURCES_2J.filter(x=>x.decision==="ACTIVATE").map(x=>x.key).sort()).toEqual(["strike-baytown-journeyman-electrician","strike-houston-journeyman-electrician","strike-midland-apprentice-electrician","strike-midland-journeyman-electrician","trillium-amarillo-apprentice-791431","trillium-amarillo-journeyman-791374"]);
  });
  it("does not report any commercial action, score, or outreach this phase",()=>expect(summary).toMatchObject({scored:0,commercialActions:0,outreachExecuted:false,contractEconomicsImplemented:false}));
});

describe("Phase 2K boundary",()=>{
  it("adds zero new sources",()=>expect(summary.newSourcesAdded).toBe(0));
  it("modifies no eligibility rule, scoring weight or Commercial Action vocabulary",()=>expect(summary).toMatchObject({eligibilityRulesModified:false,scoringWeightsModified:false,commercialActionVocabularyModified:false}));
  it("starts no scheduler or worker infrastructure",()=>expect(summary.schedulerOrWorkerInfrastructureStarted).toBe(false));
  it("does not start Phase 2L",()=>expect(summary.phase2lStarted).toBe(false));
});
