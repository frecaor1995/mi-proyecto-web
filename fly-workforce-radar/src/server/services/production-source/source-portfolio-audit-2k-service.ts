import type{AccessLegitimacyCategory,DuplicateInventoryGroup,HotGapFinding,MarketCoverageEntry,Phase2kPortfolioValue,SourceDecisionState,SourceInventoryEntry,SourceInventoryReconstruction,SourceOrigin,TechDebtResolution}from"../../../domain/source-portfolio-audit";
import{FACTS,TARGETED_SOURCES}from"../targeted-evidence/targeted-evidence-closure-service";
import{FACTS_2I,TARGETED_SOURCES_2I}from"../targeted-evidence/targeted-evidence-closure-2i-service";
import{FACTS_2J,TARGETED_SOURCES_2J,phase2jSummary}from"../targeted-evidence/targeted-evidence-closure-2j-service";
import{ACTIVATED_EXPANSION,EVALUATED_EXPANSION}from"./multi-source-strategy";
import{COMMERCIAL_ACTIVATIONS,COMMERCIAL_EVALUATIONS}from"./commercial-intelligence-strategy";
import{HOT_EVIDENCE_ACTIVATIONS,HOT_EVIDENCE_EVALUATIONS}from"./hot-evidence-strategy";
import{REAL_CONVERSION_SET}from"../hot-conversion/hot-conversion-service";

/**
 * Phase 2K: hardening/audit only. No new sources, no scheduler, no eligibility or
 * scoring changes. This file reconstructs the true production source inventory from
 * the actual registries (rather than trusting the phase-chain narrative), classifies
 * every evaluated source's access legitimacy against Phase 2J's bright line, resolves
 * TECH-DEBT-02, and separates observed commercial contribution from mere capability.
 */

/** Phase 2B predates the declarative EvaluatedSource/TargetedSource pattern used from
 * Phase 2C onward: these three adapters exist only as hand-written classes with a
 * hardcoded default capture URL, never as a data-driven registry entry with an
 * explicit decision/readiness/policy. Reconstructing the true inventory requires
 * declaring them here so this audit does not silently omit them. Values below are
 * read directly from rosendin-adapter.ts, bechtel-adapter.ts and tpwd-adapter.ts. */
const PHASE_2B_STANDALONE_SOURCES=[
  {key:"rosendin",name:"Rosendin Careers (Workday)",endpoint:"https://rosendin.wd1.myworkdayjobs.com/wday/cxs/rosendin/Careers/job/Field-TX-Austin/Journeyman-Electrician_JR106219",family:"COMPANY_CAREERS",markets:["Texas"],decision:"ACTIVATE"as const},
  {key:"bechtel",name:"Bechtel Careers (SAP SuccessFactors job detail)",endpoint:"https://bechtel.jobs.hr.cloud.sap/job/Port-Arthur-Electrical-Field-Engineer-TX-77641/1415398000/",family:"EPC_CONTRACTOR",markets:["Beaumont / Port Arthur"],decision:"ACTIVATE"as const},
  {key:"tpwd",name:"Texas Parks and Wildlife Department Construction Bid Opportunities",endpoint:"https://tpwd.texas.gov/business/bidops/current_bid_opportunities/construction/index.phtml?print=true",family:"PROCUREMENT_PORTAL",markets:["Texas"],decision:"ACTIVATE"as const},
];

interface RawSource{key:string;name:string;endpoint:string;family:string;markets:string[];origin:SourceOrigin;decision:SourceDecisionState}

const RAW_SOURCES:RawSource[]=[
  ...PHASE_2B_STANDALONE_SOURCES.map(s=>({...s,origin:"PHASE_2B_STANDALONE_ADAPTER"as const})),
  ...EVALUATED_EXPANSION.map(s=>({key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:s.markets,origin:"PHASE_2C_MULTI_SOURCE"as const,decision:s.decision as SourceDecisionState})),
  ...COMMERCIAL_EVALUATIONS.map(s=>({key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:s.markets,origin:"PHASE_2D_COMMERCIAL_INTELLIGENCE"as const,decision:s.decision as SourceDecisionState})),
  ...HOT_EVIDENCE_EVALUATIONS.map(s=>({key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:s.markets,origin:"PHASE_2F_HOT_EVIDENCE"as const,decision:s.decision as SourceDecisionState})),
  ...TARGETED_SOURCES.map(s=>({key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:[s.market],origin:"PHASE_2H_TARGETED_EVIDENCE"as const,decision:s.decision as SourceDecisionState})),
  ...TARGETED_SOURCES_2I.map(s=>({key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:[s.market],origin:"PHASE_2I_TARGETED_EVIDENCE"as const,decision:s.decision as SourceDecisionState})),
  ...TARGETED_SOURCES_2J.map(s=>({key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:[s.market],origin:"PHASE_2J_TARGETED_EVIDENCE"as const,decision:s.decision as SourceDecisionState})),
];

