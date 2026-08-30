import{randomUUID}from"node:crypto";
import{describe,expect,it}from"vitest";
import type{ProductionCaptureRequest}from"../../domain/production-source";
import{BECHTEL_LISTING_URL,BechtelListingDiscoveryAdapter}from"../../server/adapters/production/bechtel-listing-adapter";
import{STRIKE_LISTING_URL,StrikeListingDiscoveryAdapter}from"../../server/adapters/production/strike-listing-adapter";
import{TRILLIUM_CRAWL_DELAY_SECONDS,TRILLIUM_LISTING_URL,TrilliumListingDiscoveryAdapter}from"../../server/adapters/production/trillium-listing-adapter";
import{durationFromText,hoursPerWeekFromSchedule,runListingDiscovery,statesDataCentreSector,statesPerDiem}from"../../server/services/discovery/listing-discovery-service";

/**
 * Phase 2R-B: the three already-approved source families upgraded from
 * single-posting capture to listing discovery (Strike/JazzHR, Trillium,
 * Bechtel/SuccessFactors). No new compliance decision was involved -- each is
 * the same already-ACTIVATE host's own public index of the detail pages this
 * codebase already captures one at a time.
 *
 * Fixtures are hand-built to the real markup confirmed by live fetches on
 * 2026-08-29, including the awkward parts: Strike's stray double comma
 * ("Spring,, TX") and "Remote" rows, Trillium's relative "Posted N days ago"
 * stamps, and Bechtel's duplicated desktop/mobile blocks and international
 * "City, REGION, COUNTRY, POSTAL +N more..." locations.
 */

const transport=(body:string,status=200)=>({get:async(url:string)=>({status,url,contentType:"text/html",body,headers:{}})});
const request=():ProductionCaptureRequest=>({executionId:randomUUID(),requestedTarget:"listing",cursor:null,policyDecisionId:randomUUID(),asOf:new Date("2026-08-29T12:00:00Z")});

// --------------------------------------------------------------------------
// Strike / JazzHR
// --------------------------------------------------------------------------
const strikeRow=(slug:string,title:string,location:string|null)=>`<li class="list-group-item">
  <h3 class='list-group-item-heading'>
    <a href="https://strike.applytojob.com/apply/${slug}/${title.replace(/[^A-Za-z0-9]+/g,"-")}">
      ${title}                                    </a>
  </h3>
  <ul class='list-inline list-group-item-text'>
    ${location===null?"":`<li><i class='fa fa-map-marker'></i>${location}</li>`}
  </ul>
</li>`;

const STRIKE=`<html><body><ul class="list-group">
${strikeRow("dPMrOWI8fn","Journeyman Electrician","Midland, TX")}
${strikeRow("L3Wr0FKloj","Journeyman Electrician","Billings, MT")}
${strikeRow("CL0yzwQIx2","Apprentice Electrician","Baytown, TX")}
${strikeRow("ipRTBmDjv6","Electrical Designer","Spring,, TX")}
${strikeRow("4lN9mHRIDm","E&amp;I Superintendent","Remote")}
${strikeRow("fJnp6wu6Eh","Pipeline Mechanic / Construction Mechanic","Baytown, TX")}
${strikeRow("grIMC6iAK7","Human Resources Assistant","Midland, TX")}
${strikeRow("zXq5YTrDCG","Project Manager",null)}
</ul></body></html>`;

const strikeCapture=async(body=STRIKE,status=200)=>(await new StrikeListingDiscoveryAdapter(transport(body,status)).capturePage(request())).observations;
const strikeRun=async(body=STRIKE)=>runListingDiscovery(await strikeCapture(body),{sourceKey:"strike-midland",observedAt:request().asOf,listingUrl:STRIKE_LISTING_URL});

