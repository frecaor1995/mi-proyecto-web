import type { VerificationState } from "./database";

export const CONTACT_FUNCTIONS = ["RECRUITER", "CRAFT_RECRUITER", "TALENT_ACQUISITION", "WORKFORCE", "PROCUREMENT", "SUBCONTRACTS", "SUPPLIER_MANAGEMENT", "PROJECT_MANAGEMENT", "CONSTRUCTION_MANAGEMENT", "OPERATIONS", "HR", "GENERAL_OFFICE", "OTHER"] as const;
export const CONTACT_ROUTE_TYPES = ["PROFESSIONAL_PHONE", "PROFESSIONAL_EMAIL", "CORPORATE_PHONE", "CORPORATE_EMAIL", "RECRUITER_PHONE", "RECRUITER_EMAIL", "PROCUREMENT_PHONE", "PROCUREMENT_EMAIL", "OFFICE_PHONE", "SUPPLIER_PORTAL", "VENDOR_REGISTRATION", "CONTACT_FORM", "PROFESSIONAL_PROFILE", "OTHER"] as const;
export const CONTACT_ROUTE_GRADES = ["A", "B", "C", "D", "E"] as const;
export const CONTACT_LANGUAGE_STATUSES = ["UNKNOWN", "SPANISH_CONFIRMED", "BILINGUAL_CONFIRMED"] as const;

export type ContactFunction = (typeof CONTACT_FUNCTIONS)[number];
export type ContactRouteType = (typeof CONTACT_ROUTE_TYPES)[number];
export type ContactRouteGrade = (typeof CONTACT_ROUTE_GRADES)[number];
export type ContactLanguageStatus = (typeof CONTACT_LANGUAGE_STATUSES)[number];

export interface ContactPersonCandidate { companyId: string; fullName: string; title?: string | null; department?: string | null; contactFunction: ContactFunction; professionalProfileUrl?: string | null; evidenceId?: string | null; verificationState?: VerificationState; observedAt: Date; staleAfter?: Date | null; verificationDueAt?: Date | null; languageStatus?: ContactLanguageStatus; languageEvidenceId?: string | null; notes?: string | null; metadata?: Record<string, unknown> }
export interface ContactPersonRecord extends ContactPersonCandidate { id: string; normalizedName: string; verificationState: VerificationState; firstSeenAt: Date; lastSeenAt: Date }
export interface ContactRouteCandidate { companyId: string; contactPersonId?: string | null; routeType: ContactRouteType; target: string; evidenceId?: string | null; verificationState?: VerificationState; observedAt: Date; lastVerifiedAt?: Date | null; staleAfter?: Date | null; verificationDueAt?: Date | null; lifecycle?: "ACTIVE" | "STALE" | "DISABLED" | "UNKNOWN"; metadata?: Record<string, unknown> }
export interface ContactRouteRecord extends ContactRouteCandidate { id: string; contactPersonId: string | null; normalizedTarget: string; observedTarget: string; verificationState: VerificationState; evidenceId: string | null; routeGrade: ContactRouteGrade | null; lifecycle: "ACTIVE" | "STALE" | "DISABLED" | "UNKNOWN"; firstSeenAt: Date; lastSeenAt: Date; lastVerifiedAt: Date | null; staleAfter: Date | null; verificationDueAt: Date | null }
export interface RouteGradeInput { route: ContactRouteRecord; personFunction?: ContactFunction | null; authorityExplicit?: boolean; manpowerAcceptance?: "VERIFIED" | "NOT_VERIFIED" | "INSUFFICIENT_EVIDENCE" | "STALE"; evaluatedAt?: Date }
export interface RouteGradeEvaluation { id: string; contactRouteId: string; grade: ContactRouteGrade; reason: string; ruleVersion: string; evaluatedAt: Date; inputs: Record<string, unknown> }
export interface ContactExtractionResult { people: ContactPersonCandidate[]; routes: Omit<ContactRouteCandidate, "contactPersonId">[] }
