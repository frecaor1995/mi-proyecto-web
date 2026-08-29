import{describe,expect,it}from"vitest";import{closureSnapshots}from"../../server/services/targeted-evidence/targeted-evidence-closure-service";import{FACTS_2H,FACTS_2J,PLATFORM_CLASSIFICATIONS,TARGETED_SOURCES_2H,TARGETED_SOURCES_2I,TARGETED_SOURCES_2J,contributionMatrix2j,correlate,phase2jSummary,reviewPackages2j}from"../../server/services/targeted-evidence/targeted-evidence-closure-2j-service";
const summary=phase2jSummary(),snapshots=closureSnapshots();

describe("Phase 2J platform-pattern classification",()=>{
it("classifies every evaluated platform with a valid status",()=>expect(PLATFORM_CLASSIFICATIONS.every(p=>["SUPPORTED","UNDER_REVIEW_BROWSER_REQUIRED","BLOCKED"].includes(p.status))).toBe(true));
it("classifies documented public job-board APIs as SUPPORTED",()=>{expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform==="Greenhouse")?.status).toBe("SUPPORTED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform==="Lever")?.status).toBe("SUPPORTED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform==="SmartRecruiters")?.status).toBe("SUPPORTED")});
it("classifies JS-only SPA-driven platforms as BLOCKED, not silently skipped (dynamic-source classification)",()=>{expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform.startsWith("Workday"))?.status).toBe("BLOCKED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform==="iCIMS")?.status).toBe("BLOCKED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform.includes("Oracle"))?.status).toBe("BLOCKED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform.startsWith("ADP"))?.status).toBe("BLOCKED")});
it("assigns UNDER_REVIEW_BROWSER_REQUIRED (not a fabricated BLOCKED or SUPPORTED) to genuinely untested platforms",()=>{expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform.includes("UltiPro"))?.status).toBe("UNDER_REVIEW_BROWSER_REQUIRED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform==="ApplicantPro")?.status).toBe("UNDER_REVIEW_BROWSER_REQUIRED");expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform.includes("SuccessFactors"))?.status).toBe("UNDER_REVIEW_BROWSER_REQUIRED")});
it("never fabricates a bypass or session-token workaround in any platform's evidence text (no-bypass invariant)",()=>expect(PLATFORM_CLASSIFICATIONS.every(p=>!/bypass|session token|captcha solve/i.test(p.evidence))).toBe(true));
it("treats a documented Workday partner API as distinct from the undocumented wday/cxs endpoint developers actually hit",()=>expect(PLATFORM_CLASSIFICATIONS.find(p=>p.platform.startsWith("Workday"))?.evidence).toMatch(/undocumented/));
it("platform-level SUPPORTED status does not imply any per-source activation on that platform: no captured Phase 2J source is a Greenhouse, Lever, SmartRecruiters or Paylocity endpoint",()=>{const supportedButUnused=["greenhouse.io","lever.co","smartrecruiters.com","paylocity.com"];expect(TARGETED_SOURCES_2J.every(s=>supportedButUnused.every(host=>!s.endpoint.includes(host)))).toBe(true)});
});

