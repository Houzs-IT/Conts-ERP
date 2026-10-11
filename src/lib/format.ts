/**
 * Formatting rules from copy.md section 13. Money is integer sen everywhere in
 * transport and state; it only becomes a string at the edge, here.
 */

import { parsePhone } from './phone';
export { parsePhone } from './phone';

const MYT = 'Asia/Kuala_Lumpur';


export const rm = (sen: number, opts?: { cents?: boolean }) => {
  const showCents = opts?.cents ?? true;
  // A negated zero, or a fraction of a sen below zero, would print as "-0.00".
  const v = Number((sen / 100).toFixed(showCents ? 2 : 0)) || 0;
  return 'RM ' + v.toLocaleString('en-MY', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
};

/** KPI cards drop the cents. RM 12,450 */
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

/** Month names are fixed here, not taken from Intl: the en-MY locale prints "Sept", which
 *  docs/DATE-FORMAT.md does not allow. */
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

/** 16 Sep 2026 */
export const date = (iso: string) => {
  const p = mytParts(iso);
  return `${p.d} ${MONTHS[p.m]} ${p.y}`;
};

/** 16 Sep – 29 Sep 2026. Always disambiguated across months. */
export const dateRange = (fromIso: string, toIso: string) => {
  const f = mytParts(fromIso), t = mytParts(toIso);
  return `${f.d} ${MONTHS[f.m]}${f.y === t.y ? '' : ` ${f.y}`} – ${t.d} ${MONTHS[t.m]} ${t.y}`;
};

/** 15:00 — 24-hour, MYT */
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MYT });

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

/** 16 Sep 2026 14:06 */
export const dateTime = (iso: string) => `${date(iso)} ${time(iso)}`;

/** 16 Sep — day and short month, no year. */
export const dateShort = (iso: string) => {
  const p = mytParts(iso);
  return `${p.d} ${MONTHS[p.m]}`;
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

/** ALL-CAPS names from imports read in Title Case; company suffixes stay upper case. The stored value is unchanged. */
export const titleCase = (name: string) => {
  if (!name || name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  const KEEP = new Set(['SDN', 'BHD', 'PLT', 'LLP', 'A/L', 'A/P', 'B/L', 'S/O', 'D/O']);
  return name.split(/(\s+)/).map(w => KEEP.has(w.replace(/[.,]/g, '')) ? w
    : w.toLowerCase().replace(/(^|[-'(/])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())).join('');
};

/** Sat 10 Oct: short weekday, day and month, for day headers on Cleaning, Today and the field app. */
export const weekdayDate = (iso: string) => {
  const p = mytParts(iso);
  return `${WEEKDAYS[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()]} ${p.d} ${MONTHS[p.m]}`;
};

/** 10 Oct 14:00: day, month and time, no year, for stamps inside one job's history. */
export const dateTimeShort = (iso: string) => `${dateShort(iso)} ${time(iso)}`;

/** RM 1,250 for whole ringgit (calendar cells, rate chips); RM 1,250–1,400 for a range. */
export const rmRange = (loSen: number, hiSen: number) =>
  loSen === hiSen ? rmShort(loSen) : `${rmShort(loSen)}–${count(Math.round(hiSen / 100))}`;

/* ---------- Phone numbers ----------
 * Guests' phones arrive as bare digits with the country code (60189800069, from the booking sites and the
 * HostPlatform import), sometimes with + and spaces, sometimes as a Malaysian local number (0189800069).
 * They are stored as they came; this only changes how they read, for every country: +60 18-980 0069,
 * +44 7700 900123, +7 912 345-67-89. The reading rules live in phone.ts, shared with the server checks. */

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

/** 1,250.00 (or 1,250 with cents: false): the number alone, for cells under an "RM" heading and printed forms. */
export const amount = (sen: number, opts?: { cents?: boolean }) => {
  const showCents = opts?.cents ?? true;
  return (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 });
};
