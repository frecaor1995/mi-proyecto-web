import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizePublicCandidateUrl } from "./brave-search-provider";
import type { GovernedCaptureGateway } from "./candidate-processing";
import { PostgresEvidenceRepository, type SqlClient } from "../repositories/evidence/postgres-evidence-repository";
import { PostgresSourceRepository } from "../repositories/source/postgres-source-repository";
import { EvidenceCaptureService } from "../services/evidence/capture-evidence";
import { SourcePolicyService } from "../services/source/source-policy-service";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;
const ACCEPTED_TYPES = ["text/html", "text/plain", "application/pdf"];

type AddressLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

function unsafeIpv4(address: string) {
  const p = address.split(".").map(Number);
  return p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)
    || p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 0) || (p[0] === 192 && p[1] === 168)
    || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}

function unsafeIpv6(address: string) {
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
    || /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("2001:db8:");
}

async function defaultLookup(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export class PostgresGovernedDestinationCapture implements GovernedCaptureGateway {
  private readonly sourceRepository: PostgresSourceRepository;
  private readonly policy: SourcePolicyService;
  private readonly evidence: EvidenceCaptureService;

  constructor(
    private readonly db: SqlClient,
    private readonly transport: typeof fetch = fetch,
    private readonly resolveAddresses: AddressLookup = defaultLookup,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sourceRepository = new PostgresSourceRepository(db);
    this.policy = new SourcePolicyService(this.sourceRepository);
    this.evidence = new EvidenceCaptureService(new PostgresEvidenceRepository(db));
  }

  async captureDestination(input: { readonly runId?: string; readonly url: string; readonly target: string }) {
    if (!input.runId) return { state: "REJECTED" as const, reason: "A durable discovery run is required for destination capture" };
    const normalized = normalizePublicCandidateUrl(input.url);
    if (!normalized) return { state: "REJECTED" as const, reason: "Destination URL failed public HTTPS safety validation" };
    const rootDomain = normalized.domain.replace(/^www\./, "");
    const sourceResult = await this.db.query<{ id: string }>(
      `select id from sources where enabled=true and (lower(domain)=$1 or lower(domain)=$2)
       order by case when lower(domain)=$1 then 0 else 1 end,id limit 1`,
      [normalized.domain, rootDomain],
    );
    const sourceId = sourceResult.rows[0]?.id;
    if (!sourceId) return { state: "REVIEW_REQUIRED" as const, reason: "Destination domain is not in the governed source registry" };
    const decision = await this.policy.evaluate(sourceId, "HTTP_FETCH", this.now());
    if (decision.result === "DENY") return { state: "REJECTED" as const, reason: decision.reason };
    if (decision.result !== "ALLOW") return { state: "REVIEW_REQUIRED" as const, reason: decision.reason };

    const executionId = randomUUID();
    await this.db.query(
      `insert into company_discovery_run_sources(run_id,source_id,status)
       values($1,$2,'SELECTED') on conflict(run_id,source_id) do nothing`, [input.runId, sourceId],
    );
    await this.db.query(
      "update company_discovery_run_sources set status='SEARCHING' where run_id=$1 and source_id=$2 and status='SELECTED'",
      [input.runId, sourceId],
    );
    try {
      let current = normalized.normalizedUrl;
      let response: Response | null = null;
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const safe = normalizePublicCandidateUrl(current);
        if (!safe) throw new Error("UNSAFE_REDIRECT");
        const addresses = await this.resolveAddresses(safe.domain);
        if (!addresses.length || addresses.some(({ address }) => isIP(address) === 4 ? unsafeIpv4(address) : unsafeIpv6(address))) {
          throw new Error("UNSAFE_DESTINATION_ADDRESS");
        }
        response = await this.transport(safe.normalizedUrl, {
          method: "GET", redirect: "manual", cache: "no-store", credentials: "omit",
          headers: { Accept: "text/html,text/plain,application/pdf;q=0.8", "User-Agent": "FlyWorkforceRadar/Discovery-MVP-B-R1" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === MAX_REDIRECTS) throw new Error("REDIRECT_LIMIT");
          current = new URL(location, safe.normalizedUrl).toString();
          continue;
        }
        if (!response.ok) throw new Error(`DESTINATION_HTTP_${response.status}`);
        break;
      }
      if (!response) throw new Error("DESTINATION_NO_RESPONSE");
      const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
      if (!ACCEPTED_TYPES.includes(contentType)) throw new Error("UNSUPPORTED_CONTENT_TYPE");
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (declaredSize > MAX_BYTES) throw new Error("DESTINATION_RESPONSE_TOO_LARGE");
      const payload = new Uint8Array(await response.arrayBuffer());
      if (payload.byteLength > MAX_BYTES) throw new Error("DESTINATION_RESPONSE_TOO_LARGE");
      const capturedAt = this.now();
      const record = await this.evidence.capture({
        sourceId, sourceUrl: response.url || current, capturedAt, captureMethod: "HTTP_FETCH", payload,
        contentType, extractorVersion: "discovery-destination@1",
        httpMetadata: { status: response.status, contentType, contentLength: payload.byteLength },
        metadata: { discoveryRunId: input.runId, captureExecutionId: executionId, destinationCandidateUrl: normalized.normalizedUrl, target: input.target },
      });
      await this.db.query(
        `update company_discovery_run_sources set status='COMPLETED',evidence_count=evidence_count+1
         where run_id=$1 and source_id=$2`, [input.runId, sourceId],
      );
      return { state: "CAPTURED" as const, evidenceId: record.id, reason: "Approved destination captured as canonical evidence" };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "DESTINATION_CAPTURE_FAILED";
      await this.db.query(
        `update company_discovery_run_sources set status='FAILED',sanitized_failure=$3::jsonb
         where run_id=$1 and source_id=$2`, [input.runId, sourceId, JSON.stringify({ classification: code })],
      );
      return { state: "FAILED" as const, reason: code.replaceAll("_", " ").toLowerCase() };
    }
  }
}
