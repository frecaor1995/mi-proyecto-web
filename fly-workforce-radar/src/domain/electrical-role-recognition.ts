/**
 * Phase 2R-A Discovery Foundation. A NEW, standalone, pure classifier that
 * recognizes electrician-family craft roles from a source's own text.
 *
 * Why a new module rather than an edit to demand-signal-priority.ts: that
 * file's DemandSignalRole ("JOURNEYMAN_ELECTRICIAN"|"OTHER"|"UNKNOWN") and its
 * HIGH_VALUE_DATA_CENTER_MANPOWER tier logic are load-bearing for Phase 2Q's
 * accepted behaviour and must not change. This module is purely additive: it
 * widens what Radar can *recognize*, without widening or altering what the
 * existing tier rules *reward*. toDemandSignalRole() below is the only bridge,
 * and it is deliberately conservative.
 *
 * Hard rule, inherited from this codebase's existing discovery discipline: a
 * role is recognized ONLY when the supplied text explicitly names it. Nothing
 * here infers a role from employer identity, industry, geography, project
 * type, sector, licensing chatter, or the mere presence of the word
 * "electrical". Absence of an explicit phrase is always UNKNOWN, never a guess.
 */
export const ELECTRICAL_ROLE_RULE_VERSION="electrical-role-recognition@1.0.0";

export const ELECTRICAL_ROLES=[
  "LICENSED_JOURNEYMAN_ELECTRICIAN",
  "JOURNEYMAN_ELECTRICIAN",
  "ELECTRICAL_APPRENTICE",
  "ELECTRICAL_GENERAL_FOREMAN",
  "ELECTRICAL_FOREMAN",
  "ELECTRICAL_FIELD_SUPERINTENDENT",
  "ELECTRICAL_SUPERINTENDENT",
  "ELECTRICIAN"
]as const;
export type ElectricalRole=(typeof ELECTRICAL_ROLES)[number];

export interface ElectricalRoleMatch{role:ElectricalRole;phrase:string}
export interface ElectricalRoleRecognition{
  roles:ElectricalRole[];
  matches:ElectricalRoleMatch[];
  ruleVersion:string;
}

/**
 * Explicit phrase table. Every entry is a literal job-title phrase a source
 * can actually state, including the hyphenated/comma "<Title> - Electrical"
 * word order real career listings use (e.g. Bechtel's own live listing row
 * "Field Superintendent - Electrical"). Reversed word order is still EXPLICIT
 * text stating the role -- it is not an inference.
 *
 * Deliberately NOT present, so they can never match:
 *   - "engineer" in any form (electrical engineer / electrical field engineer)
 *   - "electronic"/"electronics" (electronics technician)
 *   - "technician", "mechanic", "millwright", "instrumentation"
 *   - any data-center / IT / software title
 * Word boundaries keep "electrician" from matching inside "electronics", and
 * no pattern matches the bare adjective "electrical" on its own.
 */
const SEP="\\s*[-\u2010\u2011\u2012\u2013\u2014,:]?\\s*";
const ROLE_PATTERNS:{role:ElectricalRole;pattern:RegExp}[]=[
  {role:"LICENSED_JOURNEYMAN_ELECTRICIAN",pattern:/\blicensed\s+journeyman\s+electricians?\b/i},
  {role:"LICENSED_JOURNEYMAN_ELECTRICIAN",pattern:/\bjourneyman\s+electricians?\s*\(\s*licensed\s*\)/i},
  {role:"JOURNEYMAN_ELECTRICIAN",pattern:/\bjourneyman\s+electricians?\b/i},
  // "Journeyman Wireman" is the IBEW dispatch system's own name for the same
  // craft role; it is explicit stated text, not an inference.
  {role:"JOURNEYMAN_ELECTRICIAN",pattern:/\bjourneyman\s+wirem(?:a|e)n\b/i},
  {role:"ELECTRICAL_APPRENTICE",pattern:/\belectrical\s+apprentices?\b/i},
  {role:"ELECTRICAL_APPRENTICE",pattern:/\bapprentice\s+electricians?\b/i},
  {role:"ELECTRICAL_GENERAL_FOREMAN",pattern:/\belectrical\s+general\s+foreman\b/i},
  {role:"ELECTRICAL_GENERAL_FOREMAN",pattern:new RegExp(`\\bgeneral\\s+foreman${SEP}electrical\\b`,"i")},
  {role:"ELECTRICAL_FOREMAN",pattern:/\belectrical\s+foreman\b/i},
  {role:"ELECTRICAL_FOREMAN",pattern:/\belectrician\s+foreman\b/i},
  {role:"ELECTRICAL_FOREMAN",pattern:new RegExp(`\\bforeman${SEP}electrical\\b`,"i")},
  {role:"ELECTRICAL_FIELD_SUPERINTENDENT",pattern:/\belectrical\s+field\s+superintendent\b/i},
  {role:"ELECTRICAL_FIELD_SUPERINTENDENT",pattern:new RegExp(`\\bfield\\s+superintendent${SEP}electrical\\b`,"i")},
  {role:"ELECTRICAL_SUPERINTENDENT",pattern:/\belectrical\s+superintendent\b/i},
  {role:"ELECTRICAL_SUPERINTENDENT",pattern:new RegExp(`\\bsuperintendent${SEP}electrical\\b`,"i")},
  {role:"ELECTRICIAN",pattern:/\belectricians?\b/i}
];

