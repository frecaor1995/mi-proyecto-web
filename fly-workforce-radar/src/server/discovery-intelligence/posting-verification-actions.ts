"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionTransactionRunner } from "../database/production-sql-client";
import { PostingVerificationError, recordPostingVerification } from "./posting-verification";

export interface PostingVerificationState {
  readonly status: "IDLE" | "SAVED" | "REJECTED";
  readonly error: "invalid" | "noteRequired" | "notRecipePosting" | "supersededObservation" | "notEnoughToClose" | "categoryNotForVerified" | "restricted" | "unavailable" | "failed" | null;
  readonly decision: string | null;
}

/** Step 1 of Human Review: records the operator's explicit posting-verification decision (never automatic). */
export async function recordPostingVerificationAction(_previous: PostingVerificationState, data: FormData): Promise<PostingVerificationState> {
  const candidateId = String(data.get("candidateId") ?? "").trim();
  const decision = String(data.get("decision") ?? "").trim();
  const note = String(data.get("note") ?? "").trim() || null;
  if (!candidateId || !decision) return { status: "REJECTED", error: "invalid", decision: null };
  const auth = await authorizeOperator("company_discovery.run");
  if (auth.state !== "AUTHORIZED") return { status: "REJECTED", error: "restricted", decision: null };
  const runner = getProductionTransactionRunner();
  if (!runner) return { status: "REJECTED", error: "unavailable", decision: null };
  try {
    const saved = await runner((client) => recordPostingVerification(client, { candidateId, decision, note, linkCategory: String(data.get("linkCategory") ?? "").trim() || null, operatorId: auth.operator.operatorId, now: new Date() }));
    revalidatePath(`/radar/${candidateId}`);
    revalidatePath("/radar/intelligence");
    revalidatePath("/radar");
    return { status: "SAVED", error: null, decision: saved.decision };
  } catch (error) {
    return { status: "REJECTED", error: error instanceof PostingVerificationError ? error.code : "failed", decision: null };
  }
}
