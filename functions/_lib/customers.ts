/** Customer master (debtors), the sell-side counterpart of suppliers. Money integer sen. */

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export const isCustomerStatus = (v: unknown): v is typeof CUSTOMER_STATUSES[number] => typeof v === 'string' && (CUSTOMER_STATUSES as readonly string[]).includes(v);

export interface CustomerRow {
  id: string; code: string; name: string; status: string; contact_person: string | null; phone: string | null; email: string | null;
  address: string | null; area: string | null; postcode: string | null; state: string | null; country: string;
  payment_terms: string | null; credit_limit_sen: number; currency: string; tin_number: string | null; business_reg_no: string | null;
  customer_type: string | null; notes: string | null;
}

export function toCustomerPayload(r: CustomerRow) {
  return {
    id: r.id, code: r.code, name: r.name, status: r.status, contactPerson: r.contact_person ?? '', phone: r.phone ?? '', email: r.email ?? '',
    address: r.address ?? '', area: r.area ?? '', postcode: r.postcode ?? '', state: r.state ?? '', country: r.country,
    paymentTerms: r.payment_terms ?? '', creditLimitSen: r.credit_limit_sen, currency: r.currency, tinNumber: r.tin_number ?? '',
    businessRegNo: r.business_reg_no ?? '', customerType: r.customer_type ?? '', notes: r.notes ?? '',
  };
}

export function invalidCustomer(b: { code?: unknown; name?: unknown }): { field: string; message: string } | null {
  if (typeof b.code !== 'string' || !b.code.trim()) return { field: 'code', message: 'Enter a customer code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  return null;
}
