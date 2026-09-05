/**
 * I18N-1. The single Dictionary shape both locale files must conform to via
 * `satisfies Dictionary`. A key missing (or misspelled) in either
 * src/i18n/locales/en-US.ts or es-US.ts is a TypeScript compile error, not a
 * runtime gap -- see I18N-0 section I/AA for why this was chosen over an
 * external i18n library.
 */
export interface Dictionary {
  readonly meta: { readonly title: string; readonly titleTemplate: string; readonly description: string };
  readonly a11y: {
    readonly skipToContent: string;
    readonly closeNavigation: string;
    readonly primaryNavigation: string;
    readonly expandNavigation: string;
    readonly collapseNavigation: string;
    readonly openNavigation: string;
    readonly searchUnavailable: string;
    readonly workspaceProfile: string;
    readonly languageSelector: string;
  };
  readonly nav: {
    readonly groupOverview: string;
    readonly groupIntelligence: string;
    readonly groupOperations: string;
    readonly groupKnowledge: string;
    readonly groupSystem: string;
    readonly commandCenter: string;
    readonly opportunities: string;
    readonly companies: string;
    readonly projects: string;
    readonly contacts: string;
    readonly signals: string;
    readonly verification: string;
    readonly actions: string;
    readonly hot: string;
    readonly nearReady: string;
    readonly evidence: string;
    readonly relationships: string;
    readonly sources: string;
    readonly activity: string;
    readonly settings: string;
  };
  readonly shell: {
    readonly brandName: string;
    readonly brandSubtitle: string;
    readonly internalDevelopment: string;
    readonly productionAccessBlocked: string;
    readonly searchPlaceholder: string;
    readonly dataConnectionLabel: string;
    readonly dataConnectionNotConnected: string;
    readonly verificationLabel: string;
    readonly verificationTooltip: string;
    readonly workspaceName: string;
    readonly workspaceKind: string;
    readonly mobileBrandSuffix: string;
  };
  readonly pageHeader: { readonly defaultMarker: string };
  readonly commandCenter: {
    readonly eyebrow: string;
    readonly title: string;
    readonly description: string;
    readonly connectionBannerTitle: string;
    readonly connectionBannerDescription: string;
    readonly connectionBannerBadge: string;
    readonly attentionOverline: string;
    readonly attentionTitle: string;
    readonly noCanonicalData: string;
    readonly metricPlaceholdersLabel: string;
    readonly metricHot: string;
    readonly metricNearReady: string;
    readonly metricVerification: string;
    readonly metricEvidence: string;
    readonly todaysWorkTitle: string;
    readonly todaysWorkDescription: string;
    readonly trustPreviewOverline: string;
    readonly trustPreviewTitle: string;
    readonly trustPreviewDescription: string;
    readonly metricKindLabel: {
      readonly HOT_OPPORTUNITIES: string;
      readonly NEAR_READY_OPPORTUNITIES: string;
      readonly VERIFICATION_WORK: string;
      readonly ACTIONABLE_ROUTES: string;
      readonly STALE_EVIDENCE: string;
      readonly CONFLICTS: string;
      readonly BLOCKED_ITEMS: string;
      readonly PRIORITIZED_ACTIONS: string;
    };
    readonly metricsSectionTitle: string;
    readonly knownZeroTemplate: string;
    readonly unknownCountTemplate: string;
    readonly unavailableMetricTemplate: string;
    readonly noAttentionItems: string;
    readonly attentionMissingEvidenceLabel: string;
    readonly opportunityStateTitle: string;
    readonly opportunityStateHot: string;
    readonly opportunityStateNearReady: string;
    readonly opportunityStateVerificationRequired: string;
    readonly commercialActionsTitle: string;
    readonly commercialActionsEmpty: string;
    readonly verificationSectionTitle: string;
    readonly verificationReadOnlyNote: string;
    readonly verificationViewLink: string;
    readonly radarCapabilityTitle: string;
    readonly radarCapabilityStatement: string;
    readonly dataTrustTitle: string;
    readonly asOfLabel: string;
  };
  readonly commercialAction: {
    readonly CALL_TODAY: string;
    readonly EMAIL_TODAY: string;
    readonly CONTACT_RECRUITER: string;
    readonly REGISTER_AS_VENDOR: string;
    readonly VERIFY_CONTACT: string;
    readonly VERIFY_MANPOWER_ACCEPTANCE: string;
    readonly RESEARCH_PROJECT: string;
    readonly RESOLVE_CONFLICT: string;
    readonly WAIT: string;
  };
  readonly capability: {
    readonly notConnectedYetTemplate: string;
    readonly description: string;
    readonly markerBackendReady: string;
    readonly markerPlanned: string;
  };
  readonly routes: {
    readonly opportunities: { readonly title: string; readonly description: string };
    readonly companies: { readonly title: string; readonly description: string };
    readonly projects: { readonly title: string; readonly description: string };
    readonly contacts: { readonly title: string; readonly description: string };
    readonly signals: { readonly title: string; readonly description: string };
    readonly verification: { readonly title: string; readonly description: string };
    readonly actions: { readonly title: string; readonly description: string };
    readonly hot: { readonly title: string; readonly description: string };
    readonly nearReady: { readonly title: string; readonly description: string };
    readonly evidence: { readonly title: string; readonly description: string };
    readonly relationships: { readonly title: string; readonly description: string };
    readonly sources: { readonly title: string; readonly description: string };
    readonly activity: { readonly title: string; readonly description: string };
    readonly settings: { readonly title: string; readonly description: string };
  };
  readonly trust: {
    readonly VERIFIED: string;
    readonly UNVERIFIED: string;
    readonly CANDIDATE: string;
    readonly INFERENCE: string;
    readonly STALE: string;
    readonly CONFLICT: string;
    readonly MISSING_EVIDENCE: string;
    readonly HUMAN_VERIFICATION_REQUIRED: string;
    readonly BLOCKED: string;
    readonly NOT_APPLICABLE: string;
  };
  readonly currentness: {
    readonly CURRENT: string;
    readonly AGING: string;
    readonly STALE: string;
    readonly UNKNOWN: string;
  };
  readonly scope: {
    readonly COMPANY: string;
    readonly DIVISION: string;
    readonly PROJECT: string;
    readonly TRADE: string;
    readonly UNKNOWN: string;
  };
  readonly a11yStatus: {
    readonly trustPrefix: string;
    readonly currentnessPrefix: string;
    readonly scopePrefix: string;
  };
  readonly capabilityState: {
    readonly OPERATIONAL: string;
    readonly PARTIAL: string;
    readonly PLANNED: string;
    readonly UNAVAILABLE: string;
    readonly UNKNOWN: string;
  };
  readonly emptyState: { readonly dataIntegrationPending: string };
  readonly loading: { readonly default: string };
  readonly error: { readonly defaultTitle: string; readonly defaultDescription: string };
  readonly languageSelector: { readonly english: string; readonly spanish: string };
}

type Join<K extends string, P extends string> = P extends "" ? K : `${K}.${P}`;
type LeafPaths<T> = T extends string
  ? ""
  : { [K in keyof T & string]: Join<K, LeafPaths<T[K]>> }[keyof T & string];

/** Every valid dotted leaf path through Dictionary, e.g. "nav.opportunities", "trust.VERIFIED". */
export type DictionaryKey = LeafPaths<Dictionary>;
