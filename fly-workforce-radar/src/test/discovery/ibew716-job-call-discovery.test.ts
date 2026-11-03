import{randomUUID}from"node:crypto";
import{describe,expect,it}from"vitest";
import type{ProductionCaptureRequest}from"../../domain/production-source";
import{IBEW716_JOURNEYMAN_JOB_CALLS_URL,IBEW716_TELEDATA_JOB_CALLS_URL,Ibew716JobCallAdapter,splitLevelMarker,splitUnderlinedLead}from"../../server/adapters/production/ibew716-job-call-adapter";
import{runListingDiscovery}from"../../server/services/discovery/listing-discovery-service";

/**
 * Phase 2R-B, IBEW Local 716 (Houston) dispatch job calls.
 *
 * Every assertion below runs through the SAME Ibew716JobCallAdapter and the
 * SAME runListingDiscovery() pipeline used for live execution -- no test-only
 * parser, no test-only mapping.
 *
 * The fixture is hand-built to match the real page markup confirmed by a live
 * fetch of https://ibew716.net/journeyman-job-calls/ on 2026-08-29: a
 * WordPress page whose job calls exist only as runs of headings, where an
 * underlined lead carries "<count> - <name> -" and any following text is the
 * call's requirements. It reproduces the real page's genuinely awkward
 * properties on purpose -- a contractor whose call states no count of its own,
 * a contractor heading whose only trailing text is a parenthetical note, en
 * dashes, numeric entities, and the block of ChatGPT editor markup that is
 * really embedded in that page's HTML.
 */

const CHATGPT_PASTE_ARTEFACT=`<div class="flex flex-col text-sm pb-25">
<article class="text-token-text-primary w-full" dir="auto" data-turn-id="request-1-3" data-testid="conversation-turn-10" data-turn="assistant">
<div class="markdown prose dark:prose-invert w-full" data-message-model-slug="gpt-5-2">
<h2></h2>
<h2><strong style="color: #000080;"><u>Monday, August 31, 2026</u></strong></h2>
</div></article></div>`;

const page=(body:string,modified="2026-08-28T21:32:04+00:00")=>`<!DOCTYPE html><html lang="en-US"><head>
<title>Journeyman Job Calls - The International Brotherhood of Electrical Workers Houston, TX Local 716</title>
<meta property="article:modified_time" content="${modified}" />
</head><body>
<h2>JW Job Calls</h2>
<h5>Business hours are Monday to Friday from 8am to 5 pm.</h5>
<h2>TAKING A JOB CALL</h2>
<h5>Job calls will be posted by 5pm each day on the website and the job line.</h5>
<h2>August 2026</h2>
${CHATGPT_PASTE_ARTEFACT}
${body}
</body></html>`;

const DISPATCH=page(`
<h3><span style="color: #ff6600;"><strong><em><u>20- Journeyman Job Calls &#8211;</u></em></strong></span></h3>
<h5><span style="color: #000080;"><strong><em><u>9&#8211;Big State Electric &#8211; </u></em></strong></span></h5>
<h5><strong><em><u><span style="color: #333399;">6&#8211; Foxconn &#8211;</span> </u></em></strong><em>Applicant must pass a mandatory drug test and background check, have a valid DL, SS Card, and a valid TX Electrical License. Will be working from 7 am to 3:30 pm Monday &#8211; Friday with possible overtime. </em></h5>
<h5><span style="color: #000080;"><strong><em><u>4&#8211; Fisk Electric &#8211; </u></em></strong></span></h5>
<h5><span style="color: #000080;"><strong><em><u>&#8211; Foxconn &#8211; </u></em></strong></span><em>Applicant must pass a mandatory drug test. $50 incentive per day, with a minimum of 50 hours worked.  Will be working 6(10&#8217;s) with a 6:00am start time.</em></h5>
<h2>Maintenance Job Openings</h2>
<h4 style="text-align: left;"><span style="text-decoration: underline;"><span style="color: #ff6600; text-decoration: underline;"><strong>Anheuser-Busch (Budweiser)</strong></span></span> is currently hiring  Full-Time Electricians.  The current hire in rate is $42.21 per hour. Please click on the image below to apply.</h4>
<h5><strong>When applying for any of the maintenance positions, please submit your application.</strong></h5>
<h5>Navigation</h5>`);

