import type { Env } from './db';
import { hasColumn } from './auth';

/** Migration 0110 (owner address and alternate contact) is applied by hand per environment. Until it is, reads send
 *  no address and saves ignore the address keys, so the owner page keeps working with the columns absent. */
export const ownerDetailsReady = (env: Env) => hasColumn(env, 'owners', 'address_lines').catch(() => false);

export interface OwnerAddress { lines: string | null; postcode: string | null; city: string | null; state: string | null; country: string | null }
export interface AltContact { name: string | null; phone: string | null; relation: string | null }

/** An owner row's address, or null when the owner has none (or 0110 is not applied). */
export function addressOf(o: Record<string, unknown>): OwnerAddress | null {
  const a = { lines: str(o.address_lines), postcode: str(o.address_postcode), city: str(o.address_city), state: str(o.address_state), country: str(o.address_country) };
  return Object.values(a).some(Boolean) ? a : null;
}
export function altContactOf(o: Record<string, unknown>): AltContact | null {
  const c = { name: str(o.alt_contact_name), phone: str(o.alt_contact_phone), relation: str(o.alt_contact_relation) };
  return Object.values(c).some(Boolean) ? c : null;
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** The plain text fields of the owner details form: body key (also the History label key), column, length limit.
 *  `details` fields exist only once 0110 is applied. */
export const DETAIL_TEXT: { key: string; col: string; max: number; label: string; details?: true; multiline?: true }[] = [
  { key: 'legalName', col: 'legal_name', max: 160, label: 'Legal name' },
  { key: 'notes', col: 'notes', max: 2000, label: 'Notes', multiline: true },
  { key: 'address', col: 'address_lines', max: 300, label: 'Address', details: true, multiline: true },
  { key: 'postcode', col: 'address_postcode', max: 12, label: 'Postcode', details: true },
  { key: 'city', col: 'address_city', max: 80, label: 'City', details: true },
  { key: 'stateOrRegion', col: 'address_state', max: 80, label: 'State', details: true },
  { key: 'country', col: 'address_country', max: 80, label: 'Country', details: true },
  { key: 'alternateContact', col: 'alt_contact_name', max: 120, label: 'Alternate contact', details: true },
  { key: 'alternateContactRelation', col: 'alt_contact_relation', max: 60, label: 'Relationship', details: true },
];

/** Trimmed text; a multi-line value keeps its lines but loses blank ones. null when it is not text at all. */
export function cleanText(v: unknown, multiline = false): string | null {
  if (v == null) return '';
  if (typeof v !== 'string') return null;
  return multiline
    ? v.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
    : v.replace(/\s+/g, ' ').trim();
}
