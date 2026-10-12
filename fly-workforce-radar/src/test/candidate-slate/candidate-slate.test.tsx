import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationResult } from "../../server/auth/authorization";
import type { WorkerDemandEngagement } from "../../domain/worker-demand-engagement";
import { assembleCandidateSlate, classifyCandidateSlateWorker, type CandidateSlateDemandRow, type CandidateSlateSource, type CandidateSlateWorkerRow } from "../../server/candidate-slate/candidate-slate-read-model";
import { CandidateSlateView } from "../../components/candidate-slate/candidate-slate-view";

vi.mock("server-only",()=>({}));

const demand:CandidateSlateDemandRow={demandId:"demand-1",tradeCode:"ELECTRICAL",tradeLabelEn:"Electrical",tradeLabelEs:"Electricidad",occupationCode:"ELECTRICIAN",occupationLabelEn:"Electrician",occupationLabelEs:"Electricista",requestedHeadcount:12,startDate:"2026-10-01",location:"Austin, TX"};
const engagement=(overrides:Partial<WorkerDemandEngagement>={}):WorkerDemandEngagement=>({id:"engagement-1",demandSignalId:"demand-1",workerId:"worker-1",opportunityId:"opportunity-1",originatingMatchResultId:"match-1",selectionState:"REVIEWING",contactState:"NOT_STARTED",responseState:"UNKNOWN",demandAvailabilityState:"UNKNOWN",availableFrom:null,availableUntil:null,compensationResolutionState:"UNKNOWN",travelResolutionState:"UNKNOWN",mobilizationState:"NOT_READY",closedAt:null,closureReason:null,createdByOperatorId:"operator-1",updatedByActorType:"OPERATOR",updatedByOperatorId:"operator-1",version:1,createdAt:new Date("2026-09-24T12:00:00Z"),updatedAt:new Date("2026-09-24T12:00:00Z"),...overrides});
const worker=(id:string,overrides:Partial<CandidateSlateWorkerRow>={}):CandidateSlateWorkerRow=>({demandId:"demand-1",workerId:id,displayName:`Worker ${id}`,lifecycle:"ACTIVE",tradeCode:"ELECTRICAL",tradeLabelEn:"Electrical",tradeLabelEs:"Electricidad",occupationCode:"ELECTRICIAN",occupationLabelEn:"Electrician",occupationLabelEs:"Electricista",experienceMonths:72,skills:[{code:"INDUSTRIAL_ELECTRICAL",labelEn:"Industrial electrical",labelEs:"Electricidad industrial",verificationState:"VERIFIED"}],credentials:[{code:"OSHA_10",labelEn:"OSHA 10",labelEs:"OSHA 10",verificationState:"VERIFIED"}],matchOutcome:"STRONG_MATCH",matchReasons:[],matchEvaluatedAt:"2026-09-24T12:00:00Z",hardViolation:false,engagement:null,validConsentedContactOccurred:false,consentStillGranted:false,demandActionable:true,...overrides});
const source=(workers:readonly CandidateSlateWorkerRow[],demands:readonly CandidateSlateDemandRow[]=[demand]):CandidateSlateSource=>({opportunityId:"opportunity-1",opportunityTitle:"Synthetic 12-worker requirement",customer:"Demo Customer",project:"Demo Project",location:"Austin, TX",demands,workers});

