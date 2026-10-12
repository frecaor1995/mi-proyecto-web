import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationResult } from "../../server/auth/authorization";
import { assembleCandidateSlate } from "../../server/candidate-slate/candidate-slate-read-model";
import { CandidateSlateView } from "../../components/candidate-slate/candidate-slate-view";

vi.mock("server-only", () => ({}));

const CONTEXT = "Unverified Fixture Contractor";
const CANONICAL = "Canonical Fixture Co";
const authorize = async (permission: string): Promise<AuthorizationResult> =>
  ({ state: "AUTHORIZED", operator: { operatorId: "o", authUserId: "u", email: "operator@example.test", permissions: [permission] } }) as AuthorizationResult;
const clientReturning = (customer: string | null, customerContext: string | null) => ({
  query: vi.fn(async (sql: string) => ({
    rows: sql.includes("from opportunities o")
      ? [{ id: "opportunity-1", title: "Fixture requirement", lifecycle: "ACTIVE", project: null, location: "Houston, TX", customer, customer_context: customerContext }]
      : [],
  })),
});
const load = async (customer: string | null, customerContext: string | null) => {
  const { getCandidateSlate } = await import("../../server/candidate-slate/get-candidate-slate");
  const client = clientReturning(customer, customerContext);
  const result = await getCandidateSlate("opportunity-1", { client: client as never, authorize });
  if (result.state !== "READY") throw new Error(`expected READY, got ${result.state}`);
  return result;
};
const customerCell = (html: string) => /<dt>(?:Cliente|Customer)<\/dt><dd>(.*?)<\/dd>/.exec(html)?.[1] ?? "";

describe("Candidate Slate customer: only a canonical company is ever the customer", () => {
  it("without a canonical link, free-text company context is never shown as the customer", async () => {
    const result = await load(null, CONTEXT);
    expect(result.slate.customer).toBeNull();
    expect(result.slate.customerContext).toBe(CONTEXT);
    const es = renderToStaticMarkup(<CandidateSlateView locale="es-US" result={result} group={null} />);
    const en = renderToStaticMarkup(<CandidateSlateView locale="en-US" result={result} group={null} />);
    expect(customerCell(es).startsWith("Empresa no confirmada")).toBe(true);
    expect(customerCell(en).startsWith("Company not confirmed")).toBe(true);
    expect(es).toContain(`Contexto sin verificar (no es un cliente confirmado): ${CONTEXT}`);
    expect(en).toContain(`Unverified context (not a confirmed customer): ${CONTEXT}`);
    expect(customerCell(es).startsWith(CONTEXT)).toBe(false);
  });

  it("with a valid canonical link, the canonical company is the customer and no unverified context is shown", async () => {
    const result = await load(CANONICAL, CONTEXT);
    expect(result.slate.customer).toBe(CANONICAL);
    expect(result.slate.customerContext).toBeNull();
    const es = renderToStaticMarkup(<CandidateSlateView locale="es-US" result={result} group={null} />);
    expect(customerCell(es)).toBe(CANONICAL);
    expect(es).not.toContain("Contexto sin verificar");
    expect(es).not.toContain(CONTEXT);
  });

  it("without any company information, the customer is reported as not confirmed (never invented)", async () => {
    const result = await load(null, null);
    const es = renderToStaticMarkup(<CandidateSlateView locale="es-US" result={result} group={null} />);
    expect(customerCell(es)).toBe("Empresa no confirmada");
    expect(es).not.toContain("Contexto sin verificar");
  });

  it("the read model drops unverified context whenever a canonical customer exists", () => {
    const base = { opportunityId: "o", opportunityTitle: null, project: null, location: null, demands: [], workers: [] };
    expect(assembleCandidateSlate({ ...base, customer: null, customerContext: CONTEXT }).customerContext).toBe(CONTEXT);
    expect(assembleCandidateSlate({ ...base, customer: CANONICAL, customerContext: CONTEXT }).customerContext).toBeNull();
  });

  it("the customer query uses only the canonical opportunity_companies link (no project-owner or free-text fallback)", async () => {
    const sourceCode = await readFile(path.join(process.cwd(), "src/server/candidate-slate/get-candidate-slate.ts"), "utf8");
    const sql = /const OPPORTUNITY_SQL=`([\s\S]*?)`;/.exec(sourceCode)?.[1] ?? "";
    expect(sql).toContain("opportunity_companies");
    expect(sql).toContain("coalesce(c.common_name,c.legal_name) customer");
    expect(sql).not.toMatch(/coalesce\([^)]*unresolved_company_context[^)]*\)\s*customer\b/);
    expect(sql).not.toContain("owner_company_id");
  });

  it("the printable output hides the unverified context", async () => {
    const css = await readFile(path.join(process.cwd(), "src/components/candidate-slate/candidate-slate.module.css"), "utf8");
    const print = /@media print\{([\s\S]*)$/.exec(css)?.[1] ?? "";
    // must out-rank the global `.workspace small{display:block}` (0,1,1): a bare `.unverified` (0,1,0) still prints
    expect(print).toContain("main.shell .unverified{display:none}");
    const html = renderToStaticMarkup(<CandidateSlateView locale="es-US" result={await load(null, CONTEXT)} group={null} />);
    expect(html).toMatch(new RegExp(`<small class="[^"]*unverified[^"]*">Contexto sin verificar`));
  });
});
