import type { ContactPersonCandidate, ContactPersonRecord, ContactRouteCandidate, ContactRouteRecord, RouteGradeEvaluation } from "../../../domain/contact";
export interface ContactRepository {
  upsertPerson(candidate: ContactPersonCandidate, normalizedName: string, identityKey: string): Promise<ContactPersonRecord>;
  upsertRoute(candidate: ContactRouteCandidate, normalizedTarget: string): Promise<ContactRouteRecord>;
  getRoute(id: string): Promise<ContactRouteRecord | null>;
  listRoutes(companyId: string): Promise<ContactRouteRecord[]>;
  /** UI-7 addition, mirrors listRoutes -- no by-company read existed for people before. */
  listPeople(companyId: string): Promise<ContactPersonRecord[]>;
  linkEvidence(kind: "CONTACT_PERSON" | "CONTACT_ROUTE", id: string, evidenceId: string): Promise<void>;
  saveGrade(input: Omit<RouteGradeEvaluation, "id">): Promise<RouteGradeEvaluation>;
  listGrades(routeId: string): Promise<RouteGradeEvaluation[]>;
}
