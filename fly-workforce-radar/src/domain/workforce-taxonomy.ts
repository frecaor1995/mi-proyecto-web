/**
 * Phase 3X Multi-Trade / Multi-Profession Architecture: canonical workforce
 * taxonomy. Electrical remains the first supported trade and its existing,
 * frozen recognition module (electrical-role-recognition.ts) is untouched;
 * this module gives the rest of the platform stable, trade-agnostic IDs so a
 * second, third, or tenth trade can be added by extending a seed catalog
 * rather than by building a parallel pipeline.
 *
 * Conceptual model: INDUSTRY -> DISCIPLINE -> TRADE -> OCCUPATION ->
 * SPECIALTY / SKILL / CREDENTIAL. Not every occupation needs every level
 * populated (a welder may have no jurisdictional license; an electrician
 * often does) -- optionality is modeled explicitly via nullable/empty
 * fields, never defaulted or inferred.
 */
export const WORKFORCE_TAXONOMY_RULE_VERSION="workforce-taxonomy@1.0.0";

export const WORKFORCE_ROLE_CLASSES=["CRAFT","TECHNICIAN","SUPERVISION","MANAGEMENT","ENGINEERING","PROFESSIONAL","SUPPORT","UNKNOWN"]as const;
export type WorkforceRoleClass=(typeof WORKFORCE_ROLE_CLASSES)[number];

export const INDUSTRIES=["CONSTRUCTION","INDUSTRIAL","MECHANICAL","TECHNOLOGY","ENERGY"]as const;
export type IndustryId=(typeof INDUSTRIES)[number];

export const DISCIPLINES=["ELECTRICAL","HVAC_MECHANICAL","PLUMBING_PIPEFITTING","WELDING","MILLWRIGHT","INSTRUMENTATION_CONTROLS","LOW_VOLTAGE_TELECOM_FIBER","SOLAR_BATTERY_RENEWABLE","INDUSTRIAL_CONSTRUCTION_CRAFTS","CONSTRUCTION_SUPERVISION_FIELD_MANAGEMENT"]as const;
export type DisciplineId=(typeof DISCIPLINES)[number];

export interface DisciplineDefinition{id:DisciplineId;industryId:IndustryId;label:string}
export const DISCIPLINE_CATALOG:Record<DisciplineId,DisciplineDefinition>={
  ELECTRICAL:{id:"ELECTRICAL",industryId:"CONSTRUCTION",label:"Electrical"},
  HVAC_MECHANICAL:{id:"HVAC_MECHANICAL",industryId:"MECHANICAL",label:"HVAC / Mechanical"},
  PLUMBING_PIPEFITTING:{id:"PLUMBING_PIPEFITTING",industryId:"MECHANICAL",label:"Plumbing / Pipefitting"},
  WELDING:{id:"WELDING",industryId:"INDUSTRIAL",label:"Welding"},
  MILLWRIGHT:{id:"MILLWRIGHT",industryId:"INDUSTRIAL",label:"Millwright"},
  INSTRUMENTATION_CONTROLS:{id:"INSTRUMENTATION_CONTROLS",industryId:"INDUSTRIAL",label:"Instrumentation & Controls"},
  LOW_VOLTAGE_TELECOM_FIBER:{id:"LOW_VOLTAGE_TELECOM_FIBER",industryId:"TECHNOLOGY",label:"Low Voltage / Telecom / Fiber"},
  SOLAR_BATTERY_RENEWABLE:{id:"SOLAR_BATTERY_RENEWABLE",industryId:"ENERGY",label:"Solar / Battery / Renewable Energy"},
  INDUSTRIAL_CONSTRUCTION_CRAFTS:{id:"INDUSTRIAL_CONSTRUCTION_CRAFTS",industryId:"INDUSTRIAL",label:"Industrial Construction Crafts"},
  CONSTRUCTION_SUPERVISION_FIELD_MANAGEMENT:{id:"CONSTRUCTION_SUPERVISION_FIELD_MANAGEMENT",industryId:"CONSTRUCTION",label:"Construction Supervision / Field Management"},
};

export const TRADES=["ELECTRICAL","HVAC","PLUMBING","PIPEFITTING","WELDING","MILLWRIGHT","INSTRUMENTATION_CONTROLS","LOW_VOLTAGE","FIBER","SOLAR","BATTERY_ESS","GENERAL_CRAFT","FIELD_MANAGEMENT"]as const;
export type TradeId=(typeof TRADES)[number];

