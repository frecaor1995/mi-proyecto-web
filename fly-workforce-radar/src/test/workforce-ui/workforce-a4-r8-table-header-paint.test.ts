import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

/**
 * WORKFORCE-TALENT-A4-R8. Live-browser elementsFromPoint() proved the
 * worker row existed in the final DOM with valid, visible geometry, but
 * the sticky, opaque `.radar-table th` (`position:sticky;top:59px`)
 * painted directly over the row's hit-test coordinates, occluding it.
 * The desktop `.radar-table` layout has no scroll-driven header use case
 * that justifies sticky positioning, so the fix removes it rather than
 * layering a z-index workaround. This pins that regression: the header
 * keeps its visual treatment but never again claims a stacking/positioning
 * behavior that can paint over row content.
 */
describe("WORKFORCE-TALENT-A4-R8 table header paint/stacking contract", () => {
  it("desktop .radar-table th is never sticky-positioned, so it cannot paint over tbody rows", async () => {
    const css = await read("src/app/globals.css");
    const match = css.match(/\.radar-table th\{[^}]*\}/);
    expect(match, ".radar-table th rule must exist").not.toBeNull();
    const rule = match![0];
    expect(rule).not.toContain("position:sticky");
    expect(rule).not.toContain("top:59px");
  });

  it("preserves the header's visual treatment (background, uppercase label styling)", async () => {
    const css = await read("src/app/globals.css");
    const match = css.match(/\.radar-table th\{[^}]*\}/);
    const rule = match![0];
    expect(rule).toContain("background:#15181d");
    expect(rule).toContain("text-transform:uppercase");
  });

  it("mobile (<=767px) header collapse behavior is untouched", async () => {
    const css = await read("src/app/globals.css");
    expect(css).toMatch(/@media\(max-width:767px\)[\s\S]*\.radar-table thead\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0,0,0,0\)\}/);
  });
});
