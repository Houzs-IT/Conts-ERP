// A customer account's tax identity for e-invoice (plan 2026-10-30-renovation-einvoice-ready.md Task 2): TIN, ID type
// and number, SST number, on scm.debtors. Individuals without a TIN give their MyKad number; the e-invoice then
// carries LHDN's general TIN (acc/einvoice-build.ts).
import { looksLikeTin } from './einvoice-settings';

export const ID_TYPES = ['NRIC', 'BRN', 'PASSPORT', 'ARMY'] as const;
export type IdType = (typeof ID_TYPES)[number];

type Refusal = { ok: false; error: 'invalid_tin' | 'invalid_id_type' | 'invalid_id_number'; message: string };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The ID number as stored: MyKad without dashes, everything else upper-case without spaces. Null when it is not one. */
export function normaliseIdNumber(type: IdType, raw: string): string | null {
  const v = raw.toUpperCase().replace(/\s+/g, '');
  if (type === 'NRIC') { const d = v.replace(/-/g, ''); return /^\d{12}$/.test(d) ? d : null; }
  if (type === 'BRN') {
    /* The new 12-digit number wins when SSM's printed form carries both: 201901000005 (1312525-A). */
    const twelve = /(^|\D)(\d{12})(\D|$)/.exec(v);
    if (twelve) return twelve[2];
    return /^[A-Z]{0,3}\d{4,10}-?[A-Z]{1,3}$/.test(v) ? v : null;
  }
  return /^[A-Z0-9-]{4,20}$/.test(v) ? v : null;
}

/** The columns a create/patch body sets (only the keys it sends), or why it is refused. `current` is what the account
    holds now, for a body that sends only a number or only a type. */
export function taxIdentityPatch(
  body: Record<string, unknown>,
  current: { idType: string | null; idNumber: string | null },
): { ok: true; patch: Record<string, string | null> } | Refusal {
  const patch: Record<string, string | null> = {};
  if (body.tin !== undefined) {
    const tin = text(body.tin).toUpperCase().replace(/\s+/g, '');
    if (tin && !looksLikeTin(tin)) return { ok: false, error: 'invalid_tin', message: 'The TIN starts with letters (IG for an individual, C for a company) followed by digits.' };
    patch.tin = tin || null;
  }
  let type = current.idType as IdType | null;
  if (body.idType !== undefined) {
    const t = text(body.idType).toUpperCase();
    if (t && !(ID_TYPES as readonly string[]).includes(t)) return { ok: false, error: 'invalid_id_type', message: 'The ID type is MyKad (NRIC), business registration (BRN), passport or army ID.' };
    type = (t || null) as IdType | null;
    patch.id_type = type;
  }
  if (body.idNumber !== undefined) {
    const raw = text(body.idNumber);
    if (!raw) patch.id_number = null;
    else {
      if (!type) return { ok: false, error: 'invalid_id_type', message: 'Choose the ID type for this ID number.' };
      const n = normaliseIdNumber(type, raw);
      if (!n) {
        return { ok: false, error: 'invalid_id_number', message: type === 'NRIC' ? 'A MyKad number has 12 digits, for example 900101-14-5678.' : `That does not look like a ${type === 'BRN' ? 'registration' : 'valid'} number.` };
      }
      patch.id_number = n;
    }
  }
  /* A new type alone re-checks the number the account already holds. */
  if (body.idType !== undefined && body.idNumber === undefined && type && current.idNumber) {
    const n = normaliseIdNumber(type, current.idNumber);
    if (!n) return { ok: false, error: 'invalid_id_number', message: `The ID number on this account is not a ${type} number. Change the number too.` };
    patch.id_number = n;
  }
  if (body.sstNo !== undefined) patch.sst_no = text(body.sstNo).toUpperCase() || null;
  return { ok: true, patch };
}
