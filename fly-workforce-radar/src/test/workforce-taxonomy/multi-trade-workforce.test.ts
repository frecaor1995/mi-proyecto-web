import{describe,expect,it}from"vitest";
import type{DemandSignal}from"../../domain/demand-signal";
import{evaluateDemandSignalForTracking}from"../../domain/discovery-promotion";
import{acceptanceCoversTrade,contactAuthorityCoversTrade,deriveProjectRef,evaluateDemandSignalForWorkforceTracking,groupWorkforceDemandsByProject,promoteWorkforceDemandSignals}from"../../domain/multi-trade-workforce";
import type{ScopedAcceptanceEvidence,ScopedContactAuthority,WorkforceDemandRecord}from"../../domain/multi-trade-workforce";
import{classificationForOccupation}from"../../domain/workforce-taxonomy";

const OBSERVED_AT=new Date("2026-08-30T12:00:00Z");

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

describe("Phase 3X generalized promotion stays consistent with the frozen electrical gate",()=>{
  it("a signal the frozen electrical promoter accepts is also accepted by the generalized promoter, as the same occupation",()=>{
    const s=signal({externalId:"electrician-1",title:"Journeyman Electrician"});
    const frozen=evaluateDemandSignalForTracking(s);
    const generalized=evaluateDemandSignalForWorkforceTracking(s);
    expect(frozen.promoted).toBe(true);
    expect(generalized.promoted).toBe(true);
    expect(generalized.classifications.some(c=>c.occupationId==="ELECTRICIAN")).toBe(true);
  });
  it("a signal the frozen electrical promoter rejects for lack of explicit role is also rejected by the generalized promoter",()=>{
    const s=signal({externalId:"vague-1",title:"General Labor Opportunity"});
    expect(evaluateDemandSignalForTracking(s).promoted).toBe(false);
    expect(evaluateDemandSignalForWorkforceTracking(s).promoted).toBe(false);
  });
  it("promotes an explicit non-electrical trade the frozen electrical promoter cannot see",()=>{
    const s=signal({externalId:"welder-1",title:"Combo Welder"});
    expect(evaluateDemandSignalForTracking(s).promoted).toBe(false);
    const generalized=evaluateDemandSignalForWorkforceTracking(s);
    expect(generalized.promoted).toBe(true);
    expect(generalized.classifications.some(c=>c.occupationId==="WELDER")).toBe(true);
  });
  it("promotion is idempotent by externalId across a rescan",()=>{
    const s=signal({externalId:"plumber-1",title:"Plumber"});
    const first=promoteWorkforceDemandSignals([s]);
    const second=promoteWorkforceDemandSignals([s],first.tracked);
    expect(second.tracked).toHaveLength(1);
  });
});

