import type{ProductionObservation,PublicTransport}from"../../../domain/production-capture";
import{recognizeElectricalRoles}from"../../../domain/electrical-role-recognition";
import{PublicSourceAdapter}from"./public-source-adapter";
import{decodeEntities,explicitCount,slugify,stripNoise,stripTags}from"./listing-html";

/**
 * Phase 2R-B listing discovery: IBEW Local 716 (Houston) public dispatch
 * job-call boards.
 *
 * COMPLIANCE BASIS (re-confirmed live this checkpoint, not inherited):
 *   - https://ibew716.net/robots.txt read in full. Its only User-agent: *
 *     block disallows /?s= , /page/-star-/?s= , /search/ , /wp-json/ and
 *     /?rest_route= . None of the job-call paths below is disallowed.
 *   - No Terms of Service exists to prohibit anything: the footer links none,
 *     the published sitemap lists none, and /terms, /terms-of-service,
 *     /terms-of-use, /privacy, /privacy-policy, /legal, /disclaimer and
 *     /terms-and-conditions all return HTTP 404.
 *   - The job-call pages return HTTP 200 to a plain unauthenticated GET with no
 *     login wall and no CAPTCHA.
 * Local 20 (ibew20.org) is deliberately NOT implemented here: its published
 * Terms of Service prohibits automated access outright, so it was classified
 * UNDER_REVIEW and never fetched.
 *
 * PAGE SHAPE (confirmed by live inspection 2026-08-29). WordPress content
 * built entirely from heading runs, with no per-row URL and no table:
 *   <h2>Monday, August 31, 2026</h2>            <- dispatch date
 *   <h3><u>20- Journeyman Job Calls -</u></h3>  <- craft + total for the day
 *   <h5><u>9-Big State Electric -</u></h5>      <- contractor, no detail text
 *   <h5><u>6- Foxconn -</u> Applicant must...</h5>  <- an actual job call
 * A contractor heading and a job call are told apart structurally, by whether
 * any text follows the underlined lead -- not by guessing from the name.
 *
 * WHAT IS DELIBERATELY NOT INFERRED:
 *   - A job call appearing on a union dispatch board is NOT evidence that the
 *     contractor accepts third-party manpower. af01/manpower acceptance stays
 *     UNKNOWN for every row (see source-portfolio-audit-2k-service.ts's
 *     HOT_GAP_FINDINGS: acceptance is a human-verified step).
 *   - No contact-route grade is assigned.
 *   - Headcount is captured ONLY from a number the row itself states. A
 *     contractor's total is never divided among, or copied down to, its rows:
 *     "4- Fisk Electric -" followed by "- Foxconn -" leaves that call's
 *     headcount UNKNOWN, because the row states no number of its own.
 *   - Sector stays UNKNOWN unless the row's own text says otherwise. A jobsite
 *     named for a technology company is not a data-center claim.
 *
 * HTTP failures are inherited unchanged from PublicSourceAdapter: capturePage()
 * throws on any non-2xx before parse() runs, so 403/404/429/5xx surface as
 * failures rather than a silent zero-candidate result.
 */

export const IBEW716_JOURNEYMAN_JOB_CALLS_URL="https://ibew716.net/journeyman-job-calls/";
export const IBEW716_CW_CE_JOB_CALLS_URL="https://ibew716.net/cw-ce-job-calls/";
export const IBEW716_TELEDATA_JOB_CALLS_URL="https://ibew716.net/tele-data-job-calls/";

const HEADING_RE=/<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const DATE_RE=/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}$/;
const CRAFT_CALL_RE=/^(\d+)\s*[–—-]\s*(.+?)\s+Job\s+Calls?\s*[–—-]?\s*$/i;
const MAINTENANCE_RE=/^Maintenance\s+Job\s+Openings$/i;
/** "6- Foxconn -" / "1 - Service Truck -" / "- Downtown-" : an optional
 * explicit count, then the name. The count is optional on purpose. */
const LEAD_RE=/^(\d{1,4})?\s*[–—-]?\s*(.+?)\s*[–—-]?\s*$/;

/** Finds the end index of the element opened at `open`, by tag-name balance. */
function elementEnd(html:string,open:number,tag:string):number{
  const openRe=new RegExp(`<${tag}\\b`,"gi"),closeRe=new RegExp(`</${tag}\\s*>`,"gi");
  let depth=0,i=open;
  for(;;){
    openRe.lastIndex=i;closeRe.lastIndex=i;
    const o=openRe.exec(html),c=closeRe.exec(html);
    if(!c)return html.length;
    if(o&&o.index<c.index){depth++;i=o.index+o[0].length;continue}
    depth--;
    i=c.index+c[0].length;
    if(depth<=0)return i;
  }
}