export interface TradeDefinition{id:TradeId;disciplineId:DisciplineId;label:string}
export const TRADE_CATALOG:Record<TradeId,TradeDefinition>={
  ELECTRICAL:{id:"ELECTRICAL",disciplineId:"ELECTRICAL",label:"Electrical"},
  HVAC:{id:"HVAC",disciplineId:"HVAC_MECHANICAL",label:"HVAC"},
  PLUMBING:{id:"PLUMBING",disciplineId:"PLUMBING_PIPEFITTING",label:"Plumbing"},
  PIPEFITTING:{id:"PIPEFITTING",disciplineId:"PLUMBING_PIPEFITTING",label:"Pipefitting"},
  WELDING:{id:"WELDING",disciplineId:"WELDING",label:"Welding"},
  MILLWRIGHT:{id:"MILLWRIGHT",disciplineId:"MILLWRIGHT",label:"Millwright"},
  INSTRUMENTATION_CONTROLS:{id:"INSTRUMENTATION_CONTROLS",disciplineId:"INSTRUMENTATION_CONTROLS",label:"Instrumentation & Controls"},
  LOW_VOLTAGE:{id:"LOW_VOLTAGE",disciplineId:"LOW_VOLTAGE_TELECOM_FIBER",label:"Low Voltage"},
  FIBER:{id:"FIBER",disciplineId:"LOW_VOLTAGE_TELECOM_FIBER",label:"Fiber"},
  SOLAR:{id:"SOLAR",disciplineId:"SOLAR_BATTERY_RENEWABLE",label:"Solar"},
  BATTERY_ESS:{id:"BATTERY_ESS",disciplineId:"SOLAR_BATTERY_RENEWABLE",label:"Battery / ESS"},
  GENERAL_CRAFT:{id:"GENERAL_CRAFT",disciplineId:"INDUSTRIAL_CONSTRUCTION_CRAFTS",label:"General Craft"},
  FIELD_MANAGEMENT:{id:"FIELD_MANAGEMENT",disciplineId:"CONSTRUCTION_SUPERVISION_FIELD_MANAGEMENT",label:"Field Management"},
};

export const OCCUPATIONS=[
  "ELECTRICIAN","ELECTRICAL_FOREMAN","ELECTRICAL_SUPERINTENDENT","ELECTRICAL_ENGINEER","ELECTRICAL_ESTIMATOR",
  "HVAC_TECHNICIAN","HVAC_PROJECT_MANAGER",
  "PLUMBER","PLUMBING_ESTIMATOR",
  "PIPEFITTER","PIPEFITTING_SUPERINTENDENT",
  "WELDER","WELDING_ENGINEER","WELDING_INSPECTOR",
  "MILLWRIGHT_CRAFT",
  "INSTRUMENTATION_TECHNICIAN",
  "LOW_VOLTAGE_TECHNICIAN",
  "FIBER_TECHNICIAN","FIBER_PROJECT_MANAGER",
  "SOLAR_INSTALLER","SOLAR_PROJECT_MANAGER",
  "BATTERY_ESS_TECHNICIAN",
  "GENERAL_CRAFT_LABORER",
  "GENERAL_SUPERINTENDENT","PROJECT_MANAGER",
]as const;
export type OccupationId=(typeof OCCUPATIONS)[number];

export interface OccupationDefinition{id:OccupationId;tradeId:TradeId;roleClass:WorkforceRoleClass;label:string;specialtyIds:SpecialtyId[];skillIds:SkillId[];credentialTypeIds:CredentialTypeId[]}

export const SPECIALTIES=["JOURNEYMAN","APPRENTICE","INDUSTRIAL_ELECTRICAL","COMMERCIAL_HVAC","COMBO_WELDER","FIBER_SPLICING"]as const;
export type SpecialtyId=(typeof SPECIALTIES)[number];

export const SKILLS=["INDUSTRIAL","TIG","SMAW","CONTROLS","SPLICING"]as const;
export type SkillId=(typeof SKILLS)[number];

export const CREDENTIAL_TYPES=["LICENSE","OSHA","CERTIFICATION","EPA_CFC"]as const;
export type CredentialTypeId=(typeof CREDENTIAL_TYPES)[number];

