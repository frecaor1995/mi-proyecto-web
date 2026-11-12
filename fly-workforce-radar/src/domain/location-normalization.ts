/**
 * Phase 2R-B Discovery: conservative location handling.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: posting location, jobsite, city,
 * state and region are SEPARATE facts and stay separate. Nothing here ever
 * fuzzy-merges two distinct named places, however close they sit on a map.
 * This codebase's domain already carries the scars that justify it:
 *   Temple != Belton != Killeen   (Central Texas corridor)
 *   Midland != Odessa             (Permian Basin)
 *   Beaumont != Port Arthur       (Golden Triangle)
 * Each pair shares a labor market, a metro label and often a single recruiter,
 * and merging any of them would silently relocate a real crew call. A shared
 * region is a reason to record the region, never a licence to collapse the
 * cities into one.
 *
 * Everything here is pure and explicit-text-only, matching
 * electrical-role-recognition.ts's discipline: a field is populated ONLY when
 * the source's own text states it. An unparseable location is preserved
 * verbatim in `raw` with the structured fields left null -- never guessed,
 * never dropped.
 */
export const LOCATION_NORMALIZATION_RULE_VERSION="location-normalization@1.0.0";

export interface NormalizedLocation{
  /** Exactly what the source stated, whitespace-collapsed only. Never null when
   * the source supplied any text at all -- this is the audit trail. */
  raw:string|null;
  /** A named jobsite/facility/plant the source named as such. Never derived
   * from the city, and never the other way round. */
  jobsite:string|null;
  city:string|null;
  /** State / province / region code exactly as the source wrote it (TX, ON,
   * VA...). Only ever populated from a token the source actually printed. */
  state:string|null;
  /** Only when the source's own text names a region. Never inferred from the
   * city -- knowing Midland sits in the Permian Basin does NOT let this module
   * write "Permian Basin" into a record the source never said it in. */
  region:string|null;
  country:string|null;
  /** True when the source's own listing row said this posting covers further
   * locations it did not enumerate (SuccessFactors prints "+2 more…"). Recording
   * the fact is honest; inventing the extra places would not be. */
  additionalLocationsIndicated:boolean;
  ruleVersion:string;
}

const US_STATES=new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);

/** Tokens that occupy the location slot but name no place at all. Treating
 * "Remote" as a city would put a crew somewhere that does not exist. */
const NON_PLACE=new Set(["REMOTE","VARIOUS","MULTIPLE","MULTIPLE LOCATIONS","ANYWHERE","TBD","N/A"]);

/** Postal/ZIP shapes the real sources in this portfolio print: US ZIP and
 * ZIP+4, Canadian and Polish codes, and bare numeric international codes. */
