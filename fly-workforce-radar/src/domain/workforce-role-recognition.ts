/**
 * Phase 3X Multi-Trade / Multi-Profession Architecture: generalized,
 * deterministic occupation recognition.
 *
 * This module does NOT replace electrical-role-recognition.ts. That module
 * stays exactly as-is and remains the single source of truth for electrical
 * craft/supervision phrase matching (its own frozen behaviour is load-bearing
 * for Phase 2Q/2R-A and is reused here as a bridge, not reimplemented).
 * This module widens recognition to the other Phase 3X seed trade families
 * using the identical discipline: a role is recognized ONLY when the
 * supplied text explicitly names it. Nothing here infers an occupation from
 * employer identity, industry, geography, sector, or the presence of a bare
 * discipline adjective ("electrical", "mechanical") on its own.
 *
 * False-positive control: engineering, estimating, inspection, and
 * project-management titles are modeled as their OWN occupations with their
 * own role class, never silently folded into the craft/technician
 * occupation whose discipline they share.
 */
import type{ElectricalRole}from"./electrical-role-recognition";
import{recognizeElectricalRoles}from"./electrical-role-recognition";
import type{OccupationId,SpecialtyId,WorkforceClassification}from"./workforce-taxonomy";
import{WORKFORCE_TAXONOMY_RULE_VERSION,classificationForOccupation}from"./workforce-taxonomy";

export const WORKFORCE_ROLE_RECOGNITION_RULE_VERSION="workforce-role-recognition@1.0.0";

export interface WorkforceRoleMatch{occupationId:OccupationId;phrase:string}
export interface WorkforceRoleRecognition{
  classifications:WorkforceClassification[];
  matches:WorkforceRoleMatch[];
  ruleVersion:string;
}

/** Bridges the frozen ElectricalRole vocabulary to the generalized taxonomy.
 * Craft/apprentice-family roles map to the ELECTRICIAN craft occupation;
 * foreman/superintendent-family roles map to their own SUPERVISION
 * occupations, never to the craft occupation (Phase 3X section 10). */
const ELECTRICAL_ROLE_TO_OCCUPATION:Record<ElectricalRole,{occupationId:OccupationId;specialtyIds:SpecialtyId[]}>={
  LICENSED_JOURNEYMAN_ELECTRICIAN:{occupationId:"ELECTRICIAN",specialtyIds:["JOURNEYMAN"]},
  JOURNEYMAN_ELECTRICIAN:{occupationId:"ELECTRICIAN",specialtyIds:["JOURNEYMAN"]},
  ELECTRICAL_APPRENTICE:{occupationId:"ELECTRICIAN",specialtyIds:["APPRENTICE"]},
  ELECTRICAL_GENERAL_FOREMAN:{occupationId:"ELECTRICAL_FOREMAN",specialtyIds:[]},
  ELECTRICAL_FOREMAN:{occupationId:"ELECTRICAL_FOREMAN",specialtyIds:[]},
  ELECTRICAL_FIELD_SUPERINTENDENT:{occupationId:"ELECTRICAL_SUPERINTENDENT",specialtyIds:[]},
  ELECTRICAL_SUPERINTENDENT:{occupationId:"ELECTRICAL_SUPERINTENDENT",specialtyIds:[]},
  ELECTRICIAN:{occupationId:"ELECTRICIAN",specialtyIds:[]},
};

interface NonElectricalRule{occupationId:OccupationId;pattern:RegExp;specialtyIds?:SpecialtyId[]}

/**
 * Explicit phrase table for the non-electrical Phase 3X seed families.
 * Deliberately excludes bare discipline adjectives ("mechanical", "solar")
 * and role-neutral generic titles ("field technician", "controls
 * specialist") so those remain UNKNOWN rather than guessed (Phase 3X
 * section 25). Engineer/estimator/inspector/project-manager phrases are
 * their own patterns mapped to their own non-craft occupation, so a title
 * containing both a discipline word and a management/engineering word never
 * resolves to the craft/technician occupation for that discipline.
 */
