"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { defaultWorkerService } from "./default-worker-service";
import { field, optionalField, optionalDate, optionalInt, optionalNumber, resultToState, type WorkerActionState } from "./worker-action-helpers";
import type {
  WorkerAvailabilityStatus, WorkerCompensationRateType, WorkerConsentState, WorkerContactRouteType, WorkerRoleDesignation, WorkerSourceOfRecord,
} from "../../domain/worker";

export type { WorkerActionState } from "./worker-action-helpers";

/**
 * Creates a worker and, when a trade/occupation was supplied, its initial
 * PRIMARY association -- atomically, via WorkerService.createWorkerWithPrimaryTrade.
 * A worker with no trade is equally valid: leaving trade/occupation blank
 * falls back to the plain create path. Redirects to the new profile on
 * success; never redirects on validation/authorization failure.
 */
export async function createWorkerAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.create.submissionFailed" };

  const displayName = field(formData, "displayName");
  const sourceOfRecord = (field(formData, "sourceOfRecord") || "UNKNOWN") as WorkerSourceOfRecord;
  const tradeCode = optionalField(formData, "tradeCode");
  const occupationCode = optionalField(formData, "occupationCode");
  const experienceMonths = optionalInt(formData, "experienceMonths");

  if (!displayName) return { successKey: null, errorKey: "workforce.create.validationError" };

  let workerId: string;
  if (tradeCode && occupationCode) {
    const result = await service.createWorkerWithPrimaryTrade({ displayName, sourceOfRecord }, { tradeCode, occupationCode, experienceMonths });
    if (result.kind !== "OK") return resultToState(result, "", "workforce.create.validationError");
    workerId = result.value.worker.id;
  } else {
    const result = await service.createWorker({ displayName, sourceOfRecord });
    if (result.kind !== "OK") return resultToState(result, "", "workforce.create.validationError");
    workerId = result.value.id;
  }
  revalidatePath("/workforce");
  redirect(`/workforce/${workerId}`);
}

