/**
 * Formatting rules from copy.md section 13. Money is integer sen everywhere in
 * transport and state; it only becomes a string at the edge, here.
 */

const MYT = 'Asia/Kuala_Lumpur';

/** ICU's en-MY prints September as "Sept"; every other month is three letters, so it is put back to "Sep". */
const sep = (s: string) => s.replace(/\bSept\b/g, 'Sep');

export const rm = (sen: number, opts?: { cents?: boolean }) => {
  const showCents = opts?.cents ?? true;
  const v = sen / 100;
  return 'RM ' + v.toLocaleString('en-MY', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
};

/** KPI cards drop the cents. RM 12,450 */
export const rmShort = (sen: number) => rm(sen, { cents: false });

/** Deductions carry a real minus sign, not a hyphen. − RM 2,315.00 */
export const rmDeduction = (sen: number) => '\u2212 ' + rm(Math.abs(sen));

export const percent = (n: number) => `${n.toFixed(1)}%`;

export const rating = (n: number, detail = false) =>
  detail ? `${n.toFixed(2)} / 5` : n.toFixed(2);

/** 16 Sep 2026 */
export const date = (iso: string) =>
  sep(new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: MYT }));

/** 16 Sep – 29 Sep 2026. Always disambiguated across months. */
export const dateRange = (fromIso: string, toIso: string) => {
  const f = new Date(fromIso), t = new Date(toIso);
  const sameYear = f.getFullYear() === t.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    sep(d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: MYT }));
  return `${fmt(f, !sameYear)} \u2013 ${fmt(t, true)}`;
};

/** 15:00 — 24-hour, MYT */
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MYT });

/** 14:06 MYT — when cross-channel timing matters */
export const timeWithZone = (iso: string) => `${time(iso)} MYT`;

/** Vista Jaya One #A-12-03 */
export const unitRef = (propertyName: string, unitNumber: string) => `${propertyName} ${unitNumber}`;

/** Masked secret. The raw value needs an audited reveal. */
export const masked = (tail: string) => `\u2022\u2022\u2022\u2022${tail}`;

export const nights = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
export const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/** Today's date in Malaysia as YYYY-MM-DD, plus or minus whole days. */
export const todayMyt = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: MYT });
};

/** Aug 2026 (default) / August 2026 (long). Accepts "2026-08" or a full ISO date. */
export const monthLabel = (iso: string, opts?: { long?: boolean }) => {
  const s = iso.length === 7 ? `${iso}-01` : iso;
  return sep(new Date(s).toLocaleDateString('en-MY', { month: opts?.long ? 'long' : 'short', year: 'numeric', timeZone: MYT }));
};

/** 2026 */
export const year = (iso: string) =>
  new Date(iso).toLocaleDateString('en-MY', { year: 'numeric', timeZone: MYT });

/** 16 Sep 2026 14:06 */
export const dateTime = (iso: string) => `${date(iso)} ${time(iso)}`;

/** 16 Sep — day and short month, no year. */
export const dateShort = (iso: string) =>
  sep(new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: MYT }));

/** Wed 16 — short weekday and day. */
export const weekdayDay = (iso: string) => {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString('en-MY', { weekday: 'short', timeZone: MYT });
  const day = d.toLocaleDateString('en-MY', { day: 'numeric', timeZone: MYT });
  return `${weekday} ${day}`;
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
