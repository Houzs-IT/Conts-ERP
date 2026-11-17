/**
 * Formatting rules from copy.md section 13. Money is integer sen everywhere in
 * transport and state; it only becomes a string at the edge, here.
 *
 * ONE implementation for the whole system (owner, 3 Nov 2026: "one change applies everywhere"). The date, time and
 * sen-money shapes are not written here: they come from the supply-chain engine's canonical module,
 * engine/frontend/src/vendor/shared/format.ts (fmtDate, fmtDateTime, fmtDayMonth, fmtTime, fmtSen), which the engine's
 * own screens and PDFs use and its tests pin. The server (functions/_lib/dates.ts) imports the same file. Change a
 * date or money shape there and Property OS, the server and the engine all follow.
 */
import { fmtDate, fmtDateTime, fmtDayMonth, fmtTime, fmtSen } from '../../engine/frontend/src/vendor/shared/format';


const MYT = 'Asia/Kuala_Lumpur';


export const rm = (sen: number, opts?: { cents?: boolean }) => {
  // A negated zero, or a fraction of a sen below zero, would print as "-0.00".
  if (opts?.cents ?? true) return fmtSen(Math.round(sen) || 0);
  const v = Math.round(sen / 100) || 0;
  return 'RM ' + v.toLocaleString('en-MY', { maximumFractionDigits: 0 });
};

/** Whole ringgit, for nightly rates in the calendar and pricing grids only. Every other amount keeps its sen (owner, 3 Nov 2026). RM 231 */
export const rmShort = (sen: number) => rm(sen, { cents: false });

/** Deductions carry a real minus sign, not a hyphen. − RM 2,315.00 */
export const rmDeduction = (sen: number) => '− ' + rm(Math.abs(sen));

