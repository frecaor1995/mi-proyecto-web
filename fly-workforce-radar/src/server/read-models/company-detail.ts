import type { CompanyRecord, CompanyResolution, CompanyRoleRecord } from "../../domain/company";
import type { ContactPersonRecord, ContactRouteRecord } from "../../domain/contact";
import type { AcceptanceEvaluation, PersistedManpowerAcceptanceResult } from "../../domain/manpower-acceptance";
import { normalizeManpowerAcceptanceResult } from "../../domain/manpower-acceptance";
import type { EvidenceRecord } from "../../domain/evidence";
import type { CompanyEnumerationEntry } from "../repositories/company/company-repository";
import type { OpportunityEnumerationEntry } from "../repositories/opportunity/opportunity-repository";
import type { CompanyIntelligenceProfile } from "./company-intelligence";
import { assembleCompanyIntelligenceProfile } from "./company-intelligence";
import type { ExternalManpowerAcceptanceView } from "./opportunity-radar";
import { assembleExternalManpowerAcceptanceView } from "./opportunity-radar";
import type { HumanVerificationDeskItem, HumanVerificationDeskRecord } from "./human-verification-desk";
import { assembleHumanVerificationDeskItem } from "./human-verification-desk";
import type { EvidenceTimelineItem } from "./evidence-timeline";
import { assembleEvidenceTimelineItem } from "./evidence-timeline";
import type { ReadModelCapabilityState, ReadModelCurrentness, ReadModelTrustState } from "./shared";
import { currentnessFromLastObserved, currentnessFromStaleAfter, mapDatabaseVerificationState, mapManpowerAcceptanceTrustState } from "./shared";

/**
 * Presentation-derived, non-canonical investigation hints (UI-7 section 6):
 * every kind here is computed strictly from already-fetched canonical state
 * (contact/manpower/opportunity/evidence presence and trust), never a new
 * business rule, and never mutates anything.
 */
export const INTELLIGENCE_GAP_KINDS = [
  "DECISION_MAKER_NOT_VERIFIED", "CONTACT_ROUTE_UNAVAILABLE", "MANPOWER_ACCEPTANCE_UNRESOLVED",
  "VENDOR_ROUTE_UNKNOWN", "EVIDENCE_STALE", "NO_RELATED_OPPORTUNITIES",
] as const;
export type IntelligenceGapKind = (typeof INTELLIGENCE_GAP_KINDS)[number];

export interface CompanyListItem {
  readonly companyId: string;
  readonly displayName: string | null;
  readonly currentness: ReadModelCurrentness;
  readonly relatedOpportunityCount: number;
  readonly contactRouteCount: number;
  readonly hasVerifiedContactRoute: boolean;
  readonly manpowerTrustState: ReadModelTrustState | null;
  readonly pendingVerificationCount: number;
  readonly primaryGap: IntelligenceGapKind | null;
}

export function assembleCompanyListItem(entry: CompanyEnumerationEntry, asOf: Date): CompanyListItem {
  const manpowerTrustState = entry.latestManpowerResult
    ? mapManpowerAcceptanceTrustState(normalizeManpowerAcceptanceResult(entry.latestManpowerResult as PersistedManpowerAcceptanceResult))
    : null;
  const primaryGap: IntelligenceGapKind | null =
    entry.contactRouteCount === 0 ? "CONTACT_ROUTE_UNAVAILABLE"
    : !entry.hasVerifiedContactRoute ? "DECISION_MAKER_NOT_VERIFIED"
    : manpowerTrustState !== "VERIFIED" ? "MANPOWER_ACCEPTANCE_UNRESOLVED"
    : entry.relatedOpportunityCount === 0 ? "NO_RELATED_OPPORTUNITIES"
    : null;
  return {
    companyId: entry.company.id,
    displayName: entry.company.commonName ?? entry.company.legalName,
    currentness: currentnessFromLastObserved(asOf, entry.company.lastSeenAt),
    relatedOpportunityCount: entry.relatedOpportunityCount,
    contactRouteCount: entry.contactRouteCount,
    hasVerifiedContactRoute: entry.hasVerifiedContactRoute,
    manpowerTrustState,
    pendingVerificationCount: entry.pendingVerificationCount,
    primaryGap,
  };
}

export interface CompanyRelatedOpportunityView {
  readonly opportunityId: string;
  readonly title: string | null;
  readonly projectId: string | null;
  readonly location: string | null;
  readonly lifecycle: string;
  readonly currentness: ReadModelCurrentness;
}

/**
 * One row per (person, route) pairing -- a person with two routes appears
 * twice, a route with no known person appears once with `personId: null`.
 * Never presents a candidate/unverified route as a verified decision path.
 */
export interface CompanyContactView {
  readonly personId: string | null;
  readonly name: string | null;
  readonly title: string | null;
  readonly contactFunction: string | null;
  readonly routeId: string | null;
  readonly routeType: string | null;
  readonly routeTarget: string | null;
  readonly routeGrade: string | null;
  readonly trustState: ReadModelTrustState;
  readonly currentness: ReadModelCurrentness;
}