describe("Phase 2J source activation and no-bypass invariants",()=>{
it("classifies every evaluated source with a valid family, market and decision",()=>expect(TARGETED_SOURCES_2J.every(x=>typeof x.family==="string"&&typeof x.market==="string"&&["ACTIVATE","UNDER_REVIEW","DEFER","BLOCKED"].includes(x.decision))).toBe(true));
it("activates only policy-allowed, capture-approved sources",()=>expect(TARGETED_SOURCES_2J.filter(x=>x.decision==="ACTIVATE").every(x=>x.readiness==="APPROVED_FOR_LIVE_CAPTURE"&&x.policy==="ALLOW")).toBe(true));
it("activates exactly six sources: four Strike direct-employer postings and two Trillium Amarillo postings",()=>{expect(summary.sourcesActivated).toBe(6);expect(TARGETED_SOURCES_2J.filter(x=>x.decision==="ACTIVATE").map(x=>x.key).sort()).toEqual(["strike-baytown-journeyman-electrician","strike-houston-journeyman-electrician","strike-midland-apprentice-electrician","strike-midland-journeyman-electrician","trillium-amarillo-apprentice-791431","trillium-amarillo-journeyman-791374"])});
it("denies (BLOCKED, not merely deferred) every source whose platform was classified BLOCKED",()=>expect(TARGETED_SOURCES_2J.filter(x=>x.decision==="BLOCKED").every(x=>x.readiness==="BLOCKED"&&x.policy==="DENY")).toBe(true));
it("leaves genuinely untested platforms (UltiPro, ApplicantPro) UNDER_REVIEW rather than forcing a BLOCKED or ACTIVATE call",()=>{expect(TARGETED_SOURCES_2J.find(x=>x.key==="austin-industries-ultipro")).toMatchObject({decision:"UNDER_REVIEW",policy:"REVIEW_REQUIRED"});expect(TARGETED_SOURCES_2J.find(x=>x.key==="turner-industries-applicantpro")).toMatchObject({decision:"UNDER_REVIEW",policy:"REVIEW_REQUIRED"})});
it("uses only plain-document capture methods for activated sources, never a session/auth-bypass method",()=>expect(TARGETED_SOURCES_2J.filter(x=>x.decision==="ACTIVATE").every(x=>x.captureMethod==="PUBLIC_DOCUMENT")).toBe(true));
});

describe("Phase 2J economics field parsing with NULL preservation",()=>{
it("extracts explicit Trillium Amarillo journeyman pay maximum and per diem",()=>{const f=FACTS_2J.find(x=>x.sourceKey==="trillium-amarillo-journeyman-791374");expect(f?.payMax).toBe(43);expect(f?.perDiem).toBe(100)});
it("preserves NULL for overtime even when pay and per diem are known (no inference across fields)",()=>expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("trillium-amarillo")).every(f=>f.overtime===null)).toBe(true));
it("extracts an explicit wage-progression range for the apprentice posting",()=>{const f=FACTS_2J.find(x=>x.sourceKey==="trillium-amarillo-apprentice-791431");expect(f?.payMin).toBe(20.35);expect(f?.payMax).toBe(43)});
it("captures the same named recruiter and contact route on both Trillium Amarillo postings",()=>expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("trillium-amarillo")).every(f=>f.contactPerson==="Roberto Venegas"&&f.contactRoute==="800-778-8907")).toBe(true));
it("keeps headcount null for every Phase 2J fact (never stated on any captured page)",()=>expect(FACTS_2J.every(f=>f.headcount===null)).toBe(true));
it("keeps all four Strike facts' economics fields null: the postings state no pay, per diem, overtime, headcount, or duration",()=>expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("strike")).every(f=>f.payMin===null&&f.payMax===null&&f.perDiem===null&&f.overtime===null&&f.duration===null)).toBe(true));
it("does not fabricate a buyer or AF-01 candidate for a direct-employer posting (Strike is not a staffing intermediary here)",()=>expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("strike")).every(f=>f.buyerCandidate===null&&f.af01Candidate===null)).toBe(true));
it("assigns no automatic Grade A contact authority on any Phase 2J fact",()=>expect(FACTS_2J.every(f=>f.contactGrade===null)).toBe(true));
it("preserves every buyer candidate as UNVERIFIED",()=>expect(FACTS_2J.filter(f=>f.buyerCandidate).every(f=>f.verification==="UNVERIFIED")).toBe(true));
});

describe("Phase 2J stable posting identity and no fuzzy merge",()=>{
it("correlates the two Trillium Amarillo facts as distinct postings, not a match, despite sharing employer and market",()=>expect(correlate(FACTS_2J[4],FACTS_2J[5]).decision).toBe("REVIEW_CANDIDATE"));
it("correlates a fact with itself under a different id by shared employer_posting_id",()=>expect(correlate(FACTS_2J[4],{...FACTS_2J[4],id:"other"})).toMatchObject({decision:"MATCH",key:"employer_posting_id",value:"791374"}));
it("does not correlate the two Strike Midland facts with each other despite the same market and company (distinct stable identifiers)",()=>expect(correlate(FACTS_2J[0],FACTS_2J[1]).decision).toBe("REVIEW_CANDIDATE"));
it("does not correlate Phase 2J evidence against Phase 2H evidence lacking a shared stable identifier value",()=>{const trilliumMidland794201=FACTS_2H.find(f=>f.sourceKey==="trillium-midland-794201");expect(trilliumMidland794201).toBeDefined();expect(correlate(FACTS_2J[4],trilliumMidland794201!).decision).toBe("REVIEW_CANDIDATE")});
it("gives every Phase 2J posting a distinct employer_posting_id (no collisions)",()=>{const ids=FACTS_2J.map(f=>f.stableIdentifiers.employer_posting_id);expect(new Set(ids).size).toBe(ids.length)});
});