/**
 * Bounded initial seed catalog (Phase 3X section 7): at least the ten listed
 * trade families, each with at least one representative occupation. This is
 * deliberately NOT an exhaustive global occupation database -- it is an
 * extensible architecture plus a controlled starting set. Adding a new
 * occupation is a catalog edit, not an architecture change.
 */
export const OCCUPATION_CATALOG:Record<OccupationId,OccupationDefinition>={
  ELECTRICIAN:{id:"ELECTRICIAN",tradeId:"ELECTRICAL",roleClass:"CRAFT",label:"Electrician",specialtyIds:["JOURNEYMAN","APPRENTICE","INDUSTRIAL_ELECTRICAL"],skillIds:["INDUSTRIAL"],credentialTypeIds:["LICENSE","OSHA"]},
  ELECTRICAL_FOREMAN:{id:"ELECTRICAL_FOREMAN",tradeId:"ELECTRICAL",roleClass:"SUPERVISION",label:"Electrical Foreman",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},
  ELECTRICAL_SUPERINTENDENT:{id:"ELECTRICAL_SUPERINTENDENT",tradeId:"ELECTRICAL",roleClass:"SUPERVISION",label:"Electrical Superintendent",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},
  ELECTRICAL_ENGINEER:{id:"ELECTRICAL_ENGINEER",tradeId:"ELECTRICAL",roleClass:"ENGINEERING",label:"Electrical Engineer",specialtyIds:[],skillIds:[],credentialTypeIds:[]},
  ELECTRICAL_ESTIMATOR:{id:"ELECTRICAL_ESTIMATOR",tradeId:"ELECTRICAL",roleClass:"SUPPORT",label:"Electrical Estimator",specialtyIds:[],skillIds:[],credentialTypeIds:[]},

  HVAC_TECHNICIAN:{id:"HVAC_TECHNICIAN",tradeId:"HVAC",roleClass:"TECHNICIAN",label:"HVAC Technician",specialtyIds:["COMMERCIAL_HVAC"],skillIds:["CONTROLS"],credentialTypeIds:["EPA_CFC"]},
  HVAC_PROJECT_MANAGER:{id:"HVAC_PROJECT_MANAGER",tradeId:"HVAC",roleClass:"MANAGEMENT",label:"HVAC Project Manager",specialtyIds:[],skillIds:[],credentialTypeIds:[]},

  PLUMBER:{id:"PLUMBER",tradeId:"PLUMBING",roleClass:"CRAFT",label:"Plumber",specialtyIds:[],skillIds:[],credentialTypeIds:["LICENSE"]},
  PLUMBING_ESTIMATOR:{id:"PLUMBING_ESTIMATOR",tradeId:"PLUMBING",roleClass:"SUPPORT",label:"Plumbing Estimator",specialtyIds:[],skillIds:[],credentialTypeIds:[]},

  PIPEFITTER:{id:"PIPEFITTER",tradeId:"PIPEFITTING",roleClass:"CRAFT",label:"Pipefitter",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},
  PIPEFITTING_SUPERINTENDENT:{id:"PIPEFITTING_SUPERINTENDENT",tradeId:"PIPEFITTING",roleClass:"SUPERVISION",label:"Pipefitting Superintendent",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},

  WELDER:{id:"WELDER",tradeId:"WELDING",roleClass:"CRAFT",label:"Welder",specialtyIds:["COMBO_WELDER"],skillIds:["TIG","SMAW"],credentialTypeIds:["CERTIFICATION"]},
  WELDING_ENGINEER:{id:"WELDING_ENGINEER",tradeId:"WELDING",roleClass:"ENGINEERING",label:"Welding Engineer",specialtyIds:[],skillIds:[],credentialTypeIds:[]},
  WELDING_INSPECTOR:{id:"WELDING_INSPECTOR",tradeId:"WELDING",roleClass:"PROFESSIONAL",label:"Welding Inspector",specialtyIds:[],skillIds:[],credentialTypeIds:["CERTIFICATION"]},

  MILLWRIGHT_CRAFT:{id:"MILLWRIGHT_CRAFT",tradeId:"MILLWRIGHT",roleClass:"CRAFT",label:"Millwright",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},

  INSTRUMENTATION_TECHNICIAN:{id:"INSTRUMENTATION_TECHNICIAN",tradeId:"INSTRUMENTATION_CONTROLS",roleClass:"TECHNICIAN",label:"Instrumentation Technician",specialtyIds:[],skillIds:["CONTROLS"],credentialTypeIds:["CERTIFICATION"]},

  LOW_VOLTAGE_TECHNICIAN:{id:"LOW_VOLTAGE_TECHNICIAN",tradeId:"LOW_VOLTAGE",roleClass:"TECHNICIAN",label:"Low Voltage Technician",specialtyIds:[],skillIds:[],credentialTypeIds:["CERTIFICATION"]},
  FIBER_TECHNICIAN:{id:"FIBER_TECHNICIAN",tradeId:"FIBER",roleClass:"TECHNICIAN",label:"Fiber Technician",specialtyIds:["FIBER_SPLICING"],skillIds:["SPLICING"],credentialTypeIds:["CERTIFICATION"]},
  FIBER_PROJECT_MANAGER:{id:"FIBER_PROJECT_MANAGER",tradeId:"FIBER",roleClass:"MANAGEMENT",label:"Fiber Project Manager",specialtyIds:[],skillIds:[],credentialTypeIds:[]},

  SOLAR_INSTALLER:{id:"SOLAR_INSTALLER",tradeId:"SOLAR",roleClass:"CRAFT",label:"Solar Installer",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},
  SOLAR_PROJECT_MANAGER:{id:"SOLAR_PROJECT_MANAGER",tradeId:"SOLAR",roleClass:"MANAGEMENT",label:"Solar Project Manager",specialtyIds:[],skillIds:[],credentialTypeIds:[]},
  BATTERY_ESS_TECHNICIAN:{id:"BATTERY_ESS_TECHNICIAN",tradeId:"BATTERY_ESS",roleClass:"TECHNICIAN",label:"Battery / ESS Technician",specialtyIds:[],skillIds:[],credentialTypeIds:["CERTIFICATION"]},

  GENERAL_CRAFT_LABORER:{id:"GENERAL_CRAFT_LABORER",tradeId:"GENERAL_CRAFT",roleClass:"CRAFT",label:"General Craft Laborer",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},

  GENERAL_SUPERINTENDENT:{id:"GENERAL_SUPERINTENDENT",tradeId:"FIELD_MANAGEMENT",roleClass:"SUPERVISION",label:"General Superintendent",specialtyIds:[],skillIds:[],credentialTypeIds:["OSHA"]},
  PROJECT_MANAGER:{id:"PROJECT_MANAGER",tradeId:"FIELD_MANAGEMENT",roleClass:"MANAGEMENT",label:"Project Manager",specialtyIds:[],skillIds:[],credentialTypeIds:[]},
};

