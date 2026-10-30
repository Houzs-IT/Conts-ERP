// ----------------------------------------------------------------------------
// E-invoice settings (finance, chew 30 Oct 2026; docs/superpowers/specs/
// 2026-10-30-renovation-revenue-einvoice-design.md goal 7, 7.4, 7.7; plan
// 2026-10-30-renovation-einvoice-ready.md Task 1).
//
// Renovation invoices and credit notes are prepared for LHDN e-invoice but
// nothing is sent: `active` only changes what the screens say until a
// connector exists (chew connects MyInvois later). Classification 022 and tax
// type 06 (Not applicable) are the defaults chew's accountant can change. SST
// is stored for later; switching it on is refused until its postings exist.
// Dream Crafter and The Conts are one company, so one seller.
//
// Everything lives on scm.acc_company_settings; a save writes only these columns.
// ----------------------------------------------------------------------------

import { ACC_MASTERS_FALLBACK_COMPANY_ID } from './masters-company';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;

export interface EInvoiceSeller {
  tin: string; brn: string; sstNo: string; msicCode: string; activityDesc: string;
  address1: string; address2: string; city: string; postcode: string; stateCode: string; phone: string; email: string;
}

export interface EInvoiceSettings {
  active: boolean;
  classificationCode: string;
  taxType: string;
  sstEnabled: boolean;
  sstMode: 'EXCLUSIVE' | 'INCLUSIVE' | null;
  sstOutputAccount: string | null;
  renoDescriptionTemplate: string;
  seller: EInvoiceSeller;
}

/** chew's example, with its parts as placeholders (scm/lib/reno-invoice-description.ts renders it). */
export const DEFAULT_RENO_DESCRIPTION =
  '{ordinal} Progress Billing for Interior Design & Renovation Works ({pct} {label} as per Sales Order, refer to attached breakdown)';

/** LHDN tax types (MyInvois SDK code list). */
export const TAX_TYPES: Record<string, string> = {
  '01': 'Sales Tax', '02': 'Service Tax', '03': 'Tourism Tax', '04': 'High-Value Goods Tax',
  '05': 'Sales Tax on Low Value Goods', '06': 'Not applicable', E: 'Tax exemption',
};

const EMPTY_SELLER: EInvoiceSeller = {
  tin: '', brn: '', sstNo: '', msicCode: '', activityDesc: '', address1: '', address2: '', city: '', postcode: '', stateCode: '', phone: '', email: '',
};

export const EINVOICE_DEFAULTS: EInvoiceSettings = {
  active: false, classificationCode: '022', taxType: '06', sstEnabled: false, sstMode: null, sstOutputAccount: null,
  renoDescriptionTemplate: DEFAULT_RENO_DESCRIPTION, seller: EMPTY_SELLER,
};

const SELECT = 'einvoice_active, einvoice_classification, einvoice_tax_type, sst_enabled, sst_mode, sst_output_account, reno_invoice_description, '
  + 'seller_tin, seller_brn, seller_sst_no, seller_msic, seller_activity, seller_address1, seller_address2, seller_city, seller_postcode, '
  + 'seller_state_code, seller_phone, seller_email';

const str = (v: unknown): string => String(v ?? '').trim();

export function eInvoiceSettingsOf(row: Record<string, unknown> | null): EInvoiceSettings {
  if (!row) return EINVOICE_DEFAULTS;
  const mode = str(row.sst_mode);
  return {
    active: row.einvoice_active === true,
    classificationCode: str(row.einvoice_classification) || EINVOICE_DEFAULTS.classificationCode,
    taxType: str(row.einvoice_tax_type) || EINVOICE_DEFAULTS.taxType,
    sstEnabled: row.sst_enabled === true,
    sstMode: mode === 'EXCLUSIVE' || mode === 'INCLUSIVE' ? mode : null,
    sstOutputAccount: str(row.sst_output_account) || null,
    renoDescriptionTemplate: str(row.reno_invoice_description) || DEFAULT_RENO_DESCRIPTION,
    seller: {
      tin: str(row.seller_tin), brn: str(row.seller_brn), sstNo: str(row.seller_sst_no), msicCode: str(row.seller_msic),
      activityDesc: str(row.seller_activity), address1: str(row.seller_address1), address2: str(row.seller_address2), city: str(row.seller_city),
      postcode: str(row.seller_postcode), stateCode: str(row.seller_state_code), phone: str(row.seller_phone), email: str(row.seller_email),
    },
  };
}