const NON_ELECTRICAL_RULES:NonElectricalRule[]=[
  {occupationId:"HVAC_PROJECT_MANAGER",pattern:/\bhvac\s+project\s+managers?\b/i},
  {occupationId:"HVAC_TECHNICIAN",pattern:/\b(?:commercial\s+)?hvac\s+tech(?:nician)?\b/i,specialtyIds:["COMMERCIAL_HVAC"]},
  {occupationId:"HVAC_TECHNICIAN",pattern:/\bhvac\s+tech(?:nician)?\b/i},

  {occupationId:"PLUMBING_ESTIMATOR",pattern:/\bplumbing\s+estimators?\b/i},
  {occupationId:"PLUMBER",pattern:/\bplumbers?\b/i},

  {occupationId:"PIPEFITTING_SUPERINTENDENT",pattern:/\bpipefitting\s+superintendents?\b/i},
  {occupationId:"PIPEFITTER",pattern:/\bpipe\s*fitters?\b/i},

  {occupationId:"WELDING_ENGINEER",pattern:/\bwelding\s+engineers?\b/i},
  {occupationId:"WELDING_INSPECTOR",pattern:/\bwelding\s+inspectors?\b/i},
  {occupationId:"WELDER",pattern:/\bcombo\s+welders?\b/i,specialtyIds:["COMBO_WELDER"]},
  {occupationId:"WELDER",pattern:/\b(?:pipe|structural)\s+welders?\b/i},
  {occupationId:"WELDER",pattern:/\bwelders?\b/i},

  {occupationId:"MILLWRIGHT_CRAFT",pattern:/\bmillwrights?\b/i},

  {occupationId:"INSTRUMENTATION_TECHNICIAN",pattern:/\binstrumentation\s+tech(?:nician)?\b/i},
  {occupationId:"INSTRUMENTATION_TECHNICIAN",pattern:/\bi\s*&\s*e\s+tech(?:nician)?\b/i},

  {occupationId:"LOW_VOLTAGE_TECHNICIAN",pattern:/\blow[\s-]?voltage\s+tech(?:nician)?\b/i},

  {occupationId:"FIBER_PROJECT_MANAGER",pattern:/\bfiber\s+project\s+managers?\b/i},
  {occupationId:"FIBER_TECHNICIAN",pattern:/\bfiber\s+splic(?:ing|er)s?\b/i,specialtyIds:["FIBER_SPLICING"]},
  {occupationId:"FIBER_TECHNICIAN",pattern:/\bfiber\s+tech(?:nician)?\b/i},

  {occupationId:"SOLAR_PROJECT_MANAGER",pattern:/\bsolar\s+project\s+managers?\b/i},
  {occupationId:"SOLAR_INSTALLER",pattern:/\bsolar\s+installers?\b/i},

  {occupationId:"BATTERY_ESS_TECHNICIAN",pattern:/\b(?:battery|ess|energy\s+storage)\s+tech(?:nician)?\b/i},

  {occupationId:"GENERAL_CRAFT_LABORER",pattern:/\b(?:general\s+)?craft\s+laborers?\b/i},

  {occupationId:"GENERAL_SUPERINTENDENT",pattern:/\bgeneral\s+superintendents?\b/i},
  {occupationId:"PROJECT_MANAGER",pattern:/\bproject\s+managers?\b/i},
];

const ELECTRICAL_ENGINEER_PATTERN=/\belectrical\s+engineers?\b/i;
const ELECTRICAL_ESTIMATOR_PATTERN=/\belectrical\s+estimators?\b/i;

/** Pure. Same text in, same result out; no I/O, no clock, no randomness. */
export function recognizeWorkforceOccupations(text:string|null|undefined):WorkforceRoleRecognition{
  const source=typeof text==="string"?text:"";
  const classifications:WorkforceClassification[]=[];
  const matches:WorkforceRoleMatch[]=[];
  const seen=new Set<OccupationId>();
  const add=(occupationId:OccupationId,phrase:string,specialtyIds:SpecialtyId[]=[])=>{
    if(seen.has(occupationId))return;
    seen.add(occupationId);
    classifications.push(classificationForOccupation(occupationId,{specialtyIds}));
    matches.push({occupationId,phrase:phrase.trim()});
  };

  const electrical=recognizeElectricalRoles(source);
  for(const m of electrical.matches){
    const bridge=ELECTRICAL_ROLE_TO_OCCUPATION[m.role];
    add(bridge.occupationId,m.phrase,bridge.specialtyIds);
  }
  const engineerMatch=source.match(ELECTRICAL_ENGINEER_PATTERN);
  if(engineerMatch)add("ELECTRICAL_ENGINEER",engineerMatch[0]);
  const estimatorMatch=source.match(ELECTRICAL_ESTIMATOR_PATTERN);
  if(estimatorMatch)add("ELECTRICAL_ESTIMATOR",estimatorMatch[0]);

  for(const rule of NON_ELECTRICAL_RULES){
    const m=source.match(rule.pattern);
    if(!m)continue;
    add(rule.occupationId,m[0],rule.specialtyIds??[]);
  }

  return{classifications,matches,ruleVersion:`${WORKFORCE_ROLE_RECOGNITION_RULE_VERSION}+${WORKFORCE_TAXONOMY_RULE_VERSION}`};
}

/** Convenience predicate: did the text explicitly state ANY recognized
 * occupation (any discipline, any role class)? */
export function hasAnyRecognizedWorkforceOccupation(text:string|null|undefined):boolean{
  return recognizeWorkforceOccupations(text).classifications.length>0;
}

/** Convenience predicate for a specific occupation, used by false-positive
 * tests to assert a title does NOT resolve to a given craft/technician
 * occupation even though it shares that occupation's discipline. */
export function recognizesOccupation(text:string|null|undefined,occupationId:OccupationId):boolean{
  return recognizeWorkforceOccupations(text).classifications.some(c=>c.occupationId===occupationId);
}
