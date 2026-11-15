import{describe,expect,it}from"vitest";
import{ELECTRICAL_ROLE_RULE_VERSION,hasExplicitElectricalRole,recognizeElectricalRoles,toDemandSignalRole}from"../../domain/electrical-role-recognition";
import{classifyDemandSignalPriority}from"../../domain/demand-signal-priority";

/**
 * Phase 2R-A item F. Network-independent: every input below is a hand-built
 * fixture string. Proves BOTH directions -- explicit positive recognition per
 * role, and explicit negative discrimination for every look-alike title the
 * brief calls out. No fixture is fetched, and no fixture depends on a live
 * source's current wording.
 */

describe("Phase 2R-A: positive recognition, one case per required role",()=>{
  const POSITIVES:[string,string,string][]=[
    ["electrician","Electrician needed for panel work","ELECTRICIAN"],
    ["journeyman electrician","Journeyman Electrician - Midland, TX","JOURNEYMAN_ELECTRICIAN"],
    ["licensed journeyman","Licensed Journeyman Electrician (Per Diem Offered) - Amarillo, Texas","LICENSED_JOURNEYMAN_ELECTRICIAN"],
    ["electrical apprentice","Electrical Apprentice wanted, TDLR registration required","ELECTRICAL_APPRENTICE"],
    ["electrical foreman","Electrical Foreman for substation package","ELECTRICAL_FOREMAN"],
    ["electrical general foreman","Electrical General Foreman, night shift","ELECTRICAL_GENERAL_FOREMAN"],
    ["electrical superintendent","Electrical Superintendent - refinery turnaround","ELECTRICAL_SUPERINTENDENT"],
    ["electrical field superintendent","Electrical Field Superintendent, Gulf Coast","ELECTRICAL_FIELD_SUPERINTENDENT"]
  ];
  for(const[label,text,expected]of POSITIVES)
    it(`recognizes ${label} from explicit text`,()=>{
      const r=recognizeElectricalRoles(text);
      expect(r.roles).toEqual([expected]);
      expect(r.matches).toHaveLength(1);
      expect(text.toLowerCase()).toContain(r.matches[0].phrase.toLowerCase());
      expect(r.ruleVersion).toBe(ELECTRICAL_ROLE_RULE_VERSION);
    });

  it("recognizes the reversed '<Title> - Electrical' word order real listings use, which is still explicit text",()=>{
    expect(recognizeElectricalRoles("Field Superintendent - Electrical").roles).toEqual(["ELECTRICAL_FIELD_SUPERINTENDENT"]);
    expect(recognizeElectricalRoles("Superintendent, Electrical").roles).toEqual(["ELECTRICAL_SUPERINTENDENT"]);
    expect(recognizeElectricalRoles("General Foreman - Electrical").roles).toEqual(["ELECTRICAL_GENERAL_FOREMAN"]);
    expect(recognizeElectricalRoles("Foreman - Electrical").roles).toEqual(["ELECTRICAL_FOREMAN"]);
  });
  it("recognizes 'Apprentice Electrician' as well as 'Electrical Apprentice'",()=>{
    expect(recognizeElectricalRoles("TDLR Apprentice Electrician (Per Diem Offered)").roles).toEqual(["ELECTRICAL_APPRENTICE"]);
  });
  it("recognizes journeyman wireman, the union dispatch term for the same craft role",()=>{
    expect(recognizeElectricalRoles("Journeyman Wireman call, 10 workers").roles).toEqual(["JOURNEYMAN_ELECTRICIAN"]);
  });
  it("is case-insensitive and plural-tolerant",()=>{
    expect(recognizeElectricalRoles("HIRING JOURNEYMAN ELECTRICIANS").roles).toEqual(["JOURNEYMAN_ELECTRICIAN"]);
    expect(recognizeElectricalRoles("electricians").roles).toEqual(["ELECTRICIAN"]);
  });
});

describe("Phase 2R-A: negative discrimination -- look-alike titles are NOT electricians",()=>{
  const NEGATIVES:[string,string][]=[
    ["electrical engineer","Electrical Engineer - power systems design"],
    ["electrical field engineer","Port Arthur Electrical Field Engineer TX 77641"],
    ["senior electrical engineering manager","Senior Electrical Engineering Manager"],
    ["electronics technician","Electronics Technician II, avionics bench"],
    ["electronic repair technician","Electronic Repair Technician, consumer devices"],
    ["equipment mechanic (mechanical only)","Heavy Equipment Mechanic - hydraulics and diesel"],
    ["millwright","Millwright / Industrial Mechanic, rotating equipment"],
    ["hvac mechanic","HVAC Mechanic, commercial chillers"],
    ["software engineer","Software Engineer, Data Center Automation Platform"],
    ["data center IT technician","Data Center Technician - server rack installs, IT hardware"],
    ["critical facilities IT role","Critical Facilities Engineer, data center IT operations"],
    ["bare adjective only","Electrical Service Upgrade - panel replacement project bid"],
    ["instrumentation technician","Instrumentation and Controls Technician"],
    ["empty and whitespace",""]
  ];
  for(const[label,text]of NEGATIVES)
    it(`does not recognize any electrician-family role in: ${label}`,()=>{
      const r=recognizeElectricalRoles(text);
      expect(r.roles).toEqual([]);
      expect(r.matches).toEqual([]);
      expect(hasExplicitElectricalRole(text)).toBe(false);
    });

  it("null/undefined input is UNKNOWN, never a guess",()=>{
    expect(recognizeElectricalRoles(null).roles).toEqual([]);
    expect(recognizeElectricalRoles(undefined).roles).toEqual([]);
  });
  it("'electrician' inside 'electronics' never matches -- word boundaries, not substrings",()=>{
    expect(recognizeElectricalRoles("electronics").roles).toEqual([]);
    expect(recognizeElectricalRoles("microelectronics assembly").roles).toEqual([]);
  });
});

