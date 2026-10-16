import { todayMyt } from './format';

/** Dates a saved view can hold as words, so "Cancelled this month" still means this month next month.
 *  A view's filter value of exactly one of these is turned into the day (YYYY-MM-DD, Malaysian calendar) when the
 *  view is opened (DataTable applyLayout); any other value is used as it is. */
const shiftMonth = (iso: string, add: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + add);
  return d.toISOString().slice(0, 10);
};
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

const TOKENS: Record<string, () => string> = {
  '@today': () => todayMyt(),
  '@tomorrow': () => todayMyt(1),
  '@month_start': () => shiftMonth(todayMyt(), 0),
  '@month_end': () => dayBefore(shiftMonth(todayMyt(), 1)),
  '@last_month_start': () => shiftMonth(todayMyt(), -1),
  '@last_month_end': () => dayBefore(shiftMonth(todayMyt(), 0)),
};

export const resolveRelative = (v: string) => TOKENS[v]?.() ?? v;
export const isRelative = (v: string) => v in TOKENS;
