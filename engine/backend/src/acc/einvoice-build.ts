// ----------------------------------------------------------------------------
// E-invoice payload builder (pure; plan 2026-10-30-renovation-einvoice-ready.md
// Task 3). One renovation invoice or credit note → the fields of an LHDN
// MyInvois v1.1 document, as plain JSON in the SDK's field names (not UBL:
// wrapping and signing belong to the connector, built later). One line per
// document (spec goal 6), classification and tax type from the settings.
//
// A document that lacks something LHDN needs comes back { ok: false } with the
// gaps in plain words and the payload as far as it goes; nothing is guessed.
//
// General TINs (LHDN e-Invoice Specific Guideline, general TIN): a Malaysian
// individual who gives only a MyKad / army ID → EI00000000010 with that ID; a
// buyer identified by passport → EI00000000020 with the passport number. A
// company buyer must give its own TIN.
// ----------------------------------------------------------------------------

import { sellerMissing, type EInvoiceSettings } from './einvoice-settings';

export interface EInvoiceDoc {
  kind: 'INVOICE' | 'CREDIT_NOTE';
  number: string;
  date: string;
  description: string;
  amountSen: number;
  /** A credit note: the invoice numbers it adjusts. */
  references: string[];
}

export interface EInvoiceBuyer {
  name: string; tin: string | null; idType: string | null; idNumber: string | null; sstNo: string | null;
  address1: string | null; address2: string | null; city: string | null; postcode: string | null; state: string | null;
  country: string | null; phone: string | null; email: string | null;
}

export type BuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; missing: string[]; payload: Record<string, unknown> };

export const GENERAL_TIN_LOCAL = 'EI00000000010';
export const GENERAL_TIN_FOREIGN = 'EI00000000020';
export const MAX_DESCRIPTION = 300;

const STATES: Array<[string, string[]]> = [
  ['01', ['JOHOR', 'JOHORE']], ['02', ['KEDAH']], ['03', ['KELANTAN']], ['04', ['MELAKA', 'MALACCA']], ['05', ['NEGERI SEMBILAN', 'N SEMBILAN', 'NEGERISEMBILAN']],
  ['06', ['PAHANG']], ['07', ['PULAU PINANG', 'PENANG', 'P PINANG']], ['08', ['PERAK']], ['09', ['PERLIS']], ['10', ['SELANGOR']],
  ['11', ['TERENGGANU', 'TRENGGANU']], ['12', ['SABAH']], ['13', ['SARAWAK']], ['14', ['KUALA LUMPUR', 'KL']], ['15', ['LABUAN']],
  ['16', ['PUTRAJAYA']],
];

/** LHDN state code 01–16 for a state written by hand; null when it is not one (never a guess). */
export function lhdnStateCode(state: string | null): string | null {
  let s = String(state ?? '').toUpperCase().replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(0[1-9]|1[0-6])$/.test(s)) return s;
  s = s.replace(/^(W P|WP|WILAYAH PERSEKUTUAN|FEDERAL TERRITORY OF|FEDERAL TERRITORY)\s+/, '')
    .replace(/\s+DARUL\s+\w+$/, '').replace(/\s+DARUL\s+\w+\s+\w+$/, '').trim();
  for (const [code, names] of STATES) if (names.includes(s)) return code;
  return null;
}