/** Every field is optional except the resolution state itself: a real signal
 * may state only a title ("Electrician") with no specialty/skill/credential
 * language at all, and that must remain valid, not padded with guesses. */
export type WorkforceClassificationState="RECOGNIZED"|"CANDIDATE"|"UNKNOWN";
export interface WorkforceClassification{
  state:WorkforceClassificationState;
  industryId:IndustryId|null;
  disciplineId:DisciplineId|null;
  tradeId:TradeId|null;
  occupationId:OccupationId|null;
  roleClass:WorkforceRoleClass;
  specialtyIds:SpecialtyId[];
  skillIds:SkillId[];
  credentialIds:CredentialTypeId[];
}

export const UNKNOWN_WORKFORCE_CLASSIFICATION:WorkforceClassification={state:"UNKNOWN",industryId:null,disciplineId:null,tradeId:null,occupationId:null,roleClass:"UNKNOWN",specialtyIds:[],skillIds:[],credentialIds:[]};

/** Builds a RECOGNIZED classification purely from the seed catalog -- never
 * from inference. Unknown occupation ids are a programmer error, not a data
 * condition, so this throws rather than silently degrading to UNKNOWN. */
export function classificationForOccupation(occupationId:OccupationId,overrides:Partial<Pick<WorkforceClassification,"specialtyIds"|"skillIds"|"credentialIds">> ={}):WorkforceClassification{
  const occ=OCCUPATION_CATALOG[occupationId];
  const trade=TRADE_CATALOG[occ.tradeId];
  const discipline=DISCIPLINE_CATALOG[trade.disciplineId];
  return{
    state:"RECOGNIZED",
    industryId:discipline.industryId,
    disciplineId:discipline.id,
    tradeId:trade.id,
    occupationId:occ.id,
    roleClass:occ.roleClass,
    specialtyIds:overrides.specialtyIds??[],
    skillIds:overrides.skillIds??[],
    credentialIds:overrides.credentialIds??[],
  };
}
