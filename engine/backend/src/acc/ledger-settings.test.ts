import { describe, expect, it } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { isBeforeLedgerStart, LEDGER_DEFAULTS, loadLedgerSettings, saveLedgerSettings } from './ledger-settings';

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
