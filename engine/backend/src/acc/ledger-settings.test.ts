import { describe, expect, it, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { fiscalYearStart, isBeforeLedgerStart, LEDGER_DEFAULTS, ledgerEditSide, loadLedgerSettings, saveLedgerSettings } from './ledger-settings';

describe('ledger settings', () => {
  it('returns defaults when the company has no settings row', async () => {
    const sb = fakeSb({ acc_company_settings: [] });
    const r = await loadLedgerSettings(sb, 1);
    expect(r).toEqual({ ok: true, settings: { ledgerStartDate: null, fiscalYearEndMonth: 8 } });
  });

  it('reads the saved start date and fiscal year end', async () => {
    const sb = fakeSb({ acc_company_settings: [{ company_id: 2, ledger_start_date: '2026-12-01', fiscal_year_end_month: 12 }] });
    const r = await loadLedgerSettings(sb, 2);
    expect(r).toEqual({ ok: true, settings: { ledgerStartDate: '2026-12-01', fiscalYearEndMonth: 12 } });
  });

  it('reads company 1 when the company is not known', async () => {
    const sb = fakeSb({ acc_company_settings: [{ company_id: 1, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }] });
    const r = await loadLedgerSettings(sb, null);
    expect(r.ok && r.settings.ledgerStartDate).toBe('2026-12-01');
  });

  it('fails closed when the read fails', async () => {
    const sb = fakeSb({ acc_company_settings: [] }, { acc_company_settings: ['ledger_start_date'] });
    const r = await loadLedgerSettings(sb, 1);
    expect(r.ok).toBe(false);
  });

  it('saving keeps the deposit-invoice and performance columns', async () => {
    const tables = { acc_company_settings: [{ company_id: 1, deposit_invoice_enabled: true, performance_opex_rate_bp: 1200 }] };
    const sb = fakeSb(tables);
    const r = await saveLedgerSettings(sb, 1, { ledgerStartDate: '2026-12-01' }, 'chew');
    expect(r).toEqual({ ok: true });
    const row = tables.acc_company_settings[0] as Record<string, unknown>;
    expect(row.deposit_invoice_enabled).toBe(true);
    expect(row.performance_opex_rate_bp).toBe(1200);
    expect(row.ledger_start_date).toBe('2026-12-01');
    expect(row.updated_by).toBe('chew');
    expect('fiscal_year_end_month' in row).toBe(false);
  });

  it('isBeforeLedgerStart compares the day against the start', () => {
    const s = { ...LEDGER_DEFAULTS, ledgerStartDate: '2026-12-01' };
    expect(isBeforeLedgerStart('2026-11-30', s)).toBe(true);
    expect(isBeforeLedgerStart('2026-12-01', s)).toBe(false);
    expect(isBeforeLedgerStart('2026-11-30', LEDGER_DEFAULTS)).toBe(false);
  });
});

describe('ledgerEditSide', () => {
  const sb = (start: string | null) => fakeSb({ acc_company_settings: start ? [{ company_id: 1, ledger_start_date: start, fiscal_year_end_month: 8 }] : [] });

  it('is after when no start is set', async () => {
    expect(await ledgerEditSide(sb(null), 1, '2020-01-01', '2020-01-02')).toEqual({ ok: true, side: 'after' });
  });
  it('is before when both dates are before the start', async () => {
    expect(await ledgerEditSide(sb('2026-12-01'), 1, '2026-11-01', '2026-11-30')).toEqual({ ok: true, side: 'before' });
  });
  it('is across, with the sentence, when the edit moves the date over the start either way', async () => {
    const across = { ok: true, side: 'across', message: 'This date is before the books start on 2026-12-01.' };
    expect(await ledgerEditSide(sb('2026-12-01'), 1, '2026-12-05', '2026-11-30')).toEqual(across);
    expect(await ledgerEditSide(sb('2026-12-01'), 1, '2026-11-30', '2026-12-01')).toEqual(across);
  });
  it('is after when both are on or after the start', async () => {
    expect(await ledgerEditSide(sb('2026-12-01'), 1, '2026-12-01', '2026-12-09')).toEqual({ ok: true, side: 'after' });
  });
  it('fails closed when the read fails', async () => {
    const broken = fakeSb({ acc_company_settings: [] }, { acc_company_settings: ['ledger_start_date'] });
    expect((await ledgerEditSide(broken, 1, '2026-12-01', '2026-12-02')).ok).toBe(false);
  });
});

/* The fiscal year (spec 3.7): Conts ends in August, so its year runs 1 September to 31 August. */
describe('fiscalYearStart', () => {
  test('the first day of the fiscal year a date falls in', () => {
    expect(fiscalYearStart('2026-12-15', 8)).toBe('2026-09-01');
    expect(fiscalYearStart('2026-08-31', 8)).toBe('2025-09-01');
    expect(fiscalYearStart('2026-09-01', 8)).toBe('2026-09-01');
    expect(fiscalYearStart('2026-03-10', 12)).toBe('2026-01-01');
    expect(fiscalYearStart('2026-12-31', 12)).toBe('2026-01-01');
  });
});