// ---------------------------------------------------------------------------
// 1. True inventory reconstruction
// ---------------------------------------------------------------------------
const ACTIVATED_RAW=RAW_SOURCES.filter(s=>s.decision==="ACTIVATE");
const ENDPOINT_GROUPS=new Map<string,RawSource[]>();
for(const s of ACTIVATED_RAW){const g=ENDPOINT_GROUPS.get(s.endpoint)??[];g.push(s);ENDPOINT_GROUPS.set(s.endpoint,g)}
const DUPLICATE_GROUPS:DuplicateInventoryGroup[]=[...ENDPOINT_GROUPS.entries()].filter(([,g])=>g.length>1).map(([endpoint,g])=>({endpoint,keys:g.map(x=>x.key),origins:g.map(x=>x.origin)}));

export function reconstructTrueInventory():SourceInventoryReconstruction{
  const uniqueByEndpoint=ENDPOINT_GROUPS.size,narrativeClaimed=26;
  return{
    rawEntries:ACTIVATED_RAW.length,
    uniqueByEndpoint,
    duplicates:DUPLICATE_GROUPS,
    narrativeClaimed,
    narrativeAccurate:uniqueByEndpoint===narrativeClaimed,
    narrativeDiscrepancyReason:uniqueByEndpoint===narrativeClaimed?null:
      `The Phase 2H-2J summary chain's sourcesAfter=${narrativeClaimed} is arithmetically consistent with the union of every ACTIVATE-decision entry across Phase 2B (${PHASE_2B_STANDALONE_SOURCES.length}), Phase 2C (${ACTIVATED_EXPANSION.length}), Phase 2D (${COMMERCIAL_ACTIVATIONS.length}), Phase 2F (${HOT_EVIDENCE_ACTIVATIONS.length}), Phase 2H (${TARGETED_SOURCES.filter(x=>x.decision==="ACTIVATE").length}), Phase 2I (0) and Phase 2J (${TARGETED_SOURCES_2J.filter(x=>x.decision==="ACTIVATE").length}) = ${narrativeClaimed}, but it double-counts one real endpoint: Strike Midland Journeyman Electrician (${DUPLICATE_GROUPS[0]?.endpoint}) was activated independently as "${DUPLICATE_GROUPS[0]?.keys[0]}" in Phase 2D's commercial-intelligence-strategy.ts and again as "${DUPLICATE_GROUPS[0]?.keys[1]}" in Phase 2J's targeted-evidence-closure-2j-service.ts. The true distinct-endpoint production source count is ${uniqueByEndpoint}, not ${narrativeClaimed}.`,
  };
}