/**
 * Splits a heading's inner HTML into its underlined lead and the text that
 * follows. Both underline forms these pages actually use are handled: a real
 * <u> element (dispatch rows) and a span carrying text-decoration: underline
 * (maintenance rows). Returns lead=null when the heading has no underlined
 * lead at all, which is how boilerplate headings are excluded.
 */
export function splitUnderlinedLead(innerHtml:string):{lead:string|null;rest:string}{
  if(/<u[\s>]/i.test(innerHtml)){
    const last=innerHtml.toLowerCase().lastIndexOf("</u>");
    if(last>=0)return{lead:stripTags(innerHtml.slice(0,last)),rest:stripTags(innerHtml.slice(last+4))};
  }
  const m=/<span[^>]*text-decoration:\s*underline[^>]*>/i.exec(innerHtml);
  if(m){
    const end=elementEnd(innerHtml,m.index,"span");
    return{lead:stripTags(innerHtml.slice(m.index,end)),rest:stripTags(innerHtml.slice(end))};
  }
  return{lead:null,rest:stripTags(innerHtml)};
}

/** Every extractor below returns null unless the row's own text states the
 * fact. None of them has a default, a fallback or an inferred value. */
const wageFrom=(t:string):string|null=>t.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:per\s+hour|an\s+hour|\/\s?hr\b|hourly)/i)?.[0]?.replace(/\s+/g," ").trim()??null;
const incentiveFrom=(t:string):string|null=>t.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:incentive|per\s?diem)[^.]*/i)?.[0]?.replace(/\s+/g," ").trim()??null;
const scheduleFrom=(t:string):string|null=>t.match(/Will be working[^.]*/i)?.[0]?.replace(/\s+/g," ").trim()??null;
const shiftFrom=(t:string):string|null=>t.match(/\b(?:night|day|swing|graveyard)\s+shift\b/i)?.[0]?.trim()??null;
const startFrom=(t:string):string|null=>t.match(/Report to shop[^.]*/i)?.[0]?.replace(/\s+/g," ").trim()??null;
const durationFrom=(t:string):string|null=>t.match(/\b\d{1,2}\s*(?:-|\s)?\s*(?:week|month|year)s?\s+(?:duration|assignment|project|job)\b/i)?.[0]?.trim()??null;

/**
 * Separates an explicitly-stated "**MID-LEVEL**" / "**ANY-LEVEL**" skill
 * marker from the name it was written next to, so a contractor or jobsite name
 * never silently absorbs it. Both halves are preserved; neither is invented.
 */
export function splitLevelMarker(name:string):{name:string;levelMarker:string|null};
export function splitLevelMarker(name:null):{name:null;levelMarker:null};
export function splitLevelMarker(name:string|null):{name:string|null;levelMarker:string|null}{
  if(name===null)return{name:null,levelMarker:null};
  const m=name.match(/\*\*\s*([^*]+?)\s*\*\*/);
  if(!m)return{name:name.trim()||null,levelMarker:null};
  const stripped=name.replace(m[0],"").replace(/\s+/g," ").replace(/[\s–—-]+$/,"").replace(/^[\s–—-]+/,"").trim();
  return{name:stripped||null,levelMarker:m[1].trim()};
}

/** A trailing note that is entirely parenthesised is a note ABOUT the
 * contractor (e.g. "(Orientation will be held Tuesdays and Thursdays @
 * 7:00am)"), not the requirement text of a job call. Treating it as a job call
 * would turn a contractor name into a fabricated jobsite. */
const isParentheticalNote=(s:string):boolean=>/^\(.*\)$/.test(s.trim());

interface Row{
  kind:"DISPATCH"|"MAINTENANCE";
  contractor:string|null;
  contractorNote:string|null;
  levelMarker:string|null;
  jobsite:string|null;
  headcount:number|null;
  detail:string;
  craft:string|null;
  dispatchDate:string|null;
}

export class Ibew716JobCallAdapter extends PublicSourceAdapter{
  readonly descriptor={
    adapterId:"ibew716-job-call-listing-discovery",
    version:"1.0.0",
    sourceId:"ibew716",
    sourceFamily:"UNION_DISPATCH"as const,
    captureMethod:"STATIC_HTML"as const,
    capabilities:["WORKFORCE_DEMAND"as const,"LOCATION"as const,"PUBLICATION_CURRENTNESS"as const],
    executionRequirements:["public-page","robots-allowed","no-tos-restriction"],
    parser:{id:"ibew716-job-call-html",version:"1.0.0"}
  };
  constructor(t:PublicTransport,url:string=IBEW716_JOURNEYMAN_JOB_CALLS_URL){super(t,url)}