const POSTAL_RE=/^(?:\d{4,10}|\d{5}-\d{4}|\d{2}-\d{3}|[A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i;
const REGION_CODE_RE=/^[A-Z]{2,3}$/;

const clean=(v:string|null|undefined):string|null=>{
  if(typeof v!=="string")return null;
  const t=v.replace(/\s+/g," ").trim().replace(/^[\s,–—-]+|[\s,–—-]+$/g,"").trim();
  return t.length>0?t:null;
};

/**
 * Parses ONLY the shapes real sources in this portfolio actually emit, verified
 * against live captures on 2026-08-29:
 *   "Midland, TX"                -> city Midland, state TX          (Strike)
 *   "Houston, TX"                -> city Houston, state TX          (Trillium)
 *   "Pecos, TX, US"              -> city Pecos, state TX, ctry US   (Bechtel)
 *   "Reston, VA, US, 20190"      -> city Reston, state VA, ctry US  (Bechtel)
 *   "Toronto, ON, CA, M5J 2S1"   -> city Toronto, state ON, ctry CA (Bechtel)
 *   "Santiago, CL, 8320000"      -> city Santiago, country CL       (Bechtel)
 *   "Houston, TX, US, 77056 +2 more..." -> as above, additional flag set
 *   "US" / "Remote"              -> no city, no state; raw preserved
 * Ambiguity between a US state code and a country code (CA, IN, TN) is resolved
 * POSITIONALLY -- by where the source put the token -- never by guessing which
 * reading is more likely. Anything unrecognised keeps `raw` and leaves the
 * structured fields null rather than forcing a parse.
 */
export function parsePostingLocation(text:string|null|undefined):NormalizedLocation{
  let raw=clean(text);
  const base:NormalizedLocation={raw,jobsite:null,city:null,state:null,region:null,country:null,additionalLocationsIndicated:false,ruleVersion:LOCATION_NORMALIZATION_RULE_VERSION};
  if(!raw)return base;

  // "+2 more..." means the row itself declined to enumerate the rest.
  const more=/\s*\+\s*\d+\s*more\s*(?:…|\.\.\.)?\s*$/i;
  const additionalLocationsIndicated=more.test(raw);
  if(additionalLocationsIndicated)raw=clean(raw.replace(more,""))??raw;

  const parts=raw.split(",").map(p=>clean(p)).filter((p):p is string=>p!==null);
  if(parts.length===0)return{...base,raw,additionalLocationsIndicated};

  if(parts.length>1&&POSTAL_RE.test(parts[parts.length-1]))parts.pop();

  let country:string|null=null,state:string|null=null;
  if(parts.length>=3){
    const c=parts[parts.length-1],s=parts[parts.length-2];
    if(REGION_CODE_RE.test(c)&&REGION_CODE_RE.test(s)){country=c.toUpperCase();state=s.toUpperCase();parts.length-=2}
  }
  if(country===null&&parts.length===2){
    const last=parts[1];
    if(US_STATES.has(last.toUpperCase())){state=last.toUpperCase();parts.pop()}
    else if(REGION_CODE_RE.test(last)){country=last.toUpperCase();parts.pop()}
  }
  if(country===null&&state===null&&parts.length===1&&REGION_CODE_RE.test(parts[0])&&!NON_PLACE.has(parts[0].toUpperCase())){
    country=parts[0].toUpperCase();parts.pop();
  }

  const cityText=parts.join(", ");
  const city=cityText&&!NON_PLACE.has(cityText.toUpperCase())?clean(cityText):null;
  return{...base,raw,city,state,country,additionalLocationsIndicated};
}

/**
 * Builds a location record that keeps a named jobsite and a posting location
 * as independent facts. Neither is ever copied into the other: an IBEW job
 * call naming jobsite "Foxconn" with no city stated yields city=null, and a
 * Strike listing naming "Midland, TX" with no jobsite yields jobsite=null.
 */
export function normalizeListingLocation(input:{jobsite?:string|null;postingLocation?:string|null;region?:string|null}):NormalizedLocation{
  const parsed=parsePostingLocation(input.postingLocation);
  const jobsite=clean(input.jobsite);
  const region=clean(input.region);
  return{
    ...parsed,
    // `raw` must still reflect what the source said about location. When only a
    // jobsite was stated, raw stays null rather than borrowing the jobsite --
    // a jobsite name is not a location claim.
    jobsite,
    region,
    ruleVersion:LOCATION_NORMALIZATION_RULE_VERSION
  };
}

/**
 * Strict identity. Two locations are the same place only when their explicitly
 * stated city and state match exactly (case-insensitively). Missing fields
 * never match: an unknown city is not "the same as" a known one. There is
 * deliberately NO distance heuristic, NO metro-area table and NO alias list --
 * adding one is how Temple silently becomes Belton.
 */
export function locationsAreSamePlace(a:NormalizedLocation,b:NormalizedLocation):boolean{
  if(!a.city||!b.city)return false;
  if(a.city.toLowerCase()!==b.city.toLowerCase())return false;
  if(a.state&&b.state)return a.state.toUpperCase()===b.state.toUpperCase();
  // One side stated a state and the other did not: genuinely unresolved, so
  // this is not an assertion of sameness.
  return !a.state&&!b.state;
}

/**
 * The pairs this program has already been burned by. Exported so tests can
 * assert, against the real function, that none of them ever merge. This is
 * documentation with teeth, not a lookup table the code consults.
 */
export const NEVER_MERGE_EXEMPLARS:readonly (readonly [string,string])[]=[
  ["Temple, TX","Belton, TX"],
  ["Belton, TX","Killeen, TX"],
  ["Temple, TX","Killeen, TX"],
  ["Midland, TX","Odessa, TX"],
  ["Beaumont, TX","Port Arthur, TX"]
];

/** Stable, human-readable rendering that never fabricates absent parts. */
export function formatLocation(loc:NormalizedLocation):string|null{
  const parts=[loc.city,loc.state].filter((v):v is string=>!!v);
  if(parts.length>0)return parts.join(", ");
  return loc.raw;
}