// ---------------------------------------------------------------------------
// 2. Access-legitimacy classification, extending Phase 2J's PLATFORM_CLASSIFICATIONS
//    bright line down to the individual source. Every ACTIVATE-decision key below
//    has an explicit, investigated classification; nothing active falls through to
//    a generic default.
// ---------------------------------------------------------------------------
const ACCESS_LEGITIMACY:Record<string,{category:AccessLegitimacyCategory;rationale:string}>={
  // Phase 2B
  rosendin:{category:"BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT",rationale:"TECH-DEBT-02: default URL is the undocumented Workday wday/cxs/ JSON endpoint; the friendly myworkdayjobs.com job URL, rosendin.com/careers and rosendin.com/join-our-team/apply-now/ were all confirmed this phase to be JavaScript-rendered with no server-rendered job content; no documented public Workday jobs API exists outside the Workday Community partner login. See TECH_DEBT_02_RESOLUTION."},
  bechtel:{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Individual SAP SuccessFactors job-detail URL on *.jobs.hr.cloud.sap renders as static HTML on plain GET (confirmed by Phase 2B fixture parsing and Phase 2J's platform note); a per-URL exception, not a documented SuccessFactors feed."},
  tpwd:{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Texas Parks and Wildlife Department's own construction-bid listing page (print view) is plain server-rendered HTML with no session or JS required."},
  // Phase 2C
  tradesmen:{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned careers page renders as static HTML on plain GET."},
  "exxon-beaumont":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned careers listing renders as static HTML on plain GET."},
  "texas-comptroller-vendor":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Texas Comptroller's own public vendor-information page."},
  "dws-energy-careers":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned careers page renders as static HTML on plain GET."},
  "gonzales-contractors":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned careers page renders as static HTML on plain GET."},
  // Phase 2D
  "strike-midland":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"JazzHR-hosted company-owned career page (*.applytojob.com) renders as static HTML with no session/JS required."},
  "port-freeport-notices":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Port Freeport's own public-notices page."},
  "corpus-procurement":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"City of Corpus Christi's own procurement page."},
  "austin-industries-partners":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned partnerships page."},
  "freeport-lng-careers":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned current-openings page."},
  "psv-industries":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Company-owned careers page."},
  // Phase 2F
  "city-freeport-purchasing":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"City of Freeport's own purchasing page."},
  "port-arthur-procurement":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Port of Port Arthur's own procurement page."},
  "corpus-supplier-portal":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"City of Corpus Christi's own supplier-portal information page (not the authenticated portal itself)."},
  "tfc-vendor-compliance":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Texas Facilities Commission's own vendor-compliance page."},
  "texas-dir-vendor":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Texas DIR's own how-to-become-a-vendor page."},
  // Phase 2H
  "port-arthur-temp-staffing-2026":{category:"PUBLIC_STATIC_DOCUMENT",rationale:"Directly-linked PDF RFP document hosted on the port authority's own site."},
  // Phase 2J activated
  "strike-midland-apprentice-electrician":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"JazzHR-hosted company-owned career page."},
  "strike-midland-journeyman-electrician":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"JazzHR-hosted company-owned career page; DUPLICATE endpoint of Phase 2D's strike-midland (see reconstructTrueInventory())."},
  "strike-houston-journeyman-electrician":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"JazzHR-hosted company-owned career page."},
  "strike-baytown-journeyman-electrician":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"JazzHR-hosted company-owned career page."},
  "trillium-amarillo-journeyman-791374":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Trillium's own /jobs/job/ static HTML page."},
  "trillium-amarillo-apprentice-791431":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Trillium's own /jobs/job/ static HTML page."},
  // Phase 2J blocked
  "mcdean-icims-careers":{category:"BLOCKED",rationale:"iCIMS-backed (careers-mcdean.icims.com); no open unauthenticated public feed exists, only an OAuth partner feed (Phase 2J PLATFORM_CLASSIFICATIONS: iCIMS)."},
  "zachry-oracle-recruiting-cloud":{category:"BLOCKED",rationale:"Oracle Recruiting Cloud; no public job-search API, requisition endpoints are undocumented and gated (Phase 2J PLATFORM_CLASSIFICATIONS: Oracle Recruiting Cloud / Taleo)."},
  "walker-engineering-taleo":{category:"BLOCKED",rationale:"Oracle Taleo; listings confirmed JS-rendered with no documented public API (Phase 2J PLATFORM_CLASSIFICATIONS: Oracle Recruiting Cloud / Taleo)."},
  "skillforce-adp-recruitment":{category:"BLOCKED",rationale:"ADP Workforce Now recruitment widget keyed by a session-style cid parameter; ADP's documented APIs cover OAuth-authenticated employer HRIS integration only (Phase 2J PLATFORM_CLASSIFICATIONS: ADP)."},
  // Notable UNDER_REVIEW / DEFER entries with a genuinely investigated basis
  "trillium-midland-794201":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Trillium's own /jobs/job/ pages are confirmed plain server-rendered HTML (same pattern as the current Trillium Amarillo sources); this specific posting now returns non-success (effectively gone) but the access method itself remains legitimate -- the UNDER_REVIEW/historical decision reflects the posting being dead, not an access-legitimacy problem."},
  "nes-houston-27773":{category:"UNCLEAR",rationale:"Automated live request returned non-success; no bypass attempted; whether this domain's page pattern renders statically was never proven either way."},
  "nes-fircroft":{category:"UNCLEAR",rationale:"Strong contract demand but current posting freshness/access pattern needs confirmation."},
  "workintexas":{category:"SESSION_DEPENDENT",rationale:"Individual public pages work but search/session URLs are operationally unstable."},
  "workintexas-2f":{category:"SESSION_DEPENDENT",rationale:"No stable public query path proven; session-dependent search controls."},
  "workintexas-public-detail":{category:"SESSION_DEPENDENT",rationale:"Search, pagination and encrypted detail tokens remain session-dependent across three phases of testing; no stable compliant discovery path was proven."},
  "aerotek-texas-2h":{category:"UNCLEAR",rationale:"No stable current public assignment endpoint was proven."},
  "peopleready-texas-2h":{category:"UNCLEAR",rationale:"Indexed slugs are mutable and previously resolved to a different city entirely; no stable identity proven."},
  "austin-industries-ultipro":{category:"UNCLEAR",rationale:"No documented public API found; individual job-detail pages were never tested for static rendering, genuinely unresolved per Phase 2J."},
  "turner-industries-applicantpro":{category:"UNCLEAR",rationale:"Listing page rendered only navigation chrome; individual job-detail URLs were never tested, genuinely unresolved per Phase 2J."},
  "jefferson-county-purchasing-notices":{category:"PUBLIC_SERVER_RENDERED_PAGE",rationale:"Static, successfully-fetched county bid-notices page; DEFER decision reflects the lack of a current staffing/manpower solicitation, not an access-legitimacy problem."},
  "hgac-temp-staffing-129452":{category:"BLOCKED",rationale:"OpenGov procurement portal returned HTTP 403 on direct fetch."},
  "port-houston-workday-staffing-electrical":{category:"UNCLEAR",rationale:"Workday Strategic Sourcing SPA; WebFetch returned only the page shell with no bid content and no underlying endpoint was identified or tested, genuinely unresolved."},
  "port-of-corpus-christi-procureware":{category:"UNCLEAR",rationale:"ProcureWare portal returned only navigation chrome via WebFetch; no bid content or underlying endpoint was identified, genuinely unresolved."},
  "port-freeport-epa-electrical-rfq-2025":{category:"PUBLIC_STATIC_DOCUMENT",rationale:"Directly-linked PDF hosted on Port Freeport's own site; UNDER_REVIEW reflects that the underlying opportunity is professional-services, not manpower staffing, and its deadline has passed -- not an access-legitimacy problem."},
  tfc:{category:"BLOCKED",rationale:"Public endpoint returned HTTP 403 on direct fetch."},
};