const COUNTRIES: Record<string, string> = {
  MALAYSIA: 'MYS', MY: 'MYS', MYS: 'MYS', SINGAPORE: 'SGP', SG: 'SGP', SGP: 'SGP', CHINA: 'CHN', CN: 'CHN', CHN: 'CHN',
  'HONG KONG': 'HKG', HK: 'HKG', HKG: 'HKG', TAIWAN: 'TWN', TWN: 'TWN', INDONESIA: 'IDN', IDN: 'IDN', THAILAND: 'THA', THA: 'THA',
  BRUNEI: 'BRN', AUSTRALIA: 'AUS', AUS: 'AUS', 'UNITED KINGDOM': 'GBR', UK: 'GBR', GBR: 'GBR', 'UNITED STATES': 'USA', USA: 'USA', US: 'USA',
  JAPAN: 'JPN', JPN: 'JPN', 'SOUTH KOREA': 'KOR', KOREA: 'KOR', KOR: 'KOR', INDIA: 'IND', IND: 'IND',
};
/** Blank means Malaysia (every renovation customer so far). */
const countryCode = (c: string | null): string | null => {
  const s = String(c ?? '').toUpperCase().trim();
  return s ? COUNTRIES[s] ?? null : 'MYS';
};

const rm = (sen: number): string => (sen / 100).toFixed(2);
const t = (v: string | null | undefined): string => String(v ?? '').trim();

export function buildEInvoice(doc: EInvoiceDoc, buyer: EInvoiceBuyer, s: EInvoiceSettings): BuildResult {
  const missing: string[] = [];
  const country = countryCode(buyer.country);
  const idType = t(buyer.idType).toUpperCase();
  const idNumber = t(buyer.idNumber);

  let tin = t(buyer.tin).toUpperCase();
  if (!idType || !idNumber) missing.push('buyer ID number');
  else if (!tin) {
    if (idType === 'PASSPORT') tin = GENERAL_TIN_FOREIGN;
    else if (idType === 'NRIC' || idType === 'ARMY') tin = GENERAL_TIN_LOCAL;
    else missing.push('buyer TIN');
  }

  if (!t(buyer.address1) || !t(buyer.city)) missing.push('buyer address');
  if (!country) missing.push('buyer country');
  const stateCode = country && country !== 'MYS' ? '17' : lhdnStateCode(buyer.state);
  if (country && !stateCode) missing.push('buyer state');
  if (!t(buyer.phone)) missing.push('buyer phone');

  const description = t(doc.description);
  if (!description) missing.push('description');
  else if (description.length > MAX_DESCRIPTION) missing.push(`description over ${MAX_DESCRIPTION} characters`);
  if (!Number.isSafeInteger(doc.amountSen) || doc.amountSen <= 0) missing.push('amount above zero');
  missing.push(...sellerMissing(s));

  const amount = rm(Math.max(0, doc.amountSen));
  const x = s.seller;
  const payload: Record<string, unknown> = {
    invoiceTypeCode: doc.kind === 'INVOICE' ? '01' : '02',
    id: doc.number,
    issueDate: doc.date,
    currency: 'MYR',
    supplier: {
      name: null, // the connector fills the registered name from the company
      tin: x.tin, brn: x.brn, sstNo: x.sstNo || 'NA', msicCode: x.msicCode, activityDesc: x.activityDesc,
      address: { line1: x.address1, line2: x.address2 || null, city: x.city, postcode: x.postcode, stateCode: x.stateCode, country: 'MYS' },
      phone: x.phone, email: x.email || null,
    },
    buyer: {
      name: t(buyer.name), tin: tin || null, idType: idType || null, idNumber: idNumber || null, sstNo: t(buyer.sstNo).toUpperCase() || 'NA',
      address: { line1: t(buyer.address1) || null, line2: t(buyer.address2) || null, city: t(buyer.city) || null, postcode: t(buyer.postcode) || null,
        stateCode, country },
      phone: t(buyer.phone) || null, email: t(buyer.email) || null,
    },
    lines: [{
      classification: s.classificationCode, description, quantity: 1, unitPrice: amount, subtotal: amount,
      taxType: s.taxType, taxAmount: '0.00', totalExcludingTax: amount,
    }],
    totals: { excludingTax: amount, includingTax: amount, payable: amount },
    ...(doc.kind === 'CREDIT_NOTE' ? { billingReferences: doc.references } : {}),
  };
  return missing.length ? { ok: false, missing, payload } : { ok: true, payload };
}
