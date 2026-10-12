import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkerProfileView } from "../../components/workforce/worker-profile-view";
import { WorkforceListView } from "../../components/workforce/workforce-list-view";
import type { WorkerProfile } from "../../domain/worker";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";
import type { WorkerUiPermissions } from "../../server/workforce/worker-permissions";
import type { WorkforceListResult } from "../../server/workforce/get-workforce-list";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

const taxonomy: WorkforceTaxonomy = { trades: [], occupations: [], skills: [], credentials: [] };

function permissions(profileWrite: boolean): WorkerUiPermissions {
  return { authenticated: true, profileRead: true, profileWrite, contactRead: true, contactWrite: true, compensationRead: true, compensationWrite: true };
}

function profileWithStatus(lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INACTIVE"): WorkerProfile {
  return {
    worker: {
      id: "33333333-3333-4333-8333-333333333333", displayName: "SYNTHETIC-A4-R10", lifecycleStatus,
      profileVerificationState: "UNVERIFIED", verifiedAt: null, sourceOfRecord: "IMPORTED",
      firstSeenAt: new Date(), lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(),
    },
    tradeOccupations: [], skills: [], credentials: [],
    currentAvailability: { state: "UNKNOWN" }, currentLocation: { state: "UNKNOWN" },
    workHistory: [],
    contact: { access: "GRANTED", value: { routes: [] } },
    compensation: { access: "GRANTED", value: [] },
  } as unknown as WorkerProfile;
}

/**
 * WORKFORCE-TALENT-A4-R10. Only two transitions are ever exposed in the UI
 * (ACTIVE -> ARCHIVED, ARCHIVED -> ACTIVE); INACTIVE renders neither
 * control (existing behavior preserved, no new workflow invented for it).
 */
describe("WORKFORCE-TALENT-A4-R10 worker detail lifecycle controls", () => {
  it("E. shows the archive action (behind a confirmation disclosure) only when ACTIVE and profileWrite", () => {
    const html = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("ACTIVE")} taxonomy={taxonomy} permissions={permissions(true)} />,
    );
    expect(html).toContain("Archive worker");
    expect(html).toContain("<details");
    expect(html).not.toContain("Reactivate worker");
  });

  it("F. shows the reactivate action only when ARCHIVED and profileWrite", () => {
    const html = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("ARCHIVED")} taxonomy={taxonomy} permissions={permissions(true)} />,
    );
    expect(html).toContain("Reactivate worker");
    expect(html).not.toContain("Archive worker");
  });

  it("G. shows neither lifecycle control without profileWrite, regardless of status", () => {
    const activeHtml = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("ACTIVE")} taxonomy={taxonomy} permissions={permissions(false)} />,
    );
    expect(activeHtml).not.toContain("Archive worker");
    const archivedHtml = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("ARCHIVED")} taxonomy={taxonomy} permissions={permissions(false)} />,
    );
    expect(archivedHtml).not.toContain("Reactivate worker");
  });

  it("INACTIVE renders neither the archive nor the reactivate control -- existing behavior untouched", () => {
    const html = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("INACTIVE")} taxonomy={taxonomy} permissions={permissions(true)} />,
    );
    expect(html).not.toContain("Archive worker");
    expect(html).not.toContain("Reactivate worker");
  });

  it("H. the archive control is a native <details>/<summary> disclosure requiring the warning to be revealed before the real submit button, not window.confirm()", () => {
    const html = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("ACTIVE")} taxonomy={taxonomy} permissions={permissions(true)} />,
    );
    expect(html).toMatch(/<details[^>]*><summary>Archive worker<\/summary>/);
    expect(html).toContain("will not be deleted");
    expect(html).toContain("Confirm archive");
  });

  it("archive/reactivate submit forms carry the worker id through the existing hidden-field form pattern", () => {
    const active = renderToStaticMarkup(
      <WorkerProfileView locale="en-US" profile={profileWithStatus("ACTIVE")} taxonomy={taxonomy} permissions={permissions(true)} />,
    );
    expect(active).toContain('name="workerId" value="33333333-3333-4333-8333-333333333333"');
  });

  it("Spanish: archive/reactivate copy resolves to real text, never a raw dictionary key", () => {
    for (const status of ["ACTIVE", "ARCHIVED"] as const) {
      const html = renderToStaticMarkup(
        <WorkerProfileView locale="es-US" profile={profileWithStatus(status)} taxonomy={taxonomy} permissions={permissions(true)} />,
      );
      expect(html).not.toMatch(/\[\[missing:/);
    }
  });
});

describe("WORKFORCE-TALENT-A4-R10 no source-level hard-delete path", () => {
  it("J. no delete/remove worker action, server action, or SQL DELETE exists in the workforce action/repository layer", async () => {
    const [actions, repository] = await Promise.all([
      read("src/server/workforce/worker-actions.ts"),
      read("src/server/repositories/worker/postgres-worker-repository.ts"),
    ]);
    expect(actions).not.toMatch(/deleteWorkerAction|removeWorkerAction/);
    expect(repository).not.toMatch(/delete from workforce_workers|DELETE FROM workforce_workers/);
  });
});

describe("WORKFORCE-TALENT-A4-R10 list/filter preservation", () => {
  const baseQuery = { lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 } as const;

  it("I. the Estado filter still offers Active/Inactive/Archived, and an ARCHIVED result still renders as a visible, accessible row", () => {
    const archivedWorker = {
      id: "44444444-4444-4444-8444-444444444444", displayName: "SYNTHETIC-ARCHIVED-ROW", lifecycleStatus: "ARCHIVED" as const,
      profileVerificationState: "UNVERIFIED" as const, verifiedAt: null, sourceOfRecord: "IMPORTED" as const,
      firstSeenAt: new Date(), lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const result: WorkforceListResult = {
      authorized: true, capability: "OPERATIONAL", reason: null,
      items: [{ worker: archivedWorker, primaryTradeOccupation: null, tradeOccupationCount: 0, availabilityStatus: null, locationSummary: null, missingTrade: true, missingAvailability: true }],
    };
    const html = renderToStaticMarkup(
      <WorkforceListView locale="en-US" query={baseQuery} result={result} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={true} />,
    );
    expect(html).toContain("SYNTHETIC-ARCHIVED-ROW");
    expect(html).toContain('href="/workforce/44444444-4444-4444-8444-444444444444"');
    expect(html).toContain(">Archived<");
    expect(html).toMatch(/<option value="ACTIVE">Active<\/option>/);
    expect(html).toMatch(/<option value="INACTIVE">Inactive<\/option>/);
    expect(html).toMatch(/<option value="ARCHIVED">Archived<\/option>/);
  });

  it("an unfiltered query never hardcodes ACTIVE anywhere in the list read path", async () => {
    const source = await read("src/server/workforce/get-workforce-list.ts");
    expect(source).not.toMatch(/lifecycleStatus:\s*"ACTIVE"/);
  });
});