describe("Phase 2J current-vs-removed-posting handling and Trillium/NES/WorkInTexas boundaries",()=>{
it("keeps the Phase 2H Trillium Midland posting (794201) UNDER_REVIEW and unmodified: the historical record is preserved, never converted retroactively",()=>expect(TARGETED_SOURCES_2H.find(x=>x.key==="trillium-midland-794201")).toMatchObject({decision:"UNDER_REVIEW",readiness:"UNDER_REVIEW",policy:"REVIEW_REQUIRED"}));
it("keeps the Phase 2H NES Fircroft posting (BH-330309 / 27773) UNDER_REVIEW and unmodified",()=>expect(TARGETED_SOURCES_2H.find(x=>x.key==="nes-houston-27773")).toMatchObject({decision:"UNDER_REVIEW",readiness:"UNDER_REVIEW",policy:"REVIEW_REQUIRED"}));
it("activates current Trillium Amarillo postings with different stable IDs from the dead 794201 posting, rather than resurrecting the historical one",()=>{expect(TARGETED_SOURCES_2J.filter(x=>x.key.startsWith("trillium-amarillo")).map(x=>x.decision)).toEqual(["ACTIVATE","ACTIVATE"]);expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("trillium-amarillo")).map(f=>f.stableIdentifiers.employer_posting_id)).toEqual(["791374","791431"])});
it("confirms Trillium's historical posting stays confirmed unavailable and reports the current-posting activation count separately",()=>{expect(summary.trilliumHistoricalStatus).toBe("UNDER_REVIEW_CONFIRMED_UNAVAILABLE");expect(summary.trilliumCurrentTexasPostingsActivated).toBe(2)});
it("confirms NES stays confirmed unavailable, with no NES-platform source activated this phase (careers.nesfircroft.com is JS-driven)",()=>{expect(summary.nesStatus).toBe("UNDER_REVIEW_CONFIRMED_UNAVAILABLE");expect(TARGETED_SOURCES_2J.some(s=>s.endpoint.includes("nesfircroft"))).toBe(false)});
it("leaves WorkInTexas UNDER_REVIEW after one bounded honest re-check (session-gated, no stable public detail-page URL pattern found)",()=>expect(summary.workInTexas).toBe("UNDER_REVIEW"));
it("did not re-add WorkInTexas as a Phase 2J source (no disproportionate effort spent)",()=>expect(TARGETED_SOURCES_2J.some(s=>s.endpoint.includes("workintexas"))).toBe(false));
});

describe("Phase 2J research-vs-production separation",()=>{
it("builds the source contribution matrix from activated sources only",()=>{expect(contributionMatrix2j()).toHaveLength(6);expect(contributionMatrix2j().every(row=>TARGETED_SOURCES_2J.find(s=>s.key===row.sourceKey)?.decision==="ACTIVATE")).toBe(true)});
it("excludes every BLOCKED and UNDER_REVIEW source from the production contribution matrix",()=>{const blockedAndReview=TARGETED_SOURCES_2J.filter(x=>x.decision==="BLOCKED"||x.decision==="UNDER_REVIEW").map(x=>x.key);expect(contributionMatrix2j().some(row=>blockedAndReview.includes(row.sourceKey))).toBe(false)});
it("marks captured evidence fresh",()=>expect(contributionMatrix2j().every(x=>x.freshness==="FRESH")).toBe(true));
it("counts production compensation/per-diem only from Trillium Amarillo, not from the Strike demand-only facts",()=>expect(summary).toMatchObject({productionCompensationKnown:2,productionPerDiemKnown:2,productionHeadcountKnown:0,productionOvertimeKnown:0}));
it("truthfully carries the source portfolio forward",()=>expect(summary).toMatchObject({sourcesBefore:20,sourcesEvaluated:12,sourcesActivated:6,sourcesBlocked:4,sourcesUnderReview:2,sourcesAfter:26}));
it("leaves Phase 2I's zero-activation evaluated sources untouched",()=>expect(TARGETED_SOURCES_2I.filter(x=>x.decision==="ACTIVATE")).toHaveLength(0));
});

