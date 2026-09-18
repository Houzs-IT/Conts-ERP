/**
 * Formatting rules from copy.md section 13. Money is integer sen everywhere in
 * transport and state; it only becomes a string at the edge, here.
 */

const MYT = 'Asia/Kuala_Lumpur';

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
  new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: MYT });

/** 16 Sep – 29 Sep 2026. Always disambiguated across months. */
export const dateRange = (fromIso: string, toIso: string) => {
  const f = new Date(fromIso), t = new Date(toIso);
  const sameYear = f.getFullYear() === t.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: MYT });
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
