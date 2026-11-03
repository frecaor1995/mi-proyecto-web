import { createHash } from "node:crypto";
import type { CapturedPayload } from "../../../domain/evidence";

export function capturedPayloadBytes(payload: CapturedPayload): Uint8Array {
  return typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
}

export function sha256CapturedPayload(payload: CapturedPayload): string {
  return createHash("sha256").update(capturedPayloadBytes(payload)).digest("hex");
}