describe("Strike/JazzHR listing discovery",()=>{
  it("starts from the family's own listing index, not a single posting",()=>{
    expect(STRIKE_LISTING_URL).toBe("https://strike.applytojob.com/apply/");
  });
  it("discovers every posting row on one fetch",async()=>expect(await strikeCapture()).toHaveLength(8));
  it("recognizes explicit electrician-family titles",async()=>{
    const run=await strikeRun();
    expect(run.electricalListings).toBe(3);
    expect(run.tracked.map(t=>t.recognizedRoles.join(","))).toEqual(["JOURNEYMAN_ELECTRICIAN","JOURNEYMAN_ELECTRICIAN","ELECTRICAL_APPRENTICE"]);
  });
  it("discriminates against designer, engineer-adjacent, mechanic and administrative titles",async()=>{
    const o=await strikeCapture();
    const rejected=o.filter(x=>/Designer|Superintendent|Mechanic|Resources|Manager/.test(String(x.title)));
    expect(rejected).toHaveLength(5);
    expect(rejected.every(x=>x.facts.explicitElectricalRole===false)).toBe(true);
  });
  it("keeps distinct cities distinct and never merges them",async()=>{
    const o=await strikeCapture();
    expect(o.map(x=>x.facts.city)).toEqual(["Midland","Billings","Baytown","Spring",null,"Baytown","Midland",null]);
    expect(o.map(x=>x.facts.state)).toEqual(["TX","MT","TX","TX",null,"TX","TX",null]);
  });
  it("does not invent a city for a 'Remote' row or a row with no location at all",async()=>{
    const o=await strikeCapture();
    expect(o[4].facts.city).toBeNull();
    expect(o[4].facts.postingLocationRaw).toBe("Remote");
    expect(o[7].facts.city).toBeNull();
    expect(o[7].facts.postingLocationRaw).toBeNull();
  });
  it("leaves headcount, wage and economics UNKNOWN because a JazzHR index row states none",async()=>{
    const run=await strikeRun();
    for(const s of run.signals){
      expect(s.input.headcount).toBeNull();
      expect(s.input.hoursPerWeek).toBeNull();
      expect(s.input.hasPerDiem).toBe(false);
    }
    expect((await strikeCapture()).every(o=>o.facts.wage===null)).toBe(true);
  });
  it("preserves per-row provenance: each candidate keeps its own posting URL",async()=>{
    const o=await strikeCapture();
    expect(o[0].sourceUrl).toBe("https://strike.applytojob.com/apply/dPMrOWI8fn/Journeyman-Electrician");
    expect(new Set(o.map(x=>x.sourceUrl)).size).toBe(8);
  });
  it("raises VERIFY_TEMPORAL_STATUS because the index states no posting date",async()=>{
    const run=await strikeRun();
    expect(run.opportunities.every(x=>x.needs.kinds.includes("VERIFY_TEMPORAL_STATUS"))).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Trillium
// --------------------------------------------------------------------------
const trilliumRow=(id:string,title:string,location:string,posted:string)=>`<a class='job_teaser_item' href='/jobs/job/${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g,"-")}.html'>
  <div class='big_blue_chevron'>&#9654;</div>
  <div class='job_teaser_item_details'>
    <h2>${title}</h2>
    <p class='location_and_timestamp'><span class='job_teaser_location'>
    ${location}</span> - <span class='job_timestamp'>${posted}</span></p>
  </div>
</a>`;

const TRILLIUM=`<html><body><aside id='job_teaser_browser'>
${trilliumRow("801146","Electrician","Houston, TX","Posted 1 day  ago")}
${trilliumRow("801054","Electrician - Per Diem Offered","Floyd, NM","Posted 2 days  ago")}
${trilliumRow("801182","Millwright - Per Diem Offered","Elizabethtown, PA","Posted 1 day  ago")}
${trilliumRow("801110","Welder","Columbus, OH","Posted 3 days  ago")}
${trilliumRow("801185","Class A Truck Driver","Palmer, TX","Posted 1 day  ago")}
</aside></body></html>`;

const trilliumCapture=async(body=TRILLIUM,status=200)=>(await new TrilliumListingDiscoveryAdapter(transport(body,status)).capturePage(request())).observations;
const trilliumRun=async(body=TRILLIUM)=>runListingDiscovery(await trilliumCapture(body),{sourceKey:"trillium",observedAt:request().asOf,listingUrl:TRILLIUM_LISTING_URL});

describe("Trillium listing discovery",()=>{
  it("declares the robots.txt crawl-delay obligation in code, not only in a report",()=>{
    expect(TRILLIUM_CRAWL_DELAY_SECONDS).toBe(10);
  });
  it("discovers every teaser row and keys each to its own stable posting id",async()=>{
    const o=await trilliumCapture();
    expect(o).toHaveLength(5);
    expect(o.map(x=>x.externalId)).toEqual(["trillium-listing-801146","trillium-listing-801054","trillium-listing-801182","trillium-listing-801110","trillium-listing-801185"]);
  });
  it("recognizes electrician titles and rejects millwright, welder and driver titles",async()=>{
    const run=await trilliumRun();
    expect(run.electricalListings).toBe(2);
    expect(run.tracked.map(t=>t.externalId)).toEqual(["trillium-listing-801146","trillium-listing-801054"]);
  });
  it("records an explicitly offered per diem, and does not assume one otherwise",async()=>{
    const run=await trilliumRun();
    expect(run.signals[1].input.hasPerDiem).toBe(true);
    expect(run.signals[0].input.hasPerDiem).toBe(false);
  });
  it("keeps the relative posting stamp verbatim instead of inventing an absolute date",async()=>{
    const o=await trilliumCapture();
    expect(o[0].facts.postedAtRaw).toBe("Posted 1 day ago");
  });
  it("resolves each row to an absolute posting URL from its relative href",async()=>{
    const o=await trilliumCapture();
    expect(o[0].sourceUrl).toBe("https://trilliumstaffing.com/jobs/job/801146-electrician.html");
  });
  it("keeps Houston, Floyd, Elizabethtown, Columbus and Palmer as five distinct places",async()=>{
    const o=await trilliumCapture();
    expect(o.map(x=>`${x.facts.city}|${x.facts.state}`)).toEqual(["Houston|TX","Floyd|NM","Elizabethtown|PA","Columbus|OH","Palmer|TX"]);
  });
  it("leaves wage and headcount UNKNOWN: a teaser row states neither",async()=>{
    const o=await trilliumCapture();
    expect(o.every(x=>x.facts.wage===null&&x.facts.headcount===null)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Bechtel / SAP SuccessFactors
// --------------------------------------------------------------------------
const bechtelRow=(href:string,title:string,location:string,dept:string)=>`<tr class="data-row">
  <td class="colTitle" headers="hdrTitle">
    <span class="jobTitle hidden-phone"><a href="${href}" class="jobTitle-link">${title}</a></span>
    <div class="jobdetail-phone visible-phone">
      <span class="jobTitle visible-phone"><a class="jobTitle-link" href="${href}">${title}</a></span>
      <span class="jobLocation visible-phone"><span class="jobLocation">${location}</span></span>
      <span class="jobFacility visible-phone">${dept}</span>
    </div>
  </td>
  <td class="colLocation hidden-phone" headers="hdrLocation"><span class="jobLocation">${location}</span></td>
  <td class="colDepartment hidden-phone" headers="hdrDepartment"><span class="jobDepartment">${dept}</span></td>
</tr>`;

const BECHTEL=`<html><body><table><tbody>
${bechtelRow("/job/Pecos-Field-Superintendent-Electrical-TX-79772/1388121200/","Field Superintendent - Electrical","Pecos, TX, US","Infrastructure")}
${bechtelRow("/job/Pecos-Field-Superintendent-Piping-TX-79772/1388121300/","Field Superintendent - Piping","Pecos, TX, US","Infrastructure")}
${bechtelRow("/job/Santiago-Electrical-Estimator-8320000/1402398100/","Electrical Estimator","Santiago, CL, 8320000","Mining")}
${bechtelRow("/job/Reston-Senior-Structural-Engineer-VA-20190/1395961400/","Senior Structural Engineer","Reston, VA, US, 20190","Corporate")}
${bechtelRow("/job/Houston-Paralegal-TX-77056/1396290000/","Paralegal","Houston, TX, US, 77056 +2 more&hellip;","Legal")}
${bechtelRow("/job/Toronto-System-Construction-Lead-ON-M5J-2S1/1405410600/","System Construction Lead","Toronto, ON, CA, M5J 2S1","Infrastructure")}
</tbody></table></body></html>`;

const bechtelCapture=async(body=BECHTEL,status=200)=>(await new BechtelListingDiscoveryAdapter(transport(body,status)).capturePage(request())).observations;
const bechtelRun=async(body=BECHTEL)=>runListingDiscovery(await bechtelCapture(body),{sourceKey:"bechtel",observedAt:request().asOf,listingUrl:BECHTEL_LISTING_URL});

describe("Bechtel/SuccessFactors listing discovery",()=>{
  it("counts each requisition once despite the duplicated desktop and mobile blocks",async()=>{
    const o=await bechtelCapture();
    expect(o).toHaveLength(6);
    expect(o[0].externalId).toBe("bechtel-listing-1388121200");
    expect(new Set(o.map(x=>x.externalId)).size).toBe(6);
  });
  it("does not concatenate the doubled location markup into one mangled string",async()=>{
    const o=await bechtelCapture();
    expect(o[0].facts.postingLocationRaw).toBe("Pecos, TX, US");
  });
  it("recognizes an explicit electrical field-superintendent title",async()=>{
    const run=await bechtelRun();
    expect(run.electricalListings).toBe(1);
    expect(run.tracked).toHaveLength(1);
    expect(run.tracked[0].recognizedRoles).toEqual(["ELECTRICAL_FIELD_SUPERINTENDENT"]);
  });
  it("rejects engineer, estimator, piping and administrative titles even when the word 'Electrical' appears",async()=>{
    const o=await bechtelCapture();
    const estimator=o.find(x=>x.title==="Electrical Estimator")!;
    expect(estimator.facts.explicitElectricalRole).toBe(false);
    const engineer=o.find(x=>x.title==="Senior Structural Engineer")!;
    expect(engineer.facts.explicitElectricalRole).toBe(false);
    expect(o.filter(x=>x.facts.explicitElectricalRole===true)).toHaveLength(1);
  });
  it("parses international city/region/country/postal without merging or dropping parts",async()=>{
    const o=await bechtelCapture();
    expect({c:o[0].facts.city,s:o[0].facts.state,k:o[0].facts.country}).toEqual({c:"Pecos",s:"TX",k:"US"});
    expect({c:o[2].facts.city,s:o[2].facts.state,k:o[2].facts.country}).toEqual({c:"Santiago",s:null,k:"CL"});
    expect({c:o[3].facts.city,s:o[3].facts.state,k:o[3].facts.country}).toEqual({c:"Reston",s:"VA",k:"US"});
    expect({c:o[5].facts.city,s:o[5].facts.state,k:o[5].facts.country}).toEqual({c:"Toronto",s:"ON",k:"CA"});
  });
  it("flags a multi-location row rather than inventing the locations it did not list",async()=>{
    const o=await bechtelCapture();
    const paralegal=o.find(x=>x.title==="Paralegal")!;
    expect(paralegal.facts.additionalLocationsIndicated).toBe(true);
    expect(paralegal.facts.city).toBe("Houston");
  });
  it("leaves wage, headcount and economics UNKNOWN throughout",async()=>{
    const run=await bechtelRun();
    expect(run.signals.every(s=>s.input.headcount===null&&s.input.hoursPerWeek===null&&s.input.hasPerDiem===false)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Behaviour shared by all three upgraded adapters
// --------------------------------------------------------------------------
const ADAPTERS=[
  ["strike",(b:string,s:number)=>new StrikeListingDiscoveryAdapter(transport(b,s)),STRIKE],
  ["trillium",(b:string,s:number)=>new TrilliumListingDiscoveryAdapter(transport(b,s)),TRILLIUM],
  ["bechtel",(b:string,s:number)=>new BechtelListingDiscoveryAdapter(transport(b,s)),BECHTEL]
]as const;

describe("all upgraded listing adapters: failure and idempotence contracts",()=>{
  for(const[name,make,body]of ADAPTERS){
    it(`${name}: an empty or malformed body yields zero candidates without throwing`,async()=>{
      for(const bad of["","<html><body><p>Service unavailable</p></body></html>","<tr class=\"data-row\"><td>",'<li class="list-group-item"><h3 class="list-group-item-heading">'])
        await expect(make(bad,200).capturePage(request())).resolves.toMatchObject({observations:[]});
    });
    for(const status of[403,404,429,500,503])
      it(`${name}: HTTP ${status} throws instead of reporting an empty listing`,async()=>{
        await expect(make(body,status).capturePage(request())).rejects.toThrow(String(status));
      });
    it(`${name}: repeated scans are idempotent and duplicates are suppressed, not lost`,async()=>{
      const first=(await make(body,200).capturePage(request())).observations;
      const second=(await make(body,200).capturePage(request())).observations;
      expect(second.map(o=>o.externalId)).toEqual(first.map(o=>o.externalId));
      const run=runListingDiscovery([...first,...second],{sourceKey:name,observedAt:request().asOf,listingUrl:"https://example.invalid/listing"});
      expect(run.newSignals).toBe(first.length);
      expect(run.duplicatesSuppressed).toBe(first.length);
    });
    it(`${name}: buyer, AF-01 acceptance and contact stay unknown on every signal`,async()=>{
      const observations=(await make(body,200).capturePage(request())).observations;
      const run=runListingDiscovery(observations,{sourceKey:name,observedAt:request().asOf,listingUrl:"https://example.invalid/listing"});
      for(const s of run.signals){
        expect(s.buyerCandidate).toBeNull();
        expect(s.af01Candidate).toBeNull();
        expect(s.contactPerson).toBeNull();
      }
      expect(run.opportunities.every(x=>x.needs.kinds.includes("VERIFY_MANPOWER_ACCEPTANCE"))).toBe(true);
    });
    it(`${name}: no signal reaches the top tier without explicit data-centre sector evidence`,async()=>{
      const observations=(await make(body,200).capturePage(request())).observations;
      const run=runListingDiscovery(observations,{sourceKey:name,observedAt:request().asOf,listingUrl:"https://example.invalid/listing"});
      expect(run.signals.every(s=>s.input.sector==="UNKNOWN")).toBe(true);
      expect(run.signals.some(s=>s.tier==="HIGH_VALUE_DATA_CENTER_MANPOWER")).toBe(false);
    });
  }
});

describe("listing-discovery mapping helpers are explicit-only",()=>{
  it("claims a data-centre sector only when the text says so",()=>{
    expect(statesDataCentreSector("Journeyman Electrician for a new data center campus")).toBe(true);
    expect(statesDataCentreSector("mission-critical facility electrician")).toBe(true);
    // Employer/jobsite identity is never sector evidence.
    expect(statesDataCentreSector("Journeyman Job Call — Foxconn")).toBe(false);
    expect(statesDataCentreSector("Electrician — Meta — Temple, TX")).toBe(false);
    expect(statesDataCentreSector(null)).toBe(false);
  });
  it("computes hours/week only from a schedule the source printed",()=>{
    expect(hoursPerWeekFromSchedule("Will be working 6(10's) with a 6:00am start time")).toBe(60);
    expect(hoursPerWeekFromSchedule("Will be working 5(8's)")).toBe(40);
    expect(hoursPerWeekFromSchedule("50 hours per week")).toBe(50);
    expect(hoursPerWeekFromSchedule("Will be working from 7 am to 3:30 pm Monday - Friday")).toBeNull();
    expect(hoursPerWeekFromSchedule(null)).toBeNull();
  });
  it("distinguishes a stated per diem from a stated incentive",()=>{
    expect(statesPerDiem("Per Diem Offered")).toBe(true);
    expect(statesPerDiem("$50 incentive per day, with a minimum of 50 hours worked")).toBe(false);
    expect(statesPerDiem(null)).toBe(false);
  });
  it("reports duration only when stated",()=>{
    expect(durationFromText("long-term assignment")).toBe("LONG_TERM");
    expect(durationFromText("short-term coverage")).toBe("SHORT_TERM");
    expect(durationFromText("Journeyman Electrician")).toBe("UNKNOWN");
    expect(durationFromText(null)).toBe("UNKNOWN");
  });
});