describe("Phase 2J opportunity enrichment without fuzzy merge",()=>{
it("attaches the two Strike Midland facts to the existing Permian Basin opportunity by direct market/company match, not by automatic correlate()",()=>expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("strike-midland")).every(f=>f.opportunityId==="qual-permian")).toBe(true));
it("leaves Houston/Baytown Strike facts unattached: no fuzzy merge onto a dossier whose market does not match",()=>expect(FACTS_2J.filter(f=>f.sourceKey==="strike-houston-journeyman-electrician"||f.sourceKey==="strike-baytown-journeyman-electrician").every(f=>f.opportunityId===null)).toBe(true));
it("Phase 2Q: both Trillium Amarillo facts are now attached to the real qual-amarillo tracked opportunity, added Phase 2Q by explicit manager authorization -- this is a real, non-fuzzy match (same employer, same market, same evidence this file already captured; not a geography-only inference)",()=>expect(FACTS_2J.filter(f=>f.sourceKey.startsWith("trillium-amarillo")).every(f=>f.opportunityId==="qual-amarillo")).toBe(true));
it("touches exactly two tracked opportunities this phase: qual-permian (Strike) and qual-amarillo (Trillium, Phase 2Q)",()=>expect(summary.opportunitiesTouched).toBe(2));
it("generates review packages for Trillium's buyer candidate now that it carries a matching tracked opportunityId; still none for Strike, which carries an opportunityId but no buyer/AF-01 candidate",()=>{expect(reviewPackages2j()).toHaveLength(2);expect(reviewPackages2j().every(p=>p.opportunityId==="qual-amarillo")).toBe(true)});
it("fabricates no VERIFY decision anywhere in Phase 2J review packages",()=>expect(reviewPackages2j().every(p=>(p.proposedDecision as string)!=="VERIFY")).toBe(true));
});

describe("Phase 2J eligibility, scoring and Commercial Action gates",()=>{
it("leaves eligibility unchanged and still blocked: no Phase 2J fact closed a buyer, AF-01 or actionable-contact gap",()=>{expect(snapshots.every(x=>Object.values(x.eligibility).every(y=>!y.eligible))).toBe(true);expect(snapshots.every(x=>Object.values(x.eligibility).every(y=>y.blockers.length>0))).toBe(true)});
it("reports eligibilityChanged: false, matching the closure snapshots being computed independently of Phase 2J facts",()=>expect(summary.eligibilityChanged).toBe(false));
it("scores nothing before eligibility clears",()=>{expect(snapshots.every(x=>x.scoreState==="NOT_SCORABLE")).toBe(true);expect(summary.scored).toBe(0)});
it("generates no Commercial Action before eligibility clears",()=>{expect(snapshots.every(x=>x.commercialActionState==="NOT_GENERATED")).toBe(true);expect(summary.commercialActions).toBe(0)});
it("reports zero real HOT this phase: a real acquisition-bottleneck finding is an accepted, truthful outcome",()=>expect(summary).toMatchObject({vamo:0,hotA:0,hotB:0}));
it("executes no outreach",()=>expect(summary.outreachExecuted).toBe(false));
it("implements no Contract Economics",()=>expect(summary.contractEconomicsImplemented).toBe(false));
it("never auto-verifies a buyer or AF-01 candidate this phase",()=>expect(summary).toMatchObject({newVerifiedBuyers:0,newVerifiedAf01:0}));
});

describe("Phase 2J boundary",()=>{
it("preserves the Phase 2K boundary: nothing from Phase 2K has started",()=>expect(summary.phase2kStarted).toBe(false));
it("does not alter Phase 2H's or Phase 2I's activation counts",()=>{expect(TARGETED_SOURCES_2H.filter(x=>x.decision==="ACTIVATE")).toHaveLength(1);expect(TARGETED_SOURCES_2I.filter(x=>x.decision==="ACTIVATE")).toHaveLength(0)});
});
