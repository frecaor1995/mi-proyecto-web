import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DemandMatchReadModel, DemandMatchWorkerRow } from "../../domain/matching-results";
import { WorkforceMatchingSection } from "../../components/opportunity-detail/workforce-matching-section";
import { DICTIONARIES } from "../../i18n/translate";

vi.mock("server-only", () => ({}));

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const DEMAND_A = "22222222-2222-4222-8222-222222222222";
const DEMAND_B = "33333333-3333-4333-8333-333333333333";
const permissions = { authenticated: true, canExecute: true, canRead: true };
const worker = (overrides: Partial<DemandMatchWorkerRow> = {}): DemandMatchWorkerRow => ({
  workerId: "44444444-4444-4444-8444-444444444444", workerDisplayName: "Alex Rivera", outcome: "STRONG_MATCH",
  topReasons: [], missingInformationReasons: [],
  explanations: [{ criterion: "TRADE", subject: null, importance: "HARD", state: "SATISFIED", reasonCode: "TRADE_MATCH_PRIMARY" }],
  evaluationDate: new Date("2026-09-20T12:00:00Z"), evaluatedAt: new Date("2026-09-20T12:01:00Z"), freshness: "FRESH",
  workerLifecycleStatusAtEvaluation: "ACTIVE", currentWorkerLifecycleStatus: "ACTIVE", ...overrides,
});
const model = (workers: readonly DemandMatchWorkerRow[] = [worker()]): DemandMatchReadModel => ({
  demandSignalId: DEMAND_A,
  counts: {
    STRONG_MATCH: workers.filter((value) => value.outcome === "STRONG_MATCH").length,
    POSSIBLE_MATCH: workers.filter((value) => value.outcome === "POSSIBLE_MATCH").length,
    INSUFFICIENT_DATA: workers.filter((value) => value.outcome === "INSUFFICIENT_DATA").length,
    NO_MATCH: workers.filter((value) => value.outcome === "NO_MATCH").length,
  }, workers,
});
const render = (options: {
  demands?: readonly { id: string; label: string }[];
  permissionOverrides?: Partial<typeof permissions>;
  readModel?: DemandMatchReadModel | null;
} = {}) => renderToStaticMarkup(<WorkforceMatchingSection locale="en-US" opportunityId={OPPORTUNITY_ID}
  demands={options.demands ?? [{ id: DEMAND_A, label: "#01 · Electrician" }]}
  permissions={{ ...permissions, ...options.permissionOverrides }}
  demandResults={options.readModel === null ? { [DEMAND_A]: { state: "READY", value: model([]) } } : { [DEMAND_A]: { state: "READY", value: options.readModel ?? model() } }}/>
);

