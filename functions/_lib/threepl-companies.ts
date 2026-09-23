/** 3PL Companies, ported from 2990's SCM. Third-party logistics providers (a master). */

export interface ThreePlRow {
  id: string; code: string; name: string; registration_no: string | null; contact_name: string | null;
  contact_phone: string | null; office_phone: string | null; email: string | null; address: string | null;
  is_active: number; notes: string | null;
}

export function toThreePlPayload(r: ThreePlRow) {
  return {
    id: r.id, code: r.code, name: r.name, registrationNo: r.registration_no ?? '', contactName: r.contact_name ?? '',
    contactPhone: r.contact_phone ?? '', officePhone: r.office_phone ?? '', email: r.email ?? '', address: r.address ?? '',
    isActive: r.is_active === 1, notes: r.notes ?? '',
  };
}

export function invalidThreePl(b: { code?: unknown; name?: unknown }): { field: string; message: string } | null {
  if (typeof b.code !== 'string' || !b.code.trim()) return { field: 'code', message: 'Enter a company code.' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { field: 'name', message: 'Enter a name.' };
  return null;
}
