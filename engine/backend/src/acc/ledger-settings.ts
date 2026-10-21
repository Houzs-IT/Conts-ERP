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
import { dateOrNull } from '../scm/lib/date-coerce';

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
  return { ok: true, settings: ledgerSettingsOf(data as LedgerSettingsRow | null) };
}

/** The company's settings row, as the ledger reads it (a caller holding the row already parses it here). */
export type LedgerSettingsRow = { ledger_start_date?: string | null; fiscal_year_end_month?: number | null };
export function ledgerSettingsOf(row: LedgerSettingsRow | null): LedgerSettings {
  const month = Number(row?.fiscal_year_end_month);
  return {
    ledgerStartDate: dayOf(row?.ledger_start_date),
    fiscalYearEndMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : LEDGER_DEFAULTS.fiscalYearEndMonth,
  };
}

export async function saveLedgerSettings(
  sb: Db,
  companyId: number,
  patch: Partial<LedgerSettings>,
  actor: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString(), updated_by: actor };
  if (patch.ledgerStartDate !== undefined) row.ledger_start_date = dateOrNull(patch.ledgerStartDate);
  if (patch.fiscalYearEndMonth !== undefined) row.fiscal_year_end_month = patch.fiscalYearEndMonth;
  const { error } = await sb.from('acc_company_settings').upsert(row, { onConflict: 'company_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function isBeforeLedgerStart(date: string, s: LedgerSettings): boolean {
  return s.ledgerStartDate != null && String(date).slice(0, 10) < s.ledgerStartDate;
}

/** The first day of the fiscal year a date falls in (spec 3.7): the day after the year-end month closes. Conts ends
    in August, so its year runs 1 September to 31 August. */
export function fiscalYearStart(asOf: string, fyEndMonth: number): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const startMonth = (fyEndMonth % 12) + 1;
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}

export const beforeLedgerStartMessage = (start: string): string => `This date is before the books start on ${start}.`;

/** For the edit doors (Conts): an edit that would move a document across the
    ledger start, or touch one dated before it, is refused before any write —
    a reversal on one side and a re-post on the other would double-count it or
    drop it from the books. `failed` = the settings could not be read. */
export async function ledgerDatesRefusal(
  sb: Db,
  companyId: number | null,
  dates: ReadonlyArray<string | null | undefined>,
): Promise<null | { failed: boolean; error: string }> {
  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { failed: true, error: 'The ledger settings could not be read.' };
  const start = ls.settings.ledgerStartDate;
  if (start == null) return null;
  return dates.some((d) => d && isBeforeLedgerStart(d, ls.settings)) ? { failed: false, error: beforeLedgerStartMessage(start) } : null;
}

/** Which side of the ledger start an edit sits on (Conts). `before`: both
    dates before it — the document may change, the books do not. `across`: the
    edit moves it over the start, either way — refused, since the contra and the
    re-post would land on different sides. `after`: as before the start existed. */
export async function ledgerEditSide(
  sb: Db,
  companyId: number | null,
  oldDate: string,
  newDate: string,
): Promise<{ ok: false; error: string } | { ok: true; side: 'after' | 'before' } | { ok: true; side: 'across'; message: string }> {
  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { ok: false, error: 'The ledger settings could not be read.' };
  const oldBefore = isBeforeLedgerStart(oldDate, ls.settings);
  const newBefore = isBeforeLedgerStart(newDate, ls.settings);
  if (oldBefore && newBefore) return { ok: true, side: 'before' };
  if (oldBefore || newBefore) return { ok: true, side: 'across', message: beforeLedgerStartMessage(ls.settings.ledgerStartDate as string) };
  return { ok: true, side: 'after' };
}
