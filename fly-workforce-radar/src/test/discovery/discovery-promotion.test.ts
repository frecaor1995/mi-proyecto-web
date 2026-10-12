import{describe,expect,it}from"vitest";
import type{DemandSignal}from"../../domain/demand-signal";
import{evaluateDemandSignalForTracking,promoteDemandSignals,promotionEvidenceText}from"../../domain/discovery-promotion";
import{qualificationDossiers}from"../../server/services/opportunity-qualification/opportunity-qualification-service";

/**
 * Phase 2R-A item G. Network-independent: every DemandSignal below is a
 * hand-built fixture. Proves the promotion rule (explicit electrician-family
 * evidence is sufficient, everything else may be UNKNOWN), its negative case,
 * its idempotence, and -- critically -- its ISOLATION from the existing
 * five-dossier tracked-opportunity list.
 */

const OBSERVED_AT=new Date("2026-08-29T12:00:00Z");

/** Every optional field is UNKNOWN/null by default. Tests opt in explicitly. */
const signal=(over:Partial<DemandSignal>&{externalId:string}):DemandSignal=>({
  id:`demand-signal:${over.externalId}`,
  sourceKey:"fixture-source",
  sourceUrl:`https://example.invalid/listing#${over.externalId}`,
  title:null,
  organization:null,
  location:null,
  project:null,
  buyerCandidate:null,
  af01Candidate:null,
  contactPerson:null,
  observedAt:OBSERVED_AT,
  input:{sector:"UNKNOWN",role:"UNKNOWN",hoursPerWeek:null,hasOvertime:false,hasPerDiem:false,duration:"UNKNOWN",headcount:null},
  tier:"LOW_SIGNAL",
  ruleVersion:"demand-signal-priority@1.0.0",
  reasons:["no explicit high-value signal fields present"],
  ...over
});

describe("Phase 2R-A promotion: explicit electrical evidence is sufficient on its own",()=>{
  const bare=signal({externalId:"bare-electrician",title:"Journeyman Electrician"});

  it("promotes with buyer, AF-01, contact, project, headcount and economics ALL unknown",()=>{
    expect(bare.buyerCandidate).toBeNull();
    expect(bare.af01Candidate).toBeNull();
    expect(bare.contactPerson).toBeNull();
    expect(bare.project).toBeNull();
    expect(bare.organization).toBeNull();
    expect(bare.input.headcount).toBeNull();
    expect(bare.input.hoursPerWeek).toBeNull();
    expect(bare.input.hasPerDiem).toBe(false);
    expect(bare.input.duration).toBe("UNKNOWN");
    expect(bare.input.sector).toBe("UNKNOWN");

    const d=evaluateDemandSignalForTracking(bare);
    expect(d.promoted).toBe(true);
    expect(d.recognizedRoles).toEqual(["JOURNEYMAN_ELECTRICIAN"]);
    expect(d.reasons[0]).toMatch(/explicit electrician-family role/);
  });

  it("promotes on the LOWEST priority tier -- tier is not a promotion gate, and promotion never rewrites it",()=>{
    expect(bare.tier).toBe("LOW_SIGNAL");
    const{tracked}=promoteDemandSignals([bare]);
    expect(tracked).toHaveLength(1);
    expect(tracked[0].tier).toBe("LOW_SIGNAL");
    expect(tracked[0].trackedId).toBe("tracked-discovery:bare-electrician");
    expect(tracked[0].observedAt).toEqual(OBSERVED_AT);
  });

  it("promotes each of the newly recognized non-journeyman craft roles too",()=>{
    for(const[externalId,title,role]of[
      ["s-foreman","Electrical Foreman",  "ELECTRICAL_FOREMAN"],
      ["s-gf","Electrical General Foreman","ELECTRICAL_GENERAL_FOREMAN"],
      ["s-super","Electrical Superintendent","ELECTRICAL_SUPERINTENDENT"],
      ["s-fieldsuper","Field Superintendent - Electrical","ELECTRICAL_FIELD_SUPERINTENDENT"],
      ["s-appr","Apprentice Electrician","ELECTRICAL_APPRENTICE"],
      ["s-lic","Licensed Journeyman Electrician","LICENSED_JOURNEYMAN_ELECTRICIAN"]
    ]as const){
      const d=evaluateDemandSignalForTracking(signal({externalId,title}));
      expect(d.promoted).toBe(true);
      expect(d.recognizedRoles).toEqual([role]);
    }
  });

  it("reads the role from the project/description text as well as the title",()=>{
    const d=evaluateDemandSignalForTracking(signal({externalId:"in-description",title:"Project 1000002",project:"Electrical Service Upgrade - Journeyman Electrician crew required for panel replacement"}));
    expect(d.promoted).toBe(true);
  });
});

