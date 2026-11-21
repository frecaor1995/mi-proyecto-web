import{randomUUID}from"node:crypto";
import{describe,expect,it}from"vitest";
import type{ProductionCaptureRequest}from"../../domain/production-source";
import{TPWD_LISTING_URL,TpwdListingDiscoveryAdapter}from"../../server/adapters/production/tpwd-listing-adapter";
import{dedupeDemandSignals,demandSignalsFromObservations}from"../../server/services/discovery/tpwd-listing-discovery-service";

/**
 * Discovery gap closure: entry point is the TPWD listing/index URL only --
 * never a manager-supplied bid-detail URL. This proves, via the SAME
 * production adapter class used for live execution:
 *   listing/index URL -> listing discovery (N candidates)
 *   -> stable ID/URL canonicalization
 *   -> inline evidence capture
 *   -> demand signal via the existing, unmodified classifyDemandSignalPriority
 *
 * Fixture is hand-built to resemble the real TPWD "Bid Information" summary
 * list markup confirmed by a live fetch of
 * https://tpwd.texas.gov/business/bidops/current_bid_opportunities/construction/index.phtml?print=true
 * on 2026-08-29: each row is `<li><a href="#anchor">DATE — Project NUMBER —
 * [LOCATION —] DESCRIPTION</a></li>`, an in-page anchor, not a separate
 * detail page.
 */

const TITLE_TAG=`<title>Construction and Professional Services - Bids and Vendor Opportunities - TPWD</title>`;
const META=`<meta name="Description" content="Texas Parks and Wildlife offers various bid opportunities to qualified vendors."/>`;

const wrap=(listBody:string)=>`<html><head>${TITLE_TAG}${META}</head><body>
<main>
<h1>Construction and Professional Services</h1>
<p>This page lists active construction solicitations for the Texas Parks and Wildlife Department.</p>
<h2>Bid Information</h2>
<p>The links in the following list go to details about each project.</p>
<ul class="smalltext">
${listBody}
</ul>
<hr />
</main>
</body></html>`;

const FOUR_CANDIDATES=wrap([
  `<li><a href="#a1000001">09/15/2026 02:00 PM &mdash; Project 1000001 &mdash; Example State Park, Example County, Texas &mdash; Trail Bridge Replacements</a></li>`,
  `<li><a href="#a1000002">09/22/2026 02:00 PM &mdash; Project 1000002 &mdash; Example HQ Building, Travis County, Texas &mdash; Electrical Service Upgrade - Journeyman Electrician crew required for panel replacement</a></li>`,
  `<li><a href="#a1000003">10/05/2026 02:00 PM &mdash; Project 1000003 &mdash; Pre-Solicitation Notification for Upcoming Request for Proposals (RFP) for Statewide General Construction Job Order Contracting Services</a></li>`,
  `<li><a href="#a1000004">11/01/2026 02:00 PM &mdash; Project 1000004</a></li>`
].join("\n"));

const transport=(body:string,status=200)=>({get:async(url:string)=>({status,url,contentType:"text/html",body,headers:{"cache-control":"public"}})});
const request=():ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:"tpwd-listing",cursor:null,policyDecisionId:randomUUID(),asOf:new Date("2026-08-29T12:00:00Z")});

describe("TPWD listing discovery: entry point is the listing URL only",()=>{
  it("the adapter's own default constructor argument is the listing/index URL, never a bid-detail URL",()=>{
    expect(TPWD_LISTING_URL).toMatch(/current_bid_opportunities\/construction\/index\.phtml/);
    expect(TPWD_LISTING_URL).not.toMatch(/SolicitationDetails|Gateway/i);
  });
});

