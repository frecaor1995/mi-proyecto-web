import { describe, expect, it } from "vitest";
import { toSafeEvidenceText } from "../../domain/safe-evidence-text";

describe("provider evidence plain-text presentation", () => {
  it("removes presentation tags while preserving readable words", () => {
    expect(toSafeEvidenceText("<strong>Northstar is hiring</strong> electricians")).toBe("Northstar is hiring electricians");
  });

  it("decodes named and numeric entities", () => {
    expect(toSafeEvidenceText("Electrical &amp; industrial &#38; controls &#x26; service")).toBe("Electrical & industrial & controls & service");
  });

  it("neutralizes encoded markup without interpreting it as HTML", () => {
    expect(toSafeEvidenceText("&lt;img src=x onerror=alert(1)&gt;Safe evidence")).toBe("Safe evidence");
    expect(toSafeEvidenceText("&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;Verified text")).toBe("alert(1) Verified text");
  });

  it("removes comments, control characters and normalizes whitespace", () => {
    expect(toSafeEvidenceText("A<!-- hidden --><br>B\u0000\n C")).toBe("A B C");
  });

  it("does not reinterpret compensation as workforce quantity", async () => {
    const { classifyDiscoveryQuantity } = await import("../../domain/discovery-quantity");
    const excerpt = toSafeEvidenceText("<strong>$22-$74/hr</strong> Electrician jobs")!;
    expect(classifyDiscoveryQuantity({ title: excerpt, domain: "example.test" }).type).toBe("NOT_A_WORKFORCE_QUANTITY");
  });
});
