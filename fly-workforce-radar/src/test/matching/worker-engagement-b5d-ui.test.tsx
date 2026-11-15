import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it,vi } from "vitest";
vi.mock("../../server/opportunity-detail/worker-engagement-actions",()=>({submitWorkerEngagementAction:vi.fn()}));
import { activateWorkerEngagementCommand, confirmWorkerEngagementCommand, formatCalendarDateForInput, isAvailabilitySubmissionDisabled, isContactSubmissionDisabled, isResolutionSubmissionDisabled, isResponseSubmissionDisabled, isSelectionSubmissionDisabled, keepWorkerEngagementInView, preventImplicitWorkerEngagementSubmit, shouldCorrectWorkerEngagementViewport, WorkerEngagementActionFeedback, WorkerEngagementPanel } from "../../components/opportunity-detail/worker-engagement-panel";
import type { WorkerDemandEngagement } from "../../domain/worker-demand-engagement";
import type { WorkerDemandEngagementUi } from "../../server/opportunity-detail/get-worker-demand-engagement-ui";

const empty:WorkerDemandEngagementUi={state:"NOT_STARTED",permissions:{canRead:true,canWrite:true,canReadContact:false,canExecuteContact:false},engagement:null,history:[],contactChoices:[],currentMatchResultId:"match",warnings:[]};
const engagement=(selectionState:WorkerDemandEngagement["selectionState"],version:number):WorkerDemandEngagement=>({id:"e",demandSignalId:"d",workerId:"w",opportunityId:"o",originatingMatchResultId:"m",selectionState,contactState:"NOT_STARTED",responseState:"UNKNOWN",demandAvailabilityState:"UNKNOWN",availableFrom:null,availableUntil:null,compensationResolutionState:"UNKNOWN",travelResolutionState:"UNKNOWN",mobilizationState:"NOT_READY",closedAt:null,closureReason:null,createdByOperatorId:"operator",updatedByActorType:"OPERATOR",updatedByOperatorId:"operator",version,createdAt:new Date("2026-09-23T00:00:00Z"),updatedAt:new Date("2026-09-23T00:00:00Z")});
describe("MATCHING-B5-D progressive operator UI",()=>{
  it.each([["en-US","Start engagement"],["es-US","Iniciar gestión"]] as const)("renders %s copy",(locale,label)=>expect(renderToStaticMarkup(<WorkerEngagementPanel locale={locale} opportunityId="o" demandSignalId="d" workerId="w" data={empty}/>)).toContain(label));
  it.each(["Electrician","Welder","HVAC Technician","Field Management"])("remains profession-neutral for %s",()=>{
    const html=renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={empty}/>);expect(html).not.toMatch(/electrical license|electrical certification/i);
  });
  it("does not render contact controls without both contact permissions",()=>expect(renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={empty}/>)).not.toContain("Contact outcome"));
  it("uses native responsive controls without fixed timeline width",()=>{const source=readFileSync("src/app/globals.css","utf8");expect(source).toContain(".engagement-history");expect(source).toContain("@media(max-width:767px)");});
  it.each([["REVIEWING","REVIEWING",false,true],["REVIEWING","SHORTLISTED",false,false],["SHORTLISTED","SHORTLISTED",false,true],["REVIEWING","SHORTLISTED",true,true]] as const)("guards selection submission for persisted %s, selected %s, pending %s",(persisted,selected,pending,disabled)=>expect(isSelectionSubmissionDisabled(persisted,selected,pending)).toBe(disabled));
  it("reserves native submit semantics for Start Engagement and uses deliberate buttons for every editable B5-D command",()=>{
    const data:WorkerDemandEngagementUi={...empty,state:"READY",permissions:{canRead:true,canWrite:true,canReadContact:true,canExecuteContact:true},engagement:engagement("REVIEWING",1),contactChoices:[{id:"route",routeType:"EMAIL",target:"Protected contact route",preferred:true}]};
    const readyHtml=renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={data}/>),startHtml=renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={empty}/>);
    expect(startHtml.match(/<button type="submit"/g)).toHaveLength(1);expect(readyHtml.match(/<button type="button"/g)).toHaveLength(7);expect(readyHtml).not.toContain('<button type="submit"');
  });
  it.each([["route","",false,true],["route","NO_ANSWER",false,false],["","NO_ANSWER",false,true],["route","NO_ANSWER",true,true]] as const)("requires a deliberate valid contact outcome",(route,outcome,pending,disabled)=>expect(isContactSubmissionDisabled(route,outcome,pending)).toBe(disabled));
  it("renders contact with a disabled deliberate-selection placeholder instead of default NO_ANSWER",()=>{
    const data:WorkerDemandEngagementUi={...empty,state:"READY",permissions:{canRead:true,canWrite:true,canReadContact:true,canExecuteContact:true},engagement:engagement("REVIEWING",1),contactChoices:[{id:"route",routeType:"EMAIL",target:"Protected contact route",preferred:true}]};
    const html=renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={data}/>);
    expect(html).toContain('<option value="" disabled="" selected="">Choose an outcome</option>');expect(html).toMatch(/<button type="button" disabled="">Contact attempt<\/button>/);
  });
  it.each([["UNKNOWN","UNKNOWN",false,true],["UNKNOWN","INTERESTED",false,false],["UNKNOWN","INTERESTED",true,true]] as const)("guards unchanged and pending worker responses",(persisted,selected,pending,disabled)=>expect(isResponseSubmissionDisabled(persisted,selected,pending)).toBe(disabled));
  it.each([
    ["UNKNOWN","","","UNKNOWN","","",false,true],
    ["UNKNOWN","","","CONFIRMED_AVAILABLE","","",false,true],
    ["UNKNOWN","","","CONFIRMED_AVAILABLE","2026-10-01","",false,false],
    ["CONFIRMED_AVAILABLE","2026-10-01","","CONFIRMED_AVAILABLE","2026-10-02","",false,false],
    ["UNKNOWN","","","CONFIRMED_UNAVAILABLE","","",true,true],
  ] as const)("guards unchanged, incomplete, and pending availability",(persistedState,persistedFrom,persistedUntil,state,from,until,pending,disabled)=>expect(isAvailabilitySubmissionDisabled(persistedState,persistedFrom,persistedUntil,state,from,until,pending)).toBe(disabled));
  it("formats read-model calendar dates for HTML date inputs without UTC conversion",()=>{
    expect(formatCalendarDateForInput(new Date(2026,8,28))).toBe("2026-09-28");
    expect(formatCalendarDateForInput(new Date(2026,8,29))).toBe("2026-09-29");
    expect(formatCalendarDateForInput(null)).toBe("");
    const persisted={...engagement("SHORTLISTED",4),demandAvailabilityState:"CONFIRMED_AVAILABLE" as const,availableFrom:new Date(2026,8,28),availableUntil:new Date(2026,8,29)};
    const html=renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={{...empty,state:"READY",engagement:persisted}}/>);
    expect(html).toMatch(/<input[^>]*name="availableFrom"[^>]*value="2026-09-28"/);
    expect(html).toMatch(/<input[^>]*name="availableUntil"[^>]*value="2026-09-29"/);
  });
  it.each([
    ["UNKNOWN","UNKNOWN","UNKNOWN","UNKNOWN",false,true],
    ["UNKNOWN","UNKNOWN","COMPATIBLE","UNKNOWN",false,false],
    ["UNKNOWN","UNKNOWN","UNKNOWN","COMPATIBLE",false,false],
    ["UNKNOWN","UNKNOWN","COMPATIBLE","UNKNOWN",true,true],
  ] as const)("guards only an unchanged or pending resolution pair",(persistedCompensation,persistedTravel,compensation,travel,pending,disabled)=>expect(isResolutionSubmissionDisabled(persistedCompensation,persistedTravel,compensation,travel,pending)).toBe(disabled));
  it("requires deliberate confirmation for candidate establishment and safeguard reconciliation",()=>{
    const confirm=vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(confirmWorkerEngagementCommand("candidate",confirm)).toBe(false);expect(confirmWorkerEngagementCommand("reconcile",confirm)).toBe(true);expect(confirm).toHaveBeenCalledTimes(2);
    const source=readFileSync("src/components/opportunity-detail/worker-engagement-panel.tsx","utf8");expect(source).toContain("confirmation={copy.confirmCandidate}");expect(source).toContain("confirmation={copy.confirmReconcile}");expect(source).toContain("onSubmit={preventImplicitWorkerEngagementSubmit}");
  });
  it("prevents field and Enter-key form submission while deliberate button activation dispatches exactly once",()=>{
    const preventDefault=vi.fn(),action=vi.fn(),formData=new FormData();
    preventImplicitWorkerEngagementSubmit({preventDefault});
    expect(preventDefault).toHaveBeenCalledOnce();expect(action).not.toHaveBeenCalled();
    expect(activateWorkerEngagementCommand(action,formData)).toBe(true);expect(action).toHaveBeenCalledOnce();expect(action).toHaveBeenCalledWith(formData);
  });
  it("keeps candidate and safeguard confirmation on the deliberate activation path",()=>{
    const action=vi.fn(),formData=new FormData(),deny=vi.fn().mockReturnValue(false),allow=vi.fn().mockReturnValue(true);
    expect(activateWorkerEngagementCommand(action,formData,"candidate",deny)).toBe(false);expect(action).not.toHaveBeenCalled();
    expect(activateWorkerEngagementCommand(action,formData,"candidate",allow)).toBe(true);expect(action).toHaveBeenCalledOnce();
  });
  it("keeps independent changed-value guards enabled without dispatching any command",()=>{
    const action=vi.fn();
    expect(isSelectionSubmissionDisabled("REVIEWING","SELECTED",false)).toBe(false);
    expect(isAvailabilitySubmissionDisabled("UNKNOWN","","","CONFIRMED_AVAILABLE","2026-09-28","2026-09-28",false)).toBe(false);
    expect(isContactSubmissionDisabled("route","NO_ANSWER",false)).toBe(false);
    expect(isResponseSubmissionDisabled("UNKNOWN","INTERESTED",false)).toBe(false);
    expect(isResolutionSubmissionDisabled("UNKNOWN","UNKNOWN","COMPATIBLE","NOT_REQUIRED",false)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
  it.each([["REVIEWING",1],["SHORTLISTED",2]] as const)("renders refreshed %s selection at version %s as selected and disabled",(selectionState,version)=>{
    const data:WorkerDemandEngagementUi={...empty,state:"READY",engagement:engagement(selectionState,version)};
    const html=renderToStaticMarkup(<WorkerEngagementPanel locale="en-US" opportunityId="o" demandSignalId="d" workerId="w" data={data}/>);
    expect(html).toContain(`<option selected="">${selectionState}</option>`);expect(html).toMatch(/<button type="button" disabled="">Selection<\/button>/);
  });
  it("preserves disclosure continuity while synchronizing only persisted form state",()=>{
    const source=readFileSync("src/components/opportunity-detail/worker-engagement-panel.tsx","utf8");
    expect(source).toContain("const [open,setOpen]=useState(false)");expect(source).toContain("open={open}");expect(source).toContain("onOpenChange(event.currentTarget.open)");
    expect(source).not.toMatch(/WorkerEngagementPanelStateful[^;]+key=/);expect(source).not.toContain("refreshKey");
    expect(source).toContain(":selection:${engagement.selectionState}");expect(source).toContain(":contact:${engagement.version}");expect(source).toContain(":response:${engagement.responseState}");expect(source).toContain(":availability:${engagement.demandAvailabilityState}");expect(source).toContain(":resolutions:${engagement.compensationResolutionState}");
    expect(source).toContain('[outcome,setOutcome]=useState("")');expect(source).not.toMatch(/scrollTo|router\.(?:push|replace|refresh)|\.focus\(/);
  });
  it("guards viewport continuity to new successful persisted engagement states",()=>{
    const ready={status:"READY",reason:null,blockers:[]} as const,rejected={status:"REJECTED",reason:"INVALID_SELECTION_TRANSITION",blockers:[]} as const,succeeded={status:"SUCCEEDED",reason:null,blockers:[]} as const;
    expect(shouldCorrectWorkerEngagementViewport(ready,"e:1",null)).toBe(false);
    expect(shouldCorrectWorkerEngagementViewport(rejected,"e:1",null)).toBe(false);
    expect(shouldCorrectWorkerEngagementViewport(succeeded,null,null)).toBe(false);
    expect(shouldCorrectWorkerEngagementViewport(succeeded,"e:1",null)).toBe(true);
    expect(shouldCorrectWorkerEngagementViewport(succeeded,"e:1","e:1")).toBe(false);
    expect(shouldCorrectWorkerEngagementViewport(succeeded,"e:2","e:1")).toBe(true);
  });
  it("uses minimal targeted scrolling only when the same engagement panel leaves the useful viewport",()=>{
    const scrollIntoView=vi.fn(),element={scrollIntoView,getBoundingClientRect:vi.fn()} as unknown as HTMLElement;
    vi.mocked(element.getBoundingClientRect).mockReturnValue({top:120,bottom:700} as DOMRect);
    expect(keepWorkerEngagementInView(element,844)).toBe(false);expect(scrollIntoView).not.toHaveBeenCalled();
    vi.mocked(element.getBoundingClientRect).mockReturnValue({top:900,bottom:1200} as DOMRect);
    expect(keepWorkerEngagementInView(element,844)).toBe(true);expect(scrollIntoView).toHaveBeenLastCalledWith({block:"nearest",inline:"nearest"});
    vi.mocked(element.getBoundingClientRect).mockReturnValue({top:-500,bottom:-20} as DOMRect);
    expect(keepWorkerEngagementInView(element,844)).toBe(true);expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
  it("introduces no route navigation or reload for view continuity",()=>{
    const source=readFileSync("src/components/opportunity-detail/worker-engagement-panel.tsx","utf8");
    expect(source).toContain('scrollIntoView({block:"nearest",inline:"nearest"})');
    expect(source).not.toMatch(/router\.(?:push|replace|refresh)|location\.(?:reload|assign|replace)|window\.scroll|scrollTo/);
  });
  it.each([["en-US","Choose a different selection status before saving."],["es-US","Seleccione un estado diferente antes de guardar."]] as const)("localizes invalid transition for %s without exposing its code",(locale,message)=>{
    const html=renderToStaticMarkup(<WorkerEngagementActionFeedback locale={locale} state={{status:"REJECTED",reason:"INVALID_SELECTION_TRANSITION",blockers:[]}}/>);expect(html).toContain(message);expect(html).not.toContain("INVALID_SELECTION_TRANSITION");
  });
});
import { readFileSync } from "node:fs";
