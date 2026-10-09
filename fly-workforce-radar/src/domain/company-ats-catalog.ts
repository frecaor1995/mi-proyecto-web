/**
 * Recipe 1.1 v2 — Company ATS catalog.
 *
 * COMPANY_ATS_CATALOG holds the 30 targets of the owner's catalog (Catalogo_30_Empresas_Fly_Radar.xlsx, sheet "Catálogo",
 * checked by the owner through web research on 2026-10-07). Each record keeps two evidence layers apart:
 *   - owner: what the owner's research recorded (status, ATS, slug, URL, wave) — research, not a Radar capture;
 *   - local: what this repository / local database already evidenced (Phase 2J/2R files, persisted candidates), if any.
 * Nothing here is a capture authorization: capture readiness also needs a persisted, current ALLOW decision
 * (source_capture_policy_decisions) and an extraction method — see ats-capture-readiness.ts.
 * A slug or URL the owner marked as inferred keeps identifierBasis "INFERRED" and is never presented as verified.
 * SUPPLEMENTARY_LOCAL_TARGETS keeps the 18 previously catalogued targets that are not in the owner's 30 (unchanged).
 */
export type CatalogStatus = "VERIFIED" | "PARTIAL" | "UNCONFIRMED" | "BLOCKED" | "NO_FEED" | "NOT_FOUND";
export type CompanyType = "ELECTRICAL_CONTRACTOR" | "MECHANICAL_CONTRACTOR" | "INDUSTRIAL_CONTRACTOR" | "OIL_GAS_DRILLING" | "CONSTRUCTION_STAFFING" | "PROJECT_OWNER";
export type AtsPlatform = "GREENHOUSE" | "LEVER" | "SMARTRECRUITERS" | "JAZZHR" | "WORKABLE" | "ICIMS" | "ICIMS_JIBE" | "TALEO_BUSINESS_EDITION" | "WORKDAY" | "UKG_PRO" | "APPLICANTPRO" | "ORACLE_RECRUITING_CLOUD"
  | "ORACLE_TALEO" | "TEMPWORKS" | "ADP_WORKFORCE_NOW" | "CUSTOM_STATIC_JOB_BOARD" | "CUSTOM_JAVASCRIPT" | "FORM_ONLY" | "UNKNOWN";
export type Trade = "ELECTRICAL" | "MECHANICAL" | "HVAC" | "PLUMBING" | "INDUSTRIAL" | "OIL_GAS" | "PIPELINE" | "WELDING" | "CIVIL" | "COMMUNICATIONS" | "MARITIME" | "CDL" | "GENERAL" | "MULTI_TRADE";
export type FlyRole = "POSSIBLE_CLIENT" | "COMPETITOR" | "EXTERNAL_PURCHASE_EVIDENCE" | "POSSIBLE_SUBCONTRACT" | "WORKFORCE_SOURCE";
export type IdentifierBasis = "OWNER_VERIFIED" | "LOCAL_EVIDENCE" | "INFERRED" | "NONE";
export type Wave = 1 | 2 | 3;
export type OwnerCaptureMethod = "PUBLIC_JSON_API" | "SIMPLE_HTML" | "HTML_TO_TEST" | "BROWSER" | "BROWSER_OR_POST" | "MANUAL_ROBOTS" | "BLOCKED_403" | "NO_POSTINGS";

export interface AccessReview { readonly startedAt: string; readonly atsIdentifiedAt: string | null; readonly decidedAt: string | null }

export interface CompanyAtsTarget {
  readonly key: string;
  readonly ownerRank: number;
  readonly name: string;
  readonly companyType: CompanyType;
  readonly trades: readonly Trade[];
  readonly market: string;
  /** Official careers page as recorded by the owner (scheme added); null when the owner recorded no URL. */
  readonly officialSite: string | null;
  readonly ats: AtsPlatform;
  readonly atsLabel: string;
  readonly atsIdentifier: string | null;
  readonly identifierBasis: IdentifierBasis;
  readonly jobsUrl: string | null;
  readonly ownerCaptureMethod: OwnerCaptureMethod;
  readonly wave: Wave;
  readonly pilot: boolean;
  readonly watchTier: "DAILY" | "WEEKLY" | "MONTHLY";
  readonly roles: readonly FlyRole[];
  readonly entryLevelSeen: "YES" | "NO" | "UNCONFIRMED" | "PROBABLE" | "OUTSIDE_TX" | "WITH_EXPERIENCE";
  readonly visiblePostings: string | null;
  readonly status: CatalogStatus;
  readonly evidence: string;
  readonly verifiedAt: string;
  readonly ownerNotes: string | null;
  /** Evidence already present locally (repository files / local database) before the owner catalog, if any. */
  readonly localEvidence: { readonly evidence: string; readonly verifiedAt: string; readonly jobsUrl: string | null; readonly atsIdentifier: string | null } | null;
  /** Explicit differences between the owner catalog and local evidence; neither side is overwritten. */
  readonly conflicts: readonly string[];
  /** Recipe 2.0 review clock (10-minute ATS identification target, 60-minute review timebox). Date-only values mean day precision. */
  readonly accessReview?: AccessReview;
  /** Recipe 2.0 commercial priority (owner instruction). Never implies a confirmed contact, need or client. */
  readonly commercialPriority?: { readonly rank: number; readonly focus: "INVESTIGATE_EXTERNAL_STAFFING" | "WORKFORCE_SOURCE_B2B_UNCONFIRMED" | "SECONDARY_POSSIBLE_CLIENT"; readonly note: string };
  /** Owner access decision that overrides technical readiness (e.g. published terms forbid automated retrieval). */
  readonly accessDecision?: { readonly decision: "BLOCKED_TERMS" | "BLOCKED_PENDING_PERMISSION"; readonly decidedAt: string; readonly decidedBy: "OWNER"; readonly basis: string; readonly favorableEvidenceKept: string | null };
}

const OWNER = "Owner catalog 2026-10-07 (manual web research; not a Radar capture)";
const D = "2026-10-07";
const t = (target: Omit<CompanyAtsTarget, "evidence" | "verifiedAt">): CompanyAtsTarget => ({ ...target, evidence: OWNER, verifiedAt: D });

