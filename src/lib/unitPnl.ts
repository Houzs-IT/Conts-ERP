/** The unit P&L report (plan docs/superpowers/plans/2026-10-28-unit-pnl.md): a unit's month as lines from what the guest
 *  paid down to what the company keeps, in two layers (operating profit, then after the owner's portion), with the
 *  checks that flag a number that looks wrong and the gaps that say the month's data is incomplete. Amounts in sen.
 *  The owner's portion follows the Overall unit report's rule (ownerOverall.ts overallFigures; unitPnl.test.mjs checks
 *  the two agree), written out here because node --test cannot load a sibling module imported without its extension. */

export const LINE_KEYS = ['guestPaid', 'fees', 'cleaning', 'electricity', 'water', 'internet', 'sewerage', 'other', 'misc', 'operating', 'owner', 'company'] as const;
export type LineKey = typeof LINE_KEYS[number];
export const LINE_LABEL: Record<LineKey, string> = {
  guestPaid: 'Guest total', fees: 'Service fees and taxes', cleaning: 'Cleaning', electricity: 'Electricity', water: 'Water',
  internet: 'Internet', sewerage: 'Indah Water', other: 'Other costs', misc: 'Misc charge',
  operating: 'Operating profit', owner: "Owner's portion", company: 'Company keeps',
};
/** The cost lines between guest paid and operating profit, in order. */
export const COST_KEYS = ['fees', 'cleaning', 'electricity', 'water', 'internet', 'sewerage', 'other', 'misc'] as const;
export type CostKey = typeof COST_KEYS[number];

export interface UnitMonthInput {
  unitId: string; month: string; contract: 'LT' | 'PS';
  /** What guests paid for the month's nights; `guestPaidMissing`: a stay had no amount and its payout stood in. */
  guestPaid: number; guestPaidMissing: boolean;
  /** The owner statement's gross: what the stays paid out. */
  gross: number;
  cleaning: number; electricity: number; water: number; internet: number; sewerage: number; other: number; misc: number;
  ownerPct: number; ltGrr: number; nights: number; days: number;
}
export type Pnl = Record<LineKey, number>;

/** To the sen, halves away from zero (ownerOverall.ts roundSen). */
const roundSen = (x: number): number => Math.sign(x) * Math.round(Number(Math.abs(x).toFixed(6)));

export function pnl(i: UnitMonthInput): Pnl {
  const gp = i.gross - (i.cleaning + i.electricity + i.water + i.internet + i.sewerage + i.other + i.misc);
  // PS: the higher of GP x owner % and the guarantee; LT: the fixed rent.
  const owner = i.contract === 'PS' ? Math.max(roundSen((gp * i.ownerPct) / 100), i.ltGrr) : i.ltGrr;
  return {
    guestPaid: i.guestPaid, fees: i.guestPaid - i.gross, cleaning: i.cleaning, electricity: i.electricity, water: i.water,
    internet: i.internet, sewerage: i.sewerage, other: i.other, misc: i.misc,
    operating: gp, owner, company: gp - owner,
  };
}

export function sumPnl(rows: readonly Pnl[]): Pnl {
  return Object.fromEntries(LINE_KEYS.map(k => [k, rows.reduce((n, r) => n + r[k], 0)])) as Pnl;
}

/** Percent of guest paid, one decimal; null when nothing was paid. */
export const pctOfIncome = (amount: number, income: number): number | null =>
  income > 0 ? Math.round((amount / income) * 1000) / 10 : null;

/** Finance style: (1,234.56) for a negative, – for zero. */
export function bracketMoney(sen: number): { text: string; negative: boolean } {
  if (!sen) return { text: '–', negative: false };
  const text = (Math.abs(sen) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sen < 0 ? { text: `(${text})`, negative: true } : { text, negative: false };
}

const DAY = 864e5;
const t = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const monthStart = (m: string) => t(`${m}-01`);
const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };

/** A stay's total spread over its nights: the month's share, rounded so the months' shares always add up to the total. */
export function spreadGuestPaid(checkIn: string, checkOut: string, total: number, month: string): number {
  const a = t(checkIn), b = t(checkOut), nights = Math.round((b - a) / DAY);
  if (nights <= 0) return 0;
  const from = Math.max(a, monthStart(month)), to = Math.min(b, monthStart(nextMonth(month)));
  const inMonth = Math.max(0, Math.round((to - from) / DAY));
  if (!inMonth) return 0;
  const before = Math.max(0, Math.round((Math.min(from, b) - a) / DAY));
  // Cumulative rounding: shares of consecutive months always add up to the total.
  return Math.round((total * (before + inMonth)) / nights) - Math.round((total * before) / nights);
}

