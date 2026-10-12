import { describe, expect, it } from "vitest";
import { deterministicUuid, normalizeRows } from "../../../scripts/workforce-import/import-workforce";

const row = (rowNumber: number, id: string, name: string, overrides: Record<string, string> = {}) => ({
  rowNumber,
  values: {
    "WORKER ID": id, "FULL NAME": name, TRADE: "ELECTRICAL", LEVEL: "APPRENTICE", "YEARS EXPERIENCE": "5",
    AVAILABILITY: "AVAILABLE_NOW", "TDLR TYPE": "APPRENTICE", "TDLR NUMBER": `TDLR-${id}`, "TDLR EXPIRATION": "2027-10-03",
    "TDLR VERIFICATION": "UNKNOWN", OSHA: "", "WORK AUTH DOCUMENT STATUS": "UNKNOWN", "CONSENT TO PRESENT": "UNKNOWN",
    "EXPERIENCE SUMMARY": "Commercial electrical work", "IMPORT STATUS": "READY_FOR_REVIEW", "IMPORT NOTES": "", ...overrides,
  },
});

describe("controlled Workforce 31 importer", () => {
  it("accepts exactly 31 unique normalized workers and preserves UNKNOWN", () => {
    const workers = normalizeRows(Array.from({ length: 31 }, (_, index) => row(index + 2, `FW-${index + 1}`, `Worker ${index + 1}`)));
    expect(workers).toHaveLength(31);
    expect(workers.every((worker) => worker.tdlrVerification === "UNKNOWN" && worker.candidatePresentationConsent === "UNKNOWN")).toBe(true);
  });

  it("rejects duplicate canonical identities", () => {
    const rows = Array.from({ length: 31 }, (_, index) => row(index + 2, `FW-${index + 1}`, index === 30 ? "Worker 1" : `Worker ${index + 1}`));
    expect(() => normalizeRows(rows)).toThrow("DUPLICATE_SOURCE_NAME");
  });

  it("rejects forbidden sensitive identifiers without echoing their value", () => {
    const rows = Array.from({ length: 31 }, (_, index) => row(index + 2, `FW-${index + 1}`, `Worker ${index + 1}`, index === 0 ? { "EXPERIENCE SUMMARY": "SSN present" } : {}));
    expect(() => normalizeRows(rows)).toThrow("FORBIDDEN_DATA_ROW_2");
  });

  it("generates stable UUIDs for idempotent upserts", () => {
    const first = deterministicUuid("worker", "FW1");
    expect(deterministicUuid("worker", "FW1")).toBe(first);
    expect(deterministicUuid("worker", "FW2")).not.toBe(first);
  });

  it("accepts an explicit worker level and TDLR designation that differ", () => {
    const rows = Array.from({ length: 31 }, (_, index) => row(index + 2, `FW-${index + 1}`, `Worker ${index + 1}`));
    rows[0].values.LEVEL = "JOURNEYMAN";
    rows[0].values["TDLR TYPE"] = "APPRENTICE";
    const worker = normalizeRows(rows)[0];
    expect(worker.levelCode).toBe("JOURNEYMAN");
    expect(worker.credentialDesignation).toBe("APPRENTICE_ELECTRICIAN");
  });

  it("keeps an absent TDLR designation null without copying worker level", () => {
    const rows = Array.from({ length: 31 }, (_, index) => row(index + 2, `FW-${index + 1}`, `Worker ${index + 1}`));
    rows[0].values.LEVEL = "JOURNEYMAN";
    rows[0].values["TDLR TYPE"] = "";
    expect(normalizeRows(rows)[0]).toMatchObject({ levelCode: "JOURNEYMAN", tdlrType: null, credentialDesignation: null });
  });

  it("supports MASTER level and credential designation as independent controlled values", () => {
    const rows = Array.from({ length: 31 }, (_, index) => row(index + 2, `FW-${index + 1}`, `Worker ${index + 1}`));
    rows[0].values.LEVEL = "MASTER";
    rows[0].values["TDLR TYPE"] = "JOURNEYMAN";
    expect(normalizeRows(rows)[0]).toMatchObject({ levelCode: "MASTER", credentialDesignation: "JOURNEYMAN_ELECTRICIAN" });
  });
});
