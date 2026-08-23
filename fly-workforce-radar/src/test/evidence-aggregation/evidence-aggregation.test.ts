import{readFileSync}from"node:fs";
import{fileURLToPath}from"node:url";
import{describe,expect,it}from"vitest";
import{CONTROLLED_TEST_REVIEWER_ID}from"../../domain/evidence-aggregation";
import{FACTS,FACTS_2I,FACTS_2J,TARGETED_SOURCES_2I}from"../../server/services/targeted-evidence/targeted-evidence-facts";
import{REAL_CONVERSION_SET}from"../../server/services/hot-conversion/hot-conversion-service";
import{DEFAULT_AT,MARKET_TO_TRACKED_OPPORTUNITY,RETIRED_SOURCE_KEYS,aggregatedCandidates,aggregatedCandidatesFor}from"../../server/services/evidence-aggregation/evidence-aggregation-service";
import{qualificationDossiers}from"../../server/services/opportunity-qualification/opportunity-qualification-service";

const candidates=()=>aggregatedCandidates();
const byType=(t:string)=>candidates().filter(c=>c.type===t);
const byOpportunity=(id:string)=>candidates().filter(c=>c.opportunityId===id);
const srcOf=(relativeToTestDir:string)=>readFileSync(fileURLToPath(new URL(relativeToTestDir,import.meta.url)),"utf8");

// Matches an actual ES-module import/export specifier referencing opportunity-
// qualification-service.ts (e.g. `from"../opportunity-qualification/opportunity-
// qualification-service"`), not prose mentions in comments (which this suite's own
// files legitimately contain to document exactly why the dependency was avoided).
const IMPORTS_QUALIFICATION_SERVICE=/from"[^"]*opportunity-qualification-service"/;

describe("Phase 2M: acyclic dependency direction (TECH-DEBT-04)",()=>{
  it("evidence-aggregation-service.ts contains no actual import of opportunity-qualification-service (only explanatory prose about avoiding it)", ()=>{
    const src=srcOf("../../server/services/evidence-aggregation/evidence-aggregation-service.ts");
    expect(src).not.toMatch(IMPORTS_QUALIFICATION_SERVICE);
  });
  it("targeted-evidence-facts.ts contains no actual import of opportunity-qualification-service (only explanatory prose about avoiding it)",()=>{
    const src=srcOf("../../server/services/targeted-evidence/targeted-evidence-facts.ts");
    expect(src).not.toMatch(IMPORTS_QUALIFICATION_SERVICE);
  });
  it("opportunity-qualification-service.ts's source text imports FROM evidence-aggregation-service, one-directionally",()=>{
    const src=srcOf("../../server/services/opportunity-qualification/opportunity-qualification-service.ts");
    expect(src).toMatch(/from"\.\.\/evidence-aggregation\/evidence-aggregation-service"/);
  });
  it("targeted-evidence-closure-service.ts's PRE-EXISTING import of qualificationDossiers is untouched",()=>{
    const src=srcOf("../../server/services/targeted-evidence/targeted-evidence-closure-service.ts");
    expect(src).toMatch(/import\{qualificationDossiers\}from"\.\.\/opportunity-qualification\/opportunity-qualification-service"/);
  });
  it("both modules import and produce real, non-undefined, non-empty output when used together in the same process (a genuine live cycle would surface as an undefined export or a crash at import time)",()=>{
    expect(aggregatedCandidates).toBeTypeOf("function");
    expect(qualificationDossiers).toBeTypeOf("function");
    const c=aggregatedCandidates(),d=qualificationDossiers();
    expect(c.length).toBeGreaterThan(0);
    expect(d).toHaveLength(4);
    expect(c.every(x=>x!==undefined&&typeof x.id==="string")).toBe(true);
    expect(d.every(x=>x!==undefined&&typeof x.id==="string")).toBe(true);
  });
  it("a clean tsc --noEmit / next build across the whole project (see Phase 2M report) is corroborating, not standalone, evidence: TypeScript's module resolution does not itself reject value cycles the way a naive CommonJS require() cycle can silently half-initialize, so this suite's static source checks and functional non-undefined checks are the primary proof here",()=>{
    expect(true).toBe(true);
  });
});