describe("MATCHING-B4-B commercial matching UX", () => {
  it("zero demand renders unavailable state without an execution CTA or counters", () => {
    const html = render({ demands: [] }); expect(html).toContain("no canonical workforce demand"); expect(html).not.toContain("Run Workforce Matching"); expect(html).not.toContain("matching-outcome-grid");
  });
  it("one demand is used explicitly", () => { const html = render(); expect(html).toContain("#01 · Electrician"); expect(html).toContain(`value="${DEMAND_A}"`); });
  it("multiple demands require explicit selection", () => { const html = render({ demands: [{ id: DEMAND_A, label: "Electrical" }, { id: DEMAND_B, label: "Controls" }] }); expect(html).toContain("Select a demand"); expect(html).toContain("disabled"); expect(html).not.toContain("Alex Rivera"); });
  it("read-only shows persisted results without execution", () => { const html = render({ permissionOverrides: { canExecute: false } }); expect(html).toContain("Alex Rivera"); expect(html).not.toContain(">Run Workforce Matching<"); expect(html).toContain("Execution permission required"); });
  it("execute-only shows execution without persisted rows or counts", () => { const html = render({ permissionOverrides: { canRead: false } }); expect(html).toContain("Run Workforce Matching"); expect(html).toContain("Persisted matching results are restricted"); expect(html).not.toContain("Alex Rivera"); expect(html).not.toContain("matching-outcome-grid"); });
  it("neither permission shows a restricted panel", () => { const html = render({ permissionOverrides: { canRead: false, canExecute: false } }); expect(html).toContain("Workforce Matching restricted"); expect(html).not.toContain("Run Workforce Matching"); expect(html).not.toContain("Alex Rivera"); });
  it("cold load with no rows uses honest empty state and no four-zero counters", () => { const html = render({ readModel: null }); expect(html).toContain("No persisted matching results"); expect(html).not.toContain("matching-outcome-grid"); });
  it("renders complete deterministic support for a Strong Match", () => { const html = render(); expect(html).toContain("The demand matches the worker&#x27;s primary trade"); expect(html).toContain("Supported"); });
  it("renders preferred-only Possible Match explanations", () => { const html = render({ readModel: model([worker({ outcome: "POSSIBLE_MATCH", explanations: [{ criterion: "PREFERRED_SKILL", subject: "PLC", importance: "PREFERRED", state: "SATISFIED_WITH_LIMITATION", reasonCode: "PREFERRED_SKILL_UNVERIFIED" }] })]) }); expect(html).toContain("Possible Match"); expect(html).toContain("preferred skill exists but is not currently verified"); });
  it("renders UNKNOWN as missing information, never failure", () => { const html = render({ readModel: model([worker({ outcome: "INSUFFICIENT_DATA", missingInformationReasons: ["WORKER_TRADE_UNKNOWN"], explanations: [{ criterion: "TRADE", subject: null, importance: "HARD", state: "UNKNOWN", reasonCode: "WORKER_TRADE_UNKNOWN" }] })]) }); expect(html).toContain("Missing Information"); expect(html).toContain("Information missing or not comparable"); expect(html).not.toContain("Unknown failure"); });
  it("shows freshness text and stale explanation", () => { const html = render({ readModel: model([worker({ freshness: "POTENTIALLY_STALE" })]) }); expect(html).toContain("Potentially Stale"); expect(html).toContain("Inputs have changed"); expect(html).toContain("Run Again"); });
  it("preserves current lifecycle separately from evaluation-time data", () => { const html = render({ readModel: model([worker({ workerLifecycleStatusAtEvaluation: "ACTIVE", currentWorkerLifecycleStatus: "ARCHIVED" })]) }); expect(html).toContain("ARCHIVED"); });
  it("groups outcomes in certified presentation order", () => { const html = render(); expect(html.indexOf("Strong Match")).toBeLessThan(html.indexOf("Possible Match")); expect(html.indexOf("Possible Match")).toBeLessThan(html.indexOf("Insufficient Data")); expect(html.indexOf("Insufficient Data")).toBeLessThan(html.indexOf("No Match")); });
  it("sorts workers neutrally by display name with workerId tie-breaker", () => { const html = render({ readModel: model([worker({ workerId: "55555555-5555-4555-8555-555555555555", workerDisplayName: "Zoe" }), worker({ workerId: "66666666-6666-4666-8666-666666666666", workerDisplayName: "Ana" })]) }); expect(html.indexOf("Ana")).toBeLessThan(html.indexOf("Zoe")); });
  it("uses safe worker-detail navigation", () => { expect(render()).toContain(`/workforce/${encodeURIComponent(worker().workerId)}`); });
  it("does not expose contact, raw credential identifiers, scores, or ranking", () => { const html = render(); expect(html).not.toMatch(/phone|email|consent|rawIdentifier|percentage|confidence|score|rank/i); });
  it("has complete English and Spanish namespaces", () => { for (const locale of ["en-US", "es-US"] as const) { const value = DICTIONARIES[locale].workforceMatching; expect(value.title).toBeTruthy(); expect(value.outcome.STRONG_MATCH).toBeTruthy(); expect(value.reason.COMPENSATION_HARD_GAP).toBeTruthy(); expect(value.criterionState.UNKNOWN).toBeTruthy(); } });
  it("source implements running, completed, partial-success and sanitized failed states", async () => { const component = await readFile(resolve(process.cwd(), "src/components/opportunity-detail/workforce-matching-section.tsx"), "utf8"); const action = await readFile(resolve(process.cwd(), "src/server/opportunity-detail/workforce-matching-actions.ts"), "utf8"); expect(component).toContain("matching-run-running"); for (const state of ["COMPLETED", "PARTIAL_SUCCESS", "FAILED"]) expect(action).toContain(state); expect(component).toContain('aria-live="polite"'); expect(component).toContain("disabled={pending"); });
  it("responsive CSS uses stacked mobile cards, 44px controls and wrapped reasons", async () => { const css = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8"); expect(css).toContain(".matching-worker-list{grid-template-columns:1fr}"); expect(css).toMatch(/min-height:44px/); expect(css).toContain("overflow-wrap:anywhere"); expect(css).toContain(".matching-freshness"); });
  it("keeps run summary and persisted results as separately labelled concepts", async () => { const source = await readFile(resolve(process.cwd(), "src/components/opportunity-detail/workforce-matching-section.tsx"), "utf8"); expect(source).toContain("workforceMatching.runSummary"); expect(source).toContain("workforceMatching.persistedResults"); });
  it("contains no ranking, scoring, AI, automatic run, scheduler, cron or queue implementation", async () => { const source = (await readFile(resolve(process.cwd(), "src/components/opportunity-detail/workforce-matching-section.tsx"), "utf8")).toLowerCase(); expect(source).not.toMatch(/ranking|score|percentage|confidence|openai|llm|scheduler|cron|queue|useeffect/); });
});