describe("Phase 2R-A: a look-alike title does NOT suppress real electrician demand stated in the same text",()=>{
  it("data-center IT and software titles alongside an explicit electrician request still recognize the electrician",()=>{
    const text="Data Center Technician and Software Engineer openings. Separately, the site requires 20 Journeyman Electricians for switchgear installation.";
    expect(recognizeElectricalRoles(text).roles).toEqual(["JOURNEYMAN_ELECTRICIAN"]);
  });
  it("an electrical ENGINEER mentioned next to an electrical FOREMAN recognizes only the foreman",()=>{
    expect(recognizeElectricalRoles("Openings: Electrical Engineer (design) and Electrical Foreman (field)").roles).toEqual(["ELECTRICAL_FOREMAN"]);
  });
});

describe("Phase 2R-A: minimal, deterministic role output",()=>{
  it("a more specific role suppresses the broader phrase it literally contains",()=>{
    expect(recognizeElectricalRoles("Licensed Journeyman Electrician").roles).toEqual(["LICENSED_JOURNEYMAN_ELECTRICIAN"]);
    expect(recognizeElectricalRoles("Electrical General Foreman").roles).not.toContain("ELECTRICAL_FOREMAN");
    expect(recognizeElectricalRoles("Field Superintendent - Electrical").roles).not.toContain("ELECTRICAL_SUPERINTENDENT");
  });
  it("genuinely distinct roles in one text are all reported, in stable declaration order",()=>{
    const r=recognizeElectricalRoles("Crew needed: Journeyman Electrician, Electrical Apprentice, Electrical Foreman");
    expect(r.roles).toEqual(["JOURNEYMAN_ELECTRICIAN","ELECTRICAL_APPRENTICE","ELECTRICAL_FOREMAN"]);
  });
  it("is pure: identical input yields a deeply equal result every time",()=>{
    const text="Electrical Superintendent and Apprentice Electrician";
    expect(recognizeElectricalRoles(text)).toEqual(recognizeElectricalRoles(text));
  });
});

describe("Phase 2R-A: the bridge to the existing, unmodified DemandSignalRole vocabulary",()=>{
  it("journeyman-family maps to JOURNEYMAN_ELECTRICIAN, the value the existing tier logic already rewards",()=>{
    expect(toDemandSignalRole(recognizeElectricalRoles("Journeyman Electrician").roles)).toBe("JOURNEYMAN_ELECTRICIAN");
    expect(toDemandSignalRole(recognizeElectricalRoles("Licensed Journeyman Electrician").roles)).toBe("JOURNEYMAN_ELECTRICIAN");
  });
  it("other electrical craft roles map to OTHER, never silently widening the top tier",()=>{
    expect(toDemandSignalRole(recognizeElectricalRoles("Electrical Superintendent").roles)).toBe("OTHER");
    expect(toDemandSignalRole(recognizeElectricalRoles("Electrical Apprentice").roles)).toBe("OTHER");
  });
  it("nothing recognized maps to UNKNOWN",()=>{
    expect(toDemandSignalRole(recognizeElectricalRoles("Electrical Engineer").roles)).toBe("UNKNOWN");
  });
  it("the newly recognized non-journeyman roles cannot reach HIGH_VALUE_DATA_CENTER_MANPOWER -- the existing tier rules are unchanged",()=>{
    const r=classifyDemandSignalPriority({sector:"DATA_CENTER",role:toDemandSignalRole(recognizeElectricalRoles("Electrical Superintendent").roles),hoursPerWeek:70,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:200});
    expect(r.tier).not.toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
  it("a journeyman signal still reaches the top tier exactly as Phase 2Q established",()=>{
    const r=classifyDemandSignalPriority({sector:"DATA_CENTER",role:toDemandSignalRole(recognizeElectricalRoles("Licensed Journeyman Electrician").roles),hoursPerWeek:70,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:null});
    expect(r.tier).toBe("HIGH_VALUE_DATA_CENTER_MANPOWER");
  });
});
