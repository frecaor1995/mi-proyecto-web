import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../app/page";

describe("Radar foundation", () => {
  it("identifies the dedicated application and its initialized state", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain("Fly Workforce");
    expect(markup).toContain("Radar");
    expect(markup).toContain("Foundation initialized");
    expect(markup).toContain("Phase 1A");
  });
});
