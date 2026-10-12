import { getProductionSqlClient } from "../database/production-sql-client";
import { PostgresCompanyRepository } from "../repositories/company/postgres-company-repository";
import { PostgresContactRepository } from "../repositories/contact/postgres-contact-repository";
import { PostgresManpowerAcceptanceRepository } from "../repositories/manpower-acceptance/postgres-manpower-acceptance-repository";
import { PostgresOpportunityRepository } from "../repositories/opportunity/postgres-opportunity-repository";
import { PostgresHumanVerificationDeskRepository } from "../repositories/human-verification-desk/postgres-human-verification-desk-repository";
import { PostgresEvidenceRepository } from "../repositories/evidence/postgres-evidence-repository";
import { assembleCompanyDetailView, assembleCompanyListItem, type CompanyDetailView, type CompanyListItem } from "../read-models/company-detail";
import type { ReadModelCapabilityState } from "../read-models/shared";

export const COMPANY_LIST_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CompanyListQuery { readonly search: string; readonly page: number }
export interface CompanyListResult { readonly capability: ReadModelCapabilityState; readonly items: readonly CompanyListItem[]; readonly total: number | null; readonly pageCount: number | null; readonly reason: string | null }
export type CompanyDetailResult =
  | { readonly state: "READY"; readonly detail: CompanyDetailView }
  | { readonly state: "NOT_FOUND" | "UNAVAILABLE" | "ERROR"; readonly detail: null; readonly reason: string };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function parseCompanyListQuery(params: Record<string, string | string[] | undefined>): CompanyListQuery {
  const page = Number.parseInt(one(params.page), 10);
  return { search: one(params.q).trim().slice(0, 120), page: Number.isFinite(page) && page > 0 ? page : 1 };
}

export function companyListHref(query: CompanyListQuery, changes: Partial<CompanyListQuery>): string {
  const next = { ...query, ...changes };
  const params = new URLSearchParams();
  if (next.search) params.set("q", next.search);
  if (next.page > 1) params.set("page", String(next.page));
  const value = params.toString();
  return value ? `/companies?${value}` : "/companies";
}

/** Canonical repositories could resolve a company by name/alias but could not enumerate companies or load one by id -- see CompanyRepository.enumerate()/getById() (UI-7 additions). */
async function loadCompanyListSource(query: CompanyListQuery): Promise<CompanyListResult> {
  const client = getProductionSqlClient();
  if (!client) return { capability: "UNAVAILABLE", items: [], total: null, pageCount: null, reason: "DATABASE_CONNECTION_UNAVAILABLE" };
  const repository = new PostgresCompanyRepository(client);
  const asOf = new Date();
  const offset = (query.page - 1) * COMPANY_LIST_PAGE_SIZE;
  const result = await repository.enumerate({ search: query.search, asOf, limit: COMPANY_LIST_PAGE_SIZE, offset });
  const items = result.items.map((entry) => assembleCompanyListItem(entry, asOf));
  return { capability: "OPERATIONAL", items, total: result.total, pageCount: Math.max(1, Math.ceil(result.total / COMPANY_LIST_PAGE_SIZE)), reason: null };
}

export async function getCompanyListPage(query: CompanyListQuery, load: (query: CompanyListQuery) => Promise<CompanyListResult> = loadCompanyListSource): Promise<CompanyListResult> {
  try {
    return await load(query);
  } catch {
    return { capability: "UNKNOWN", items: [], total: null, pageCount: null, reason: "COMPANY_QUERY_FAILED" };
  }
}

/**
 * Composes six repositories (four reused as-is: CompanyRepository.listRoles,
 * ContactRepository.listRoutes, ManpowerAcceptanceRepository.listEvaluations,
 * EvidenceRepository.getById; three UI-7 additions: CompanyRepository
 * enumerate/getById, ContactRepository.listPeople, OpportunityRepository
 * .listByCompany, HumanVerificationDeskRepository.listByCompany) into one
 * bounded read model. Every write method on every one of these repositories
 * is untouched and unused here.
 */
export async function loadCompanyDetail(id: string): Promise<CompanyDetailResult> {
  if (!UUID.test(id)) return { state: "NOT_FOUND", detail: null, reason: "INVALID_COMPANY_ID" };
  const client = getProductionSqlClient();
  if (!client) return { state: "UNAVAILABLE", detail: null, reason: "DATABASE_CONNECTION_UNAVAILABLE" };
  const companyRepository = new PostgresCompanyRepository(client);
  try {
    const company = await companyRepository.getById(id);
    if (!company) return { state: "NOT_FOUND", detail: null, reason: "COMPANY_NOT_FOUND" };
    const contactRepository = new PostgresContactRepository(client);
    const manpowerRepository = new PostgresManpowerAcceptanceRepository(client);
    const opportunityRepository = new PostgresOpportunityRepository(client);
    const verificationRepository = new PostgresHumanVerificationDeskRepository(client);
    const evidenceRepository = new PostgresEvidenceRepository(client);
    const [roles, contactPeople, contactRoutes, manpowerAcceptanceHistory, relatedOpportunities, humanVerificationTasks] = await Promise.all([
      companyRepository.listRoles(id),
      contactRepository.listPeople(id),
      contactRepository.listRoutes(id),
      manpowerRepository.listEvaluations(id),
      opportunityRepository.listByCompany(id),
      verificationRepository.listByCompany(id),
    ]);
    const evidenceIds = Array.from(new Set([
      ...roles.map((role) => role.evidenceId),
      ...contactRoutes.map((route) => route.evidenceId).filter((value): value is string => !!value),
      ...manpowerAcceptanceHistory.flatMap((evaluation) => evaluation.supportingEvidenceIds),
    ]));
    const evidenceRecords = (await Promise.all(evidenceIds.map((evidenceId) => evidenceRepository.getById(evidenceId))))
      .filter((record): record is NonNullable<typeof record> => !!record);
    const asOf = new Date();
    const detail = assembleCompanyDetailView({
      company, roles, relatedOpportunities, contactPeople, contactRoutes,
      manpowerAcceptanceHistory, humanVerificationTasks, evidence: evidenceRecords, asOf,
    });
    return { state: "READY", detail };
  } catch {
    return { state: "ERROR", detail: null, reason: "COMPANY_QUERY_FAILED" };
  }
}

export async function getCompanyDetailPage(id: string, load: (id: string) => Promise<CompanyDetailResult> = loadCompanyDetail): Promise<CompanyDetailResult> {
  try {
    return await load(id);
  } catch {
    return { state: "ERROR", detail: null, reason: "COMPANY_QUERY_FAILED" };
  }
}