/** The real teledata board: every row is a technician/level classification and
 * NONE of them is an electrician role. */
const TELEDATA=`<!DOCTYPE html><html><head><title>Teledata Job Calls</title>
<meta property="article:modified_time" content="2026-08-28T20:57:14+00:00" /></head><body>
<h2><strong><u>Monday, August 31, 2026</u></strong></h2>
<h4><span><strong><em><u>8 &#8211; Teledata Job Call &#8211;</u></em></strong></span></h4>
<h5><span><strong><em><u>8 &#8211; Fisk Technologies &#8211;</u></em></strong></span> (Orientation will be held Tuesdays and Thursdays @ 7:00am)</h5>
<h5><strong><em><u>1 &#8211; Fiber Technician @ 100% &#8211;</u></em></strong><em>Applicant must pass a mandatory drug test, background check, and OSHA 10.</em></h5>
<h5><strong><em><u>4&#8211; Structured Cabling Technician @ 100% &#8211;</u></em></strong><em>Applicant must pass a mandatory drug test and have OSHA 10.</em></h5>
</body></html>`;

const transport=(body:string,status=200)=>({get:async(url:string)=>({status,url,contentType:"text/html",body,headers:{"cache-control":"public"}})});
const request=():ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:"ibew716",cursor:null,policyDecisionId:randomUUID(),asOf:new Date("2026-08-29T12:00:00Z")});
const capture=async(body:string,url=IBEW716_JOURNEYMAN_JOB_CALLS_URL)=>(await new Ibew716JobCallAdapter(transport(body),url).capturePage(request())).observations;
const discover=async(body:string,url=IBEW716_JOURNEYMAN_JOB_CALLS_URL)=>runListingDiscovery(await capture(body,url),{sourceKey:"ibew716",observedAt:request().asOf,listingUrl:url});

describe("IBEW 716: listing entry point and structural parsing",()=>{
  it("the adapter's default entry point is a job-call listing page, never a per-call detail URL",()=>{
    expect(IBEW716_JOURNEYMAN_JOB_CALLS_URL).toMatch(/ibew716\.net\/journeyman-job-calls\/$/);
  });
  it("discovers the individual job calls, and does NOT emit the contractor grouping headings as calls",async()=>{
    const o=await capture(DISPATCH);
    // 2 real dispatch calls + 2 contractor headings that must NOT become calls
    // + 1 maintenance opening = 3 observations.
    expect(o).toHaveLength(3);
    expect(o.map(x=>x.facts.jobsite)).toEqual(["Foxconn","Foxconn",null]);
    expect(o.map(x=>x.organization)).toEqual(["Big State Electric","Fisk Electric","Anheuser-Busch (Budweiser)"]);
  });
  it("separates a contractor heading whose only trailing text is a parenthetical note from a real job call",async()=>{
    const o=await capture(TELEDATA,IBEW716_TELEDATA_JOB_CALLS_URL);
    // Fisk Technologies is the contractor, not a jobsite.
    expect(o.map(x=>x.facts.jobsite)).toEqual(["Fiber Technician @ 100%","Structured Cabling Technician @ 100%"]);
    expect(new Set(o.map(x=>x.organization))).toEqual(new Set(["Fisk Technologies"]));
  });
  it("splitUnderlinedLead handles both underline forms the real page uses, and reports none when absent",()=>{
    expect(splitUnderlinedLead(`<strong><u>6 – Foxconn –</u></strong><em>Applicant must pass.</em>`)).toEqual({lead:"6 – Foxconn –",rest:"Applicant must pass."});
    expect(splitUnderlinedLead(`<span style="text-decoration: underline;"><strong>Wyman- Gordon</strong></span> is hiring.`)).toEqual({lead:"Wyman- Gordon",rest:"is hiring."});
    expect(splitUnderlinedLead(`<p>Business hours are 8am to 5pm.</p>`).lead).toBeNull();
  });
  it("keeps an explicitly stated skill-level marker out of the name it was written beside",()=>{
    expect(splitLevelMarker("Aramco (16600 Park Row Dr) **MID-LEVEL** –")).toEqual({name:"Aramco (16600 Park Row Dr)",levelMarker:"MID-LEVEL"});
    expect(splitLevelMarker("Big State Electric")).toEqual({name:"Big State Electric",levelMarker:null});
  });
});