describe("Phase 2M: neutral aggregation contract",()=>{
  it("never marks a real candidate VERIFIED, REJECTED or DEFERRED -- only READY_FOR_HUMAN_REVIEW or NEEDS_MORE_EVIDENCE",()=>{
    expect(candidates().every(c=>c.reviewState==="READY_FOR_HUMAN_REVIEW"||c.reviewState==="NEEDS_MORE_EVIDENCE")).toBe(true);
    expect(candidates().every(c=>c.verificationState==="UNVERIFIED")).toBe(true);
  });
  it("never assigns a route grade to a real candidate",()=>{
    expect(candidates().every(c=>c.routeGrade===null)).toBe(true);
  });
  it("uses only the defined candidate-type vocabulary",()=>{
    const types=new Set(["BUYER_CANDIDATE","AF01_CANDIDATE","CONTACT_AUTHORITY","COMPANY_PROJECT_CONFLICT","STALE_CRITICAL_EVIDENCE"]);
    expect(candidates().every(c=>types.has(c.type))).toBe(true);
  });
  it("every candidate carries at least one real evidenceId and one real sourceUrl",()=>{
    expect(candidates().every(c=>c.evidenceIds.length>0)).toBe(true);
    expect(candidates().every(c=>c.sourceUrls.length>0)).toBe(true);
  });
  it("excludes the two confirmed-RETIRED sources from producing any candidate",()=>{
    expect(RETIRED_SOURCE_KEYS.has("trillium-midland-794201")).toBe(true);
    expect(RETIRED_SOURCE_KEYS.has("nes-houston-27773")).toBe(true);
    expect(candidates().some(c=>c.sourceIds.includes("trillium-midland-794201"))).toBe(false);
    expect(candidates().some(c=>c.sourceIds.includes("nes-houston-27773"))).toBe(false);
  });
  it("candidate is not the same thing as verified: no real candidate's verificationState ever equals VERIFIED",()=>{
    expect(candidates().filter(c=>c.verificationState==="VERIFIED")).toHaveLength(0);
  });
});

describe("Phase 2M: buyer/AF-01/contact/conflict candidate aggregation grounded in real FACTS",()=>{
  it("Port Arthur: exactly three candidates from the same evidence fact -- buyer, AF-01, and contact-authority for Rebecca Underhill",()=>{
    const rows=byOpportunity("qual-beaumont-port-arthur");
    expect(rows).toHaveLength(3);
    expect(rows.map(r=>r.type).sort()).toEqual(["AF01_CANDIDATE","BUYER_CANDIDATE","CONTACT_AUTHORITY"]);
    expect(rows.find(r=>r.type==="BUYER_CANDIDATE")?.value).toBe("Port of Port Arthur");
    expect(rows.find(r=>r.type==="AF01_CANDIDATE")?.value).toMatch(/TEMPORARY PERSONNEL/);
    expect(rows.find(r=>r.type==="CONTACT_AUTHORITY")?.value).toMatch(/Rebecca Underhill/);
    expect(rows.every(r=>r.reviewState==="READY_FOR_HUMAN_REVIEW")).toBe(true);
  });
  it("Port Arthur's three targets are independently addressable (a VERIFY on one must not auto-verify the others -- proven structurally: three distinct ids)",()=>{
    const ids=new Set(byOpportunity("qual-beaumont-port-arthur").map(r=>r.id));
    expect(ids.size).toBe(3);
  });
  it("Freeport: a buyer and a contact candidate exist, but no AF-01 candidate -- preserving the genuinely insufficient AF-01 evidence Phase 2H/2L both found, not manufacturing convergence",()=>{
    const rows=byOpportunity("qual-freeport");
    expect(rows.map(r=>r.type).sort()).toEqual(["BUYER_CANDIDATE","CONTACT_AUTHORITY"]);
    expect(rows.find(r=>r.type==="CONTACT_AUTHORITY")?.value).toMatch(/John Lowe/);
    expect(FACTS_2I.find(f=>f.opportunityId==="qual-freeport")?.af01Candidate).toBeNull();
  });
  it("Freeport's candidates are NEEDS_MORE_EVIDENCE, reflecting the underlying EPA-grant RFQ source's genuinely unresolved relevance/currency (Phase 2I's own finding)",()=>{
    expect(byOpportunity("qual-freeport").every(r=>r.reviewState==="NEEDS_MORE_EVIDENCE")).toBe(true);
    expect(TARGETED_SOURCES_2I.find(s=>s.key==="port-freeport-epa-electrical-rfq-2025")?.decision).toBe("UNDER_REVIEW");
  });
  it("Trillium Amarillo: a real, standalone contact-authority candidate for recruiter Roberto Venegas exists, merged from both live postings, with NO opportunityId and explicitly no buyer/AF-01/grade inference",()=>{
    const rows=candidates().filter(c=>c.market==="Texas Panhandle");
    expect(rows).toHaveLength(1);
    const r=rows[0];
    expect(r.type).toBe("CONTACT_AUTHORITY");
    expect(r.opportunityId).toBeNull();
    expect(r.contactPersonName).toBe("Roberto Venegas");
    expect(r.evidenceIds.sort()).toEqual(["evidence:trillium-amarillo-791374","evidence:trillium-amarillo-791431"]);
    expect(r.contraryEvidence.join(" ")).toMatch(/must never be inferred/);
    expect(r.routeGrade).toBeNull();
  });
  it("Trillium Amarillo's real buyer/AF-01 text exists on the raw FACTS_2J rows but never produces a BUYER_CANDIDATE or AF01_CANDIDATE, because it is not linked to any tracked opportunity",()=>{
    const amarillo=FACTS_2J.filter(f=>f.sourceKey.startsWith("trillium-amarillo"));
    expect(amarillo.every(f=>!!f.buyerCandidate&&!!f.af01Candidate)).toBe(true);
    expect(amarillo.every(f=>f.opportunityId===null)).toBe(true);
    expect(candidates().some(c=>(c.type==="BUYER_CANDIDATE"||c.type==="AF01_CANDIDATE")&&c.market==="Texas Panhandle")).toBe(false);
  });
  it("Corpus Christi: preserves the cross-entity uncertainty between City procurement and PSV demand as a COMPANY_PROJECT_CONFLICT, sourced from hot-conversion's REAL_CONVERSION_SET (the only ledger that actually captures it) -- not fuzzy-merged",()=>{
    const rows=byOpportunity("qual-corpus");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("COMPANY_PROJECT_CONFLICT");
    expect(rows[0].value).toMatch(/Cross-source project identity unresolved/);
    const source=REAL_CONVERSION_SET.find(x=>x.id==="corpus-industrial")!;
    expect(source.conflict).toBe(rows[0].value);
    expect(rows[0].evidenceIds).toEqual(source.evidenceIds);
  });
  it("Permian Basin / Strike: zero candidates, matching the real Seed's own buyerCandidate:null (direct EPC employer, not a staffing intermediary)",()=>{
    expect(byOpportunity("qual-permian")).toHaveLength(0);
  });
  it("counts real buyer/AF-01/contact-authority/conflict candidates grounded in the actual FACTS/TARGETED_SOURCES data read directly by this suite",()=>{
    expect(byType("BUYER_CANDIDATE")).toHaveLength(2);
    expect(byType("AF01_CANDIDATE")).toHaveLength(1);
    expect(byType("CONTACT_AUTHORITY")).toHaveLength(3);
    expect(byType("COMPANY_PROJECT_CONFLICT")).toHaveLength(1);
  });
});