/** Charts only: RM 14k, RM 1.2M. */
export const rmCompact = (sen: number) => {
  const v = Math.abs(sen) / 100, sign = sen < 0 ? '− ' : '';
  if (v >= 1e6) return `${sign}RM ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${sign}RM ${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return `${sign}RM ${Math.round(v)}`;
};

export const percent = (n: number) => `${n.toFixed(1)}%`;

export const rating = (n: number, detail = false) =>
  detail ? `${n.toFixed(2)} / 5` : n.toFixed(2);

/** Month names, for whole-month labels only (Nov 2026, November 2026). A full date is numeric (owner, 3 Nov 2026):
 *  2026/11/03, the engine's rule, see docs/DATE-FORMAT.md. Fixed here, not taken from Intl (en-MY prints "Sept"). */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Year, month (0-11) and day of an instant on the Malaysian calendar. A bare YYYY-MM-DD is that calendar day. */
const mytParts = (iso: string) => {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (ymd) return { y: Number(ymd[1]), m: Number(ymd[2]) - 1, d: Number(ymd[3]) };
  const [y, m, d] = new Date(iso).toLocaleDateString('en-CA', { timeZone: MYT }).split('-').map(Number);
  return { y, m: m - 1, d };
};

/** 09/16: month and day, no year (the engine's fmtDayMonth). */
const md = (iso: string) => fmtDayMonth(iso);

/** 16/09/2026: day first, numeric (YH, 11 Nov 2026; the engine's rule). */
export const date = (iso: string) => fmtDate(iso);

/** A YYYY-MM-DD day (or YYYY-MM-15 for a month) in another language, for the portal (src/lib/portalI18n.ts). */
export const dateIn = (locale: string, day: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: MYT }).format(new Date(`${day.slice(0, 10)}T12:00:00+08:00`));

/** 16/09/2026 – 29/09/2026: both ends in full, so neither can be misread. */
export const dateRange = (fromIso: string, toIso: string) => `${date(fromIso)} – ${date(toIso)}`;

/** 15:00 — 24-hour, MYT */
export const time = (iso: string) => fmtTime(iso);

/** 14:06 MYT — when cross-channel timing matters */
export const timeWithZone = (iso: string) => `${time(iso)} MYT`;

/** Vista Jaya One #A-12-03 */
export const unitRef = (propertyName: string, unitNumber: string) => `${propertyName} ${unitNumber}`;

/** Masked secret. The raw value needs an audited reveal. */
export const masked = (tail: string) => `••••${tail}`;

export const nights = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
export const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/** Today's date in Malaysia as YYYY-MM-DD, plus or minus whole days. */
export const todayMyt = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: MYT });
};

/** Aug 2026 (default) / August 2026 (long). Accepts "2026-08" or a full ISO date. */
export const monthLabel = (iso: string, opts?: { long?: boolean }) => {
  const p = mytParts(iso.length === 7 ? `${iso}-01` : iso);
  return `${(opts?.long ? MONTHS_LONG : MONTHS)[p.m]} ${p.y}`;
};

/** 2026 */
export const year = (iso: string) => String(mytParts(iso).y);

/** 16/09/2026 14:06 */
export const dateTime = (iso: string) => fmtDateTime(iso);

/** 16/09: day and month, no year, where the year is plain from the page. */
export const dateShort = (iso: string) => md(iso);

/** Sunday, 25/10/2026: the weekday spelled out, the date numeric. */
export const dateLong = (iso: string) => {
  const p = mytParts(iso);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  return `${day}, ${date(iso)}`;
};

/** Wed — short weekday alone. */
export const weekdayShort = (iso: string) => {
  const p = mytParts(iso);
  return WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
};

/** Wed 16 — short weekday and day. */
export const weekdayDay = (iso: string) => {
  const p = mytParts(iso);
  return `${WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()]} ${p.d}`;
};

/** Just now / N min ago / N hours ago / Yesterday, then falls back to date(). */
export const relative = (iso: string, now: Date = new Date()) => {
  const then = new Date(iso);
  const diffMin = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  return date(iso);
};

/** yyyy-mm-dd for an <input type="date"> value, normalised to the MYT date part. */
export const dateInputValue = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: MYT }) : '';

/** yyyy-mm-dd MYT stamp for filenames and exports; defaults to now. */
export const fileStamp = (iso?: string) =>
  (iso ? new Date(iso) : new Date()).toLocaleDateString('en-CA', { timeZone: MYT });

/** 4,150 — every count shown to a person gets thousands separators. */
export const count = (n: number) => n.toLocaleString('en-MY');

/** "1 item", "2 items", "4,150 reservations". Pass the plural form when it is not just +s. */
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** "operations_staff" -> "Operations staff". For raw codes only, never for names. */
/** The name to greet a guest by: the first word, skipping a title ("Ms Ang" -> "Ang"). */
export const greetName = (fullName: string | null | undefined, fallback = 'there') => {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const title = /^(mr|mrs|ms|miss|mdm|madam|dr|prof|encik|en|puan|pn|cik|tuan|dato'?|datin|tan sri|sir)\.?$/i;
  while (words.length > 1 && title.test(words[0])) words.shift();
  return words[0] ?? fallback;
};

export const humanize = (code: string) => code.replace(/[_.]+/g, ' ').trim().toLowerCase().replace(/^./, c => c.toUpperCase());

/** Short place and company abbreviations that stay in capitals inside a title-cased name. */
const KEEP_UPPER = new Set(['SDN', 'BHD', 'PLT', 'LLP', 'A/L', 'A/P', 'B/L', 'S/O', 'D/O',
  'KL', 'PJ', 'DK', 'RC', 'JB', 'KLCC', 'KLIA', 'TTDI', 'OUG', 'USJ', 'MRT', 'LRT', 'YTL', 'UOA', 'II', 'III', 'IV']);

/** One word of a name, title-cased for display. Words with a digit (unit codes, SS2, MK2) keep what is stored, except
 *  ordinals (8TH -> 8th); a word already in mixed case is kept; short abbreviations stay in capitals. */
const displayWord = (w: string, place = false) => {
  if (!/[A-Za-z]/.test(w)) return w;
  const bare = w.replace(/[.,()]/g, '');
  if (/\d/.test(w)) return /^\d+(ST|ND|RD|TH)$/i.test(bare) ? w.toLowerCase() : w;
  const upper = w === w.toUpperCase(), lower = w === w.toLowerCase();
  if (!upper && !lower) return w;
  // In a building name a short word with no vowel is an abbreviation (KL, PJ, DK); in a person's name it may be a
  // surname (NG), so only the fixed list applies there.
  if (upper && (KEEP_UPPER.has(bare.toUpperCase()) || (place && bare.length <= 3 && !/[AEIOUY]/.test(bare)))) return w;
  return w.toLowerCase().replace(/(^|[-'(/&])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
};

const titleWords = (s: string, place = false) => s.split(/(\s+)/).map(w => displayWord(w, place)).join('');

/** ALL-CAPS or all-lowercase names read in Title Case; company suffixes, short abbreviations (KL, SS2) and unit codes
 *  stay as stored. A name a person typed in mixed case is kept. The stored value is unchanged. */
export const titleCase = (name: string) => (!name || /^[A-Z]{1,3}$/.test(name.trim()) ? name : titleWords(name));

/** A building as shown everywhere: AGILE BUKIT BINTANG -> Agile Bukit Bintang, SKYLINE KL D49-03A -> Skyline KL D49-03A,
 *  8TH STELLAR -> 8th Stellar. Display only: the stored name is unchanged. */
export const buildingName = (name: string | null | undefined) => (name ? titleWords(name.trim(), true) : '');

/** A person as shown: ALEX GOH -> Alex Goh, FONG -> Fong. A one-word initialism such as YH stays as it is. */
export const personName = (name: string | null | undefined) => {
  const n = (name ?? '').trim();
  if (!n) return '';
  return titleCase(n);
};

/** Sat 10/10: short weekday, then month/day, for day headers on Cleaning, Today and the field app. */
export const weekdayDate = (iso: string) => {
  const p = mytParts(iso);
  return `${WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()]} ${md(iso)}`;
};

/** 10/10 14:00: month/day and time, no year, for stamps inside one job's history. */
export const dateTimeShort = (iso: string) => `${dateShort(iso)} ${time(iso)}`;

/** RM 1,250 for whole ringgit (calendar cells, rate chips); RM 1,250–1,400 for a range. */
export const rmRange = (loSen: number, hiSen: number) =>
  loSen === hiSen ? rmShort(loSen) : `${rmShort(loSen)}–${count(Math.round(hiSen / 100))}`;

/** 1,250.00 (or 1,250 with cents: false): the number alone, for cells under an "RM" heading and printed forms. */
export const amount = (sen: number, opts?: { cents?: boolean }) => {
  const showCents = opts?.cents ?? true;
  return (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 });
};
