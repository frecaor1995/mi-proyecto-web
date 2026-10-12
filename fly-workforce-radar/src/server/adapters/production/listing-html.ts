/**
 * Phase 2R-B: the small amount of HTML handling the four new listing-discovery
 * adapters genuinely share. Deliberately NOT a shared listing parser: live
 * inspection confirmed the four sources emit materially different markup
 * (IBEW 716 nests heading runs with no per-row URL, Strike uses a
 * list-group/<h3><a> pattern, Trillium an <a class="job_teaser_item"> card,
 * Bechtel a <tr class="data-row"> table), so each keeps its own parse() rather
 * than being forced through one artificial abstraction. Only entity decoding
 * and tag stripping are common, and only those live here.
 *
 * Consistent with the codebase convention established by tpwd-listing-adapter.ts
 * and public-source-adapter.ts: server-rendered HTML is handled with regex and
 * plain-text helpers, not a DOM library.
 */

const ENTITIES:Record<string,string>={
  "&mdash;":"—","&ndash;":"–","&nbsp;":" ","&amp;":"&","&quot;":'"',
  "&rsquo;":"’","&lsquo;":"‘","&ldquo;":"“","&rdquo;":"”",
  "&#8211;":"–","&#8212;":"—","&#8216;":"‘","&#8217;":"’",
  "&#8220;":"“","&#8221;":"”","&#39;":"'","&#x27;":"'","&apos;":"'","&lt;":"<","&gt;":">",
  "&hellip;":"…","&#8230;":"…"
};

/** Decodes the entity set these four real pages actually emit, plus numeric
 * escapes, then collapses whitespace. Unknown entities are left verbatim
 * rather than mangled. */
export const decodeEntities=(s:string):string=>{
  let out=s;
  for(const[k,v]of Object.entries(ENTITIES))out=out.split(k).join(v);
  out=out.replace(/&#(\d+);/g,(_,d)=>{const n=Number(d);return n>0&&n<0x110000?String.fromCodePoint(n):_});
  out=out.replace(/&#x([0-9a-f]+);/gi,(_,d)=>{const n=parseInt(d,16);return n>0&&n<0x110000?String.fromCodePoint(n):_});
  return out.replace(/\s+/g," ").trim();
};

/** Strips tags (and script/style bodies) from a fragment and decodes it. */
export const stripTags=(html:string):string=>decodeEntities(
  html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")
);

/** Removes only the noise regions before structural parsing, preserving the
 * element structure the adapters key on. */
export const stripNoise=(html:string):string=>html
  .replace(/<script[\s\S]*?<\/script>/gi," ")
  .replace(/<style[\s\S]*?<\/style>/gi," ")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi," ")
  .replace(/<!--[\s\S]*?-->/g," ");

/** Slug-safe stable-ID fragment. Never returns an empty string for non-empty
 * input, so external IDs stay distinguishable. */
export const slugify=(s:string,max=60):string=>{
  const base=s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  return(base.length>0?base:"x").slice(0,max).replace(/-+$/,"")||"x";
};

/** Parses an explicitly-stated integer count. Returns null for anything that
 * is not a plain non-negative integer -- never rounds, never infers, and never
 * treats an absent number as zero. */
export const explicitCount=(s:string|null|undefined):number|null=>{
  if(typeof s!=="string")return null;
  const t=s.trim();
  if(!/^\d{1,4}$/.test(t))return null;
  const n=Number(t);
  return Number.isInteger(n)?n:null;
};