function classifyAccessLegitimacy(s:RawSource):{category:AccessLegitimacyCategory;rationale:string}{
  const override=ACCESS_LEGITIMACY[s.key];
  if(override)return override;
  if(s.decision==="BLOCKED")return{category:"BLOCKED",rationale:"Decision is BLOCKED."};
  return{category:"UNCLEAR",rationale:"Evaluated but not individually re-verified this phase; genuinely unresolved, not assumed BLOCKED or SUPPORTED."};
}

// ---------------------------------------------------------------------------
// 3. TECH-DEBT-02 resolution
// ---------------------------------------------------------------------------
export const TECH_DEBT_02_RESOLUTION:TechDebtResolution={
  id:"TECH-DEBT-02",
  title:"Rosendin adapter's undocumented Workday wday/cxs endpoint",
  investigatedAt:new Date("2026-08-23T00:00:00Z"),
  findings:[
    "rosendin-adapter.ts's default capture URL (https://rosendin.wd1.myworkdayjobs.com/wday/cxs/rosendin/Careers/job/Field-TX-Austin/Journeyman-Electrician_JR106219) is the undocumented Workday Candidate Experience Service (CxS) JSON endpoint every Workday career site's own search UI calls internally, not a documented public API.",
    "The 'friendly' front-end equivalent (https://rosendin.wd1.myworkdayjobs.com/en-US/Careers/job/Field-TX-Austin/Journeyman-Electrician_JR106219) was fetched directly this phase via plain GET and returned an empty JavaScript application shell with no server-rendered job content -- the same JS-only pattern already confirmed BLOCKED for Zachry (Oracle Recruiting Cloud) and Walker Engineering (Taleo) in Phase 2J.",
    "Rosendin's own corporate site was checked for a compliant fallback: rosendin.com/careers does not list individual postings in HTML at all (it only links out to an internal apply portal); rosendin.com/join-our-team/apply-now/ is a client-side-filtered JavaScript search widget (confirmed showing 'No matches found matching your criteria' with a loading.svg spinner, no static job content), and its individual job links resolve back to the Workday-hosted portal.",
    "Web search corroborates Phase 2J's conclusion industry-wide: there is no documented, unauthenticated public Workday jobs API; the only documented Workday API lives behind a Workday Community partner login, and third-party tooling explicitly documents the wday/cxs endpoint as reverse-engineered, not published.",
    "No genuinely documented alternative route (feed, partner API, or a static job-detail fallback comparable to the pre-existing Bechtel SAP SuccessFactors adapter's per-URL static rendering) exists for Rosendin specifically.",
  ],
  outcome:"BLOCKED",
  rationale:"Rosendin's endpoint matches this program's existing platform-level Workday=BLOCKED classification (Phase 2J PLATFORM_CLASSIFICATIONS) with no source-specific exception available. Per the brief's conservative instruction ('when genuinely uncertain, downgrade rather than uphold'), and given Phase 2J itself already flagged this adapter as inconsistent with its bright line but left it untouched as out of scope, the source-level access legitimacy is reclassified here from an implicit, undeclared approval to BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT / portfolio value BLOCKED.",
  historicalEvidencePreserved:true,
  downstreamAction:"rosendin-adapter.ts, its descriptor and its Phase 2B fixture-based unit tests (production-adapters.test.ts) are left completely unmodified -- no code, capture logic or test was changed or deleted. No live Rosendin evidence exists in any FACTS or REAL_CONVERSION_SET ledger to preserve or delete; the adapter has never contributed observed evidence to this codebase's evidence ledgers, only fixture-parsed test output. The reclassification is recorded here, in the Phase 2K source inventory, as the closing of the silent-approval gap Phase 2J explicitly deferred. Going forward the adapter must not be scheduled for live capture absent a documented compliant route or an explicit manager risk acceptance.",
};