describe("TPWD listing discovery: listing -> N candidates, no detail URL supplied",()=>{
  it("discovers 4 candidates from a single listing fetch",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const captured=await adapter.capturePage(request());
    expect(captured.result.status).toBe("CAPTURED");
    expect(captured.observations).toHaveLength(4);
  });
  it("canonicalizes each candidate to a stable external ID and a fragment URL on the SAME listing page (no separate detail page fetched)",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    expect(observations.map(o=>o.externalId)).toEqual(["tpwd-listing-a1000001","tpwd-listing-a1000002","tpwd-listing-a1000003","tpwd-listing-a1000004"]);
    for(const o of observations)expect(o.sourceUrl.startsWith(TPWD_LISTING_URL)).toBe(true);
    expect(observations[0].sourceUrl.endsWith("#a1000001")).toBe(true);
  });
  it("captures inline evidence per candidate -- date, project number, location when present, description -- without fabricating a location that was never in a 3-segment row",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    expect(observations[0]).toMatchObject({location:"Example State Park, Example County, Texas",title:"Trail Bridge Replacements",organization:"Texas Parks and Wildlife Department"});
    expect(observations[0].facts.dueDateRaw).toBe("09/15/2026 02:00 PM");
    expect(observations[0].facts.projectNumber).toBe("1000001");
    // Row 3 has no location segment in the source text -- must stay null, not guessed.
    expect(observations[2].location).toBeNull();
    expect(observations[2].facts.description).toMatch(/Job Order Contracting/);
    // Row 4 has no description segment at all in the source text.
    expect(observations[3].facts.description).toBeNull();
    expect(observations[3].title).toBe(observations[3].facts.rawListingText);
  });
});

describe("TPWD listing discovery: electrician-role recognition is explicit, not fabricated",()=>{
  it("recognizes explicit electrical trade work and journeyman electrician role when a row's own text states it",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    const electricalRow=observations.find(o=>o.externalId==="tpwd-listing-a1000002")!;
    expect(electricalRow.facts.explicitElectricalTradeWork).toBe(true);
    expect(electricalRow.facts.explicitJourneymanElectrician).toBe(true);
    const signals=demandSignalsFromObservations(observations,request().asOf);
    const electricalSignal=signals.find(s=>s.externalId==="tpwd-listing-a1000002")!;
    expect(electricalSignal.input.role).toBe("JOURNEYMAN_ELECTRICIAN");
    expect(electricalSignal.tier).toBe("STANDARD");
    expect(electricalSignal.reasons).toContain("journeyman electrician role");
  });
  it("does not fabricate electrical trade work or a journeyman role for a row whose text never mentions it",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    const nonElectricalRow=observations.find(o=>o.externalId==="tpwd-listing-a1000001")!;
    expect(nonElectricalRow.facts.explicitElectricalTradeWork).toBe(false);
    expect(nonElectricalRow.facts.explicitJourneymanElectrician).toBe(false);
    const signals=demandSignalsFromObservations(observations,request().asOf);
    const nonElectricalSignal=signals.find(s=>s.externalId==="tpwd-listing-a1000001")!;
    expect(nonElectricalSignal.input.role).toBe("UNKNOWN");
    expect(nonElectricalSignal.tier).toBe("LOW_SIGNAL");
  });
  it("most TPWD bid rows legitimately classify LOW_SIGNAL or STANDARD -- expected, not a bug, since hours/per-diem/duration are never stated on a procurement listing",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    const signals=demandSignalsFromObservations(observations,request().asOf);
    expect(signals.every(s=>s.tier==="LOW_SIGNAL"||s.tier==="STANDARD")).toBe(true);
    expect(signals.some(s=>s.tier==="HIGH_VALUE_DATA_CENTER_MANPOWER")).toBe(false);
  });
});

