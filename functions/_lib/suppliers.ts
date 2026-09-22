/** Supplier master, ported from 2990's SCM. Money is integer sen. Conts is
 *  single-tenant, so 2990's per-company scoping is dropped. */

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type SupplierStatus = typeof SUPPLIER_STATUSES[number];

export function isSupplierStatus(v: unknown): v is SupplierStatus {
  return typeof v === 'string' && (SUPPLIER_STATUSES as readonly string[]).includes(v);
}

export interface SupplierRow {
  id: string; code: string; name: string; status: string;
  contact_person: string | null; attention: string | null;
  phone: string | null; mobile: string | null; whatsapp_number: string | null; fax: string | null;
  email: string | null; website: string | null;
  address: string | null; area: string | null; postcode: string | null; state: string | null; country: string;
  payment_terms: string | null; credit_limit_sen: number; currency: string;
  statement_type: string; aging_basis: string;
  supplier_type: string | null; category: string | null; business_nature: string | null;
  tin_number: string | null; business_reg_no: string | null; rating: number; notes: string | null;
}

/** DB row → API payload (camelCase). */
export function toSupplierPayload(r: SupplierRow) {
  return {
    id: r.id, code: r.code, name: r.name, status: r.status,
    contactPerson: r.contact_person ?? '', attention: r.attention ?? '',
    phone: r.phone ?? '', mobile: r.mobile ?? '', whatsappNumber: r.whatsapp_number ?? '', fax: r.fax ?? '',
    email: r.email ?? '', website: r.website ?? '',
    address: r.address ?? '', area: r.area ?? '', postcode: r.postcode ?? '', state: r.state ?? '', country: r.country,
    paymentTerms: r.payment_terms ?? '', creditLimitSen: r.credit_limit_sen, currency: r.currency,
    statementType: r.statement_type, agingBasis: r.aging_basis,
    supplierType: r.supplier_type ?? '', category: r.category ?? '', businessNature: r.business_nature ?? '',
    tinNumber: r.tin_number ?? '', businessRegNo: r.business_reg_no ?? '', rating: r.rating, notes: r.notes ?? '',
  };
}

/** The first problem with a create body, or null. */
export function invalidSupplier(b: { code?: unknown; name?: unknown }): { field: string; message: string } | null {
  if (typeof b.code !== 'string' || !b.code.trim()) return { field: 'code', message: 'Enter a supplier code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  return null;
}

export const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

export const intOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Light phone normalisation (2990 stores E.164-ish): keep a leading +, strip
 *  spaces/dashes/parens. Not a validator — just tidies what the operator types. */
export const normPhone = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/[^\d]/g, '') || null;
};