// ---------------------------------------------------------------------------
// 4. Observed-vs-capability contribution and portfolio-value classification
// ---------------------------------------------------------------------------
const KEY_ALIASES:Record<string,string>={"exxon-beaumont":"exxonmobil-beaumont"};

function observedEvidenceFor(key:string):{count:number;ledgers:string[]}{
  const aliased=KEY_ALIASES[key]??key;
  const factsCount=[...FACTS,...FACTS_2I,...FACTS_2J].filter(f=>f.sourceKey===key).length;
  const conversionCount=REAL_CONVERSION_SET.flatMap(x=>x.sources).filter(s=>s.key===aliased).length;
  const ledgers=[...(factsCount>0?["targeted-evidence FACTS ledger"]:[]),...(conversionCount>0?["hot-conversion REAL_CONVERSION_SET ledger"]:[])];
  return{count:factsCount+conversionCount,ledgers};
}

/** A handful of EvidenceFact rows set contactRoute to a generic placeholder
 * ("Public assignment page") rather than a distinguishing contact detail. Counting
 * that as closing the scarce actionable-contact gap would mark a source HIGH_VALUE
 * "just because it exists," which the brief explicitly warns against -- so only a
 * named contactPerson or a specific, non-generic contactRoute counts here. */
const GENERIC_CONTACT_ROUTES=new Set(["Public assignment page"]);

function closesScarceGapFor(key:string):boolean{
  const aliased=KEY_ALIASES[key]??key;
  const factsHit=[...FACTS,...FACTS_2I,...FACTS_2J].some(f=>f.sourceKey===key&&(!!f.buyerCandidate||!!f.af01Candidate||!!f.contactPerson||(!!f.contactRoute&&!GENERIC_CONTACT_ROUTES.has(f.contactRoute))));
  const conversionHit=REAL_CONVERSION_SET.some(x=>x.sources.some(s=>s.key===aliased&&(s.contribution==="BUYER"||s.contribution==="AF_01"||s.contribution==="CONTACT")));
  return factsHit||conversionHit;
}