describe("Candidate Slate canonical aggregation",()=>{
  it("aggregates a 12-worker requirement, deduplicates workers, and separates canonical states",()=>{
    const candidate=worker("candidate",{engagement:engagement({id:"e-candidate",workerId:"candidate",selectionState:"SELECTED",contactState:"RESPONSE_RECEIVED",responseState:"INTERESTED",demandAvailabilityState:"CONFIRMED_AVAILABLE",availableFrom:new Date("2026-09-28T00:00:00Z"),compensationResolutionState:"COMPATIBLE",travelResolutionState:"COMPATIBLE",mobilizationState:"CANDIDATE"}),validConsentedContactOccurred:true,consentStillGranted:true});
    const selected=worker("selected",{engagement:engagement({id:"e-selected",workerId:"selected",selectionState:"SELECTED"})});
    const progressing=worker("progressing",{engagement:engagement({id:"e-progressing",workerId:"progressing"})});
    const blocked=worker("blocked",{matchOutcome:"NO_MATCH",hardViolation:true,engagement:engagement({id:"e-blocked",workerId:"blocked",selectionState:"SELECTED"})});
    const result=assembleCandidateSlate(source([candidate,candidate,selected,progressing,blocked,...Array.from({length:8},(_,i)=>worker(`match-${i}`))]));
    const summary=result.demands[0];
    expect(summary.requestedHeadcount).toBe(12);
    expect(summary.workers).toHaveLength(12);
    expect(summary.matchingCount).toBe(11);
    expect(summary.engagedCount).toBe(4);
    expect(summary.selectedCount).toBe(3);
    expect(summary.candidateCount).toBe(1);
    expect(summary.remainingPositions).toBe(11);
    expect(new Set(summary.workers.map(row=>row.workerId)).size).toBe(12);
    expect(summary.workers.map(row=>row.group)).toEqual(expect.arrayContaining(["CANDIDATE","SELECTED","IN_PROGRESS","BLOCKED"]));
    expect(summary.workers.find(row=>row.workerId==="selected")?.blockers).toContain("CONSENTED_CONTACT_REQUIRED");
  });

  it("uses the published B5 mobilization blockers and deterministic next action",()=>{
    const row=worker("selected",{engagement:engagement({selectionState:"SELECTED"})});
    const result=classifyCandidateSlateWorker(row,demand);
    expect(result.blockers).toEqual(expect.arrayContaining(["CONSENTED_CONTACT_REQUIRED","WORKER_INTEREST_REQUIRED","DEMAND_AVAILABILITY_REQUIRED","COMPENSATION_UNRESOLVED","TRAVEL_UNRESOLVED"]));
    expect(result.nextAction).toBe("COMPLETE_CONSENTED_CONTACT");
  });

  it("surfaces safeguard drift instead of presenting a stale candidate as ready",()=>{
    const row=worker("candidate-drift",{engagement:engagement({workerId:"candidate-drift",selectionState:"SELECTED",mobilizationState:"CANDIDATE"})});
    const result=classifyCandidateSlateWorker(row,demand);
    expect(result.group).toBe("BLOCKED");expect(result.nextAction).toBe("RECONCILE_SAFEGUARDS");expect(result.blockers).toContain("CONSENTED_CONTACT_REQUIRED");
  });

  it("keeps unknown headcount honest and exposes candidate surplus",()=>{
    const candidate=worker("candidate",{engagement:engagement({workerId:"candidate",mobilizationState:"CANDIDATE",selectionState:"SELECTED"}),validConsentedContactOccurred:true,consentStillGranted:true});
    expect(assembleCandidateSlate(source([candidate],[{...demand,requestedHeadcount:null}])).demands[0].remainingPositions).toBeNull();
    const surplus=assembleCandidateSlate(source([candidate],[{...demand,requestedHeadcount:0}])).demands[0];
    expect(surplus.candidateCount).toBe(1);expect(surplus.surplusCandidates).toBe(1);expect(surplus.remainingPositions).toBe(0);
  });

  it("renders bilingual, multi-profession, partial and print-handoff UI without contact PII",()=>{
    const welding={...demand,tradeCode:"WELDING",tradeLabelEn:"Welding",tradeLabelEs:"Soldadura",occupationCode:"WELDER",occupationLabelEn:"Welder",occupationLabelEs:"Soldador"};
    const slate=assembleCandidateSlate(source([worker("welder",{tradeCode:"WELDING",tradeLabelEn:"Welding",tradeLabelEs:"Soldadura",occupationCode:"WELDER",occupationLabelEn:"Welder",occupationLabelEs:"Soldador"})],[welding]));
    const result={state:"READY" as const,slate};
    const english=renderToStaticMarkup(<CandidateSlateView locale="en-US" result={result} group={null}/>),spanish=renderToStaticMarkup(<CandidateSlateView locale="es-US" result={result} group={null}/>);
    expect(english).toContain("Candidate Slate");expect(english).toContain("Welding");expect(english).toContain("Commercial handoff");
    expect(spanish).toContain("Lista de candidatos");expect(spanish).toContain("Soldadura");expect(spanish).toContain("Entrega comercial");
    expect(english).not.toContain("555-0100");expect(JSON.stringify(slate)).not.toMatch(/target|email|phone/i);
  });

  it("renders honest no-demand and restricted states",()=>{
    const empty={state:"READY" as const,slate:assembleCandidateSlate(source([],[]))};
    expect(renderToStaticMarkup(<CandidateSlateView locale="en-US" result={empty} group={null}/>)).toContain("No workforce demand");
    expect(renderToStaticMarkup(<CandidateSlateView locale="en-US" result={{state:"RESTRICTED",slate:null}} group={null}/>)).toContain("is restricted");
  });
});

describe("Candidate Slate authorization and integration",()=>{
  it("fails closed before querying when any required permission is absent",async()=>{
    const {getCandidateSlate}=await import("../../server/candidate-slate/get-candidate-slate");
    const query=vi.fn();
    const denied:AuthorizationResult={state:"AUTHENTICATED_BUT_UNAUTHORIZED",authUserId:"u",email:"operator@example.test"};
    const result=await getCandidateSlate("opportunity-1",{client:{query},authorize:async permission=>permission==="worker_engagement.read"?denied:{state:"AUTHORIZED",operator:{operatorId:"o",authUserId:"u",email:"operator@example.test",permissions:[permission]}}});
    expect(result.state).toBe("RESTRICTED");expect(query).not.toHaveBeenCalled();
  });

  it("keeps SQL selections outside raw contact and credential identifier data",async()=>{
    const sourceCode=await readFile(path.join(process.cwd(),"src/server/candidate-slate/get-candidate-slate.ts"),"utf8");
    expect(sourceCode).not.toMatch(/cr\.target|raw_identifier/);
    expect(sourceCode).toContain("consent_state");
  });

  it("links Opportunity Detail directly to the slate",async()=>{
    const detail=await readFile(path.join(process.cwd(),"src/components/opportunity-detail/opportunity-detail-view.tsx"),"utf8");
    expect(detail).toContain("/candidate-slate");expect(detail).toContain("Open Candidate Slate & commercial handoff");
  });
});