/** A failed read throws: e-invoice preparation is a step after posting and its caller logs and carries on. */
export async function loadEInvoiceSettings(sb: Db, companyId: number | null): Promise<EInvoiceSettings> {
  const { data, error } = await sb.from('acc_company_settings').select(SELECT)
    .eq('company_id', companyId ?? ACC_MASTERS_FALLBACK_COMPANY_ID).maybeSingle();
  if (error) throw new Error(`e-invoice settings: ${error.message}`);
  return eInvoiceSettingsOf(data as Record<string, unknown> | null);
}

/** What the seller block still lacks, in the words the screens show. */
export function sellerMissing(s: EInvoiceSettings): string[] {
  const x = s.seller;
  const out: string[] = [];
  if (!x.tin) out.push('seller TIN');
  if (!x.brn) out.push('seller registration no.');
  if (!x.msicCode) out.push('seller MSIC code');
  if (!x.activityDesc) out.push('seller business activity');
  if (!x.address1 || !x.city || !x.postcode) out.push('seller address');
  if (!x.stateCode) out.push('seller state');
  if (!x.phone) out.push('seller phone');
  return out;
}

type Check = { ok: true } | { ok: false; field: string; message: string };

/* Loose on purpose: an unusual but real TIN must not lock finance out. */
const TIN_RE = /^(C|CS|D|E|F|FA|PT|TA|TC|TN|TR|TP|J|LE|IG|OG)\d{8,12}$/;
export const looksLikeTin = (tin: string): boolean => TIN_RE.test(tin.toUpperCase());

export function validateEInvoiceSettings(s: EInvoiceSettings): Check {
  if (!/^\d{3}$/.test(s.classificationCode)) return { ok: false, field: 'classificationCode', message: 'The classification code is three digits, for example 022.' };
  if (!(s.taxType in TAX_TYPES)) return { ok: false, field: 'taxType', message: 'Choose a tax type from the list.' };
  if (s.sstEnabled) return { ok: false, field: 'sstEnabled', message: 'SST postings are not built yet. Leave SST off until they are.' };
  const x = s.seller;
  if (x.tin && !looksLikeTin(x.tin)) return { ok: false, field: 'seller.tin', message: 'The TIN starts with letters (C for a company) followed by digits, for example C12345678901.' };
  if (x.msicCode && !/^\d{5}$/.test(x.msicCode)) return { ok: false, field: 'seller.msicCode', message: 'The MSIC code is five digits.' };
  if (x.stateCode && !/^(0[1-9]|1[0-7])$/.test(x.stateCode)) return { ok: false, field: 'seller.stateCode', message: 'Choose the state from the list.' };
  if (x.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)) return { ok: false, field: 'seller.email', message: 'That email address does not look right.' };
  if (s.active) {
    const missing = sellerMissing(s);
    if (missing.length) return { ok: false, field: 'active', message: `Fill in the seller details first: ${missing.join(', ')}.` };
  }
  return { ok: true };
}

export async function saveEInvoiceSettings(sb: Db, companyId: number, s: EInvoiceSettings, actor: string): Promise<Check> {
  const v = validateEInvoiceSettings(s);
  if (!v.ok) return v;
  const x = s.seller;
  const row = {
    company_id: companyId, updated_at: new Date().toISOString(), updated_by: actor,
    einvoice_active: s.active, einvoice_classification: s.classificationCode, einvoice_tax_type: s.taxType,
    sst_enabled: s.sstEnabled, sst_mode: s.sstMode, sst_output_account: s.sstOutputAccount,
    reno_invoice_description: s.renoDescriptionTemplate.trim() === DEFAULT_RENO_DESCRIPTION ? null : s.renoDescriptionTemplate.trim() || null,
    seller_tin: x.tin.toUpperCase() || null, seller_brn: x.brn || null, seller_sst_no: x.sstNo || null, seller_msic: x.msicCode || null,
    seller_activity: x.activityDesc || null, seller_address1: x.address1 || null, seller_address2: x.address2 || null, seller_city: x.city || null,
    seller_postcode: x.postcode || null, seller_state_code: x.stateCode || null, seller_phone: x.phone || null, seller_email: x.email || null,
  };
  const { error } = await sb.from('acc_company_settings').upsert(row, { onConflict: 'company_id' });
  if (error) return { ok: false, field: '', message: error.message };
  return { ok: true };
}