function classifyPortfolioValue(s:RawSource,observedCount:number,scarce:boolean):{value:Phase2kPortfolioValue;rationale:string}{
  if(s.key==="rosendin")return{value:"BLOCKED",rationale:"TECH-DEBT-02: access legitimacy downgraded to BROWSER_VISIBLE_UNDOCUMENTED_ENDPOINT; must not be scheduled for live capture pending a compliant route or explicit manager risk acceptance."};
  if(s.key==="trillium-midland-794201")return{value:"RETIRED",rationale:"Confirmed unavailable (non-success / effectively 404) on live re-check in Phase 2I; preserved as historical, non-current evidence -- the existing UNDER_REVIEW registry entry is unmodified by this audit."};
  if(s.key==="nes-houston-27773")return{value:"RETIRED",rationale:"Confirmed unavailable (non-success / effectively 410) on live re-check in Phase 2I; preserved as historical, non-current evidence -- the existing UNDER_REVIEW registry entry is unmodified by this audit."};
  if(s.decision==="BLOCKED")return{value:"BLOCKED",rationale:"Decision is BLOCKED; platform or endpoint is not intentionally public."};
  if(s.decision!=="ACTIVATE")return{value:"UNDER_REVIEW",rationale:"Not activated; access legitimacy, freshness or relevance genuinely unresolved."};
  if(observedCount===0)return{value:"UNDER_REVIEW",rationale:"Declared ACTIVATE with documented capability, but zero observed evidence exists in either the targeted-evidence FACTS ledgers or the hot-conversion REAL_CONVERSION_SET ledger; commercial yield is unconfirmed, not merely low."};
  if(scarce)return{value:"HIGH_VALUE",rationale:"Observed evidence closes a scarce buyer, AF-01 or actionable-contact gap."};
  return{value:"SUPPORTING",rationale:"Observed evidence is real but limited to demand/company context, which is not scarce across the portfolio."};
}

export const SOURCE_PORTFOLIO_INVENTORY:SourceInventoryEntry[]=RAW_SOURCES.map(s=>{
  const legit=classifyAccessLegitimacy(s),{count,ledgers}=observedEvidenceFor(s.key),scarce=closesScarceGapFor(s.key),port=classifyPortfolioValue(s,count,scarce);
  return{key:s.key,name:s.name,endpoint:s.endpoint,family:s.family,markets:s.markets,origin:s.origin,decision:s.decision,accessLegitimacy:legit.category,legitimacyRationale:legit.rationale,observedEvidenceCount:count,observedEvidenceLedgers:ledgers,closesScarceGap:scarce,portfolioValue:port.value,portfolioRationale:port.rationale};
});

// ---------------------------------------------------------------------------
// 5. Market coverage matrix
// ---------------------------------------------------------------------------
const CANONICAL_MARKETS=["Houston / Gulf Coast","Freeport","Beaumont / Port Arthur","Corpus Christi","Permian Basin","Texas Panhandle","Dallas–Fort Worth","Texas (statewide)"]as const;
const MARKET_ALIASES:Record<string,string>={"Houston / Gulf Coast":"Houston / Gulf Coast","Houston Metro":"Houston / Gulf Coast","Freeport":"Freeport","Beaumont / Port Arthur":"Beaumont / Port Arthur","Beaumont":"Beaumont / Port Arthur","Port Arthur":"Beaumont / Port Arthur","Corpus Christi":"Corpus Christi","Permian Basin":"Permian Basin","Midland / Odessa / Permian Basin":"Permian Basin","Texas Panhandle":"Texas Panhandle","Dallas–Fort Worth":"Dallas–Fort Worth","DFW":"Dallas–Fort Worth","Texas":"Texas (statewide)"};

interface EvidenceRow{market:string;keys:string[];demand:boolean;buyer:boolean;af01:boolean;contact:boolean;compensation:boolean;perDiem:boolean;headcount:boolean}
const GAP_PRIORITY=["demand","buyer","af01","contact","compensation","perDiem","headcount"]as const;