describe("Phase 3X multi-demand project model (section 12 / 23)",()=>{
  const demand=(over:Partial<WorkforceDemandRecord>&{id:string;projectRef:string}):WorkforceDemandRecord=>({
    signalId:`signal:${over.id}`,
    classification:classificationForOccupation("ELECTRICIAN"),
    headcount:null,schedule:null,shift:null,duration:null,perDiem:null,pay:null,
    sourceEvidenceIds:[],observedAt:OBSERVED_AT,
    ...over
  });

  it("one explicitly-named project can hold three independent occupation demands",()=>{
    const ref=deriveProjectRef({project:"Project Alpha",opportunityId:"opp-1"});
    const demands=[
      demand({id:"d1",projectRef:ref,classification:classificationForOccupation("ELECTRICIAN"),headcount:80,pay:"$40/hr"}),
      demand({id:"d2",projectRef:deriveProjectRef({project:"Project Alpha",opportunityId:"opp-2"}),classification:classificationForOccupation("PIPEFITTER"),headcount:40,pay:"$38/hr"}),
      demand({id:"d3",projectRef:deriveProjectRef({project:"project alpha",opportunityId:"opp-3"}),classification:classificationForOccupation("WELDER"),headcount:25,pay:"$36/hr"}),
    ];
    const groups=groupWorkforceDemandsByProject(demands);
    expect(groups).toHaveLength(1);
    expect(groups[0].demands).toHaveLength(3);
  });

  it("headcount and pay remain independent per demand within the same project",()=>{
    const ref=deriveProjectRef({project:"Project Beta",opportunityId:"opp-4"});
    const groups=groupWorkforceDemandsByProject([
      demand({id:"d1",projectRef:ref,classification:classificationForOccupation("ELECTRICIAN"),headcount:80}),
      demand({id:"d2",projectRef:ref,classification:classificationForOccupation("HVAC_TECHNICIAN"),headcount:15}),
    ]);
    const byOccupation=Object.fromEntries(groups[0].demands.map(d=>[d.classification.occupationId,d.headcount]));
    expect(byOccupation.ELECTRICIAN).toBe(80);
    expect(byOccupation.HVAC_TECHNICIAN).toBe(15);
  });

  it("without an explicit shared project name, two signals do NOT collapse into one project",()=>{
    const groups=groupWorkforceDemandsByProject([
      demand({id:"d1",projectRef:deriveProjectRef({project:null,opportunityId:"opp-5"})}),
      demand({id:"d2",projectRef:deriveProjectRef({project:null,opportunityId:"opp-6"})}),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("Phase 3X cross-trade evidence-scope tests (section 24)",()=>{
  const acceptance=(over:Partial<ScopedAcceptanceEvidence>):ScopedAcceptanceEvidence=>({
    category:"CRAFT_LABOR_VENDOR_ACCEPTED",scope:"UNKNOWN",scopedTradeIds:[],scopeEvidenceText:null,...over
  });

  it("electrician-specific acceptance does not auto-support welding",()=>{
    const e=acceptance({scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"],scopeEvidenceText:"accepts electrical craft labor vendors"});
    expect(acceptanceCoversTrade(e,"ELECTRICAL")).toBe(true);
    expect(acceptanceCoversTrade(e,"WELDING")).toBe(false);
  });
  it("generic craft-labor acceptance supports bounded multi-craft scope only when explicit",()=>{
    const e=acceptance({scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL","WELDING","PIPEFITTING"],scopeEvidenceText:"accepts electrical, welding and pipefitting craft labor vendors"});
    expect(acceptanceCoversTrade(e,"WELDING")).toBe(true);
    expect(acceptanceCoversTrade(e,"PLUMBING")).toBe(false);
  });
  it("organization-wide scope covers every trade",()=>{
    const e=acceptance({scope:"ORGANIZATION_WIDE",scopeEvidenceText:"enterprise-wide craft labor acceptance policy"});
    expect(acceptanceCoversTrade(e,"WELDING")).toBe(true);
    expect(acceptanceCoversTrade(e,"MILLWRIGHT")).toBe(true);
  });
  it("project-specific and unknown scope never auto-extend to any trade",()=>{
    expect(acceptanceCoversTrade(acceptance({scope:"PROJECT_SPECIFIC"}),"ELECTRICAL")).toBe(false);
    expect(acceptanceCoversTrade(acceptance({scope:"UNKNOWN"}),"ELECTRICAL")).toBe(false);
  });

  const contact=(over:Partial<ScopedContactAuthority>):ScopedContactAuthority=>({
    gradeCandidate:"B",scope:"UNKNOWN",scopedTradeIds:[],...over
  });
  it("one project contact does not auto-become authority for every workforce category",()=>{
    const c=contact({scope:"TRADE_SPECIFIC",scopedTradeIds:["ELECTRICAL"]});
    expect(contactAuthorityCoversTrade(c,"ELECTRICAL")).toBe(true);
    expect(contactAuthorityCoversTrade(c,"HVAC")).toBe(false);
  });
  it("a general procurement route with unknown scope proves nothing by itself",()=>{
    expect(contactAuthorityCoversTrade(contact({scope:"UNKNOWN"}),"ELECTRICAL")).toBe(false);
  });
});