export interface Limits { lines: Partial<Record<CostKey, { pctMax?: number; perNightMax?: number }>>; marginMin?: number }
export type FlagRule = 'own_past' | 'building' | 'limit';
export interface Flag {
  unitId: string; month: string; rule: FlagRule; line: CostKey | 'operating';
  /** The month's figure and what it was compared with, in the same measure (sen per night, or percent). */
  value: number; reference: number; measure: 'per_night' | 'pct';
}

const shift = (m: string, by: number) => { const n = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + by; return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`; };
const perNight = (r: UnitMonthInput, k: CostKey) => (r.nights > 0 ? pnl(r)[k] / r.nights : null);
const margin = (r: UnitMonthInput) => pctOfIncome(pnl(r).operating, r.guestPaid);
const away = (v: number, ref: number) => ref > 0 && Math.abs(v - ref) / ref > 0.5;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Own past (more than 50 % from the previous three months, two of them needed), same building (more than 50 % above
 *  the median of at least three units that month) and chew's limits. Months with no nights or no income are not judged. */
export function checks(rows: readonly UnitMonthInput[], buildingOf: Record<string, string>, limits: Limits): Flag[] {
  const flags: Flag[] = [];
  const at = new Map(rows.map(r => [`${r.unitId}|${r.month}`, r]));
  const byBuildingMonth = new Map<string, UnitMonthInput[]>();
  for (const r of rows) if (r.nights > 0) {
    const k = `${buildingOf[r.unitId] ?? ''}|${r.month}`;
    byBuildingMonth.set(k, [...(byBuildingMonth.get(k) ?? []), r]);
  }
  for (const r of rows) {
    if (r.nights <= 0 || r.guestPaid <= 0) continue;
    const prev = [1, 2, 3].map(i => at.get(`${r.unitId}|${shift(r.month, -i)}`)).filter((x): x is UnitMonthInput => !!x && x.nights > 0 && x.guestPaid > 0);
    for (const k of COST_KEYS) {
      const v = perNight(r, k)!;
      const had = prev.filter(p => pnl(p)[k] !== 0);
      if (had.length >= 2) {
        const ref = had.reduce((n, p) => n + perNight(p, k)!, 0) / had.length;
        if (away(v, ref)) flags.push({ unitId: r.unitId, month: r.month, rule: 'own_past', line: k, value: Math.round(v), reference: Math.round(ref), measure: 'per_night' });
      }
      const peers = byBuildingMonth.get(`${buildingOf[r.unitId] ?? ''}|${r.month}`) ?? [];
      if (buildingOf[r.unitId] && peers.length >= 3) {
        const ref = median(peers.map(p => perNight(p, k)!));
        if (ref > 0 && v > ref * 1.5) flags.push({ unitId: r.unitId, month: r.month, rule: 'building', line: k, value: Math.round(v), reference: Math.round(ref), measure: 'per_night' });
      }
      const lim = limits.lines[k];
      const pct = pctOfIncome(pnl(r)[k], r.guestPaid)!;
      if (lim?.pctMax != null && pct > lim.pctMax) flags.push({ unitId: r.unitId, month: r.month, rule: 'limit', line: k, value: pct, reference: lim.pctMax, measure: 'pct' });
      if (lim?.perNightMax != null && v > lim.perNightMax) flags.push({ unitId: r.unitId, month: r.month, rule: 'limit', line: k, value: Math.round(v), reference: lim.perNightMax, measure: 'per_night' });
    }
    const m = margin(r)!;
    if (prev.length >= 2) {
      const ref = prev.reduce((n, p) => n + margin(p)!, 0) / prev.length;
      if (ref > 0 && Math.abs(m - ref) / ref > 0.5) flags.push({ unitId: r.unitId, month: r.month, rule: 'own_past', line: 'operating', value: m, reference: Math.round(ref * 10) / 10, measure: 'pct' });
    }
    if (limits.marginMin != null && m < limits.marginMin) flags.push({ unitId: r.unitId, month: r.month, rule: 'limit', line: 'operating', value: m, reference: limits.marginMin, measure: 'pct' });
  }
  return flags;
}

export type GapKind = 'no_cleaning' | 'no_electricity' | 'no_nights' | 'guest_paid_missing' | 'payout_above_guest_paid';
export interface Gap { unitId: string; month: string; kind: GapKind }

/** What says the month's figures are incomplete: owned by other teams (bookings import, cleaning), so only flagged. */
export function gaps(rows: readonly UnitMonthInput[]): Gap[] {
  const out: Gap[] = [];
  for (const r of rows) {
    const add = (kind: GapKind) => out.push({ unitId: r.unitId, month: r.month, kind });
    if (r.nights <= 0) add('no_nights');
    else {
      if (!r.cleaning) add('no_cleaning');
      if (!r.electricity) add('no_electricity');
    }
    if (r.guestPaidMissing) add('guest_paid_missing');
    if (r.gross > r.guestPaid) add('payout_above_guest_paid');
  }
  return out;
}