function factRows():EvidenceRow[]{return[...FACTS,...FACTS_2I,...FACTS_2J].map(f=>({market:f.market,keys:[f.sourceKey],demand:f.demand,buyer:!!f.buyerCandidate,af01:!!f.af01Candidate,contact:!!(f.contactPerson||f.contactRoute),compensation:f.payMin!=null||f.payMax!=null,perDiem:f.perDiem!=null,headcount:f.headcount!=null}))}
function conversionRows():EvidenceRow[]{return REAL_CONVERSION_SET.map(x=>({market:x.market,keys:[...new Set(x.sources.map(s=>s.key))],demand:x.demand,buyer:!!x.buyerCandidate,af01:!!(x.af01Category&&x.af01Excerpt),contact:!!x.contactRoute,compensation:x.economics.hourlyPay!=null,perDiem:x.economics.perDiem!=null,headcount:x.economics.headcount!=null}))}

export function marketCoverageMatrix():MarketCoverageEntry[]{
  const rows=[...factRows(),...conversionRows()];
  return CANONICAL_MARKETS.map(market=>{
    const inMarket=rows.filter(r=>(MARKET_ALIASES[r.market]??"UNKNOWN")===market);
    const counts=Object.fromEntries(GAP_PRIORITY.map(k=>[k,inMarket.filter(r=>r[k]).length]))as Record<(typeof GAP_PRIORITY)[number],number>;
    const present=GAP_PRIORITY.filter(k=>counts[k]>0),missing=GAP_PRIORITY.filter(k=>counts[k]===0);
    return{market,sourcesTouching:new Set(inMarket.flatMap(r=>r.keys)).size,observedEvidenceCount:inMarket.length,evidenceClassesPresent:present,evidenceClassesMissing:missing,largestGap:missing[0]??"none"};
  });
}

// ---------------------------------------------------------------------------
// 6. Real HOT gap analysis: structural eligibility blockers, not enrichment gaps.
//    Grounded directly in eligibility-service.ts's actual requirement codes.
// ---------------------------------------------------------------------------
export const HOT_GAP_FINDINGS:HotGapFinding[]=[
  {eligibilityType:"VAMO_ELIGIBLE",structuralBlockers:["ACTIONABLE_CONTACT_REQUIRED"],blockerExplanations:["EligibilityService.assess() requires a current contact route with an explicit grade A/B/C recorded in g.routeGrades AND a VERIFIED verification_state or a human VERIFY review decision (eligibility-service.ts route()). opportunity-qualification-service.ts's graph() never populates routeGrades (always []) and never marks a route VERIFIED for any of the four tracked dossiers, so this requirement fails unconditionally regardless of how much contact evidence has been acquired."],enrichmentGapsNotBlocking:["compensation","perDiem","headcount"],explanation:"VAMO_ELIGIBLE is 0 because no contact route has ever been assigned a grade and marked VERIFIED by a human reviewer -- not because compensation, per diem or headcount are missing (none of those three even appear in ELIGIBILITY_REASONS)."},
  {eligibilityType:"HOT_A_ELIGIBLE",structuralBlockers:["ACTIONABLE_CONTACT_REQUIRED","MANPOWER_ACCEPTANCE_REQUIRED"],blockerExplanations:["Same ACTIONABLE_CONTACT_REQUIRED gap as VAMO_ELIGIBLE.","MANPOWER_ACCEPTANCE_REQUIRED needs g.acceptance.result==='VERIFIED' and unexpired. opportunity-qualification-service.ts's graph() always sets acceptance:null, even for dossiers with strong AF-01 candidate text already captured (Port Arthur's 'TEMPORARY PERSONNEL AGENCY ACCEPTED', Trillium/Strike's 'THIRD_PARTY_RECRUITING_ACCEPTED', Austin Industries' 'LABOR_SUBCONTRACTING_ACCEPTED'): those candidates live only in EvidenceFact.af01Candidate / ReviewPackage / REAL_CONVERSION_SET.af01Category and are never promoted into an acceptance record on the actual OpportunityGraph the eligibility engine reads."],enrichmentGapsNotBlocking:["compensation","perDiem","headcount"],explanation:"HOT_A_ELIGIBLE is 0 because no AF-01 candidate has been promoted to a VERIFIED manpower-acceptance record and no contact route has a VERIFIED grade -- both are human-review-gated steps that have not executed by design, not missing raw evidence."},
  {eligibilityType:"HOT_B_ELIGIBLE",structuralBlockers:["HOT_B_INTELLIGENCE_PATH_PRESENT"],blockerExplanations:["Requires a current contact route whose route_type is RECRUITER_EMAIL, RECRUITER_PHONE, PROFESSIONAL_EMAIL, PROFESSIONAL_PHONE or PROFESSIONAL_PROFILE, with a grade A-D, VERIFIED. The four tracked qualification-dossier seeds only carry PROCUREMENT_EMAIL and CORPORATE_PHONE route types. Real recruiter contacts do exist in the evidence ledgers (Trillium's Roberto Venegas / 800-778-8907 in FACTS_2J, Olivia Barnes in the historical Trillium Midland FACTS) but were never wired into any OpportunityGraph.contactRoutes entry at all -- they are stranded in EvidenceFact and ReviewPackage records that human review has not yet turned into graph-level contact routes."],enrichmentGapsNotBlocking:["compensation","perDiem","headcount"],explanation:"HOT_B_ELIGIBLE is 0 because the recruiter/professional-typed, graded, VERIFIED contact-route path the rule requires has never been populated on any tracked opportunity graph -- including for opportunities where a real recruiter contact was already captured by targeted-evidence work, because no pipeline step promotes that evidence into the graph."},
];