/**
 * A more specific recognized role suppresses the broader roles whose phrase it
 * literally contains, so output is minimal and deterministic: "Licensed
 * Journeyman Electrician" reports exactly one role, not three.
 */
const SUBSUMES:Partial<Record<ElectricalRole,ElectricalRole[]>>={
  LICENSED_JOURNEYMAN_ELECTRICIAN:["JOURNEYMAN_ELECTRICIAN","ELECTRICIAN"],
  JOURNEYMAN_ELECTRICIAN:["ELECTRICIAN"],
  ELECTRICAL_APPRENTICE:["ELECTRICIAN"],
  ELECTRICAL_GENERAL_FOREMAN:["ELECTRICAL_FOREMAN"],
  ELECTRICAL_FIELD_SUPERINTENDENT:["ELECTRICAL_SUPERINTENDENT"]
};

/** Journeyman-family roles, i.e. the subset the existing, unmodified
 * demand-signal-priority.ts already treats as "JOURNEYMAN_ELECTRICIAN". */
const JOURNEYMAN_FAMILY:ReadonlySet<ElectricalRole>=new Set<ElectricalRole>(["LICENSED_JOURNEYMAN_ELECTRICIAN","JOURNEYMAN_ELECTRICIAN"]);

/** Pure. Same text in, same result out; no I/O, no clock, no randomness. */
export function recognizeElectricalRoles(text:string|null|undefined):ElectricalRoleRecognition{
  const source=typeof text==="string"?text:"";
  const matches:ElectricalRoleMatch[]=[];
  const hit=new Set<ElectricalRole>();
  for(const{role,pattern}of ROLE_PATTERNS){
    const m=source.match(pattern);
    if(!m)continue;
    if(!hit.has(role)){hit.add(role);matches.push({role,phrase:m[0].trim()})}
  }
  const suppressed=new Set<ElectricalRole>();
  for(const role of hit)for(const broader of SUBSUMES[role]??[])suppressed.add(broader);
  const roles=ELECTRICAL_ROLES.filter(r=>hit.has(r)&&!suppressed.has(r));
  return{roles,matches:matches.filter(m=>roles.includes(m.role)),ruleVersion:ELECTRICAL_ROLE_RULE_VERSION};
}

/** Convenience predicate: did the text explicitly state ANY electrician-family
 * craft role? This is the single question Phase 2R-A's tracked-status
 * promotion rule asks. */
export function hasExplicitElectricalRole(text:string|null|undefined):boolean{
  return recognizeElectricalRoles(text).roles.length>0;
}

/**
 * Backward-compatible bridge to the EXISTING, unmodified DemandSignalRole
 * vocabulary in demand-signal-priority.ts. Deliberately conservative:
 *   - journeyman-family (incl. licensed) -> "JOURNEYMAN_ELECTRICIAN", exactly
 *     the value the existing tier logic already rewards;
 *   - any other explicitly recognized electrical craft role -> "OTHER", which
 *     honestly means "a role was explicitly stated and it is not the journeyman
 *     one" -- it does NOT widen the HIGH_VALUE_DATA_CENTER_MANPOWER tier;
 *   - nothing recognized -> "UNKNOWN", never a guess.
 */
export function toDemandSignalRole(roles:readonly ElectricalRole[]):"JOURNEYMAN_ELECTRICIAN"|"OTHER"|"UNKNOWN"{
  if(roles.some(r=>JOURNEYMAN_FAMILY.has(r)))return"JOURNEYMAN_ELECTRICIAN";
  if(roles.length>0)return"OTHER";
  return"UNKNOWN";
}