describe("IBEW 716: headcount is preserved only when the row states it",()=>{
  it("preserves an explicitly stated headcount",async()=>{
    const o=await capture(DISPATCH);
    expect(o[0].facts.headcount).toBe(6);
    expect((await discover(DISPATCH)).signals[0].input.headcount).toBe(6);
  });
  it("leaves headcount UNKNOWN when the row states no number, and never borrows the contractor's total",async()=>{
    const o=await capture(DISPATCH);
    // The fixture's contractor heading says 4, its call states no number.
    expect(o[1].facts.contractor).toBe("Fisk Electric");
    expect(o[1].facts.headcount).toBeNull();
    expect((await discover(DISPATCH)).signals[1].input.headcount).toBeNull();
  });
});

describe("IBEW 716: wage and economics are explicit-only",()=>{
  it("preserves an explicitly stated hourly wage",async()=>{
    const o=await capture(DISPATCH);
    expect(o[2].facts.wage).toBe("$42.21 per hour");
  });
  it("leaves wage UNKNOWN on a dispatch call that states no rate",async()=>{
    const o=await capture(DISPATCH);
    expect(o[0].facts.wage).toBeNull();
    expect(o[1].facts.wage).toBeNull();
  });
  it("records a stated dollar incentive without misreporting it as a per diem",async()=>{
    const run=await discover(DISPATCH);
    expect(run.signals[1].input.hasPerDiem).toBe(false);
    const o=await capture(DISPATCH);
    expect(o[1].facts.incentive).toMatch(/\$50 incentive per day/);
  });
  it("derives hours/week only from a schedule the row printed in full",async()=>{
    const run=await discover(DISPATCH);
    expect(run.signals[1].input.hoursPerWeek).toBe(60); // "6(10's)" as printed
    expect(run.signals[0].input.hoursPerWeek).toBeNull();
  });
});

describe("IBEW 716: electrical role recognition",()=>{
  it("recognizes an explicitly stated electrician role",async()=>{
    const o=await capture(DISPATCH);
    expect(o[2].facts.explicitElectricalRole).toBe(true);
    expect(o[2].facts.recognizedElectricalRoles).toBe("ELECTRICIAN");
  });
  it("does NOT recognize a role from a licence requirement or from the union's own electrical identity",async()=>{
    const o=await capture(DISPATCH);
    // The row says "a valid TX Electrical License" and sits on an IBEW board;
    // neither is an explicit statement of an electrician role.
    expect(o[0].facts.explicitElectricalRole).toBe(false);
    expect(o[0].facts.recognizedElectricalRoles).toBeNull();
  });
  it("rejects fiber/structured-cabling technician rows outright",async()=>{
    const o=await capture(TELEDATA,IBEW716_TELEDATA_JOB_CALLS_URL);
    expect(o.every(x=>x.facts.explicitElectricalRole===false)).toBe(true);
    expect((await discover(TELEDATA,IBEW716_TELEDATA_JOB_CALLS_URL)).tracked).toHaveLength(0);
  });
  it("never promotes on employer identity: an electrical contractor's name alone tracks nothing",async()=>{
    const run=await discover(DISPATCH);
    const promotedOrgs=run.tracked.map(t=>t.organization);
    expect(promotedOrgs).not.toContain("Big State Electric");
    expect(promotedOrgs).not.toContain("Fisk Electric");
  });
});

