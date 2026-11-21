import type{ProductionObservation,PublicTransport}from"../../../domain/production-capture";
import{recognizeElectricalRoles}from"../../../domain/electrical-role-recognition";
import{normalizeListingLocation}from"../../../domain/location-normalization";
import{PublicSourceAdapter}from"./public-source-adapter";
import{stripNoise,stripTags}from"./listing-html";

/**
 * Phase 2R-B: upgrades the already-ACTIVATE Trillium source family from
 * single-posting capture to listing discovery.
 *
 * No new compliance decision is required: same already-approved family and host
 * as the existing "trillium-amarillo-journeyman-791374" /
 * "trillium-amarillo-apprentice-791431" entries (PUBLIC_SERVER_RENDERED_PAGE in
 * source-portfolio-audit-2k-service.ts), just the family's own public index of
 * those /jobs/job/ pages.
 *
 * CRAWL-DELAY: trilliumstaffing.com/robots.txt specifies `Crawl-delay: 10` for
 * User-agent: * (re-confirmed live this checkpoint, alongside its only
 * Disallow rules: /jobs/signup/, /jobs/indeedapply/, /bdcap/ -- none of which
 * covers the listing path below). This adapter issues exactly ONE request per
 * capture, so it cannot itself violate the delay; any CALLER that fetches more
 * than one Trillium page in a run must leave >= 10s between them. That
 * obligation is stated on TRILLIUM_CRAWL_DELAY_SECONDS below so it travels
 * with the code rather than living only in a report.
 *
 * PAGE SHAPE (confirmed live 2026-08-29):
 *   <a class='job_teaser_item' href='/jobs/job/801146-electrician-houston-texas.html'>
 *     <div class='job_teaser_item_details'>
 *       <h2>Electrician</h2>
 *       <p class='location_and_timestamp'>
 *         <span class='job_teaser_location'>Houston, TX</span> -
 *         <span class='job_timestamp'>Posted 1 day  ago</span></p>
 *     </div>
 *   </a>
 * A row states title, location and a RELATIVE posting age. The relative age is
 * preserved verbatim as `postedAtRaw` and never converted into an absolute
 * timestamp here -- doing so would invent precision the source did not give.
 */

export const TRILLIUM_LISTING_URL="https://trilliumstaffing.com/jobs/search/";
export const TRILLIUM_CRAWL_DELAY_SECONDS=10;

const ROW_RE=/<a[^>]*class=['"]job_teaser_item['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
const TITLE_RE=/<h2[^>]*>([\s\S]*?)<\/h2>/i;
const LOC_RE=/<span[^>]*class=['"]job_teaser_location['"][^>]*>([\s\S]*?)<\/span>/i;
const TS_RE=/<span[^>]*class=['"]job_timestamp['"][^>]*>([\s\S]*?)<\/span>/i;

export class TrilliumListingDiscoveryAdapter extends PublicSourceAdapter{
  readonly descriptor={
    adapterId:"trillium-listing-discovery",
    version:"1.0.0",
    sourceId:"trillium",
    sourceFamily:"STAFFING_CAREERS"as const,
    captureMethod:"STATIC_HTML"as const,
    capabilities:["WORKFORCE_DEMAND"as const,"LOCATION"as const,"PUBLICATION_CURRENTNESS"as const],
    executionRequirements:["public-page","robots-allowed","crawl-delay-10s"],
    parser:{id:"trillium-listing-html",version:"1.0.0"}
  };
  constructor(t:PublicTransport,url:string=TRILLIUM_LISTING_URL){super(t,url)}

  protected parse(h:string,u:string):ProductionObservation[]{
    const html=stripNoise(h);
    const origin=(()=>{try{return new URL(u).origin}catch{return"https://trilliumstaffing.com"}})();
    const seen=new Set<string>();
    const observations:ProductionObservation[]=[];

    for(const m of html.matchAll(ROW_RE)){
      const href=stripTags(m[1]),body=m[2];
      const title=stripTags(body.match(TITLE_RE)?.[1]??"");
      if(!title||!href)continue;
      const postingId=href.match(/\/jobs\/job\/(\d+)-/)?.[1];
      if(!postingId)continue;
      const externalId=`trillium-listing-${postingId}`;
      if(seen.has(externalId))continue;
      seen.add(externalId);

      const locationText=stripTags(body.match(LOC_RE)?.[1]??"")||null;
      const postedAtRaw=stripTags(body.match(TS_RE)?.[1]??"")||null;
      const location=normalizeListingLocation({postingLocation:locationText});
      const recognition=recognizeElectricalRoles(title);

      observations.push({
        kind:"WORKFORCE_DEMAND",
        title,
        organization:null,
        location:location.raw,
        sourceUrl:href.startsWith("http")?href:`${origin}${href}`,
        externalId,
        facts:{
          postingId,
          postingLocationRaw:location.raw,
          city:location.city,
          state:location.state,
          jobsite:null,
          // Verbatim relative age as stated ("Posted 1 day ago"); never
          // resolved to a date the page did not print.
          postedAtRaw,
          rawListingText:title,
          recognizedElectricalRoles:recognition.roles.join(",")||null,
          explicitElectricalRole:recognition.roles.length>0,
          headcount:null,wage:null,incentive:null,schedule:null,shift:null,
          duration:null,startInstruction:null,
          manpowerAcceptance:null,buyer:null,contact:null,
          isWorkforceDemand:true
        }
      });
    }
    return observations;
  }
}
