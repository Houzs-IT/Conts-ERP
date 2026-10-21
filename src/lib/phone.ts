/* Phone numbers for every country, shared by the screens and the server checks (libphonenumber, "min" metadata).
 * Guests' phones arrive as bare digits with the country code (60189800069, from the booking sites and the
 * HostPlatform import), sometimes with + and spaces, sometimes as a Malaysian local number (0189800069).
 * Stored values are never rewritten; this only decides what a stored or typed value means. */
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from 'libphonenumber-js/min';

export type { CountryCode };
export const HOME_COUNTRY: CountryCode = 'MY';

export interface ParsedPhone {
  /** Digits a phone link dials, country code first: "60189800069". */
  digits: string;
  country: CountryCode | undefined;
  callingCode: string;
  /** +60 18-980 0069 */
  international: string;
  /** The number without the country code, in that country's grouping: 18-980 0069. */
  national: string;
  /** Right length for the country: what the server accepts. */
  possible: boolean;
  /** Also a number range the country actually uses (coarse with the small metadata). */
  valid: boolean;
}

/** The country's own grouping without its trunk prefix: 018-980 0069 -> 18-980 0069, 8 (912) 345-67-89 -> 912 345-67-89.
 *  libphonenumber-js's international format turns every dash into a space, which reads worse for Malaysian numbers. */
function groupedNational(n: PhoneNumber) {
  const want = String(n.nationalNumber);
  const fallback = n.formatInternational().slice(n.countryCallingCode.length + 2);
  let s = n.formatNational();
  let digits = s.replace(/\D/g, '').length;
  while (digits > want.length && s) { if (/\d/.test(s[0])) digits--; s = s.slice(1); }
  s = s.replace(/^[^\d(]+/, '').replace(/\((\d+)\)\s*/g, '$1 ').replace(/[()]/g, '').trim();
  return s.replace(/\D/g, '') === want ? s : fallback;
}

const shape = (n: PhoneNumber): ParsedPhone => {
  const national = groupedNational(n);
  return {
    digits: `${n.countryCallingCode}${n.nationalNumber}`,
    country: n.country,
    callingCode: n.countryCallingCode,
    international: `+${n.countryCallingCode} ${national}`,
    national,
    possible: n.isPossible(),
    valid: n.isValid(),
  };
};

const tryParse = (text: string, country?: CountryCode) => {
  try { const n = parsePhoneNumberFromString(text, country); return n ? shape(n) : null; } catch { return null; }
};

/** What a stored or typed phone means. "+..." and "00..." carry their country code; a leading 0 is a local number of
 *  `localCountry` (Malaysia by default); other bare digits are read with the country code first, the way booking
 *  sites send them, and only fall back to a local number without its 0 when that reading is not a real number.
 *  Null when there are no digits to read. The result may still be impossible (check `possible`). */
export function parsePhone(raw: string | null | undefined, localCountry: CountryCode = HOME_COUNTRY): ParsedPhone | null {
  const text = (raw ?? '').trim();
  const d = text.replace(/\D/g, '');
  if (!d) return null;
  if (text.startsWith('+')) return tryParse(`+${d}`);
  if (d.startsWith('00')) return tryParse(`+${d.slice(2)}`);
  if (d.startsWith('0')) return tryParse(d, localCountry);
  // A real number range beats a mere right length: 1123456789 is a Malaysian 011 number missing its 0, not +1 123.
  const asIntl = tryParse(`+${d}`), asLocal = tryParse(d, localCountry);
  return [asIntl?.valid && asIntl, asLocal?.valid && asLocal, asIntl?.possible && asIntl, asLocal?.possible && asLocal]
    .find(Boolean) || asIntl || asLocal;
}

/** Every country the picker offers: ISO code, calling code and English name, sorted by code. */
export function phoneCountries(): { code: CountryCode; callingCode: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old browsers: codes only */ }
  return getCountries().map(code => ({ code, callingCode: getCountryCallingCode(code), name: names?.of(code) ?? code }));
}