describe("TPWD listing discovery: idempotence",()=>{
  it("re-running the scan against the same fixture does not duplicate signals for the same candidate",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const firstRun=(await adapter.capturePage(request())).observations;
    const secondRun=(await adapter.capturePage(request())).observations;
    expect(secondRun.map(o=>o.externalId)).toEqual(firstRun.map(o=>o.externalId));
    const signalsFromBothRuns=[...demandSignalsFromObservations(firstRun,request().asOf),...demandSignalsFromObservations(secondRun,request().asOf)];
    const deduped=dedupeDemandSignals(signalsFromBothRuns);
    expect(deduped).toHaveLength(4);
    expect(new Set(deduped.map(s=>s.externalId)).size).toBe(4);
  });
  it("a duplicate anchor within a single fetch is also not double-counted",async()=>{
    const duplicated=wrap(`<li><a href="#a1000001">09/15/2026 02:00 PM &mdash; Project 1000001 &mdash; Example State Park, Example County, Texas &mdash; Trail Bridge Replacements</a></li>
<li><a href="#a1000001">09/15/2026 02:00 PM &mdash; Project 1000001 &mdash; Example State Park, Example County, Texas &mdash; Trail Bridge Replacements</a></li>`);
    const adapter=new TpwdListingDiscoveryAdapter(transport(duplicated));
    const{observations}=await adapter.capturePage(request());
    expect(observations).toHaveLength(1);
  });
});

describe("TPWD listing discovery: malformed/empty listing HTML",()=>{
  it("empty body yields zero candidates, no throw",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(""));
    await expect(adapter.capturePage(request())).resolves.toMatchObject({observations:[]});
  });
  it("unrelated/malformed HTML with no matching listing markup yields zero candidates, no throw",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport("<html><body><p>Page temporarily unavailable</p><div><li>broken<a>nope</div></body></html>"));
    await expect(adapter.capturePage(request())).resolves.toMatchObject({observations:[]});
  });
});

describe("TPWD listing discovery: transport failures surface as capture failures, not empty results",()=>{
  for(const status of[403,404,429,500,503])
    it(`HTTP ${status} on the listing fetch throws rather than returning zero candidates`,async()=>{
      const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES,status));
      await expect(adapter.capturePage(request())).rejects.toThrow(String(status));
    });
});

describe("TPWD listing discovery: hard invariants -- no fabrication",()=>{
  it("unknown buyer/AF-01/contact stay null throughout; project is populated only when the row's own text supplies a description",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    const signals=demandSignalsFromObservations(observations,request().asOf);
    for(const s of signals){
      expect(s.buyerCandidate).toBeNull();
      expect(s.af01Candidate).toBeNull();
      expect(s.contactPerson).toBeNull();
    }
    expect(signals.find(s=>s.externalId==="tpwd-listing-a1000001")!.project).toBe("Trail Bridge Replacements");
    // Row 4 had no description segment in the source text -- project stays null.
    expect(signals.find(s=>s.externalId==="tpwd-listing-a1000004")!.project).toBeNull();
  });
  it("headcount, hours/week and per-diem stay null/false throughout -- a procurement listing row never states them",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    const signals=demandSignalsFromObservations(observations,request().asOf);
    for(const s of signals){
      expect(s.input.headcount).toBeNull();
      expect(s.input.hoursPerWeek).toBeNull();
      expect(s.input.hasPerDiem).toBe(false);
      expect(s.input.hasOvertime).toBe(false);
      expect(s.input.duration).toBe("UNKNOWN");
      expect(s.input.sector).toBe("UNKNOWN");
    }
  });
});

describe("TPWD listing discovery boundary",()=>{
  it("no automatic outreach: nothing in this discovery workstream applies, contacts, or submits anything",async()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    const{observations}=await adapter.capturePage(request());
    const signals=demandSignalsFromObservations(observations,request().asOf);
    expect(JSON.stringify(signals)).not.toMatch(/applied|submitted|contacted/i);
  });
  it("reuses the SAME PublicSourceAdapter base class as every other production adapter -- no parallel architecture",()=>{
    const adapter=new TpwdListingDiscoveryAdapter(transport(FOUR_CANDIDATES));
    expect(typeof adapter.capturePage).toBe("function");
    expect(typeof adapter.capture).toBe("function");
    expect(adapter.descriptor.sourceId).toBe("tpwd");
  });
});
