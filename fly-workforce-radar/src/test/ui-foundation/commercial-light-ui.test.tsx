import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("Commercial Light UI operator experience", () => {
  it("applies the light commercial token system after protected feature styles", async () => {
    const css = await read("src/app/globals.css");
    const layer = css.indexOf("COMMERCIAL LIGHT UI: presentation-only operator experience layer");
    expect(layer).toBeGreaterThan(css.indexOf("MATCHING-B5-D"));
    expect(css.slice(layer)).toContain("color-scheme:light");
    expect(css.slice(layer)).toContain("--canvas:#f4f6f8");
    expect(css.slice(layer)).toContain("--surface:#ffffff");
    expect(css.slice(layer)).toContain("--text:#18232d");
  });

  it("keeps active, disabled, hover, and focus affordances distinct", async () => {
    const css = await read("src/app/globals.css");
    expect(css).toContain(":not(:disabled):not([aria-disabled=\"true\"]):hover");
    expect(css).toContain("cursor:not-allowed!important");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("background:#0b5f83;color:#fff");
  });

  it("visually separates governed discovery from the canonical Radar list", async () => {
    const [css, panel] = await Promise.all([
      read("src/app/globals.css"),
      read("src/components/opportunity-radar/opportunity-search-panel.tsx"),
    ]);
    expect(css).toContain(".opportunity-search-panel");
    expect(css).toContain(".opportunity-radar-view>.radar-filters");
    expect(panel).toContain("Discovered does not mean verified or canonical.");
    expect(panel).toContain("Descubierto no significa verificado ni canónico.");
  });

  it("keeps the operator layout practical at tablet and mobile widths", async () => {
    const css = await read("src/app/globals.css");
    expect(css).toMatch(/@media\(max-width:1024px\)[\s\S]*\.opportunity-search-panel>\.radar-filters/);
    expect(css).toMatch(/@media\(max-width:767px\)[\s\S]*\.workspace\{padding:22px 14px 52px/);
    expect(css).toContain(".radar-table tr{border-color:#d3dde3");
  });

  it("preserves the dedicated Candidate Slate light and print presentation", async () => {
    const css = await read("src/components/candidate-slate/candidate-slate.module.css");
    expect(css).toContain("--paper:#f4f2eb");
    expect(css).toContain("@media print");
    expect(css).toContain(".worker.candidate");
    expect(css).toContain(".worker.blocked");
  });
});
