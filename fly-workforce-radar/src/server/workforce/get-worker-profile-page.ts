import { defaultWorkerService } from "./default-worker-service";
import { getWorkforceTaxonomy, type WorkforceTaxonomy } from "./get-workforce-taxonomy";
import type { WorkerProfile } from "../../domain/worker";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkerProfilePageResult =
  | { readonly state: "READY"; readonly profile: WorkerProfile; readonly taxonomy: WorkforceTaxonomy }
  | { readonly state: "NOT_FOUND" | "UNAVAILABLE" | "UNAUTHENTICATED" | "UNAUTHORIZED" | "ERROR"; readonly profile: null; readonly taxonomy: null };

export async function getWorkerProfilePage(workerId: string): Promise<WorkerProfilePageResult> {
  if (!UUID.test(workerId)) return { state: "NOT_FOUND", profile: null, taxonomy: null };
  const service = defaultWorkerService();
  if (!service) return { state: "UNAVAILABLE", profile: null, taxonomy: null };
  try {
    const [result, taxonomy] = await Promise.all([service.getWorkerProfile(workerId), getWorkforceTaxonomy()]);
    if (result.kind === "UNAUTHENTICATED") return { state: "UNAUTHENTICATED", profile: null, taxonomy: null };
    if (result.kind === "UNAUTHORIZED") return { state: "UNAUTHORIZED", profile: null, taxonomy: null };
    if (result.kind === "VALIDATION_ERROR") return { state: "ERROR", profile: null, taxonomy: null };
    if (!result.value) return { state: "NOT_FOUND", profile: null, taxonomy: null };
    return { state: "READY", profile: result.value, taxonomy };
  } catch {
    return { state: "ERROR", profile: null, taxonomy: null };
  }
}
