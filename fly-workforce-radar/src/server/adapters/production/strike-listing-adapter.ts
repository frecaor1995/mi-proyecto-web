import type{ProductionObservation,PublicTransport}from"../../../domain/production-capture";
import{recognizeElectricalRoles}from"../../../domain/electrical-role-recognition";
import{normalizeListingLocation}from"../../../domain/location-normalization";
import{PublicSourceAdapter}from"./public-source-adapter";
import{slugify,stripNoise,stripTags}from"./listing-html";

/**
 * Phase 2R-B: upgrades the already-ACTIVATE Strike / JazzHR source family from
 * single-posting capture to listing discovery.
 *
 * No new compliance decision is required: this is the SAME already-approved
 * source family and the SAME host as the existing
 * "strike-midland-journeyman-electrician" / "strike-houston-journeyman-electrician"
 * / "strike-baytown-journeyman-electrician" entries (all classified
 * PUBLIC_SERVER_RENDERED_PAGE in source-portfolio-audit-2k-service.ts). Only
 * the page differs: strike.applytojob.com/apply/ is the family's own public
 * index of the individual job pages already being captured one at a time.
 *
 * PAGE SHAPE (confirmed live 2026-08-29):
 *   <li class="list-group-item">
 *     <h3 class='list-group-item-heading'><a href="ABS_URL">TITLE</a></h3>
 *     <ul class='list-inline list-group-item-text'>
 *       <li><i class='fa fa-map-marker'></i>Midland, TX</li>
 *     </ul>
 *   </li>
 * The row states a title and a location and nothing else -- no wage, no
 * headcount, no schedule, no contact. Those therefore stay UNKNOWN here rather
 * than being filled from the detail page, the employer, or anywhere else.
 */

export const STRIKE_LISTING_URL="https://strike.applytojob.com/apply/";

const ROW_RE=/<h3[^>]*class=['"][^'"]*list-group-item-heading[^'"]*['"][^>]*>\s*<a[^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>\s*<\/h3>([\s\S]{0,600}?)(?=<h3|<\/ul>\s*<\/div>|$)/gi;
const LOCATION_RE=/<li>\s*(?:<i[^>]*><\/i>)?\s*([^<]{2,120})<\/li>/i;

export class StrikeListingDiscoveryAdapter extends PublicSourceAdapter{
  readonly descriptor={
    adapterId:"strike-jazzhr-listing-discovery",
    version:"1.0.0",
    sourceId:"strike-midland",
    sourceFamily:"COMPANY_CAREERS"as const,
    captureMethod:"STATIC_HTML"as const,
    capabilities:["WORKFORCE_DEMAND"as const,"LOCATION"as const],
    executionRequirements:["public-page","robots-allowed"],
    parser:{id:"strike-jazzhr-listing-html",version:"1.0.0"}
  };
  constructor(t:PublicTransport,url:string=STRIKE_LISTING_URL){super(t,url)}

  protected parse(h:string):ProductionObservation[]{
    const html=stripNoise(h);
    const seen=new Set<string>();
    const observations:ProductionObservation[]=[];

    for(const m of html.matchAll(ROW_RE)){
      const href=stripTags(m[1]);
      const title=stripTags(m[2]);
      if(!title||!href)continue;
      // The "View All Jobs" self-link is the listing itself, not a posting.
      const slug=href.match(/\/apply\/([A-Za-z0-9]+)\//)?.[1];
      if(!slug)continue;
      const externalId=`strike-listing-${slug.toLowerCase()}-${slugify(title,40)}`;
      if(seen.has(externalId))continue;
      seen.add(externalId);

      const locationText=m[3]?.match(LOCATION_RE)?.[1]?.trim()??null;
      const location=normalizeListingLocation({postingLocation:locationText});
      const recognition=recognizeElectricalRoles(title);

      observations.push({
        kind:"WORKFORCE_DEMAND",
        title,
        // The listing page never names the hiring entity per row; the family
        // identity is the source, not a stated fact on the row.
        organization:null,
        location:location.raw,
        sourceUrl:href,
        externalId,
        facts:{
          postingLocationRaw:location.raw,
          city:location.city,
          state:location.state,
          jobsite:null,
          rawListingText:title,
          recognizedElectricalRoles:recognition.roles.join(",")||null,
          explicitElectricalRole:recognition.roles.length>0,
          // Not stated anywhere on a JazzHR index row.
          headcount:null,wage:null,incentive:null,schedule:null,shift:null,
          duration:null,startInstruction:null,postedAtRaw:null,
          manpowerAcceptance:null,buyer:null,contact:null,
          isWorkforceDemand:true
        }
      });
    }
    return observations;
  }
}
