import type{ProductionObservation,PublicTransport}from"../../../domain/production-capture";
import{recognizeElectricalRoles}from"../../../domain/electrical-role-recognition";
import{normalizeListingLocation}from"../../../domain/location-normalization";
import{PublicSourceAdapter}from"./public-source-adapter";
import{slugify,stripNoise,stripTags}from"./listing-html";

/**
 * Phase 2R-B: upgrades the already-ACTIVATE Bechtel / SAP SuccessFactors source
 * from single-posting capture to listing discovery.
 *
 * No new compliance decision is required: bechtel-adapter.ts already captures an
 * individual bechtel.jobs.hr.cloud.sap job-detail page live, classified
 * PUBLIC_SERVER_RENDERED_PAGE in source-portfolio-audit-2k-service.ts. This is
 * the same host's own public search index of exactly those pages.
 *
 * PAGE SHAPE (confirmed live 2026-08-29):
 *   <tr class="data-row">
 *     <td class="colTitle"><span class="jobTitle hidden-phone">
 *       <a href="/job/Pecos-Field-Superintendent-Electrical-TX-79772/1388121200/"
 *          class="jobTitle-link">Field Superintendent - Electrical</a></span>
 *       ... a duplicate mobile block repeating title/location ...
 *     </td>
 *     <td class="colLocation"><span class="jobLocation">Pecos, TX, US</span></td>
 *     <td class="colDepartment"><span class="jobDepartment">Infrastructure</span></td>
 *   </tr>
 * Each row's title and location are rendered TWICE (a desktop cell and a
 * visible-phone block). De-duplication is by the requisition id in the href, so
 * the doubled markup can never inflate the candidate count.
 *
 * Note on role recognition: this listing legitimately contains both
 * "Field Superintendent - Electrical" (an explicit electrical craft-leadership
 * title the recognizer accepts) and "Senior Structural Engineer" /
 * "Electrical Estimator" (which it must NOT accept). Nothing here overrides
 * that judgement either way.
 */

export const BECHTEL_LISTING_URL="https://bechtel.jobs.hr.cloud.sap/search/";

const ROW_RE=/<tr[^>]*class=['"][^'"]*data-row[^'"]*['"][^>]*>([\s\S]*?)<\/tr>/gi;
const LINK_RE=/<a[^>]+href=['"]([^'"]+)['"][^>]*class=['"][^'"]*jobTitle-link[^'"]*['"][^>]*>([\s\S]*?)<\/a>/i;
const LOC_RE=/<span[^>]*class=['"][^'"]*jobLocation[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i;
const DEPT_RE=/<span[^>]*class=['"][^'"]*jobDepartment[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i;
const DATE_RE=/<span[^>]*class=['"][^'"]*jobDate[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i;

export class BechtelListingDiscoveryAdapter extends PublicSourceAdapter{
  readonly descriptor={
    adapterId:"bechtel-successfactors-listing-discovery",
    version:"1.0.0",
    sourceId:"bechtel",
    sourceFamily:"EPC_CONTRACTOR"as const,
    captureMethod:"STATIC_HTML"as const,
    capabilities:["WORKFORCE_DEMAND"as const,"LOCATION"as const],
    executionRequirements:["public-page","robots-allowed"],
    parser:{id:"bechtel-successfactors-listing-html",version:"1.0.0"}
  };
  constructor(t:PublicTransport,url:string=BECHTEL_LISTING_URL){super(t,url)}

  protected parse(h:string,u:string):ProductionObservation[]{
    const html=stripNoise(h);
    const origin=(()=>{try{return new URL(u).origin}catch{return"https://bechtel.jobs.hr.cloud.sap"}})();
    const seen=new Set<string>();
    const observations:ProductionObservation[]=[];

    for(const m of html.matchAll(ROW_RE)){
      const row=m[1];
      const link=row.match(LINK_RE);
      if(!link)continue;
      const href=stripTags(link[1]),title=stripTags(link[2]);
      if(!title||!href)continue;
      const requisitionId=href.match(/\/(\d{6,})\/?$/)?.[1]??null;
      const externalId=`bechtel-listing-${requisitionId??slugify(href,50)}`;
      if(seen.has(externalId))continue;
      seen.add(externalId);

      // The desktop cell and the mobile block both carry jobLocation; the first
      // match is taken and the duplicate ignored, never concatenated.
      const locationText=stripTags(row.match(LOC_RE)?.[1]??"")||null;
      const department=stripTags(row.match(DEPT_RE)?.[1]??"")||null;
      const postedAtRaw=stripTags(row.match(DATE_RE)?.[1]??"")||null;
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
          requisitionId,
          department,
          postingLocationRaw:location.raw,
          city:location.city,
          state:location.state,
          country:location.country,
          additionalLocationsIndicated:location.additionalLocationsIndicated,
          jobsite:null,
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
