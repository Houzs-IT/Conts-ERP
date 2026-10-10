/** Field-level checks for numbers, money, dates, times and phones arriving in a request body.
 *  Each check writes a plain-English message into `fields` under the body key (or a path such as "lines.2.qty")
 *  and returns nothing; the handler ends with `const bad = invalid(fields); if (bad) return bad;`.
 *  A value that is absent passes unless `required`, so PATCH bodies can be checked with the same calls. */
import { fail } from './db';

export type Fields = Record<string, string>;

const absent = (v: unknown) => v === undefined || v === null || v === '';

interface NumOpts { label?: string; required?: boolean; min?: number; max?: number }

/** Integer sen. Rejects floats (12.3 is a ringgit value sent by mistake), strings and out-of-range amounts. */
export function checkSen(fields: Fields, key: string, v: unknown, o: NumOpts = {}) {
  const label = o.label ?? 'Amount';
  if (absent(v)) { if (o.required) fields[key] = `${label} is required.`; return; }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) { fields[key] = `${label} must be an amount in ringgit, e.g. 12.30.`; return; }
  const min = o.min ?? 0;
  if (v < min) fields[key] = min === 0 ? `${label} cannot be negative.` : `${label} must be at least RM ${(min / 100).toFixed(2)}.`;
  else if (o.max != null && v > o.max) fields[key] = `${label} must be RM ${(o.max / 100).toFixed(2)} or less.`;
}

/** A whole number (count, quantity, minutes, kilometres). */
export function checkInt(fields: Fields, key: string, v: unknown, o: NumOpts = {}) {
  const label = o.label ?? 'This';
  if (absent(v)) { if (o.required) fields[key] = `${label} is required.`; return; }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) { fields[key] = `${label} must be a whole number.`; return; }
  if (o.min != null && v < o.min) fields[key] = `${label} must be at least ${o.min}.`;
  else if (o.max != null && v > o.max) fields[key] = `${label} must be ${o.max} or less.`;
}

/** A number that may have decimals (a percentage, cubic metres). */
export function checkNumber(fields: Fields, key: string, v: unknown, o: NumOpts & { decimals?: number } = {}) {
  const label = o.label ?? 'This';
  if (absent(v)) { if (o.required) fields[key] = `${label} is required.`; return; }
  if (typeof v !== 'number' || !Number.isFinite(v)) { fields[key] = `${label} must be a number.`; return; }
  if (o.decimals != null && Math.abs(Math.round(v * 10 ** o.decimals) - v * 10 ** o.decimals) > 1e-6) {
    fields[key] = `${label} can have at most ${o.decimals} decimal places.`; return;
  }
  if (o.min != null && v < o.min) fields[key] = `${label} must be at least ${o.min}.`;
  else if (o.max != null && v > o.max) fields[key] = `${label} must be ${o.max} or less.`;
}

/** A calendar date as yyyy-mm-dd that actually exists (no 31 February). */
export function checkDate(fields: Fields, key: string, v: unknown, o: { label?: string; required?: boolean; min?: string; max?: string } = {}) {
  const label = o.label ?? 'Date';
  if (absent(v)) { if (o.required) fields[key] = `${label} is required.`; return; }
  if (typeof v !== 'string' || !isIsoDate(v)) { fields[key] = `${label} must be a real date.`; return; }
  if (o.min && v < o.min) fields[key] = `${label} must be on or after ${o.min}.`;
  else if (o.max && v > o.max) fields[key] = `${label} must be on or before ${o.max}.`;
}

export function isIsoDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** A clock time as HH:mm (seconds tolerated). */
export function checkTime(fields: Fields, key: string, v: unknown, o: { label?: string; required?: boolean } = {}) {
  const label = o.label ?? 'Time';
  if (absent(v)) { if (o.required) fields[key] = `${label} is required.`; return; }
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) fields[key] = `${label} must be a time such as 15:00.`;
}

/** A phone number: 7 to 15 digits, with spaces, dashes, brackets and a leading + allowed. */
export function checkPhone(fields: Fields, key: string, v: unknown, o: { label?: string; required?: boolean } = {}) {
  const label = o.label ?? 'Phone';
  if (absent(v)) { if (o.required) fields[key] = `${label} is required.`; return; }
  if (typeof v !== 'string' || !/^\+?[\d\-() ]+$/.test(v.trim())) { fields[key] = `${label} can only hold digits, spaces, dashes and a leading +.`; return; }
  const digits = v.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) fields[key] = `${label} must have 7 to 15 digits, e.g. +60 12-345 6789.`;
}

/** The 422 response when any check failed, else null. */
export function invalid(fields: Fields, message = 'Some fields need attention.') {
  return Object.keys(fields).length ? fail('VALIDATION', message, 422, fields) : null;
}
