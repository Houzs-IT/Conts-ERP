// ----------------------------------------------------------------------------
// Conts ledger settings (finance 2026-10-21; docs/superpowers/specs/
// 2026-10-20-finance-phase1-ledger-design.md 3.7, 3.8).
//
// ledgerStartDate: the day the books start in the engine. Everything dated
// before it is already inside the AutoCount opening balances, so nothing dated
// before it may post or reverse (engine.ts). Null = no start set, posting as
// before.
// fiscalYearEndMonth: Conts closes its year at the end of August (FYE 8).
//
// Both live on scm.acc_company_settings beside the deposit-invoice switch and
// the performance P&L settings; a save writes only these two columns.
// ----------------------------------------------------------------------------

import { ACC_MASTERS_FALLBACK_COMPANY_ID } from './masters-company';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;

export interface LedgerSettings { ledgerStartDate: string | null; fiscalYearEndMonth: number }

export const LEDGER_DEFAULTS: LedgerSettings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };

const dayOf = (v: unknown): string | null => {
  const d = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/** A failed read is { ok: false }, never the defaults: defaults mean "no start
    date", and that would let a pre-start document post. */
export async function loadLedgerSettings(
  sb: Db,
  companyId: number | null,
): Promise<{ ok: true; settings: LedgerSettings } | { ok: false }> {
  const { data, error } = await sb.from('acc_company_settings')
    .select('ledger_start_date, fiscal_year_end_month')
    .eq('company_id', companyId ?? ACC_MASTERS_FALLBACK_COMPANY_ID)
    .maybeSingle();
  if (error) return { ok: false };
  const row = data as { ledger_start_date?: string | null; fiscal_year_end_month?: number | null } | null;
  const month = Number(row?.fiscal_year_end_month);
  return {
    ok: true,
    settings: {
      ledgerStartDate: dayOf(row?.ledger_start_date),
      fiscalYearEndMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : LEDGER_DEFAULTS.fiscalYearEndMonth,
    },
  };
}

export async function saveLedgerSettings(
  sb: Db,
  companyId: number,
  patch: Partial<LedgerSettings>,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString(), updated_by: actor };
  if (patch.ledgerStartDate !== undefined) row.ledger_start_date = patch.ledgerStartDate;
  if (patch.fiscalYearEndMonth !== undefined) row.fiscal_year_end_month = patch.fiscalYearEndMonth;
  const { error } = await sb.from('acc_company_settings').upsert(row, { onConflict: 'company_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function isBeforeLedgerStart(date: string, s: LedgerSettings): boolean {
  return s.ledgerStartDate != null && String(date).slice(0, 10) < s.ledgerStartDate;
}