export const COMPANY_ATS_CATALOG: readonly CompanyAtsTarget[] = [
  // ------------------------------------------------------------------ Wave 1 (simple fetch per owner)
  t({ key: "enterprise", ownerRank: 1, name: "Enterprise Electrical", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "Houston, Austin, Temple",
    officialSite: "https://apply.workable.com/enterprise-electrical", ats: "WORKABLE", atsLabel: "Workable", atsIdentifier: "enterprise-electrical", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://apply.workable.com/api/v1/widget/accounts/enterprise-electrical", ownerCaptureMethod: "PUBLIC_JSON_API", wave: 1, pilot: false, watchTier: "DAILY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "YES", visiblePostings: "~99 entries (62 unique)", status: "VERIFIED", ownerNotes: "Best Houston apprentice feed; also journeyman in Pearland, Channelview, Spring.",
    localEvidence: { evidence: "Persisted candidate URL /enterprise-electrical/j/47A7CAD596", verifiedAt: D, jobsUrl: "https://apply.workable.com/enterprise-electrical/", atsIdentifier: "enterprise-electrical" }, conflicts: [],
    // Workable access review opened 2026-10-08 (day precision); ficha REVIEW_REQUIRED, no decision, no ALLOW.
    accessReview: { startedAt: "2026-10-08", atsIdentifiedAt: "2026-10-08", decidedAt: null },
    commercialPriority: { rank: 1, focus: "INVESTIGATE_EXTERNAL_STAFFING", note: "Priority 1: investigate whether Enterprise buys external labor (Contact Intelligence + Phase 3A). No contact, need or client confirmed." } }),
  t({ key: "fsg", ownerRank: 2, name: "Facility Solutions Group (FSG)", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "Houston, Dallas, San Antonio, Harlingen, Jarrell",
    officialSite: "https://careers-fsg.icims.com", ats: "ICIMS", atsLabel: "iCIMS", atsIdentifier: "fsg", identifierBasis: "OWNER_VERIFIED", jobsUrl: "https://careers-fsg.icims.com/jobs/search?ss=1",
    ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "DAILY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "YES", visiblePostings: "50+", status: "VERIFIED",
    ownerNotes: "#2528 'apprentice' requires 2+ years: classify as mixed. Texas location filter not confirmed.",
    localEvidence: { evidence: "Persisted candidate 1874", verifiedAt: D, jobsUrl: "https://careers-spanish-fsg.icims.com/jobs/", atsIdentifier: "fsg" },
    conflicts: ["Local evidence uses the careers-spanish-fsg.icims.com host; the owner records careers-fsg.icims.com (same iCIMS slug).",
      "Owner catalog listed the Houston Service Apprentice Electrician as '#2524' with URL /jobs/2080/…; the owner's 2026-10-09 public evidence shows /jobs/2524/… with published ID 2026-2524. Both kept as antecedents; not asserted to be the same posting."],
    accessDecision: { decision: "BLOCKED_PENDING_PERMISSION", decidedAt: "2026-10-09", decidedBy: "OWNER",
      basis: "FSG's public conditions restrict commercial use and automated collection without written permission. Automated capture stays REVIEW_REQUIRED until FSG grants written permission; no ALLOW registered.",
      favorableEvidenceKept: "Public posting 2026-2524 (Houston, $18–$25/h) kept as a human-review reference; not captured." },
    commercialPriority: { rank: 3, focus: "SECONDARY_POSSIBLE_CLIENT", note: "Secondary possible client. Written permission for automated collection could be requested in a first commercial contact." } }),
  t({ key: "walker", ownerRank: 3, name: "Walker Engineering", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "Irving, Houston, Pflugerville, San Antonio",
    officialSite: "https://walkertx.com/careers", ats: "TALEO_BUSINESS_EDITION", atsLabel: "Taleo Business Edition", atsIdentifier: "org WP3X5Q / cws 37", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://phg.tbe.taleo.net/phg04/ats/careers/v2/searchResults?org=WP3X5Q&cws=37", ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "DAILY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "YES", visiblePostings: "~60 + 7 travelers", status: "VERIFIED", ownerNotes: "Comfort Systems USA subsidiary. 14 openings in Houston.",
    localEvidence: { evidence: "Phase 2J local target; JS-rendered and no documented public API", verifiedAt: "2026-08-29", jobsUrl: "https://phg.tbe.taleo.net/phg04/ats/careers/v2/searchResults?org=WP3X5Q&cws=37", atsIdentifier: "WP3X5Q/cws37" },
    conflicts: ["Phase 2J recorded the board as JS-rendered; the owner records it as simple HTML. Capture method needs confirmation on a real sample."],
    commercialPriority: { rank: 2, focus: "WORKFORCE_SOURCE_B2B_UNCONFIRMED", note: "Employment source for Fly workers; possible B2B client, unconfirmed. Postings are direct hires, not external-labor requests." } }),
  t({ key: "bergelectric", ownerRank: 4, name: "Bergelectric", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "El Paso, Laredo, Dallas",
    officialSite: "https://careers-bergelectric.icims.com", ats: "ICIMS", atsLabel: "iCIMS", atsIdentifier: "bergelectric", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://careers-bergelectric.icims.com/jobs/search?ss=1", ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "YES", visiblePostings: "12", status: "VERIFIED", ownerNotes: "No Houston presence.", localEvidence: null, conflicts: [] }),
  t({ key: "strike", ownerRank: 5, name: "Strike LLC", companyType: "INDUSTRIAL_CONTRACTOR", trades: ["ELECTRICAL", "WELDING", "PIPELINE", "CDL"], market: "Midland, Corpus Christi, Baytown, Carthage",
    officialSite: "https://strike.applytojob.com", ats: "JAZZHR", atsLabel: "JazzHR", atsIdentifier: "strike", identifierBasis: "OWNER_VERIFIED", jobsUrl: "https://strike.applytojob.com/apply",
    ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: true, watchTier: "DAILY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "YES", visiblePostings: "14 of 17", status: "VERIFIED",
    ownerNotes: "Correct slug is 'strike', not 'strikeusa'. First technical test.",
    localEvidence: { evidence: "Phase 2J/2R-B local files (company-owned JazzHR pages, stable posting IDs incl. Houston 5DyLJo3Zgw) + persisted HTTP_FETCH ALLOW recipe-1.1-strike-jazzhr-v1", verifiedAt: "2026-08-29", jobsUrl: "https://strike.applytojob.com/apply/", atsIdentifier: "strike" },
    conflicts: ["Owner's 2026-10-07 Texas presence does not list Houston; the Houston posting 5DyLJo3Zgw is from 2026-08-29 local evidence and may no longer be published."] }),
  t({ key: "tdindustries", ownerRank: 6, name: "TDIndustries", companyType: "MECHANICAL_CONTRACTOR", trades: ["HVAC", "PLUMBING", "ELECTRICAL"], market: "Dallas, Houston, Waco, San Antonio",
    officialSite: "https://careers-tdindustries.icims.com", ats: "ICIMS", atsLabel: "iCIMS", atsIdentifier: "tdindustries", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://careers-tdindustries.icims.com/jobs/search?ss=1", ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "NO", visiblePostings: "~18 on page 1 (7 pages)", status: "VERIFIED", ownerNotes: "Houston: Journeyman HVAC Service Tech, Sr Plumbing Service Tech. No entry level on page 1.",
    localEvidence: null, conflicts: [] }),
  t({ key: "ies", ownerRank: 7, name: "IES Holdings", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL", "COMMUNICATIONS"], market: "Abilene, Haskell, San Antonio",
    officialSite: "https://joinus.ies-co.com", ats: "ICIMS_JIBE", atsLabel: "iCIMS (Jibe)", atsIdentifier: "ies-co / iesinfrastructure", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://joinus.ies-co.com/api/jobs", ownerCaptureMethod: "PUBLIC_JSON_API", wave: 1, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "UNCONFIRMED", visiblePostings: "6 readable", status: "PARTIAL", ownerNotes: "Filters ignored and response truncated. IES Commercial & Industrial site not confirmed.",
    localEvidence: { evidence: "Canonical local company with website and Houston location (Contact Intelligence)", verifiedAt: D, jobsUrl: null, atsIdentifier: null },
    conflicts: ["Local company record places IES in Houston; the owner's Texas presence for job postings lists Abilene, Haskell and San Antonio."] }),
  t({ key: "tradesmen", ownerRank: 8, name: "Tradesmen International", companyType: "CONSTRUCTION_STAFFING", trades: ["MULTI_TRADE"], market: "Houston (sites in LA/MS)",
    officialSite: "https://careers.tradesmeninternational.com", ats: "ICIMS", atsLabel: "iCIMS", atsIdentifier: "tradesmen", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://jobs-tradesmen.icims.com/jobs/search?ss=1&in_iframe=1", ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "DAILY", roles: ["COMPETITOR", "EXTERNAL_PURCHASE_EVIDENCE"],
    entryLevelSeen: "YES", visiblePostings: "~880–900 total; Texas not confirmed", status: "VERIFIED", ownerNotes: "Keyword and location filters did not work by fetch.",
    localEvidence: { evidence: "Local source strategy and persisted Houston candidate 366270", verifiedAt: D, jobsUrl: "https://jobs-tradesmen.icims.com/jobs/", atsIdentifier: "tradesmen" }, conflicts: [] }),
  t({ key: "kodiak", ownerRank: 9, name: "Kodiak Labor Solutions", companyType: "CONSTRUCTION_STAFFING", trades: ["MULTI_TRADE"], market: "Houston, Dallas, Odessa, Pecos",
    officialSite: "https://kodiakls.com/job-search", ats: "CUSTOM_STATIC_JOB_BOARD", atsLabel: "Own board (possibly Salesforce)", atsIdentifier: null, identifierBasis: "NONE",
    jobsUrl: "https://kodiakls.com/job-search/", ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "WEEKLY", roles: ["WORKFORCE_SOURCE"], entryLevelSeen: "NO",
    visiblePostings: "0 on own page; ~12 on ZipRecruiter", status: "VERIFIED", ownerNotes: "Captive agency (Comfort Systems): does not buy from Fly. Useful as a Comfort Systems project signal.",
    localEvidence: null, conflicts: [] }),
  t({ key: "trillium", ownerRank: 10, name: "Trillium Staffing", companyType: "CONSTRUCTION_STAFFING", trades: ["MULTI_TRADE", "CDL"], market: "Houston, Claude, Vernon, Mesquite",
    officialSite: "https://trilliumstaffing.com/jobs/search", ats: "CUSTOM_STATIC_JOB_BOARD", atsLabel: "Own board", atsIdentifier: null, identifierBasis: "NONE",
    jobsUrl: "https://trilliumstaffing.com/jobs/search", ownerCaptureMethod: "SIMPLE_HTML", wave: 1, pilot: false, watchTier: "WEEKLY", roles: ["COMPETITOR", "POSSIBLE_SUBCONTRACT"],
    entryLevelSeen: "OUTSIDE_TX", visiblePostings: "4 of 30 shown (1,344 total)", status: "VERIFIED", ownerNotes: "1,344 openings in total.",
    localEvidence: { evidence: "Phase 2J local captures document stable /jobs/job/{id} pages", verifiedAt: "2026-08-29", jobsUrl: "https://trilliumstaffing.com/jobs/", atsIdentifier: null }, conflicts: [],
    accessDecision: { decision: "BLOCKED_TERMS", decidedAt: "2026-10-09", decidedBy: "OWNER",
      basis: "Published terms at https://trilliumstaffing.com/jobs/sms-terms/ (effective 2025-11-01) prohibit robots and automated tools that retrieve or index service content. No automated capture without Trillium's express permission; no ALLOW registered.",
      favorableEvidenceKept: "robots.txt 2026-10-09 HTTP 200 (sha256 d6dd44dc…; run 721b2ff9-8b66-43b5-b99f-7793d7657d81): /jobs/search/ and /jobs/job/* allowed for '*', Crawl-delay 10." } }),
  // ------------------------------------------------------------------ Wave 2 (browser / POST per owner — not automated in this phase)
  t({ key: "rosendin", ownerRank: 11, name: "Rosendin Electric", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "McKinney, Sherman, Lewisville, Houston",
    officialSite: "https://rosendin.com/go/txjobs", ats: "WORKDAY", atsLabel: "Workday", atsIdentifier: "rosendin / wd1 / Careers", identifierBasis: "INFERRED",
    jobsUrl: "https://rosendin.wd1.myworkdayjobs.com/en-US/Careers", ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "NO", visiblePostings: "89", status: "PARTIAL", ownerNotes: "Apprenticeship via union JATC. Workday URL inferred.", localEvidence: null, conflicts: [] }),
  t({ key: "amteck", ownerRank: 12, name: "Amteck", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "Round Rock / Houston", officialSite: "https://amteck.com/careers",
    ats: "WORKDAY", atsLabel: "Workday", atsIdentifier: "comfortsystemsusa / wd1 / Amteckcareers", identifierBasis: "INFERRED", jobsUrl: "https://comfortsystemsusa.wd1.myworkdayjobs.com/Amteckcareers",
    ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED",
    ownerNotes: "Comfort Systems USA subsidiary.", localEvidence: null, conflicts: [] }),
  t({ key: "apache", ownerRank: 13, name: "Apache Industrial Services", companyType: "INDUSTRIAL_CONTRACTOR", trades: ["INDUSTRIAL"], market: "Deer Park (Houston)",
    officialSite: "https://apacheip.com/careers", ats: "WORKDAY", atsLabel: "Workday", atsIdentifier: "apacheip / wd1 / Apache_Careers", identifierBasis: "INFERRED",
    jobsUrl: "https://apacheip.wd1.myworkdayjobs.com/en-US/Apache_Careers", ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Scaffolding, insulation, painting, refractory. Hiring center: 1803 Center St, Deer Park.",
    localEvidence: null, conflicts: [] }),
  t({ key: "primoris", ownerRank: 14, name: "Primoris Services", companyType: "INDUSTRIAL_CONTRACTOR", trades: ["CIVIL", "ELECTRICAL", "PIPELINE", "COMMUNICATIONS"], market: "Belton, San Antonio, Houston",
    officialSite: "https://prim.com/careers", ats: "WORKDAY", atsLabel: "Workday + UKG", atsIdentifier: "prim / wd108 / Primoris; UKG PRI1028PSC", identifierBasis: "INFERRED",
    jobsUrl: "https://prim.wd108.myworkdayjobs.com/Primoris", ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "YES", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Entry level per prim.com (not confirmed on the ATS).", localEvidence: null, conflicts: [] }),
  t({ key: "austin", ownerRank: 15, name: "Austin Industries", companyType: "INDUSTRIAL_CONTRACTOR", trades: ["PIPELINE", "CIVIL", "INDUSTRIAL"], market: "Matagorda, La Porte",
    officialSite: "https://austin-ind.com/careers", ats: "UKG_PRO", atsLabel: "UKG / UltiPro", atsIdentifier: "AUS1003AUIN", identifierBasis: "LOCAL_EVIDENCE",
    jobsUrl: "https://recruiting2.ultipro.com/AUS1003AUIN/JobBoard/611d5a38-76c4-4f66-a55f-2bc012d98024/", ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "WEEKLY",
    roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Includes Austin Industrial, Bridge & Road, Commercial.",
    localEvidence: { evidence: "Phase 2J local target", verifiedAt: "2026-08-29", jobsUrl: "https://recruiting2.ultipro.com/AUS1003AUIN/JobBoard/", atsIdentifier: "AUS1003AUIN" }, conflicts: [] }),
  t({ key: "turner", ownerRank: 16, name: "Turner Industries", companyType: "INDUSTRIAL_CONTRACTOR", trades: ["MULTI_TRADE", "INDUSTRIAL"], market: "Gulf Coast",
    officialSite: "https://turner-industries.com", ats: "APPLICANTPRO", atsLabel: "ApplicantPro", atsIdentifier: "turnerindustries", identifierBasis: "LOCAL_EVIDENCE",
    jobsUrl: "https://turnerindustries.applicantpro.com/jobs/", ownerCaptureMethod: "BROWSER", wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: null,
    localEvidence: { evidence: "Phase 2J local target; listing rendered navigation only", verifiedAt: "2026-08-29", jobsUrl: "https://turnerindustries.applicantpro.com/jobs/country/us/state/Texas-TX", atsIdentifier: "turnerindustries" }, conflicts: [] }),
  t({ key: "comfort", ownerRank: 17, name: "Comfort Systems USA (corporate)", companyType: "MECHANICAL_CONTRACTOR", trades: ["HVAC", "ELECTRICAL", "PLUMBING"], market: "Houston, San Antonio, Manor, Fort Worth",
    officialSite: "https://comfortsystemsusa.com/careers", ats: "WORKDAY", atsLabel: "Workday", atsIdentifier: "comfortsystemsusa / wd1 / Corpcareers", identifierBasis: "INFERRED",
    jobsUrl: "https://comfortsystemsusa.wd1.myworkdayjobs.com/Corpcareers", ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "MONTHLY", roles: ["POSSIBLE_CLIENT"],
    entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Possible client via subsidiaries (Walker, CSUSA Central/South Central TX, TAS Energy, Summit Industrial, DynaTen, Dilling, NeoPod).",
    localEvidence: null, conflicts: [] }),
  t({ key: "hp", ownerRank: 18, name: "Helmerich & Payne", companyType: "OIL_GAS_DRILLING", trades: ["OIL_GAS"], market: "Permian (to confirm)", officialSite: null, ats: "WORKDAY", atsLabel: "Workday",
    atsIdentifier: "hpinc / wd5 / HPINC", identifierBasis: "INFERRED", jobsUrl: "https://hpinc.wd5.myworkdayjobs.com/HPINC", ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false,
    watchTier: "WEEKLY", roles: ["WORKFORCE_SOURCE"], entryLevelSeen: "OUTSIDE_TX", visiblePostings: null, status: "PARTIAL", ownerNotes: "Hires directly. Oil demand signal. Owner recorded 'H&P Careers (Workday)' as the careers page.",
    localEvidence: null, conflicts: [] }),
  t({ key: "patterson", ownerRank: 19, name: "Patterson-UTI", companyType: "OIL_GAS_DRILLING", trades: ["OIL_GAS"], market: "Midland (Permian)", officialSite: "https://patenergy.com/careers",
    ats: "ORACLE_RECRUITING_CLOUD", atsLabel: "Oracle (inferred)", atsIdentifier: "site CX", identifierBasis: "INFERRED", jobsUrl: "https://patenergy.com/jobs#en/sites/CX", ownerCaptureMethod: "BROWSER",
    wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["WORKFORCE_SOURCE"], entryLevelSeen: "PROBABLE", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Hires directly.", localEvidence: null, conflicts: [] }),
  t({ key: "nabors", ownerRank: 20, name: "Nabors Industries", companyType: "OIL_GAS_DRILLING", trades: ["OIL_GAS"], market: "Odessa, Tyler", officialSite: "https://nabors.com/careers",
    ats: "ORACLE_RECRUITING_CLOUD", atsLabel: "Oracle + Taleo", atsIdentifier: "nabors-careers; Taleo nabors/100", identifierBasis: "INFERRED", jobsUrl: "https://jobs.nabors.com/en/sites/nabors-careers",
    ownerCaptureMethod: "BROWSER_OR_POST", wave: 2, pilot: false, watchTier: "WEEKLY", roles: ["WORKFORCE_SOURCE"], entryLevelSeen: "PROBABLE", visiblePostings: null, status: "UNCONFIRMED",
    ownerNotes: "Hires directly.", localEvidence: null, conflicts: [] }),
  t({ key: "peopleready", ownerRank: 21, name: "PeopleReady (TrueBlue)", companyType: "CONSTRUCTION_STAFFING", trades: ["MULTI_TRADE", "GENERAL"], market: "Houston and all of Texas",
    officialSite: "https://jobs.peopleready.com", ats: "ORACLE_RECRUITING_CLOUD", atsLabel: "Own + Oracle corporate", atsIdentifier: "Oracle ehnn / CX_1", identifierBasis: "INFERRED",
    jobsUrl: "https://jobs.peopleready.com", ownerCaptureMethod: "BROWSER", wave: 2, pilot: false, watchTier: "MONTHLY", roles: ["COMPETITOR", "EXTERNAL_PURCHASE_EVIDENCE"],
    entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Hourly work through the JobStack app.",
    localEvidence: { evidence: "Local Phase 2H/2F source evaluations; mutable slugs", verifiedAt: "2026-08-22", jobsUrl: "https://skilled.peopleready.com/jobs/", atsIdentifier: null },
    conflicts: ["Local evaluations used skilled.peopleready.com; the owner records jobs.peopleready.com with an Oracle corporate site."] }),
  // ------------------------------------------------------------------ Wave 3 (manual / no feed / blocked per owner)
  t({ key: "fls", ownerRank: 22, name: "Finish Line Staffing (FLS)", companyType: "CONSTRUCTION_STAFFING", trades: ["ELECTRICAL"], market: "Houston, Amarillo, Abilene, Haskell",
    officialSite: "https://jobboard.ontempworks.com/FLStaff/Jobs", ats: "TEMPWORKS", atsLabel: "TempWorks", atsIdentifier: "FLStaff", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://jobboard.ontempworks.com/FLStaff/Jobs/", ownerCaptureMethod: "MANUAL_ROBOTS", wave: 3, pilot: false, watchTier: "WEEKLY", roles: ["COMPETITOR"], entryLevelSeen: "NO",
    visiblePostings: "4 (RoadDog Jobs)", status: "BLOCKED", ownerNotes: "Competitor (declined fee). Respect robots.txt: manual review only.", localEvidence: null, conflicts: [] }),
  t({ key: "marathon", ownerRank: 23, name: "Marathon Staffing Group", companyType: "CONSTRUCTION_STAFFING", trades: ["GENERAL"], market: "DeSoto, Dallas", officialSite: "https://jobs.marathonstaffing.com",
    ats: "CUSTOM_STATIC_JOB_BOARD", atsLabel: "Own board", atsIdentifier: null, identifierBasis: "NONE", jobsUrl: "https://jobs.marathonstaffing.com", ownerCaptureMethod: "MANUAL_ROBOTS",
    wave: 3, pilot: false, watchTier: "MONTHLY", roles: ["COMPETITOR"], entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "BLOCKED", ownerNotes: "Little trade focus; robots.txt.",
    localEvidence: null, conflicts: [] }),
  t({ key: "laborfinders", ownerRank: 24, name: "Labor Finders", companyType: "CONSTRUCTION_STAFFING", trades: ["GENERAL", "CIVIL"], market: "38 Texas cities (Houston, Pasadena, Baytown, La Porte)",
    officialSite: "https://laborfinders.com/browse-jobs/tx", ats: "CUSTOM_JAVASCRIPT", atsLabel: "Own (JavaScript)", atsIdentifier: null, identifierBasis: "NONE", jobsUrl: "https://laborfinders.com/browse-jobs/tx/",
    ownerCaptureMethod: "BROWSER", wave: 3, pilot: false, watchTier: "MONTHLY", roles: ["COMPETITOR"], entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "UNCONFIRMED",
    ownerNotes: "Franchises; frequent in-person registration.", localEvidence: null, conflicts: [] }),
  t({ key: "coregroup", ownerRank: 25, name: "Core Group Resources", companyType: "CONSTRUCTION_STAFFING", trades: ["MARITIME", "OIL_GAS", "MULTI_TRADE"], market: "Houston (Katy Fwy)",
    officialSite: "https://cgrcareerportal.com/jobs", ats: "CUSTOM_STATIC_JOB_BOARD", atsLabel: "Own board", atsIdentifier: null, identifierBasis: "NONE", jobsUrl: "https://cgrcareerportal.com/jobs/",
    ownerCaptureMethod: "HTML_TO_TEST", wave: 3, pilot: false, watchTier: "MONTHLY", roles: ["COMPETITOR", "POSSIBLE_SUBCONTRACT"], entryLevelSeen: "UNCONFIRMED", visiblePostings: null,
    status: "UNCONFIRMED", ownerNotes: "Access test pending.", localEvidence: null, conflicts: [] }),
  t({ key: "trs", ownerRank: 26, name: "TRS Staffing Solutions", companyType: "CONSTRUCTION_STAFFING", trades: ["INDUSTRIAL", "MULTI_TRADE"], market: "Houston", officialSite: "https://trsstaffing.com/jobs",
    ats: "CUSTOM_STATIC_JOB_BOARD", atsLabel: "Own board", atsIdentifier: null, identifierBasis: "NONE", jobsUrl: "https://www.trsstaffing.com/jobs", ownerCaptureMethod: "BLOCKED_403",
    wave: 3, pilot: false, watchTier: "MONTHLY", roles: ["COMPETITOR"], entryLevelSeen: "UNCONFIRMED", visiblePostings: null, status: "BLOCKED",
    ownerNotes: "HTTP 403. Replaces Clayton Services (no longer a staffing firm).", localEvidence: null, conflicts: [] }),
  t({ key: "mmr", ownerRank: 27, name: "MMR Group", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "Pasadena (Houston), Abilene, Odessa", officialSite: "https://careers.mmrgrp.com",
    ats: "FORM_ONLY", atsLabel: "Own form (no published postings)", atsIdentifier: null, identifierBasis: "NONE", jobsUrl: "https://mmrgrp.com/workforce-development/careers",
    ownerCaptureMethod: "NO_POSTINGS", wave: 3, pilot: false, watchTier: "MONTHLY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "YES", visiblePostings: "0 published", status: "NO_FEED",
    ownerNotes: "Entry level in general application. Direct contact: branch 3222 Pasadena Fwy.",
    localEvidence: { evidence: "Canonical local company identity; website ATS not locally demonstrated", verifiedAt: D, jobsUrl: null, atsIdentifier: null }, conflicts: [] }),
  t({ key: "powerdesign", ownerRank: 28, name: "Power Design Inc", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL", "PLUMBING", "MECHANICAL"], market: "Houston, Woodlands, Sugar Land, Austin",
    officialSite: "https://powerdesigninc.us/careers", ats: "CUSTOM_STATIC_JOB_BOARD", atsLabel: "Own (HubSpot)", atsIdentifier: "IDs like R10852", identifierBasis: "OWNER_VERIFIED",
    jobsUrl: "https://www.powerdesigninc.us/careers", ownerCaptureMethod: "HTML_TO_TEST", wave: 3, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "WITH_EXPERIENCE",
    visiblePostings: "~45", status: "UNCONFIRMED", ownerNotes: "'Trainee' requires 3+ years: classify as mixed.", localEvidence: null, conflicts: [] }),
  t({ key: "cupertino", ownerRank: 29, name: "Cupertino Electric", companyType: "ELECTRICAL_CONTRACTOR", trades: ["ELECTRICAL"], market: "No visible Texas locations",
    officialSite: "https://cei.com/careers/current-openings", ats: "UNKNOWN", atsLabel: "Unknown", atsIdentifier: null, identifierBasis: "NONE", jobsUrl: "https://www.cei.com/careers/current-openings",
    ownerCaptureMethod: "NO_POSTINGS", wave: 3, pilot: false, watchTier: "MONTHLY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "NO", visiblePostings: "0", status: "NO_FEED",
    ownerNotes: "General application only (owner-recorded contact mailbox). Possible client for data centers.", localEvidence: null, conflicts: [] }),
  t({ key: "zachry", ownerRank: 30, name: "Zachry Group", companyType: "INDUSTRIAL_CONTRACTOR", trades: ["MULTI_TRADE", "INDUSTRIAL"], market: "Houston and the Gulf Coast",
    officialSite: "https://careers.zachrygroup.com", ats: "UNKNOWN", atsLabel: "Unknown (owner) / Oracle Recruiting Cloud (Phase 2J local)", atsIdentifier: null, identifierBasis: "NONE",
    jobsUrl: "https://careers.zachrygroup.com", ownerCaptureMethod: "BROWSER", wave: 3, pilot: false, watchTier: "WEEKLY", roles: ["POSSIBLE_CLIENT"], entryLevelSeen: "UNCONFIRMED",
    visiblePostings: null, status: "UNCONFIRMED", ownerNotes: "Not to be confused with Zachry Construction Corp. Previous contact recorded by the owner.",
    localEvidence: { evidence: "Canonical company plus Phase 2J local ATS classification", verifiedAt: "2026-08-29",
      jobsUrl: "https://fa-evfm-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1029/requisitions", atsIdentifier: "CX_1029" },
    conflicts: ["Phase 2J locally classified Oracle Recruiting Cloud site CX_1029; the owner could not confirm the ATS on 2026-10-07. Kept as local evidence only, not verified."] }),
];

/**
 * Entry-level postings the OWNER saw during research (sheet "Entrada vista"). They were NOT captured by the Radar and are
 * never shown as Radar postings; they serve only to validate future captures.
 */
export const OWNER_SEEN_ENTRY_POSTINGS: readonly { readonly company: string; readonly title: string; readonly city: string; readonly pay: string | null; readonly reference: string;
  readonly levelRule: "ENTRY" | "MIXED"; readonly url: string; readonly state: "SEEN_IN_RESEARCH_NOT_CAPTURED" | "POSSIBLY_EXPIRED" | "HUMAN_REVIEW_REFERENCE_NOT_CAPTURED";
  readonly requirements?: string; readonly note?: string }[] = [
  { company: "enterprise", title: "Apprentice Commercial Electrician", city: "Houston / Pasadena / Texas City / South Houston", pay: null, reference: "Workable", levelRule: "ENTRY", url: "https://apply.workable.com/enterprise-electrical/jobs/view/BDFDCFF05F.md", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "enterprise", title: "Apprentice Electrician – Mission Critical Data Center", city: "Temple", pay: null, reference: "Workable", levelRule: "ENTRY", url: "https://apply.workable.com/enterprise-electrical/", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  // Antecedent from the owner catalog (2026-10-07): URL job id 2080, listed with reference "#2524". Not asserted to be the posting below.
  { company: "fsg", title: "Service Apprentice Electrician", city: "Houston", pay: null, reference: "URL job id 2080 (owner catalog listed it as #2524; relation to 2026-2524 unconfirmed)", levelRule: "MIXED",
    url: "https://careers-fsg.icims.com/jobs/2080/service-apprentice-electrician/job", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  // Owner's public evidence (2026-10-09): kept for human review only — not an automated capture.
  { company: "fsg", title: "Service Apprentice Electrician", city: "Houston", pay: "$18–$25/h", reference: "2026-2524 (URL job id 2524)", levelRule: "MIXED",
    url: "https://careers-fsg.icims.com/jobs/2524/service-apprentice-electrician/job?in_iframe=1", state: "HUMAN_REVIEW_REFERENCE_NOT_CAPTURED",
    requirements: "Current apprentice license; 2+ years of experience (as published)", note: "Automated capture blocked pending FSG written permission (owner decision 2026-10-09)." },
  { company: "fsg", title: "Commercial Apprentice Electrician", city: "Houston", pay: null, reference: "#2528", levelRule: "MIXED", url: "https://careers-fsg.icims.com/jobs/search?ss=1", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "fsg", title: "Entry Level Data Technician / Helper", city: "Jarrell", pay: null, reference: "#2545", levelRule: "ENTRY", url: "https://careers-fsg.icims.com/jobs/search?ss=1", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "walker", title: "Apprentice Electrician", city: "Houston", pay: null, reference: "rid 441", levelRule: "ENTRY", url: "https://phg.tbe.taleo.net/phg04/ats/careers/v2/requisition.jsp?org=WP3X5Q&cws=37&rid=441", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "strike", title: "Apprentice Electrician", city: "Midland", pay: null, reference: "JazzHR", levelRule: "ENTRY", url: "https://strike.applytojob.com/apply", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "bergelectric", title: "Electrician Apprentice", city: "El Paso", pay: null, reference: "#1767", levelRule: "ENTRY", url: "https://careers-bergelectric.icims.com/jobs/search?ss=1", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "bergelectric", title: "Electrician Apprentice", city: "Laredo", pay: null, reference: "#1768", levelRule: "ENTRY", url: "https://careers-bergelectric.icims.com/jobs/search?ss=1", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "bergelectric", title: "Apprentice Electrician", city: "Dallas", pay: null, reference: "#2058", levelRule: "ENTRY", url: "https://careers-bergelectric.icims.com/jobs/search?ss=1", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "tradesmen", title: "Apprentice Electrician / Electrical Helper", city: "Houston", pay: "$18–19/h", reference: "#366270", levelRule: "ENTRY", url: "https://jobs-tradesmen.icims.com/jobs/366270/apprentice-electrician---electrical-helper/job", state: "POSSIBLY_EXPIRED" },
  { company: "powerdesign", title: "Electrical Trainee", city: "Houston / Woodlands / Sugar Land", pay: "$18–35/h", reference: "R10852", levelRule: "MIXED", url: "https://www.powerdesigninc.us/careers", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
  { company: "primoris", title: "Road Laborer", city: "Belton", pay: null, reference: "prim.com", levelRule: "ENTRY", url: "https://www.prim.com/careers", state: "SEEN_IN_RESEARCH_NOT_CAPTURED" },
];

/** Previously catalogued targets that are not among the owner's 30 (kept unchanged; not part of Recipe 1.1 v2 waves). */
export interface LocalAtsTarget { key: string; name: string; companyType: CompanyType; market: string; officialSite: string; ats: string | null; atsIdentifier: string | null; jobsUrl: string | null;
  evidence: string; verifiedAt: string; status: CatalogStatus; access: "ALLOWED" | "RESTRICTED" | "UNCONFIRMED"; ownerNote?: string }
const d = "2026-08-29";
export const SUPPLEMENTARY_LOCAL_TARGETS: readonly LocalAtsTarget[] = [
  { key: "nes", name: "NES Fircroft", companyType: "CONSTRUCTION_STAFFING", market: "Houston / Gulf Coast", officialSite: "https://www.nesfircroft.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.nesfircroft.com/jobs/", evidence: "Phase 2H target BH-330309; direct retrieval returned non-success", verifiedAt: "2026-08-22", status: "UNCONFIRMED", access: "UNCONFIRMED" },
  { key: "aerotek", name: "Aerotek", companyType: "CONSTRUCTION_STAFFING", market: "Texas", officialSite: "https://www.aerotek.com", ats: "WORKDAY", atsIdentifier: null, jobsUrl: "https://jobs.aerotek.com/us/en", evidence: "Phase 2J local platform review identifies Workday; no permitted public feed", verifiedAt: d, status: "VERIFIED", access: "RESTRICTED" },
  { key: "mcdean", name: "M.C. Dean", companyType: "ELECTRICAL_CONTRACTOR", market: "Texas", officialSite: "https://www.mcdean.com", ats: "ICIMS", atsIdentifier: "mcdean", jobsUrl: "https://careers.mcdean.com/jobs", evidence: "Phase 2J platform record; partner-gated iCIMS feed", verifiedAt: d, status: "VERIFIED", access: "RESTRICTED" },
  { key: "skillforce", name: "Skillforce", companyType: "CONSTRUCTION_STAFFING", market: "Texas", officialSite: "https://www.skillforce.com", ats: "ADP_WORKFORCE_NOW", atsIdentifier: "068836c5-32da-4d04-b518-9e662ad548ec", jobsUrl: null, evidence: "Phase 2J local target; session-style ADP recruitment widget", verifiedAt: d, status: "VERIFIED", access: "RESTRICTED" },
  { key: "exxon", name: "ExxonMobil", companyType: "PROJECT_OWNER", market: "Beaumont / Port Arthur", officialSite: "https://corporate.exxonmobil.com", ats: null, atsIdentifier: null, jobsUrl: "https://jobs.exxonmobil.com/go/Electrical-Jobs-in-Beaumont/3051500/", evidence: "Versioned multi-source strategy", verifiedAt: "2026-08-21", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "dws", name: "DWS Energy", companyType: "ELECTRICAL_CONTRACTOR", market: "Houston; DFW; Permian Basin", officialSite: "https://www.dwsenergy.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.dwsenergy.com/careers/", evidence: "Versioned multi-source strategy", verifiedAt: "2026-08-21", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "gonzales", name: "Gonzales Contractors", companyType: "ELECTRICAL_CONTRACTOR", market: "Permian Basin", officialSite: "https://www.gonzalescontractors.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.gonzalescontractors.com/careers", evidence: "Versioned multi-source strategy", verifiedAt: "2026-08-21", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "psv", name: "PSV Industries", companyType: "INDUSTRIAL_CONTRACTOR", market: "Corpus Christi; Gulf Coast", officialSite: "https://www.psvindustries.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.psvindustries.com/careers", evidence: "Versioned commercial-intelligence strategy", verifiedAt: "2026-08-21", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "link", name: "LINK Staffing", companyType: "CONSTRUCTION_STAFFING", market: "Houston", officialSite: "https://linkstaffing.com", ats: null, atsIdentifier: null, jobsUrl: null, evidence: "Canonical local company with website and Houston location", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "edge", name: "Edge Electric", companyType: "ELECTRICAL_CONTRACTOR", market: "United States", officialSite: "https://edgeelectric.com", ats: "WORKABLE", atsIdentifier: "edge-electric", jobsUrl: "https://apply.workable.com/edge-electric/", evidence: "Persisted candidate URL /edge-electric/j/49460944DC", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "cummings", name: "Cummings Electrical", companyType: "ELECTRICAL_CONTRACTOR", market: "Fort Worth / Texas", officialSite: "https://cummingselec.com", ats: "ICIMS", atsIdentifier: "cummingselec", jobsUrl: "https://careers-cummingselec.icims.com/jobs/", evidence: "Persisted candidates 4884 and 6488", verifiedAt: "2026-10-07", status: "VERIFIED", access: "RESTRICTED" },
  { key: "titan", name: "Titan Electric", companyType: "ELECTRICAL_CONTRACTOR", market: "United States", officialSite: "https://titanelectric-ga.com", ats: "LEVER", atsIdentifier: "titanelectric-ga", jobsUrl: "https://jobs.lever.co/titanelectric-ga", evidence: "Persisted Lever candidate b5ba89be-76db-42af-9b43-56f4cd36a936", verifiedAt: "2026-10-07", status: "VERIFIED", access: "ALLOWED" },
  { key: "advance", name: "Advance Onboarding Solutions", companyType: "CONSTRUCTION_STAFFING", market: "United States", officialSite: "https://apply.workable.com/advance-onboarding-solutions/", ats: "WORKABLE", atsIdentifier: "advance-onboarding-solutions", jobsUrl: "https://apply.workable.com/advance-onboarding-solutions/", evidence: "Persisted Workable candidate 71AB16D4C2", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "buildforce", name: "Buildforce", companyType: "CONSTRUCTION_STAFFING", market: "Houston", officialSite: "https://www.buildforce.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.buildforce.com/markets/houston", evidence: "Persisted Houston staffing observation", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "talentcorps", name: "Talent Corps", companyType: "CONSTRUCTION_STAFFING", market: "Texas", officialSite: "https://talentcorps.com", ats: null, atsIdentifier: null, jobsUrl: "https://talentcorps.com/employers/electrical-staffing-solutions", evidence: "Persisted electrical-staffing observation", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "premier", name: "Premier Electrical Staffing", companyType: "CONSTRUCTION_STAFFING", market: "Houston", officialSite: "https://www.premierelectricalstaffing.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.premierelectricalstaffing.com/locations/tx/houston", evidence: "Persisted Houston observation", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "burnett", name: "Burnett Specialists", companyType: "CONSTRUCTION_STAFFING", market: "Houston / Texas", officialSite: "https://burnettspecialists.com", ats: null, atsIdentifier: null, jobsUrl: "https://burnettspecialists.com/electrician-staffing-texas", evidence: "Persisted electrical-staffing observation", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED" },
  { key: "clayton", name: "Clayton Services", companyType: "CONSTRUCTION_STAFFING", market: "Houston", officialSite: "https://www.claytonpersonnel.com", ats: null, atsIdentifier: null, jobsUrl: "https://www.claytonpersonnel.com/electrician-staffing-houston", evidence: "Persisted Houston electrical-staffing observation", verifiedAt: "2026-10-07", status: "VERIFIED", access: "UNCONFIRMED",
    ownerNote: "Owner catalog 2026-10-07: no longer a staffing firm; replaced by TRS Staffing Solutions. Local observation kept for the record." },
];

// ---------------------------------------------------------------------------------------------------------
// Commercial intelligence (Stage 4): evidence-backed signals → POSIBLE_CLIENTE, never a confirmed client.

export type CommercialSignal = "STAFFING_AGENCY" | "REPEATED_THREE_WEEKS" | "SIMULTANEOUS_CONCENTRATION" | "APPRENTICE_HELPER_DEMAND" | "EXPLICIT_EXTERNAL_NEED";
/** One individually evidenced posting observation (dated, with its raw evidence id). */
export interface PostingObservationEvidence {
  readonly postingIdentity: string;
  readonly title: string | null;
  readonly observedAt: string;
  readonly evidenceId: string;
  readonly relationship: "DIRECT_HIRE_POSTING" | "STAFFING_POSTING" | "UNKNOWN";
}
export interface CommercialSignalInput {
  readonly companyType: CompanyType;
  /** Evidence reference for the company type (e.g. catalog key + source); a type without a reference does not count. */
  readonly companyTypeEvidence: string | null;
  readonly observations: readonly PostingObservationEvidence[];
  readonly explicitExternalNeed: { readonly text: string; readonly evidenceId: string } | null;
}
export interface CommercialSignalReason { readonly signal: CommercialSignal; readonly reason: string; readonly evidence: readonly string[] }

const WEEK_MS = 7 * 86_400_000;
const isoWeek = (iso: string) => { const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7; const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4)); return `${thursday.getUTCFullYear()}-W${1 + Math.round((thursday.getTime() - firstThursday.getTime()) / WEEK_MS)}`; };

/**
 * Rules (owner catalog sheet "Reglas"): staffing/recruiting company; the same posting observed in ≥3 distinct weeks
 * spanning ≥14 days (the clock starts at the first capture, so a first observation can never qualify); ≥3 distinct
 * individually evidenced postings observed within the same 7 days (postings, never workers); apprentice/helper postings;
 * an explicitly stated external need. A direct-hire posting by itself proves nothing about vendor acceptance.
 */
export function classifyCommercialSignals(input: CommercialSignalInput) {
  const reasons: CommercialSignalReason[] = [];
  if (input.companyType === "CONSTRUCTION_STAFFING" && input.companyTypeEvidence?.trim()) {
    reasons.push({ signal: "STAFFING_AGENCY", reason: "Locally evidenced company type is construction staffing/recruiting: someone in this market buys external labor. This does not prove the agency itself buys from Fly.", evidence: [input.companyTypeEvidence.trim()] });
  }
  const byPosting = new Map<string, PostingObservationEvidence[]>();
  for (const o of input.observations) if (!Number.isNaN(Date.parse(o.observedAt))) byPosting.set(o.postingIdentity, [...(byPosting.get(o.postingIdentity) ?? []), o]);
  for (const [identity, obs] of byPosting) {
    const sorted = [...obs].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const weeks = new Set(sorted.map((o) => isoWeek(o.observedAt)));
    const spanDays = (Date.parse(sorted[sorted.length - 1].observedAt) - Date.parse(sorted[0].observedAt)) / 86_400_000;
    if (weeks.size >= 3 && spanDays >= 14) {
      reasons.push({ signal: "REPEATED_THREE_WEEKS", reason: `Posting ${identity.slice(0, 12)} observed in ${weeks.size} distinct weeks over ${Math.floor(spanDays)} days (${sorted[0].observedAt.slice(0, 10)} → ${sorted[sorted.length - 1].observedAt.slice(0, 10)}).`,
        evidence: [...new Set(sorted.map((o) => o.evidenceId))] });
    }
  }
  const latest = input.observations.reduce<number>((max, o) => Math.max(max, Date.parse(o.observedAt) || 0), 0);
  const recent = [...new Map(input.observations.filter((o) => latest - Date.parse(o.observedAt) < WEEK_MS).map((o) => [o.postingIdentity, o])).values()];
  if (recent.length >= 3) {
    reasons.push({ signal: "SIMULTANEOUS_CONCENTRATION", reason: `${recent.length} distinct individually evidenced postings observed within the same 7 days. This counts postings, not workers required.`,
      evidence: recent.map((o) => o.evidenceId) });
  }
  const entry = [...new Map(input.observations.filter((o) => /\b(apprentice|helper|trainee)\b/i.test(o.title ?? "")).map((o) => [o.postingIdentity, o])).values()];
  if (entry.length) reasons.push({ signal: "APPRENTICE_HELPER_DEMAND", reason: `${entry.length} individually evidenced posting(s) explicitly name apprentice, helper or trainee.`, evidence: entry.map((o) => o.evidenceId) });
  if (input.explicitExternalNeed?.text.trim() && input.explicitExternalNeed.evidenceId.trim()) {
    reasons.push({ signal: "EXPLICIT_EXTERNAL_NEED", reason: input.explicitExternalNeed.text.trim(), evidence: [input.explicitExternalNeed.evidenceId.trim()] });
  }
  const directHireOnly = input.observations.length > 0 && input.observations.every((o) => o.relationship === "DIRECT_HIRE_POSTING");
  return {
    classification: reasons.length ? ("POSIBLE_CLIENTE" as const) : ("INSUFFICIENT_EVIDENCE" as const),
    reasons,
    clientConfirmed: false as const,
    /** Number of distinct postings evidenced — never a worker headcount. */
    distinctPostings: byPosting.size,
    workersRequired: null,
    note: !reasons.length && directHireOnly ? "Direct-hire postings only: they show labor demand, not acceptance of external vendors. Recorded, not added to the funnel." : null,
  };
}
