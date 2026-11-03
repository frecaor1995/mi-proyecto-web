import { getProductionSqlClient } from "../database/production-sql-client";

/**
 * WORKFORCE-TALENT-A4. Read-only lookup over the shared canonical taxonomy
 * (workforce_trades/workforce_occupations/workforce_skills/workforce_credentials)
 * -- the same reference tables demand_signals already joins against
 * (postgres-project-intelligence-repository.ts), never a worker table. This
 * is deliberately NOT routed through WorkerService: WorkerService's remit is
 * the nine worker-domain tables, and these four are pre-existing,
 * multi-profession reference data with no worker identity involved.
 * Explicit column lists throughout; never `select *`.
 */

export interface TradeOption { readonly code: string; readonly labelEn: string; readonly labelEs?: string }
export interface OccupationOption { readonly code: string; readonly tradeCode: string; readonly labelEn: string; readonly labelEs?: string }
export interface SkillOption { readonly code: string; readonly labelEn: string; readonly labelEs?: string }
export interface CredentialOption { readonly code: string; readonly labelEn: string; readonly labelEs?: string }

export interface WorkforceTaxonomy {
  readonly trades: readonly TradeOption[];
  readonly occupations: readonly OccupationOption[];
  readonly skills: readonly SkillOption[];
  readonly credentials: readonly CredentialOption[];
}

const EMPTY_TAXONOMY: WorkforceTaxonomy = { trades: [], occupations: [], skills: [], credentials: [] };

export async function getWorkforceTaxonomy(): Promise<WorkforceTaxonomy> {
  const client = getProductionSqlClient();
  if (!client) return EMPTY_TAXONOMY;
  try {
    const [trades, occupations, skills, credentials] = await Promise.all([
      client.query<{ code: string; label_en: string; label_es: string }>("select code,label_en,label_es from workforce_trades where active order by label_en"),
      client.query<{ code: string; trade_code: string; label_en: string; label_es: string }>("select code,trade_code,label_en,label_es from workforce_occupations where active order by label_en"),
      client.query<{ code: string; label_en: string; label_es: string }>("select code,label_en,label_es from workforce_skills where active order by label_en"),
      client.query<{ code: string; label_en: string; label_es: string }>("select code,label_en,label_es from workforce_credentials where active order by label_en"),
    ]);
    return {
      trades: trades.rows.map((r) => ({ code: r.code, labelEn: r.label_en, labelEs: r.label_es })),
      occupations: occupations.rows.map((r) => ({ code: r.code, tradeCode: r.trade_code, labelEn: r.label_en, labelEs: r.label_es })),
      skills: skills.rows.map((r) => ({ code: r.code, labelEn: r.label_en, labelEs: r.label_es })),
      credentials: credentials.rows.map((r) => ({ code: r.code, labelEn: r.label_en, labelEs: r.label_es })),
    };
  } catch {
    return EMPTY_TAXONOMY;
  }
}
