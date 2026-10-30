import { describe, expect, it } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import {
  DEFAULT_RENO_DESCRIPTION, EINVOICE_DEFAULTS, loadEInvoiceSettings, saveEInvoiceSettings, sellerMissing, validateEInvoiceSettings,
  type EInvoiceSettings,
} from './einvoice-settings';

const SELLER: EInvoiceSettings['seller'] = {
  tin: 'C12345678901', brn: '202001012345', sstNo: '', msicCode: '43301', activityDesc: 'Interior renovation works',
  address1: '1 Jalan Contoh', address2: '', city: 'Kuala Lumpur', postcode: '50000', stateCode: '14', phone: '+60312345678', email: '',
};
const full = (patch: Partial<EInvoiceSettings> = {}): EInvoiceSettings => ({ ...EINVOICE_DEFAULTS, seller: { ...SELLER }, ...patch });

describe('e-invoice settings', () => {
  it('defaults are 022, 06, SST off, inactive', () => {
    expect(EINVOICE_DEFAULTS).toMatchObject({ classificationCode: '022', taxType: '06', sstEnabled: false, active: false });
  });

  it('default template is the placeholder sentence', () => {
    expect(EINVOICE_DEFAULTS.renoDescriptionTemplate).toBe(DEFAULT_RENO_DESCRIPTION);
    expect(DEFAULT_RENO_DESCRIPTION).toBe(
      '{ordinal} Progress Billing for Interior Design & Renovation Works ({pct} {label} as per Sales Order, refer to attached breakdown)');
  });

  it('accepts complete settings', () => {
    expect(validateEInvoiceSettings(full({ active: true }))).toEqual({ ok: true });
  });

  it('rejects classification that is not three digits', () => {
    expect(validateEInvoiceSettings(full({ classificationCode: '22' }))).toMatchObject({ ok: false, field: 'classificationCode' });
  });

  it('rejects unknown tax type', () => {
    expect(validateEInvoiceSettings(full({ taxType: '07' }))).toMatchObject({ ok: false, field: 'taxType' });
  });

  it('refuses switching SST on', () => {
    expect(validateEInvoiceSettings(full({ sstEnabled: true }))).toEqual({
      ok: false, field: 'sstEnabled', message: 'SST postings are not built yet. Leave SST off until they are.',
    });
  });

  it('refuses active while seller details are missing', () => {
    const r = validateEInvoiceSettings({ ...EINVOICE_DEFAULTS, active: true });
    expect(r).toMatchObject({ ok: false, field: 'active' });
    expect(!r.ok && r.message).toContain('seller TIN');
  });

  it('lists missing seller details in plain words', () => {
    expect(sellerMissing(EINVOICE_DEFAULTS)).toEqual([
      'seller TIN', 'seller registration no.', 'seller MSIC code', 'seller business activity', 'seller address', 'seller state', 'seller phone',
    ]);
    expect(sellerMissing(full())).toEqual([]);
  });

  it('MSIC must be five digits; seller TIN has a letter prefix and digits', () => {
    expect(validateEInvoiceSettings(full({ seller: { ...SELLER, msicCode: '4330' } }))).toMatchObject({ ok: false, field: 'seller.msicCode' });
    expect(validateEInvoiceSettings(full({ seller: { ...SELLER, tin: '12345' } }))).toMatchObject({ ok: false, field: 'seller.tin' });
    expect(validateEInvoiceSettings(full({ seller: { ...SELLER, tin: 'IG98765432100' } }))).toEqual({ ok: true });
  });

  it('a blank seller field is allowed while inactive', () => {
    expect(validateEInvoiceSettings({ ...EINVOICE_DEFAULTS })).toEqual({ ok: true });
  });

  it('loads defaults when the company has no row, and reads saved values', async () => {
    expect(await loadEInvoiceSettings(fakeSb({ acc_company_settings: [] }), 1)).toEqual(EINVOICE_DEFAULTS);
    const sb = fakeSb({ acc_company_settings: [{ company_id: 1, einvoice_active: true, einvoice_classification: '022', einvoice_tax_type: '06',
      sst_enabled: false, reno_invoice_description: '{ordinal} billing', seller_tin: 'C1234567890', seller_state_code: '14' }] });
    const s = await loadEInvoiceSettings(sb, 1);
    expect(s.active).toBe(true);
    expect(s.renoDescriptionTemplate).toBe('{ordinal} billing');
    expect(s.seller.tin).toBe('C1234567890');
    expect(s.seller.brn).toBe('');
  });

  it('saving writes the e-invoice columns and keeps the others', async () => {
    const tables: Record<string, Record<string, unknown>[]> = { acc_company_settings: [{ company_id: 1, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8 }] };
    const sb = fakeSb(tables);
    const r = await saveEInvoiceSettings(sb, 1, full(), 'chew');
    expect(r).toEqual({ ok: true });
    const row = tables.acc_company_settings[0];
    expect(row).toMatchObject({ ledger_start_date: '2026-11-01', seller_tin: 'C12345678901', seller_msic: '43301', einvoice_tax_type: '06', updated_by: 'chew' });
  });

  it('saving refuses invalid settings without writing', async () => {
    const tables: Record<string, Record<string, unknown>[]> = { acc_company_settings: [] };
    const sb = fakeSb(tables);
    const r = await saveEInvoiceSettings(sb, 1, full({ sstEnabled: true }), 'chew');
    expect(r).toMatchObject({ ok: false, field: 'sstEnabled' });
    expect(tables.acc_company_settings).toEqual([]);
  });
});
