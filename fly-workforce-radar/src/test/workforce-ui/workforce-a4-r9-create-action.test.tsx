import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkforceListView } from "../../components/workforce/workforce-list-view";
import type { WorkforceListResult } from "../../server/workforce/get-workforce-list";
import type { WorkforceTaxonomy } from "../../server/workforce/get-workforce-taxonomy";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

/**
 * WORKFORCE-TALENT-A4-R9. A4-R9's live-browser evidence found the "Nuevo
 * trabajador" action functionally correct (real <Link>, correct href,
 * correct permission gate) but visually indistinguishable from plain text,
 * because it reused `.radar-primary-link` -- the same subdued inline-row
 * style used for worker-name navigation inside the table. This pins the
 * fix: the create action gets its own dedicated class so it reads as a
 * real primary action, while `.radar-primary-link` (and every row/detail
 * link that still uses it) is completely untouched.
 */
describe("WORKFORCE-TALENT-A4-R9 create-action styling and gating", () => {
  const taxonomy: WorkforceTaxonomy = { trades: [], occupations: [], skills: [], credentials: [] };
  const baseQuery = { lifecycleStatus: null, tradeCode: null, occupationCode: null, page: 1 } as const;
  const emptyResult: WorkforceListResult = { authorized: true, capability: "OPERATIONAL", reason: null, items: [] };

  it("renders the create action with its dedicated style and the unchanged /workforce/new href when canCreate is true", () => {
    const html = renderToStaticMarkup(
      <WorkforceListView locale="en-US" query={baseQuery} result={emptyResult} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={true} />,
    );
    expect(html).toContain('href="/workforce/new"');
    expect(html).toMatch(/class="radar-create-action"[^>]*href="\/workforce\/new"|href="\/workforce\/new"[^>]*class="radar-create-action"/);
    expect(html).not.toMatch(/class="radar-primary-link"[^>]*href="\/workforce\/new"/);
  });

  it("still gates the dedicated create action behind canCreate (profileWrite) -- it never renders when false", () => {
    // Note: ListEmpty's own unconditional "New worker" fallback link (shown
    // for an unfiltered empty result regardless of canCreate) is a separate,
    // pre-existing entry point and is intentionally not asserted against
    // here -- only the page-level .radar-create-action gate is in scope.
    const html = renderToStaticMarkup(
      <WorkforceListView locale="en-US" query={baseQuery} result={emptyResult} trades={taxonomy.trades} occupations={taxonomy.occupations} canCreate={false} />,
    );
    expect(html).not.toContain("radar-create-action");
  });

  it("leaves the worker-row detail link on .radar-primary-link untouched", async () => {
    const view = await read("src/components/workforce/workforce-list-view.tsx");
    expect(view).toContain('<Link className="radar-primary-link" href={`/workforce/${encodeURIComponent(item.worker.id)}`}>');
  });
});

describe("WORKFORCE-TALENT-A4-R9 dedicated create-action stylesheet contract", () => {
  it("defines .radar-create-action as a real button-shaped, focusable, dark-theme-readable action reusing the existing accent-action pattern", async () => {
    const css = await read("src/app/globals.css");
    const match = css.match(/\.radar-create-action\{[^}]*\}/);
    expect(match, ".radar-create-action rule must exist").not.toBeNull();
    const rule = match![0];
    expect(rule).toMatch(/display:inline-flex|display:flex/);
    expect(rule).toContain("padding:");
    expect(rule).toContain("border:");
    expect(rule).toContain("background:");
    expect(rule).toContain("margin-bottom:");
    expect(css).toContain(".radar-create-action:hover{");
    expect(css).toContain(".radar-create-action:focus-visible");
  });

  it("does not modify .radar-primary-link's own rule (row/detail link styling is unaffected)", async () => {
    const css = await read("src/app/globals.css");
    expect(css).toContain(".radar-primary-link{display:flex;flex-direction:column;gap:5px;color:var(--text);font-weight:700;text-decoration:none}");
  });

  /**
   * WORKFORCE PUBLICATION R2-B. The shared UI-9 mobile 44px touch-target
   * :where(...) rule is owned by UI-9's own publication, not this one --
   * this commit does not stage that file's touch-target hunk (an
   * inseparable UI-9 fragment, per the publication staging decision), so
   * asserting `.radar-create-action` is a member of it here would assert a
   * fact outside this commit's actual scope. The base rule this action
   * gets from A4-R9 itself already gives it a reasonable tap target
   * (min-height:34px); the additional 44px guarantee is intentionally
   * deferred and will be covered by UI-9's own test suite when published.
   */
  it("has its own baseline tap-target height from the A4-R9 rule itself, independent of the deferred UI-9 44px enhancement", async () => {
    const css = await read("src/app/globals.css");
    const match = css.match(/\.radar-create-action\{[^}]*\}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("min-height:34px");
  });

  it("A4-R8 non-sticky table-header protection remains intact", async () => {
    const css = await read("src/app/globals.css");
    const match = css.match(/\.radar-table th\{[^}]*\}/);
    const rule = match![0];
    expect(rule).not.toContain("position:sticky");
  });
});
