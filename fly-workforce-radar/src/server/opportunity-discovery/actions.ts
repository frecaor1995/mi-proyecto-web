"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CommercialIntakeInput } from "../../domain/commercial-intake";
import type { DemandRequirementLevel } from "../../domain/demand-matching";
import { authorizeOperator } from "../auth/authorization";
import { getProductionSqlClient, getProductionTransactionRunner } from "../database/production-sql-client";
import { CommercialIntakeService } from "../services/commercial-intake/commercial-intake-service";
import { getSignal, type ReviewDecision } from "./signals";

export interface SignalActionState {
  readonly status: "IDLE" | "SAVED" | "REJECTED";
  readonly error: "restricted" | "unavailable" | "invalid" | "notVerified" | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
}

const REVIEW_DECISIONS: readonly ReviewDecision[] = ["NEEDS_REVIEW", "VERIFIED", "REJECTED"];
const text = (data: FormData, key: string) => { const value = data.get(key); return typeof value === "string" ? value.trim() : ""; };
const rejected = (error: SignalActionState["error"], fieldErrors: Record<string, string> = {}): SignalActionState => ({ status: "REJECTED", error, fieldErrors });

/** Records a human review decision for a discovered signal. Discovery itself never verifies. */
export async function reviewSignalAction(_previous: SignalActionState, data: FormData): Promise<SignalActionState> {
  const candidateId = text(data, "candidateId");
  const decision = text(data, "decision") as ReviewDecision;
  const note = text(data, "note").slice(0, 2000) || null;
  if (!REVIEW_DECISIONS.includes(decision)) return rejected("invalid");
  if (decision === "VERIFIED" && !note) return rejected("invalid", { note: "required" });
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return rejected("restricted");
  const client = getProductionSqlClient();
  const found = await getSignal(client, candidateId);
  if (!client || found.state === "UNAVAILABLE") return rejected("unavailable");
  if (found.state !== "READY") return rejected("invalid");
  if (found.signal.status === "PROMOTED") return rejected("invalid");
  await client.query(
    "insert into discovery_signal_reviews(normalized_candidate_url, candidate_id, decision, note, decided_by_operator_id) values ($1, $2, $3, $4, $5)",
    [found.signal.normalizedUrl, candidateId, decision, note, auth.operator.operatorId],
  );
  revalidatePath("/radar");
  revalidatePath(`/radar/${candidateId}`);
  revalidatePath("/command-center");
  return { status: "SAVED", error: null, fieldErrors: {} };
}

function requirements(data: FormData, key: string) {
  return data.getAll(key).flatMap((raw) => {
    if (typeof raw !== "string") return [];
    const [code, level] = raw.split("|");
    return code && (level === "REQUIRED" || level === "PREFERRED") ? [{ code, level: level as DemandRequirementLevel }] : [];
  });
}

/**
 * Promotes a human-VERIFIED signal into an Opportunity through the existing Commercial Intake, keeping
 * the source URL as public-source evidence. The candidate id is the intake idempotency key and the
 * PROMOTED review has a unique index per source URL, so a signal can never become two opportunities.
 */
export async function promoteSignalAction(_previous: SignalActionState, data: FormData): Promise<SignalActionState> {
  const candidateId = text(data, "candidateId");
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return rejected("restricted");
  const client = getProductionSqlClient();
  const found = await getSignal(client, candidateId);
  if (!client || found.state === "UNAVAILABLE") return rejected("unavailable");
  if (found.state !== "READY") return rejected("invalid");
  const signal = found.signal;
  if (signal.status === "PROMOTED" && signal.promotedOpportunityId) redirect(`/opportunities/${signal.promotedOpportunityId}`);
  if (signal.status !== "VERIFIED") return rejected("notVerified");

  const reviewerNote = signal.reviews.find((review) => review.decision === "VERIFIED")?.note;
  const evidenceSummary = [
    `Discovered by Opportunity Radar (${signal.domain}): ${signal.title}`,
    signal.description ? `Source excerpt: ${signal.description}` : null,
    reviewerNote ? `Human verification note: ${reviewerNote}` : null,
    text(data, "needSummary") ? `Workforce need from evidence: ${text(data, "needSummary")}` : null,
  ].filter(Boolean).join("\n");
  const numberOrNull = (value: string) => (value === "" ? null : Number(value));
  const input: CommercialIntakeInput = {
    idempotencyKey: candidateId,
    sourceType: "PUBLIC_SOURCE",
    sourceReference: signal.url,
    evidenceSummary,
    customerName: text(data, "customerName"),
    opportunityTitle: text(data, "opportunityTitle"),
    projectName: text(data, "projectName") || null,
    city: text(data, "city") || null,
    state: text(data, "state") || null,
    tradeCode: text(data, "tradeCode"),
    occupationCode: text(data, "occupationCode"),
    headcount: numberOrNull(text(data, "headcount")),
    minimumExperienceMonths: numberOrNull(text(data, "minimumExperienceMonths")),
    startDate: text(data, "startDate") || null,
    schedule: text(data, "schedule") || null,
    skills: requirements(data, "skills"),
    credentials: requirements(data, "credentials"),
  };
  const result = await new CommercialIntakeService({ transactionRunner: getProductionTransactionRunner() }).activate(input);
  if (result.kind === "VALIDATION_ERROR") return rejected("invalid", result.errors);
  if (result.kind === "UNAVAILABLE") return rejected("unavailable");
  if (result.kind !== "ACTIVATED") return rejected("restricted");

  const opportunityId = result.value.opportunityId;
  await client.query(
    `insert into discovery_signal_reviews(normalized_candidate_url, candidate_id, decision, note, promoted_opportunity_id, decided_by_operator_id)
     values ($1, $2, 'PROMOTED', $3, $4, $5) on conflict do nothing`,
    [signal.normalizedUrl, candidateId, "Promoted to opportunity through Commercial Intake", opportunityId, auth.operator.operatorId],
  );
  revalidatePath("/radar");
  revalidatePath(`/radar/${candidateId}`);
  revalidatePath("/command-center");
  redirect(`/opportunities/${opportunityId}`);
}