export interface CompanyDetailView {
  readonly overview: CompanyIntelligenceProfile;
  readonly relatedOpportunities: readonly CompanyRelatedOpportunityView[];
  readonly contacts: readonly CompanyContactView[];
  /** Always UNAVAILABLE today: `vendor_routes` has no company-scoped read path yet -- see UI-7 report section D/enumeration boundary. Never inferred from a supplier-portal-shaped contact route. */
  readonly vendorRouteCapability: ReadModelCapabilityState;
  readonly manpowerAcceptance: ExternalManpowerAcceptanceView | null;
  readonly manpowerAcceptanceHistory: readonly ExternalManpowerAcceptanceView[];
  readonly humanVerification: readonly HumanVerificationDeskItem[];
  readonly evidence: readonly EvidenceTimelineItem[];
  readonly gaps: readonly IntelligenceGapKind[];
}

export interface CompanyDetailAssemblyInput {
  readonly company: CompanyRecord;
  readonly resolution?: CompanyResolution | null;
  readonly roles?: readonly CompanyRoleRecord[];
  readonly relatedOpportunities?: readonly OpportunityEnumerationEntry[];
  readonly contactPeople?: readonly ContactPersonRecord[];
  readonly contactRoutes?: readonly ContactRouteRecord[];
  readonly manpowerAcceptanceHistory?: readonly AcceptanceEvaluation[];
  readonly humanVerificationTasks?: readonly HumanVerificationDeskRecord[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly asOf: Date;
}

function contactView(asOf: Date, person: ContactPersonRecord | null, route: ContactRouteRecord | null): CompanyContactView {
  const trustSource = route?.verificationState ?? person?.verificationState ?? "UNVERIFIED";
  const staleAfter = route?.staleAfter ?? person?.staleAfter;
  return {
    personId: person?.id ?? null,
    name: person?.fullName ?? null,
    title: person?.title ?? null,
    contactFunction: person?.contactFunction ?? null,
    routeId: route?.id ?? null,
    routeType: route?.routeType ?? null,
    routeTarget: route?.target ?? null,
    routeGrade: route?.routeGrade ?? null,
    trustState: mapDatabaseVerificationState(trustSource),
    currentness: currentnessFromStaleAfter(asOf, staleAfter),
  };
}

/**
 * Reuses four certified assemblers verbatim (assembleCompanyIntelligenceProfile
 * from UI-2, assembleExternalManpowerAcceptanceView and
 * assembleHumanVerificationDeskItem and assembleEvidenceTimelineItem from
 * UI-2/UI-6) rather than re-deriving trust/currentness mapping -- see UI-7
 * report section E.
 */
export function assembleCompanyDetailView(input: CompanyDetailAssemblyInput): CompanyDetailView {
  const {
    company, resolution, roles = [], relatedOpportunities = [], contactPeople = [], contactRoutes = [],
    manpowerAcceptanceHistory = [], humanVerificationTasks = [], evidence = [], asOf,
  } = input;

  const overview = assembleCompanyIntelligenceProfile({ company, resolution, roles, asOf });

  const relatedOpportunityViews: CompanyRelatedOpportunityView[] = relatedOpportunities.map((entry) => ({
    opportunityId: entry.opportunity.id,
    title: entry.opportunity.title,
    projectId: entry.opportunity.projectId,
    location: entry.location,
    lifecycle: entry.opportunity.lifecycle,
    currentness: currentnessFromStaleAfter(asOf, entry.opportunity.staleAfter),
  }));

  const routesByPerson = new Map<string, ContactRouteRecord[]>();
  const unassignedRoutes: ContactRouteRecord[] = [];
  for (const route of contactRoutes) {
    if (route.contactPersonId) {
      const list = routesByPerson.get(route.contactPersonId) ?? [];
      list.push(route);
      routesByPerson.set(route.contactPersonId, list);
    } else {
      unassignedRoutes.push(route);
    }
  }
  const contacts: CompanyContactView[] = [];
  for (const person of contactPeople) {
    const personRoutes = routesByPerson.get(person.id);
    if (personRoutes?.length) for (const route of personRoutes) contacts.push(contactView(asOf, person, route));
    else contacts.push(contactView(asOf, person, null));
  }
  for (const route of unassignedRoutes) contacts.push(contactView(asOf, null, route));

  const manpowerViews = [...manpowerAcceptanceHistory]
    .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())
    .map((evaluation) => assembleExternalManpowerAcceptanceView(evaluation, asOf));
  const manpowerAcceptance = manpowerViews[0] ?? null;

  const humanVerification = humanVerificationTasks.map((record) => assembleHumanVerificationDeskItem(record, asOf));
  const evidenceItems = evidence.map((record) => assembleEvidenceTimelineItem({ evidence: record, asOf }));

  const gaps: IntelligenceGapKind[] = [];
  if (contacts.length === 0) gaps.push("CONTACT_ROUTE_UNAVAILABLE");
  else if (!contacts.some((c) => c.trustState === "VERIFIED")) gaps.push("DECISION_MAKER_NOT_VERIFIED");
  if (!manpowerAcceptance || manpowerAcceptance.trustState !== "VERIFIED") gaps.push("MANPOWER_ACCEPTANCE_UNRESOLVED");
  gaps.push("VENDOR_ROUTE_UNKNOWN");
  if (evidenceItems.some((item) => item.currentness === "STALE")) gaps.push("EVIDENCE_STALE");
  if (relatedOpportunityViews.length === 0) gaps.push("NO_RELATED_OPPORTUNITIES");

  return {
    overview,
    relatedOpportunities: relatedOpportunityViews,
    contacts,
    vendorRouteCapability: "UNAVAILABLE",
    manpowerAcceptance,
    manpowerAcceptanceHistory: manpowerViews,
    humanVerification,
    evidence: evidenceItems,
    gaps,
  };
}
