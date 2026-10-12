import { describe, expect, it } from "vitest";
import { nextPostingToWork, postingEvidenceChanges, postingProgress, type PostingDecisions } from "../../domain/posting-workflow";
import { guidedCopy, intelligenceCopy, labelFor } from "../../components/discovery-intelligence/intelligence-copy";

const none: PostingDecisions = { postingReview: null, companyOutcome: null, companyId: null, demandDecision: null };

describe("Recipe 2.1 — daily posting flow", () => {
  it("advances only on recorded human decisions, in order: posting → company → demand → client/contact", () => {
    expect(postingProgress(none)).toEqual({ stage: "REGISTERED", next: "VERIFY_POSTING", open: true });
    expect(postingProgress({ ...none, postingReview: "NEEDS_REVIEW" }).next).toBe("RECHECK_POSTING");
    expect(postingProgress({ ...none, postingReview: "REJECTED" })).toEqual({ stage: "CLOSED", next: "CLOSED_POSTING_REJECTED", open: false });
    // a company decision without a verified posting does not skip step 1
    expect(postingProgress({ ...none, companyOutcome: "CREATE", companyId: "c1" }).next).toBe("VERIFY_POSTING");
    expect(postingProgress({ ...none, postingReview: "VERIFIED" })).toEqual({ stage: "POSTING_VERIFIED", next: "CONFIRM_COMPANY", open: true });
    expect(postingProgress({ ...none, postingReview: "VERIFIED", companyOutcome: "DEFER" }).next).toBe("CONFIRM_COMPANY");
    expect(postingProgress({ ...none, postingReview: "VERIFIED", companyOutcome: "UNSUPPORTED" }).next).toBe("CLOSED_COMPANY_UNSUPPORTED");
    expect(postingProgress({ ...none, postingReview: "VERIFIED", companyOutcome: "CREATE", companyId: "c1" })).toEqual({ stage: "COMPANY_CONFIRMED", next: "DECIDE_DEMAND", open: true });
    expect(postingProgress({ postingReview: "VERIFIED", companyOutcome: "LINK", companyId: "c1", demandDecision: "DEFER" }).next).toBe("DECIDE_DEMAND");
    expect(postingProgress({ postingReview: "VERIFIED", companyOutcome: "LINK", companyId: "c1", demandDecision: "REJECT" }).next).toBe("CLOSED_NO_DOCUMENTED_DEMAND");
    expect(postingProgress({ postingReview: "VERIFIED", companyOutcome: "LINK", companyId: "c1", demandDecision: "VERIFY" })).toEqual({ stage: "DEMAND_VERIFIED", next: "EVALUATE_CLIENT_AND_CONTACT", open: true });
  });
  it("treats an older observation of a re-observed posting as history, whatever its decisions", () => {
    const verified: PostingDecisions = { postingReview: "VERIFIED", companyOutcome: "LINK", companyId: "c1", demandDecision: "VERIFY" };
    expect(postingProgress(verified, { superseded: true })).toEqual({ stage: "SUPERSEDED", next: "SUPERSEDED_BY_NEWER_OBSERVATION", open: false });
    expect(nextPostingToWork([{ next: "SUPERSEDED_BY_NEWER_OBSERVATION" as const, capturedAt: "2026-10-01T12:00:00Z" }])).toBeNull();
  });
  it("lists the recorded fields that changed between two observations", () => {
    const before = { title: "Apprentice Electrician", employerName: "Walker Engineering", location: "Houston, TX", licenses: ["TDLR"], compensation: null, evidenceExcerpt: "a" };
    expect(postingEvidenceChanges(before, { ...before })).toEqual([]);
    expect(postingEvidenceChanges(before, { ...before, compensation: "$18/hr", licenses: ["TDLR", "OSHA 10"] })).toEqual(["licenses", "compensation"]);
  });
  it("picks the earliest pending step first, then the oldest posting", () => {
    const items = [
      { id: "a", next: "DECIDE_DEMAND" as const, capturedAt: "2026-10-01T12:00:00Z" },
      { id: "b", next: "VERIFY_POSTING" as const, capturedAt: "2026-10-08T12:00:00Z" },
      { id: "c", next: "VERIFY_POSTING" as const, capturedAt: "2026-10-05T12:00:00Z" },
      { id: "d", next: "CLOSED_POSTING_REJECTED" as const, capturedAt: "2026-09-01T12:00:00Z" },
    ];
    expect(nextPostingToWork(items)?.id).toBe("c");
    expect(nextPostingToWork([items[3]])).toBeNull();
  });
});

describe("Recipe 2.1 — Spanish copy", () => {
  it("has a Spanish text for every key, stage and next action, and keeps EN as the fallback", () => {
    const en = intelligenceCopy("en-US"), es = intelligenceCopy("es-US");
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en.nextLabel)) expect(es.nextLabel[key as keyof typeof es.nextLabel]).not.toBe(en.nextLabel[key as keyof typeof en.nextLabel]);
    expect(es.flowSteps).toEqual(["Registrar vacante", "Revisar", "Verificar", "Posible cliente", "Investigar contacto", "Seguimiento"]);
    expect(Object.keys(guidedCopy("es-US")).sort()).toEqual(Object.keys(guidedCopy("en-US")).sort());
    expect(labelFor("es-US", "REVIEW_TIMEBOX_EXPIRED")).toBe("VENCIÓ EL TIEMPO DE REVISIÓN");
    expect(labelFor("en-US", "REVIEW_TIMEBOX_EXPIRED")).toBe("REVIEW TIMEBOX EXPIRED");
    expect(es.priorityNotes.enterprise).toMatch(/Prioridad 1/);
  });
});
