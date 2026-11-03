"use server";

import { revalidatePath } from "next/cache";
import { authorizeOperator } from "../auth/authorization";
import { getProductionSqlClient } from "../database/production-sql-client";
import { enrichSource } from "./enrich-source";

export interface EnrichActionState {
  readonly state: "IDLE" | "DONE" | "COOLDOWN" | "RESTRICTED" | "UNAVAILABLE" | "INVALID";
  readonly status: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One manual retrieval per source every 10 minutes: enrichment is bounded, never a crawler. */
const MANUAL_COOLDOWN_MINUTES = 10;

export async function enrichSignalSourceAction(previous: EnrichActionState, formData: FormData): Promise<EnrichActionState> {
  void previous;
  const candidateId = String(formData.get("candidateId") ?? "");
  if (!UUID.test(candidateId)) return { state: "INVALID", status: null };
  const authorization = await authorizeOperator("company_discovery.run");
  if (authorization.state !== "AUTHORIZED") return { state: "RESTRICTED", status: null };
  const client = getProductionSqlClient();
  if (!client) return { state: "UNAVAILABLE", status: null };
  const candidate = (await client.query<{ candidate_url: string; normalized_candidate_url: string }>(
    "select candidate_url, normalized_candidate_url from company_discovery_candidates where id = $1", [candidateId])).rows[0];
  if (!candidate) return { state: "INVALID", status: null };
  const recent = await client.query<{ n: string | number }>(
    "select count(*) as n from discovery_source_enrichments where normalized_candidate_url = $1 and fetched_at > now() - make_interval(mins => $2)",
    [candidate.normalized_candidate_url, MANUAL_COOLDOWN_MINUTES]);
  if (Number(recent.rows[0]?.n ?? 0) > 0) return { state: "COOLDOWN", status: null };
  const record = await enrichSource(client, { normalizedUrl: candidate.normalized_candidate_url, url: candidate.candidate_url, trigger: "MANUAL", operatorId: authorization.operator.operatorId });
  revalidatePath(`/radar/${candidateId}`);
  revalidatePath("/radar");
  return { state: "DONE", status: record.status };
}