describe("Phase 2R-A promotion: no explicit electrical role means no promotion",()=>{
  const NON_PROMOTING:[string,Partial<DemandSignal>][]=[
    ["a non-electrical procurement row",{title:"Trail Bridge Replacements",project:"Trail Bridge Replacements"}],
    ["an electrical ENGINEER posting",{title:"Port Arthur Electrical Field Engineer TX 77641"}],
    ["an electronics technician posting",{title:"Electronics Technician II"}],
    ["a mechanical-only equipment mechanic",{title:"Heavy Equipment Mechanic - hydraulics and diesel"}],
    ["a data-center IT/software posting",{title:"Data Center Technician",project:"Server rack installs and IT hardware support"}],
    ["a bare 'electrical' adjective with no craft role",{title:"Electrical Service Upgrade",project:"Panel replacement bid package"}],
    ["a signal with no text at all",{}]
  ];
  for(const[label,over]of NON_PROMOTING)
    it(`does not promote ${label}`,()=>{
      const s=signal({externalId:`neg-${label.replace(/\W+/g,"-")}`,...over});
      const d=evaluateDemandSignalForTracking(s);
      expect(d.promoted).toBe(false);
      expect(d.recognizedRoles).toEqual([]);
      expect(promoteDemandSignals([s]).tracked).toHaveLength(0);
    });

  it("an employer whose NAME is an electrical contractor is never enough on its own -- organization is excluded from the evidence text",()=>{
    const s=signal({externalId:"employer-identity-only",organization:"Rosendin Electric",title:"Project Controls Analyst"});
    expect(promotionEvidenceText(s)).not.toMatch(/Rosendin/);
    expect(evaluateDemandSignalForTracking(s).promoted).toBe(false);
  });
  it("a high tier alone never promotes a signal whose text states no electrician role",()=>{
    const s=signal({externalId:"tier-without-role",title:"Data Center Technician",tier:"HIGH_VALUE_DATA_CENTER_MANPOWER",input:{sector:"DATA_CENTER",role:"OTHER",hoursPerWeek:70,hasOvertime:true,hasPerDiem:true,duration:"LONG_TERM",headcount:200}});
    expect(evaluateDemandSignalForTracking(s).promoted).toBe(false);
  });
});

describe("Phase 2R-A promotion: idempotence",()=>{
  const a=signal({externalId:"idem-a",title:"Journeyman Electrician"});
  const b=signal({externalId:"idem-b",title:"Electrical Foreman"});
  const noise=signal({externalId:"idem-noise",title:"Trail Bridge Replacements"});

  it("the same signal twice within one batch does not double-promote",()=>{
    const{tracked,decisions}=promoteDemandSignals([a,a,b,noise]);
    expect(tracked).toHaveLength(2);
    expect(tracked.map(t=>t.externalId)).toEqual(["idem-a","idem-b"]);
    expect(new Set(tracked.map(t=>t.trackedId)).size).toBe(2);
    // A decision is still recorded per input signal -- dedupe is on the
    // tracked set, not on the audit trail.
    expect(decisions).toHaveLength(4);
  });
  it("re-running the scan and carrying the prior tracked set forward does not double-promote",()=>{
    const first=promoteDemandSignals([a,b,noise]);
    const second=promoteDemandSignals([a,b,noise],first.tracked);
    expect(second.tracked).toHaveLength(2);
    expect(second.tracked.map(t=>t.externalId)).toEqual(first.tracked.map(t=>t.externalId));
    const third=promoteDemandSignals([a,b,noise],second.tracked);
    expect(third.tracked).toEqual(second.tracked);
  });
  it("a re-observed signal with a different id but the SAME externalId is still one tracked record",()=>{
    const rescanned:DemandSignal={...a,id:"demand-signal:idem-a:rescan-2"};
    const{tracked}=promoteDemandSignals([a,rescanned]);
    expect(tracked).toHaveLength(1);
  });
  it("is pure: the same input batch yields a deeply equal result every time",()=>{
    expect(promoteDemandSignals([a,b,noise])).toEqual(promoteDemandSignals([a,b,noise]));
  });
});

describe("Phase 2R-A promotion boundary: isolated from the existing tracked-opportunity list",()=>{
  it("promoting signals does not create a sixth qualification dossier",()=>{
    expect(qualificationDossiers()).toHaveLength(5);
    promoteDemandSignals([signal({externalId:"iso-1",title:"Journeyman Electrician"}),signal({externalId:"iso-2",title:"Electrical Superintendent"})]);
    expect(qualificationDossiers()).toHaveLength(5);
  });
  it("tracked-discovery ids live in their own namespace and collide with no qualification dossier id",()=>{
    const{tracked}=promoteDemandSignals([signal({externalId:"iso-3",title:"Journeyman Electrician"})]);
    const dossierIds=new Set(qualificationDossiers().map(d=>d.id));
    for(const t of tracked){
      expect(t.trackedId.startsWith("tracked-discovery:")).toBe(true);
      expect(dossierIds.has(t.trackedId)).toBe(false);
    }
  });
  it("no automatic outreach: promotion applies to, contacts, or submits nothing",()=>{
    const{tracked}=promoteDemandSignals([signal({externalId:"iso-4",title:"Journeyman Electrician"})]);
    expect(JSON.stringify(tracked)).not.toMatch(/applied|submitted|contacted/i);
  });
  it("promotion never invents buyer, AF-01 or contact fields -- they are absent from the tracked record entirely",()=>{
    const{tracked}=promoteDemandSignals([signal({externalId:"iso-5",title:"Journeyman Electrician"})]);
    const record=tracked[0]as unknown as Record<string,unknown>;
    expect(record).not.toHaveProperty("buyerCandidate");
    expect(record).not.toHaveProperty("af01Candidate");
    expect(record).not.toHaveProperty("contactPerson");
  });
});