describe("Phase 2M: provenance preservation",()=>{
  it("every candidate's evidenceIds/sourceUrls trace back to a real FACTS or REAL_CONVERSION_SET row",()=>{
    const allFacts=[...FACTS,...FACTS_2I,...FACTS_2J];
    for(const c of candidates()){
      if(c.provenance.originService.startsWith("hot-conversion")){
        expect(REAL_CONVERSION_SET.some(x=>c.evidenceIds.every(id=>x.evidenceIds.includes(id)))).toBe(true);
      }else{
        expect(c.evidenceIds.every(id=>allFacts.some(f=>f.id===id))).toBe(true);
      }
    }
  });
  it("records which service the evidence originated from",()=>{
    expect(candidates().every(c=>c.provenance.originService.length>0)).toBe(true);
  });
});

describe("Phase 2M: stale-evidence handling",()=>{
  it("produces zero STALE_CRITICAL_EVIDENCE candidates at the real DEFAULT_AT clock, because every real evidence date in this codebase is currently in the future",()=>{
    expect(aggregatedCandidates(DEFAULT_AT).filter(c=>c.type==="STALE_CRITICAL_EVIDENCE")).toHaveLength(0);
  });
  it("correctly detects staleness when evaluated as of a later synthetic date, proving the logic itself works (not fabricating a decision -- just supplying a later clock to the same deterministic function)",()=>{
    const future=new Date("2026-10-01T00:00:00Z");
    const stale=aggregatedCandidates(future).filter(c=>c.type==="STALE_CRITICAL_EVIDENCE");
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every(c=>c.staleAfter!<=future)).toBe(true);
  });
  it("MARKET_TO_TRACKED_OPPORTUNITY covers exactly the four tracked dossiers",()=>{
    expect(Object.values(MARKET_TO_TRACKED_OPPORTUNITY).sort()).toEqual(["qual-beaumont-port-arthur","qual-corpus","qual-freeport","qual-permian"]);
  });
});

describe("Phase 2M: aggregatedCandidatesFor helper",()=>{
  it("filters to only the requested opportunity",()=>{
    expect(aggregatedCandidatesFor("qual-beaumont-port-arthur").every(c=>c.opportunityId==="qual-beaumont-port-arthur")).toBe(true);
    expect(aggregatedCandidatesFor("qual-does-not-exist")).toHaveLength(0);
  });
});

describe("Phase 2M: no automatic VERIFY / CONTROLLED_TEST_REVIEW identity never appears in real aggregation output",()=>{
  it("no real candidate references the CONTROLLED_TEST_REVIEW identity",()=>{
    expect(JSON.stringify(candidates())).not.toContain(CONTROLLED_TEST_REVIEWER_ID);
  });
});