describe("IBEW 716: unknowns survive to the DemandSignal rather than being filled",()=>{
  it("buyer, AF-01 acceptance and contact stay null on every signal",async()=>{
    const run=await discover(DISPATCH);
    for(const s of run.signals){
      expect(s.buyerCandidate).toBeNull();
      expect(s.af01Candidate).toBeNull();
      expect(s.contactPerson).toBeNull();
    }
  });
  it("a job call existing on a union dispatch board is never treated as manpower acceptance",async()=>{
    const o=await capture(DISPATCH);
    expect(o.every(x=>x.facts.manpowerAcceptance===null)).toBe(true);
  });
  it("sector stays UNKNOWN: a jobsite named after a technology company is not a data-centre claim",async()=>{
    const run=await discover(DISPATCH);
    expect(run.signals.every(s=>s.input.sector==="UNKNOWN")).toBe(true);
    expect(run.signals.some(s=>s.tier==="HIGH_VALUE_DATA_CENTER_MANPOWER")).toBe(false);
  });
  it("a promoted signal carries only the verification needs its own gaps justify",async()=>{
    const run=await discover(DISPATCH);
    expect(run.opportunities).toHaveLength(1);
    const needs=run.opportunities[0].needs.kinds;
    expect(needs).toContain("RESOLVE_BUYER");
    expect(needs).toContain("VERIFY_MANPOWER_ACCEPTANCE");
    expect(needs).toContain("VERIFY_HEADCOUNT");
    // The page stated a dispatch date, so currentness is NOT an open question.
    expect(needs).not.toContain("VERIFY_TEMPORAL_STATUS");
  });
});

describe("IBEW 716: provenance",()=>{
  it("preserves the source URL and the page's own stated timestamp end to end",async()=>{
    const run=await discover(DISPATCH);
    for(const s of run.signals){
      expect(s.sourceUrl).toBe(IBEW716_JOURNEYMAN_JOB_CALLS_URL);
      expect(s.observedAt).toEqual(new Date("2026-08-29T12:00:00Z"));
    }
    const o=await capture(DISPATCH);
    expect(o[0].facts.pageModifiedRaw).toBe("2026-08-28T21:32:04+00:00");
    expect(o[0].facts.dispatchDateRaw).toBe("Monday, August 31, 2026");
  });
});

describe("IBEW 716: idempotence and duplicates",()=>{
  it("re-scanning the same listing yields the same candidates and no duplicate signals",async()=>{
    const first=await capture(DISPATCH),second=await capture(DISPATCH);
    expect(second.map(o=>o.externalId)).toEqual(first.map(o=>o.externalId));
    const run=runListingDiscovery([...first,...second],{sourceKey:"ibew716",observedAt:request().asOf,listingUrl:IBEW716_JOURNEYMAN_JOB_CALLS_URL});
    expect(run.newSignals).toBe(3);
    expect(run.duplicatesSuppressed).toBe(3);
  });
  it("carrying a prior run's tracked set forward does not re-track the same call",async()=>{
    const first=await discover(DISPATCH);
    const second=runListingDiscovery(await capture(DISPATCH),{sourceKey:"ibew716",observedAt:request().asOf,listingUrl:IBEW716_JOURNEYMAN_JOB_CALLS_URL},first.tracked);
    expect(second.tracked).toHaveLength(first.tracked.length);
    expect(second.opportunities).toHaveLength(0);
  });
  it("a duplicated row within one fetch is collapsed to a single candidate",async()=>{
    const row=`<h3><u>2- Journeyman Job Calls –</u></h3>
<h5><u>1–Dup Electric – </u></h5>
<h5><u>1 – Same Site –</u><em>Applicant must pass a drug test.</em></h5>
<h5><u>1 – Same Site –</u><em>Applicant must pass a drug test.</em></h5>`;
    expect(await capture(page(row))).toHaveLength(1);
  });
});

describe("IBEW 716: malformed input and transport failures",()=>{
  it("an empty body yields zero candidates and does not throw",async()=>{
    await expect(new Ibew716JobCallAdapter(transport("")).capturePage(request())).resolves.toMatchObject({observations:[]});
  });
  it("unrelated or broken markup yields zero candidates and does not throw",async()=>{
    for(const body of["<html><body><p>Page temporarily unavailable</p></body></html>","<h5><u>orphan lead with no craft heading –</u><em>detail</em></h5>","<html><body><h5><u>",'<h3><u>5- Journeyman Job Calls –</u></h3>'])
      await expect(new Ibew716JobCallAdapter(transport(body)).capturePage(request())).resolves.toMatchObject({observations:[]});
  });
  for(const status of[403,404,429,500,503])
    it(`HTTP ${status} throws rather than reporting zero candidates`,async()=>{
      await expect(new Ibew716JobCallAdapter(transport(DISPATCH,status)).capturePage(request())).rejects.toThrow(String(status));
    });
});