// ---------------------------------------------------------------------------
// 7. Phase 2K summary, following the existing phase-chain summary pattern.
// ---------------------------------------------------------------------------
export const phase2kSummary=()=>{
  const j=phase2jSummary(),recon=reconstructTrueInventory(),activated=SOURCE_PORTFOLIO_INVENTORY.filter(x=>x.decision==="ACTIVATE"),all=SOURCE_PORTFOLIO_INVENTORY;
  return{
    sourcesNarrativeClaimed:recon.narrativeClaimed,
    sourcesRawActivated:recon.rawEntries,
    sourcesTrueUniqueActivated:recon.uniqueByEndpoint,
    narrativeAccurate:recon.narrativeAccurate,
    duplicateEndpointsFound:recon.duplicates.length,
    // Portfolio breakdown scoped to currently ACTIVATE (production-live) sources only.
    portfolioHighValue:activated.filter(x=>x.portfolioValue==="HIGH_VALUE").length,
    portfolioSupporting:activated.filter(x=>x.portfolioValue==="SUPPORTING").length,
    portfolioLowYield:activated.filter(x=>x.portfolioValue==="LOW_YIELD").length,
    portfolioUnderReview:activated.filter(x=>x.portfolioValue==="UNDER_REVIEW").length,
    portfolioBlocked:activated.filter(x=>x.portfolioValue==="BLOCKED").length,
    portfolioRetired:activated.filter(x=>x.portfolioValue==="RETIRED").length,
    // Portfolio breakdown across the FULL evaluated universe (every ACTIVATE, UNDER_REVIEW,
    // DEFER and BLOCKED entry across all seven origins) -- this is the complete picture.
    inventoryTotalEvaluated:all.length,
    inventoryHighValue:all.filter(x=>x.portfolioValue==="HIGH_VALUE").length,
    inventorySupporting:all.filter(x=>x.portfolioValue==="SUPPORTING").length,
    inventoryLowYield:all.filter(x=>x.portfolioValue==="LOW_YIELD").length,
    inventoryUnderReview:all.filter(x=>x.portfolioValue==="UNDER_REVIEW").length,
    inventoryBlocked:all.filter(x=>x.portfolioValue==="BLOCKED").length,
    inventoryRetired:all.filter(x=>x.portfolioValue==="RETIRED").length,
    techDebt02Outcome:TECH_DEBT_02_RESOLUTION.outcome,
    vamo:j.vamo,hotA:j.hotA,hotB:j.hotB,
    scored:j.scored,commercialActions:j.commercialActions,outreachExecuted:j.outreachExecuted,contractEconomicsImplemented:j.contractEconomicsImplemented,
    eligibilityRulesModified:false,scoringWeightsModified:false,commercialActionVocabularyModified:false,
    newSourcesAdded:0,
    schedulerOrWorkerInfrastructureStarted:false,
    phase2lStarted:false,
  };
};