export const callingCodeOf = (country: CountryCode) => getCountryCallingCode(country);

/** A number typed into the local part of the phone field, for the country picked beside it. */
export const parseLocal = (digits: string, country: CountryCode) => (digits ? tryParse(digits, country) : null);

/** The country a parsed number belongs to; for a number outside every known range, the main country of its code. */
export const countryOf = (p: ParsedPhone): CountryCode | undefined => p.country ?? countryForCallingCode(p.callingCode);

/** How the local part reads while it is typed. Typed with the trunk 0 it keeps the country's own local layout
 *  (018-980 0069, 07700 900123); typed without it, it groups like the international form (18-980 0069). */
export function formatLocalAsTyped(digits: string, country: CountryCode) {
  if (!digits) return '';
  const t = new AsYouType(country);
  const local = t.input(digits);
  const read = t.getNumber();
  if (!read || String(read.nationalNumber).length < digits.length) return local;
  const whole = parseLocal(digits, country);
  if (whole?.possible) return whole.national;
  const cc = callingCodeOf(country);
  const intl = new AsYouType().input(`+${cc}${digits}`);
  return intl.startsWith(`+${cc} `) ? intl.slice(cc.length + 2) : digits;
}

/** As-you-type reading of an international number: the country and the rest once the calling code is complete. */
export function readInternationalAsTyped(digits: string): { country: CountryCode; national: string } | null {
  const t = new AsYouType();
  t.input(`+${digits}`);
  const cc = t.getCallingCode();
  if (!cc) return null;
  const country = t.getCountry() ?? countryForCallingCode(cc);
  if (!country) return null;
  return { country, national: digits.slice(cc.length) };
}

export function countryForCallingCode(callingCode: string): CountryCode | undefined {
  // Several countries share some codes; pick the one most guests mean (US for +1, Russia for +7, UK for +44).
  const main: Record<string, CountryCode> = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '47': 'NO', '358': 'FI', '262': 'RE', '590': 'GP', '599': 'CW', '212': 'MA', '290': 'SH' };
  return main[callingCode] ?? getCountries().find(c => getCountryCallingCode(c) === callingCode);
}

/* ---------- Phone numbers ----------
 * Guests' phones arrive as bare digits with the country code (60189800069, from the booking sites and the
 * HostPlatform import), sometimes with + and spaces, sometimes as a Malaysian local number (0189800069).
 * They are stored as they came; this only changes how they read, for every country: +60 18-980 0069,
 * +44 7700 900123, +7 912 345-67-89. Kept here, not in format.ts, so
 * libphonenumber loads only with the screens that show a phone, not on every page. */

/** The digits a phone link dials, with the country code: "60189800069". Empty when there is no usable number. */
export const phoneDigits = (raw: string | null | undefined) => {
  const p = parsePhone(raw);
  if (p?.possible) return p.digits;
  const trimmed = (raw ?? '').trim();
  const d = trimmed.replace(/\D/g, '');
  if (!d) return '';
  return trimmed.startsWith('00') ? d.slice(2) : d;
};

/** +60 18-980 0069 for any country; a number of the wrong length shows as +<digits>, and text with too few digits
 *  to be a phone shows as typed. */
export const phone = (raw: string | null | undefined) => {
  if (!raw) return '';
  const p = parsePhone(raw);
  if (p?.possible) return p.international;
  const d = phoneDigits(raw);
  return d.length < 7 ? raw.trim() : `+${d}`;
};

/** tel: link for a phone, or '' when there is no number. */
export const phoneHref = (raw: string | null | undefined) => { const d = phoneDigits(raw); return d ? `tel:+${d}` : ''; };
/** WhatsApp chat link for a phone, or '' when there is no number. */
export const whatsappHref = (raw: string | null | undefined) => { const d = phoneDigits(raw); return d ? `https://wa.me/${d}` : ''; };
