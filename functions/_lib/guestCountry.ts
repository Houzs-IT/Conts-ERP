import { COUNTRIES, CALLING_CODE_COUNTRY } from '../../src/lib/countries';

/** Where a guest is from, worked out in SQL so the lists can filter, count, search and export it over every row.
 *
 *  In order: the nationality stored on the guest (ISO code), the nationality a booking site sent with the booking
 *  (a country name), and otherwise the country of the guest's phone number. The phone is read the way
 *  src/lib/phone.ts reads it: "+.." and "00.." carry their code, a leading 0 is a Malaysian number, other digits
 *  start with the country code (how the booking sites send them), except that a number starting with 1 that is not
 *  11 digits long is a Malaysian mobile without its 0 (011, 012 ...), not the US.
 *
 *  Computed, not stored: the guest's phone and nationality change, and a stored copy would need a migration and a
 *  backfill to stay right. 3,400 guests take a few milliseconds (scripts/api-checks/bookings-ux.mjs times it and
 *  compares it with parsePhone on every stored phone). */

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const CODES = `(VALUES ${Object.entries(CALLING_CODE_COUNTRY).map(([c, iso]) => `(${q(c)}, ${q(iso)})`).join(', ')}) AS cc(code, iso)`;
const NAMES = `(VALUES ${COUNTRIES.map(([iso, name]) => `(${q(iso)}, ${q(name)})`).join(', ')}) AS cn(iso, name)`;
const KNOWN = new Set(COUNTRIES.map(c => c[0]));

const fromCode = (digits: string) => `(SELECT cc.iso FROM ${CODES} WHERE ${digits} LIKE cc.code || '%' ORDER BY length(cc.code) DESC LIMIT 1)`;

/** A LATERAL join that adds `<alias>.iso`, `<alias>.name` and `<alias>.src` ('nationality' | 'phone'). */
export function countryJoin(alias: string, p: { phone: string; stored: string; nationalityName?: string | null }) {
  const raw = `btrim(COALESCE(${p.phone}, ''))`;
  const d = `regexp_replace(${raw}, '[^0-9]', '', 'g')`;
  const phone = `CASE WHEN ${d} = '' THEN NULL
      WHEN ${raw} LIKE '+%' THEN ${fromCode(d)}
      WHEN ${d} LIKE '00%' THEN ${fromCode(`substr(${d}, 3)`)}
      WHEN ${d} LIKE '0%' THEN 'MY'
      WHEN ${d} LIKE '1%' AND length(${d}) <> 11 THEN 'MY'
      ELSE ${fromCode(d)} END`;
  const stored = `CASE WHEN upper(btrim(COALESCE(${p.stored}, ''))) ~ '^[A-Z]{2}$' THEN upper(btrim(${p.stored})) END`;
  const named = p.nationalityName ? `(SELECT cn.iso FROM ${NAMES} WHERE lower(cn.name) = lower(btrim(${p.nationalityName})) LIMIT 1)` : 'NULL';
  return `LEFT JOIN LATERAL (
    SELECT x.iso, x.src, (SELECT cn.name FROM ${NAMES} WHERE cn.iso = x.iso) AS name
    FROM (SELECT COALESCE(${stored}, ${named}, ${phone}) AS iso,
                 CASE WHEN COALESCE(${stored}, ${named}) IS NOT NULL THEN 'nationality' WHEN ${phone} IS NOT NULL THEN 'phone' END AS src) x
  ) ${alias} ON TRUE`;
}

/** The `country` URL parameter: comma-separated ISO codes, "none" for guests with no country at all. */
export function parseCountries(v: string | null): string[] {
  return [...new Set((v ?? '').toUpperCase().split(',').map(s => s.trim()).filter(s => s === 'NONE' || KNOWN.has(s)))].slice(0, 40);
}

/** WHERE for a parsed `country` list against a join made by countryJoin(). */
export function countryWhere(alias: string, codes: string[]): { sql: string; args: string[] } | null {
  if (!codes.length) return null;
  const real = codes.filter(c => c !== 'NONE');
  const parts = [real.length ? `${alias}.iso IN (${real.map(() => '?').join(', ')})` : null, codes.includes('NONE') ? `${alias}.iso IS NULL` : null].filter(Boolean);
  return { sql: `(${parts.join(' OR ')})`, args: real };
}

export const countryName = (iso: string | null | undefined) => (iso ? COUNTRIES.find(c => c[0] === iso)?.[1] ?? iso : null);