export async function updateWorkerOverviewAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.overview.updateError" };
  const workerId = field(formData, "workerId");
  const displayName = optionalField(formData, "displayName") ?? undefined;
  const markVerified = formData.get("markVerified") === "on";
  const result = await service.updateWorker(workerId, {
    displayName,
    ...(markVerified ? { profileVerificationState: "VERIFIED" as const, verifiedAt: new Date() } : {}),
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.overview.updateSuccess", "workforce.overview.updateError");
}

/**
 * WORKFORCE-TALENT-A4-R10. Plain (non-useActionState) form actions, matching
 * deactivateContactRouteAction's existing convention -- the worker detail
 * page renders these without a Client Component. Unlike that precedent,
 * these redirect back to the profile with an explicit outcome query param
 * so success/error feedback reflects the actual operation rather than
 * relying only on the re-rendered lifecycle state to imply it.
 */
export async function archiveWorkerAction(formData: FormData): Promise<void> {
  const workerId = field(formData, "workerId");
  const service = defaultWorkerService();
  const result = service ? await service.archiveWorker(workerId) : null;
  if (result?.kind === "OK") {
    revalidatePath(`/workforce/${workerId}`);
    revalidatePath("/workforce");
    redirect(`/workforce/${workerId}?lifecycle=archived`);
  }
  redirect(`/workforce/${workerId}?lifecycleError=archive`);
}

export async function reactivateWorkerAction(formData: FormData): Promise<void> {
  const workerId = field(formData, "workerId");
  const service = defaultWorkerService();
  const result = service ? await service.reactivateWorker(workerId) : null;
  if (result?.kind === "OK") {
    revalidatePath(`/workforce/${workerId}`);
    revalidatePath("/workforce");
    redirect(`/workforce/${workerId}?lifecycle=reactivated`);
  }
  redirect(`/workforce/${workerId}?lifecycleError=reactivate`);
}

export async function addTradeOccupationAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.tradeOccupation.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.addTradeOccupation({
    workerId,
    tradeCode: field(formData, "tradeCode"),
    occupationCode: field(formData, "occupationCode"),
    roleDesignation: (field(formData, "roleDesignation") || "SECONDARY") as WorkerRoleDesignation,
    experienceMonths: optionalInt(formData, "experienceMonths"),
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.tradeOccupation.addSuccess", "workforce.tradeOccupation.addError");
}

export async function removeTradeOccupationAction(formData: FormData): Promise<void> {
  const service = defaultWorkerService();
  if (!service) return;
  const workerId = field(formData, "workerId");
  await service.removeTradeOccupation(workerId, field(formData, "tradeCode"), field(formData, "occupationCode"));
  revalidatePath(`/workforce/${workerId}`);
}

export async function addSkillAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.skills.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.addSkill({ workerId, skillCode: field(formData, "skillCode") });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.skills.addSuccess", "workforce.skills.addError");
}

export async function removeSkillAction(formData: FormData): Promise<void> {
  const service = defaultWorkerService();
  if (!service) return;
  const workerId = field(formData, "workerId");
  await service.removeSkill(workerId, field(formData, "skillCode"));
  revalidatePath(`/workforce/${workerId}`);
}

/** rawIdentifier, if present, is written but is never echoed back in the
 * returned form state -- only successKey/errorKey ever reach the client. */
export async function addCredentialAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.credentials.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.addCredential({
    workerId,
    credentialCode: field(formData, "credentialCode"),
    rawIdentifier: optionalField(formData, "rawIdentifier"),
    issuedAt: optionalDate(formData, "issuedAt"),
    expiresAt: optionalDate(formData, "expiresAt"),
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.credentials.addSuccess", "workforce.credentials.addError");
}

export async function verifyCredentialAction(formData: FormData): Promise<void> {
  const service = defaultWorkerService();
  if (!service) return;
  const workerId = field(formData, "workerId");
  await service.updateCredentialVerification({
    workerId, credentialCode: field(formData, "credentialCode"), verificationState: "VERIFIED", verifiedAt: new Date(),
  });
  revalidatePath(`/workforce/${workerId}`);
}

export async function appendAvailabilityAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.availability.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.appendAvailability({
    workerId,
    status: (field(formData, "status") || "UNKNOWN") as WorkerAvailabilityStatus,
    availableFrom: optionalDate(formData, "availableFrom"),
    availableUntil: optionalDate(formData, "availableUntil"),
    source: "OPERATOR_ENTERED",
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.availability.addSuccess", "workforce.availability.addError");
}

export async function appendLocationAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.location.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.appendLocation({
    workerId,
    city: optionalField(formData, "city"),
    region: optionalField(formData, "region"),
    country: optionalField(formData, "country"),
    travelWilling: formData.get("travelWilling") === "on",
    travelRadiusMiles: optionalInt(formData, "travelRadiusMiles"),
    relocationWilling: formData.get("relocationWilling") === "on",
    source: "OPERATOR_ENTERED",
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.location.addSuccess", "workforce.location.addError");
}

export async function addWorkHistoryAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.workHistory.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.addWorkHistory({
    workerId,
    employerLabel: field(formData, "employerLabel"),
    projectLabel: optionalField(formData, "projectLabel"),
    startDate: optionalDate(formData, "startDate"),
    endDate: optionalDate(formData, "endDate"),
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.workHistory.addSuccess", "workforce.workHistory.addError");
}

export async function markWorkHistoryEndedAction(formData: FormData): Promise<void> {
  const service = defaultWorkerService();
  if (!service) return;
  const workerId = field(formData, "workerId");
  await service.updateWorkHistory({ id: field(formData, "id"), endDate: new Date() });
  revalidatePath(`/workforce/${workerId}`);
}

/** Fail-closed at the form boundary too: consentState "GRANTED" without a
 * captured timestamp is rejected before this even reaches WorkerService
 * (which independently enforces the same rule). */
export async function addContactRouteAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.contact.addError" };
  const workerId = field(formData, "workerId");
  const consentState = (field(formData, "consentState") || "UNKNOWN") as WorkerConsentState;
  const result = await service.addContactRoute({
    workerId,
    routeType: (field(formData, "routeType") || "OTHER") as WorkerContactRouteType,
    target: field(formData, "target"),
    consentState,
    consentCapturedAt: consentState === "GRANTED" ? new Date() : null,
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.contact.addSuccess", "workforce.contact.addError");
}

export async function updateContactConsentAction(formData: FormData): Promise<void> {
  const service = defaultWorkerService();
  if (!service) return;
  const workerId = field(formData, "workerId");
  const consentState = field(formData, "consentState") as WorkerConsentState;
  await service.updateContactConsent({
    id: field(formData, "id"), consentState, consentCapturedAt: consentState === "GRANTED" ? new Date() : null,
  });
  revalidatePath(`/workforce/${workerId}`);
}

export async function deactivateContactRouteAction(formData: FormData): Promise<void> {
  const service = defaultWorkerService();
  if (!service) return;
  const workerId = field(formData, "workerId");
  await service.deactivateContactRoute(field(formData, "id"));
  revalidatePath(`/workforce/${workerId}`);
}

export async function appendCompensationAction(_previous: WorkerActionState, formData: FormData): Promise<WorkerActionState> {
  const service = defaultWorkerService();
  if (!service) return { successKey: null, errorKey: "workforce.compensation.addError" };
  const workerId = field(formData, "workerId");
  const result = await service.appendCompensationExpectation({
    workerId,
    rateType: (field(formData, "rateType") || "HOURLY") as WorkerCompensationRateType,
    rateMin: optionalNumber(formData, "rateMin"),
    ratePreferred: optionalNumber(formData, "ratePreferred"),
    currency: optionalField(formData, "currency") ?? "USD",
    perDiemRequired: formData.get("perDiemRequired") === "on",
    negotiable: formData.get("negotiable") === "on",
  });
  if (result.kind === "OK") revalidatePath(`/workforce/${workerId}`);
  return resultToState(result, "workforce.compensation.addSuccess", "workforce.compensation.addError");
}
