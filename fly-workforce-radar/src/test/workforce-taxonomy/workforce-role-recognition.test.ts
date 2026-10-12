import{describe,expect,it}from"vitest";
import{DISCIPLINES,OCCUPATION_CATALOG,TRADE_CATALOG}from"../../domain/workforce-taxonomy";
import{hasAnyRecognizedWorkforceOccupation,recognizeWorkforceOccupations,recognizesOccupation}from"../../domain/workforce-role-recognition";

/**
 * Phase 3X. Network-independent: every fixture below is a hand-built title
 * string. Proves (a) the initial controlled multi-trade catalog exists and
 * is internally consistent, (b) the required cross-trade fixtures recognize
 * correctly with the right occupation AND the right role class, and (c) the
 * required false-positive fixtures do NOT collapse into the craft/technician
 * occupation that shares their discipline.
 */

describe("Phase 3X workforce taxonomy: catalog consistency",()=>{
  it("covers at least the ten required trade families",()=>{
    expect(DISCIPLINES.length).toBeGreaterThanOrEqual(10);
  });
  it("every occupation resolves to a trade that resolves to a discipline",()=>{
    for(const occ of Object.values(OCCUPATION_CATALOG)){
      expect(TRADE_CATALOG[occ.tradeId]).toBeDefined();
    }
  });
});

describe("Phase 3X controlled multi-trade fixtures (section 21)",()=>{
  const cases:[string,string,string][]=[
    ["Journeyman Electrician","ELECTRICIAN","CRAFT"],
    ["HVAC Technician","HVAC_TECHNICIAN","TECHNICIAN"],
    ["Plumber","PLUMBER","CRAFT"],
    ["Pipefitter","PIPEFITTER","CRAFT"],
    ["Combo Welder","WELDER","CRAFT"],
    ["Millwright","MILLWRIGHT_CRAFT","CRAFT"],
    ["Instrumentation Technician","INSTRUMENTATION_TECHNICIAN","TECHNICIAN"],
    ["I&E Technician","INSTRUMENTATION_TECHNICIAN","TECHNICIAN"],
    ["Low Voltage Technician","LOW_VOLTAGE_TECHNICIAN","TECHNICIAN"],
    ["Fiber Technician","FIBER_TECHNICIAN","TECHNICIAN"],
    ["Solar Installer","SOLAR_INSTALLER","CRAFT"],
    ["Battery Technician","BATTERY_ESS_TECHNICIAN","TECHNICIAN"],
    ["Electrical Superintendent","ELECTRICAL_SUPERINTENDENT","SUPERVISION"],
  ];
  for(const[title,occupationId,roleClass]of cases){
    it(`"${title}" recognizes as ${occupationId} (${roleClass})`,()=>{
      const r=recognizeWorkforceOccupations(title);
      const match=r.classifications.find(c=>c.occupationId===occupationId);
      expect(match).toBeDefined();
      expect(match?.roleClass).toBe(roleClass);
      expect(match?.state).toBe("RECOGNIZED");
    });
  }
});

describe("Phase 3X required false-positive tests (section 22)",()=>{
  it("Electrical Engineer != Electrician",()=>{
    expect(recognizesOccupation("Electrical Engineer","ELECTRICIAN")).toBe(false);
    expect(recognizesOccupation("Electrical Engineer","ELECTRICAL_ENGINEER")).toBe(true);
  });
  it("Electrical Estimator != Electrician",()=>{
    expect(recognizesOccupation("Electrical Estimator","ELECTRICIAN")).toBe(false);
  });
  it("Electrical Superintendent != Electrician craft",()=>{
    expect(recognizesOccupation("Electrical Superintendent","ELECTRICIAN")).toBe(false);
    const r=recognizeWorkforceOccupations("Electrical Superintendent");
    expect(r.classifications.every(c=>c.roleClass!=="CRAFT")).toBe(true);
  });
  it("Welding Engineer != Welder",()=>{
    expect(recognizesOccupation("Welding Engineer","WELDER")).toBe(false);
    expect(recognizesOccupation("Welding Engineer","WELDING_ENGINEER")).toBe(true);
  });
  it("Welding Inspector != Welder unless separately modeled",()=>{
    expect(recognizesOccupation("Welding Inspector","WELDER")).toBe(false);
    expect(recognizesOccupation("Welding Inspector","WELDING_INSPECTOR")).toBe(true);
  });
  it("Plumbing Estimator != Plumber",()=>{
    expect(recognizesOccupation("Plumbing Estimator","PLUMBER")).toBe(false);
  });
  it("Pipefitting Superintendent != Pipefitter craft",()=>{
    expect(recognizesOccupation("Pipefitting Superintendent","PIPEFITTER")).toBe(false);
  });
  it("HVAC Project Manager != HVAC Technician",()=>{
    expect(recognizesOccupation("HVAC Project Manager","HVAC_TECHNICIAN")).toBe(false);
  });
  it("Fiber Project Manager != Fiber Technician",()=>{
    expect(recognizesOccupation("Fiber Project Manager","FIBER_TECHNICIAN")).toBe(false);
  });
  it("Solar Project Manager != Solar Installer",()=>{
    expect(recognizesOccupation("Solar Project Manager","SOLAR_INSTALLER")).toBe(false);
  });
  it('generic "electrical work" != explicit electrician demand',()=>{
    expect(hasAnyRecognizedWorkforceOccupation("Electrical work needed for new build"))
      .toBe(false);
  });
  it('generic "mechanical work" != explicit HVAC technician demand',()=>{
    expect(hasAnyRecognizedWorkforceOccupation("Mechanical work needed on site"))
      .toBe(false);
  });
});

describe("Phase 3X ambiguous titles stay UNKNOWN (section 25)",()=>{
  for(const title of["Electrical Field Specialist","Mechanical Technician","Controls Specialist","Field Technician"]){
    it(`"${title}" is not auto-resolved to any occupation`,()=>{
      expect(hasAnyRecognizedWorkforceOccupation(title)).toBe(false);
    });
  }
});

describe("Phase 3X electrical bridge stays consistent with the frozen electrical module",()=>{
  it("bare 'Electrician' recognizes as ELECTRICIAN craft with no specialty",()=>{
    const r=recognizeWorkforceOccupations("Electrician");
    const match=r.classifications.find(c=>c.occupationId==="ELECTRICIAN");
    expect(match?.specialtyIds).toEqual([]);
  });
  it("'Journeyman Electrician' carries the JOURNEYMAN specialty",()=>{
    const r=recognizeWorkforceOccupations("Journeyman Electrician");
    const match=r.classifications.find(c=>c.occupationId==="ELECTRICIAN");
    expect(match?.specialtyIds).toContain("JOURNEYMAN");
  });
  it("nothing recognized when text is null/empty",()=>{
    expect(recognizeWorkforceOccupations(null).classifications).toEqual([]);
    expect(recognizeWorkforceOccupations("").classifications).toEqual([]);
  });
});
