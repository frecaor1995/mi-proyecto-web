import type{ProductionObservation,PublicTransport}from"../../../domain/production-capture";
import{PublicSourceAdapter,match,plainText}from"./public-source-adapter";

/**
 * Discovery gap closure: every currently-ACTIVATE production adapter
 * (bechtel-adapter.ts, rosendin-adapter.ts, tpwd-adapter.ts's own
 * TpwdConstructionAdapter) takes ONE fixed URL and parses exactly ONE
 * observation from it. None starts from a listing/index page and discovers
 * multiple candidate opportunities. This adapter closes that gap using the
 * SAME already-ACTIVATE TPWD source (source-portfolio-audit-2k-service.ts's
 * "tpwd" entry, PUBLIC_SERVER_RENDERED_PAGE) and the SAME listing/index
 * endpoint TpwdConstructionAdapter already fetches live today -- no new
 * compliance decision is required.
 *
 * Live inspection of the real page (fetched 2026-08-29) confirmed which
 * branch of listing discovery actually applies here: TPWD's "Bid
 * Information" summary list renders each opportunity as
 * `<li><a href="#a1112666">DATE &mdash; Project NUMBER &mdash; LOCATION &mdash;
 * DESCRIPTION</a></li>` -- an in-page anchor, NOT a link to a separate
 * detail page or PDF. The fuller per-bid text lives further down the SAME
 * page, addressable by that identical anchor id. So per this task's
 * documented fallback: the stable external ID is the TPWD anchor id
 * (canonicalized), the candidate's own summary-list text is captured as its
 * evidence, and this is modeled as N distinct candidates -- not 1, and not a
 * fetch of N separate detail URLs that do not exist as standalone pages.
 *
 * HTTP failure handling is inherited unchanged from PublicSourceAdapter:
 * capturePage() already throws on any non-2xx status before parse() ever
 * runs, so a 403/404/429/5xx on the listing fetch surfaces as a thrown
 * failure -- never silently coerced into "zero candidates found".
 */

export const TPWD_LISTING_URL="https://tpwd.texas.gov/business/bidops/current_bid_opportunities/construction/index.phtml?print=true";

const CANDIDATE_RE=/<li>\s*<a\s+href="#([^"]+)">([^<]+)<\/a>\s*<\/li>/gi;

const decodeEntities=(s:string):string=>s
  .replace(/&mdash;/g,"—")
  .replace(/&ndash;/g,"–")
  .replace(/&rsquo;/g,"’")
  .replace(/&lsquo;/g,"‘")
  .replace(/&amp;/g,"&")
  .replace(/&nbsp;/g," ")
  .replace(/\s+/g," ")
  .trim();

export class TpwdListingDiscoveryAdapter extends PublicSourceAdapter{
  readonly descriptor={
    adapterId:"tpwd-construction-listing-discovery",
    version:"1.0.0",
    sourceId:"tpwd",
    sourceFamily:"PROCUREMENT_PORTAL"as const,
    captureMethod:"STATIC_HTML"as const,
    capabilities:["PROJECT_EXISTENCE"as const,"LOCATION"as const,"PUBLICATION_CURRENTNESS"as const],
    executionRequirements:["public-page","robots-allowed"],
    parser:{id:"tpwd-construction-listing-html",version:"1.0.0"}
  };
  constructor(t:PublicTransport,url:string=TPWD_LISTING_URL){super(t,url)}

  protected parse(h:string,u:string):ProductionObservation[]{
    // Explicitly stated by the page itself (title/meta), same pattern as
    // tpwd-adapter.ts's own organization match -- never guessed.
    const organization=match(plainText(h),/(Texas Parks (?:and|&) Wildlife Department)/i);
    const seen=new Set<string>();
    const observations:ProductionObservation[]=[];

    for(const m of h.matchAll(CANDIDATE_RE)){
      const anchorId=m[1].trim();
      if(!anchorId||seen.has(anchorId))continue;
      const rawText=decodeEntities(m[2]);
      if(!rawText)continue;
      seen.add(anchorId);

      // "DATE — Project NUMBER — [LOCATION —] DESCRIPTION"; the location
      // segment is only present on some rows (confirmed on the live page),
      // so it is only ever populated when a 4th segment genuinely exists --
      // never assumed present.
      const segments=rawText.split(" — ").map(s=>s.trim()).filter(Boolean);
      const dueDateRaw=segments[0]??null;
      const projectSeg=segments[1]??null;
      const projectNumber=projectSeg?(projectSeg.match(/^Project\s+(.+)$/i)?.[1]?.trim()??null):null;
      const rest=segments.slice(2);
      const location=rest.length>=2?rest[0]:null;
      const description=rest.length>=2?rest.slice(1).join(" — "):(rest.length===1?rest[0]:null);
      const title=description??rawText;

      observations.push({
        kind:"PROJECT_PROCUREMENT",
        title,
        organization,
        location,
        sourceUrl:`${u}#${anchorId}`,
        externalId:`tpwd-listing-${anchorId.toLowerCase()}`,
        facts:{
          dueDateRaw,
          projectNumber,
          description,
          rawListingText:rawText,
          // Explicit recognition of electrical trade work when the row's own
          // text states it -- distinct from the narrower journeyman-role
          // check below, and never inferred from employer/project identity.
          explicitElectricalTradeWork:/electric(al|ian)?/i.test(rawText),
          explicitJourneymanElectrician:/journeyman\s+electrician/i.test(rawText),
          // A procurement bid listing is not itself a staffing/job posting.
          isWorkforceDemand:false,
          current:null
        }
      });
    }
    return observations;
  }
}
