import { count } from '../../lib/format';

/** The figures Showcase control can replace (functions/_lib/showcase.ts SHOWCASE_KEYS), grouped as the control
 *  panel lists them. `decimals` is how the showcase prints the figure. */
export const SECTIONS = [
  { title: 'Today', where: '01 Today page', rows: [
    { key: 'today_in', label: 'Check-ins today', decimals: 0 }, { key: 'today_out', label: 'Check-outs today', decimals: 0 },
    { key: 'today_up', label: 'Upcoming orders', decimals: 0 }, { key: 'tn_occ', label: 'Occupied tonight', decimals: 0 },
    { key: 'tn_pct', label: 'Occupancy tonight (%)', decimals: 0 }, { key: 'tn_turn', label: 'Turnovers in progress', decimals: 0 },
  ] },
  { title: 'Portfolio', where: 'Listings, Today, Calendar', rows: [{ key: 'listings', label: 'Total listings', decimals: 0 }] },
  { title: 'Guest reviews', where: '04 Reviews page', rows: [
    { key: 'rev_count', label: 'Total reviews', decimals: 0 }, { key: 'rev_five', label: '5-star rate (%)', decimals: 1 },
    { key: 'rev_rating', label: 'Overall rating', decimals: 2 },
  ] },
  { title: 'Occupancy & reliability', where: '05 Occupancy page', rows: [
    { key: 'occ_rate', label: 'Occupancy rate (%)', decimals: 1 }, { key: 'occ_cancel', label: 'Cancellation rate (%)', decimals: 1 },
    { key: 'occ_stay', label: 'Average stay (nights)', decimals: 1 }, { key: 'occ_year', label: 'Year-round daily occupancy (%)', decimals: 1 },
  ] },
  { title: 'Booking lead time', where: '06 Lead Time page', rows: [
    { key: 'lead_avg', label: 'Average lead time (days)', decimals: 1 }, { key: 'lead_b0', label: '0–2 days (%)', decimals: 0 },
    { key: 'lead_b1', label: '3–7 days (%)', decimals: 0 }, { key: 'lead_b2', label: '8–14 days (%)', decimals: 0 },
    { key: 'lead_b3', label: '15–30 days (%)', decimals: 0 }, { key: 'lead_b4', label: '30+ days (%)', decimals: 0 },
  ] },
  { title: 'Page views', where: '07 Page Views page', rows: [
    { key: 'views_pv', label: 'Avg listing page views / month', decimals: 0 }, { key: 'views_imp', label: 'Avg first-page search impressions / month', decimals: 0 },
  ] },
] as const;

export type FigureKey = typeof SECTIONS[number]['rows'][number]['key'];
export const META: Record<FigureKey, { label: string; decimals: number }> =
  Object.fromEntries(SECTIONS.flatMap(s => s.rows.map(r => [r.key, { label: r.label, decimals: r.decimals }]))) as never;
export const LEAD_KEYS = ['lead_b0', 'lead_b1', 'lead_b2', 'lead_b3', 'lead_b4'] as const;

export type Live = Record<FigureKey, number | null>;
export interface Override { value: number; active: boolean }
export type Overrides = Partial<Record<FigureKey, Override>>;

/** How the showcase prints a figure: counts with separators, rates with their fixed decimals. */
export const fmtFigure = (key: FigureKey, v: number | null | undefined) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  const d = META[key].decimals;
  return d ? v.toFixed(d) : count(Math.round(v));
};

/** The figure the showcase shows: the override when it is switched on, else the live one. */
export const resolve = (key: FigureKey, live: Live, ov: Overrides): number | null => {
  const o = ov[key];
  return o && o.active ? o.value : live[key];
};
export const activeCount = (ov: Overrides) => Object.values(ov).filter(o => o?.active).length;

export interface Listing { id: string; name: string; unit: string; city: string | null; photoId: string | null; rating: number | null; reviews: number; bedrooms: number; bathrooms: number; maxGuests: number; airbnbId: string | null }
export interface TodayItem { id: string; time: string; guest: string; guests: number; listing: string; unit: string; checkIn: string; checkOut: string; photoId: string | null }
export interface TodayBlock {
  date: string;
  checkIns: { count: number; items: TodayItem[] }; checkOuts: { count: number; items: TodayItem[] }; upcoming: { count: number; items: TodayItem[] };
  tonight: { occupied: number; listings: number; pct: number; turnovers: number };
}
export interface ReviewCard { id: string; guest: string; stay: string | null; listing: string; rating: number; text: string; reviewedAt: string }
export interface ShowcaseData { generatedAt: string; today: TodayBlock; listings: Listing[]; reviews: ReviewCard[]; live: Live; overrides: Overrides; overridesReady: boolean }
export interface Insights {
  from: string; to: string; days: number; units: number;
  reviews: { count: number; fiveStar: number; rating: number | null };
  occupancy: { rate: number; cancel: number; avgStay: number; bookedPerListing: number; blockedPerListing: number; unbookedPerListing: number; checkInsPerListing: number; year: number; months: { month: string; occupancy: number }[] };
  lead: { avg: number; buckets: number[]; rows: { unitId: string; name: string; unit: string; photoId: string | null; lead: number; bookings: number; rate: number }[] };
  recentReviews: ReviewCard[] | null;
}
export interface CalendarStay { id: string; code: string; unitId: string; guest: string; checkIn: string; checkOut: string; guests: number; status: 'completed' | 'in_stay' | 'confirmed'; total: number }
export interface CalendarData { from: string; days: number; today: string; dates: string[]; rates: Record<string, number[]>; stays: CalendarStay[] }

export const photoUrl = (id: string | null | undefined) => (id ? `/api/documents/${id}/download` : null);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const tint = (i: number) => `var(--sc-tint-${((i % 6) + 6) % 6})`;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/** BroadcastChannel name: an override saved in one tab (or in the visual editor's frame) shows at once in the others. */
export const OVERRIDES_CHANNEL = 'conts-showcase-overrides';