  protected parse(h:string,u:string):ProductionObservation[]{
    const html=stripNoise(h);
    // The page's own stated last-modified time, when it publishes one. Never
    // substituted with "now" -- absence is a real temporal unknown.
    const pageModified=html.match(/article:modified_time"\s+content="([^"]+)"/i)?.[1]??null;

    const rows:Row[]=[];
    let mode:"NONE"|"DISPATCH"|"MAINTENANCE"="NONE";
    let craft:string|null=null,dispatchDate:string|null=null,contractor:string|null=null;
    let contractorNote:string|null=null,contractorLevel:string|null=null;

    for(const m of html.matchAll(HEADING_RE)){
      const level=Number(m[1]),inner=m[2];
      const flat=stripTags(inner);
      if(!flat)continue;

      if(MAINTENANCE_RE.test(flat)){mode="MAINTENANCE";contractor=null;contractorNote=null;contractorLevel=null;continue}
      if(DATE_RE.test(flat)){dispatchDate=flat;continue}

      const craftMatch=flat.match(CRAFT_CALL_RE);
      if(craftMatch){mode="DISPATCH";craft=decodeEntities(craftMatch[2]).trim();contractor=null;contractorNote=null;contractorLevel=null;continue}

      const{lead,rest}=splitUnderlinedLead(inner);

      if(mode==="MAINTENANCE"){
        // An employer name (underlined) followed by the opening's own text.
        if(level===4&&lead&&rest)rows.push({kind:"MAINTENANCE",contractor:lead.replace(/[\s:–—-]+$/,"").trim()||null,contractorNote:null,levelMarker:null,jobsite:null,headcount:null,detail:rest,craft:null,dispatchDate});
        continue;
      }

      if(mode!=="DISPATCH"||level!==5||!lead)continue;

      const parsed=lead.match(LEAD_RE);
      if(!parsed)continue;
      const count=explicitCount(parsed[1]??null);
      const split=splitLevelMarker(decodeEntities(parsed[2]??"").replace(/[\s–—-]+$/,"").trim());
      const name=split.name;
      if(!name)continue;

      // Structural distinction: no trailing text (or a purely parenthetical
      // note) => a contractor grouping heading; real trailing requirement text
      // => an actual job call under that contractor.
      if(!rest||isParentheticalNote(rest)){contractor=name;contractorNote=rest||null;contractorLevel=split.levelMarker;continue}
      rows.push({kind:"DISPATCH",contractor,contractorNote,jobsite:name,headcount:count,detail:rest,craft,dispatchDate,levelMarker:split.levelMarker??contractorLevel});
    }

    const seen=new Set<string>();
    const observations:ProductionObservation[]=[];
    for(const r of rows){
      const idBase=[r.kind==="MAINTENANCE"?"maint":"call",r.dispatchDate??"nodate",r.contractor??"nocontractor",r.jobsite??r.detail.slice(0,40)].map(s=>slugify(String(s),40)).join("-");
      const externalId=`ibew716-${slugify(new URL(u).pathname,30)}-${idBase}`;
      if(seen.has(externalId))continue;
      seen.add(externalId);

      const text=r.detail;
      // The row's own evidence text, EXCLUDING the employer name -- promotion
      // must never be able to fire on employer identity.
      const evidenceText=[r.craft,r.jobsite,r.detail].filter(Boolean).join(" — ");
      const recognition=recognizeElectricalRoles(evidenceText);

      observations.push({
        kind:"WORKFORCE_DEMAND",
        title:r.kind==="MAINTENANCE"?r.detail:[r.craft?`${r.craft} Job Call`:"Job Call",r.jobsite].filter(Boolean).join(" — "),
        organization:r.contractor,
        // A jobsite name is not a posting location. IBEW 716 dispatches the
        // Houston local, but the ROW never states a city, so location stays
        // null rather than borrowing "Houston" from the local's identity.
        location:null,
        sourceUrl:u,
        externalId,
        facts:{
          rowKind:r.kind,
          craftClassification:r.craft,
          contractor:r.contractor,
          contractorNote:r.contractorNote,
          levelMarker:r.levelMarker,
          jobsite:r.jobsite,
          dispatchDateRaw:r.dispatchDate,
          pageModifiedRaw:pageModified,
          headcount:r.headcount,
          wage:wageFrom(text),
          incentive:incentiveFrom(text),
          schedule:scheduleFrom(text),
          shift:shiftFrom(text),
          startInstruction:startFrom(text),
          duration:durationFrom(text),
          rawListingText:evidenceText,
          recognizedElectricalRoles:recognition.roles.join(",")||null,
          explicitElectricalRole:recognition.roles.length>0,
          // Never inferred from the presence of a dispatch call.
          manpowerAcceptance:null,
          buyer:null,
          contact:null,
          isWorkforceDemand:true
        }
      });
    }
    return observations;
  }
}
