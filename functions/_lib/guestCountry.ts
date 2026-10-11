import { COUNTRIES, CALLING_CODE_COUNTRY } from '../../src/lib/countries';

/** Where a guest is from, worked out in SQL so the lists can filter, count, search, sort and export it over every row.
 *
 *  In order: the nationality stored on the guest (ISO code), the nationality a booking site sent with the booking
 *  (a country name), and otherwise the country of the guest's phone number. The phone is read the way
 *  src/lib/phone.ts reads it: "+.." and "00.." carry their code, a leading 0 is a Malaysian number, other digits
 *  start with the country code (how the booking sites send them), except that a number starting with 1 that is not
 *  11 digits long is a Malaysian mobile without its 0 (011, 012 ...), not the US.
 *
 *  Computed, not stored: a guest's phone and nationality change, and a stored copy would need a migration and a
 *  backfill to stay right. It is one plain expression per row (calling codes never start with another code, so the
 *  first 3, 2 or 1 digits name the country), with no join or sub-query, so it costs the same on 50 rows or 5,000.
 *  scripts/api-checks/bookings-ux.mjs compares it with parsePhone on every stored phone and times the lists. */

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const KNOWN = new Set(COUNTRIES.map(c => c[0]));
const byLength = (n: number) => Object.entries(CALLING_CODE_COUNTRY).filter(([c]) => c.length === n);

/** The country of a phone column, or NULL. */
function phoneCountrySql(phone: string) {
  const raw = `btrim(COALESCE(${phone}, ''))`;
  const d = `regexp_replace(${raw}, '[^0-9]', '', 'g')`;
  // The digits from the country code on.
  const n = `(CASE WHEN ${raw} NOT LIKE '+%' AND ${d} LIKE '00%' THEN substr(${d}, 3) ELSE ${d} END)`;
  const level = (len: number, rest: string) => `CASE left(${n}, ${len}) ${byLength(len).map(([c, iso]) => `WHEN ${q(c)} THEN ${q(iso)}`).join(' ')} ELSE ${rest} END`;
  return `CASE WHEN ${d} = '' THEN NULL
    WHEN ${raw} NOT LIKE '+%' AND ${d} NOT LIKE '00%' AND (${d} LIKE '0%' OR (${d} LIKE '1%' AND length(${d}) <> 11)) THEN 'MY'
    ELSE ${level(3, level(2, level(1, 'NULL')))} END`;
}

/** A country name (as booking sites send nationality) to its ISO code, or NULL. */
const nameToIso = (col: string) => `CASE lower(btrim(${col})) ${COUNTRIES.map(([iso, name]) => `WHEN ${q(name.toLowerCase())} THEN ${q(iso)}`).join(' ')} ELSE NULL END`;

/** The English name of an ISO column, for sorting by country. */
export const countryNameSql = (iso: string) => `CASE ${iso} ${COUNTRIES.map(([c, name]) => `WHEN ${q(c)} THEN ${q(name)}`).join(' ')} ELSE NULL END`;

/** A LATERAL join that adds `<alias>.iso` and `<alias>.src` ('nationality' | 'phone') for guest alias `guest`.
 *  `nationalityName`: a column holding a country name sent with the booking, when there is one. */
export function countryJoin(alias: string, p: { guest: string; nationalityName?: string | null }) {
  const stored = `CASE WHEN upper(btrim(COALESCE(${p.guest}.country_code, ''))) ~ '^[A-Z]{2}$' THEN upper(btrim(${p.guest}.country_code)) END`;
  const named = p.nationalityName ? nameToIso(p.nationalityName) : 'NULL';
  return `LEFT JOIN LATERAL (SELECT x.iso, CASE WHEN x.given IS NOT NULL THEN 'nationality' WHEN x.iso IS NOT NULL THEN 'phone' END AS src
    FROM (SELECT y.given, COALESCE(y.given, ${phoneCountrySql(`${p.guest}.phone`)}) AS iso
          FROM (SELECT COALESCE(${stored}, ${named}) AS given) y) x) ${alias} ON TRUE`;
}

/** Countries whose English name contains the word typed (at least 3 letters), for the search box. */
export function countriesNamed(word: string): string[] {
  const w = word.trim().toLowerCase();
  if (w.length < 3 || /\d/.test(w)) return [];
  return COUNTRIES.filter(([, name]) => name.toLowerCase().includes(w)).map(c => c[0]).slice(0, 20);
}

/** The `country` URL parameter: comma-separated ISO codes, "none" for guests with no country at all. */
export function parseCountries(v: string | null): string[] {
  return [...new Set((v ?? '').toUpperCase().split(',').map(s => s.trim()).filter(s => s === 'NONE' || KNOWN.has(s)))].slice(0, 40);
}

/** WHERE for a parsed `country` list on a country ISO column. */
export function countryWhere(iso: string, codes: string[]): { sql: string; args: string[] } | null {
  if (!codes.length) return null;
  const real = codes.filter(c => c !== 'NONE');
  const parts = [real.length ? `${iso} IN (${real.map(() => '?').join(', ')})` : null, codes.includes('NONE') ? `${iso} IS NULL` : null].filter(Boolean);
  return { sql: `(${parts.join(' OR ')})`, args: real };
}

export const countryName = (iso: string | null | undefined) => (iso ? COUNTRIES.find(c => c[0] === iso)?.[1] ?? iso : null);
