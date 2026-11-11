/** Airbnb reconciliation (chew's spec and answers, 10 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md).
 *  Each booking's money from Airbnb's transaction CSVs is set against the booking in the system and sorted by rule into
 *  what finance should do. It only suggests: nothing changes until finance confirms. Pure (no database), amounts in sen.
 *
 *  A booking is compared whole (chew: Airbnb mostly pays a stay in one go, even a long one): every uploaded payment
 *  for its confirmation code, in any month, against the system's net for that code (gross_booking_value − channel_fee,
 *  as on the owner statement), added up over the units a code covers. */
import type { AirbnbTxn } from './airbnbCsv';

export type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13' | 'R99';
export const RULES: Record<Rule, string> = {
  R1: 'Equal',
  R2: 'Extra charge inside the reservation',
  R3: 'Cancelled, fully refunded',
  R4: 'Money won back',
  R5: 'Equal after the adjustment',
  R6: 'Long stay, not fully paid yet',
  R7: 'Extended, paid in parts',
  R8: 'Extended before check-in',
  R9: 'Not in the system: last month’s reservation',
  R10: 'Cancelled but paid',
  R11: 'Not in the system: stay not over',
  R12: 'In the system, not paid in these files',
  // Not in chew's spec: October had 14 bookings with only an AirCover or resolution line, their stay paid earlier.
  R13: 'Paid before these files',
  R99: 'Reason not known',
};
export const RULE_ORDER = Object.keys(RULES) as Rule[];

/** Money that is the company's, never an owner's (chew: extras "归我们"; won back and cancelled-but-paid "default
 *  归公司"), kept apart by kind ("要分开记"). */
export type IncomeKind = 'extra_charge' | 'won_back' | 'cancelled_paid' | 'aircover';
export const INCOME_KINDS: Record<IncomeKind, string> = {
  extra_charge: 'Extra charge', won_back: 'Money won back', cancelled_paid: 'Cancelled but paid', aircover: 'AirCover reimbursement',
};

/** What confirming would do to the booking: nothing, set its amount, mark it cancelled, look by hand, or wait for a
 *  later file. Company income is listed apart (`income`). */
export type Action = 'none' | 'set_amount' | 'cancel' | 'check' | 'wait';

/** Booking states the owner statement counts (functions/_lib/revenue.ts COUNTED_STAY). */
export const COUNTED_STATES = ['confirmed', 'checked_in', 'checked_out'];
/** Under RM 0.05 apart counts as equal. */
export const near = (a: number, b: number) => Math.abs(a - b) < 5;

export type ReconTxn = Pick<AirbnbTxn, 'txnDate' | 'type' | 'code' | 'startDate' | 'endDate' | 'nights' | 'guest' | 'listing' | 'details' | 'amount' | 'paidOut'>
  & Partial<Pick<AirbnbTxn, 'arrivingBy' | 'referenceCode'>> & { id: string };
export interface Stay { id: string; code: string; unitId: string; unit: string; guest: string | null; checkIn: string; checkOut: string; state: string; net: number }
export interface Income { kind: IncomeKind; amount: number; date: string; txnIds: string[]; note: string }
export interface Payment { id: string; date: string; amount: number; inMonth: boolean }

export interface Line {
  code: string; rule: Rule;
  /** R7: likely when the system holds the first payment, else look closer. */
  sure: 'likely' | 'look' | null;
  action: Action;
  /** The booking's net after the change, for set_amount (and 0 for cancel). */
  newAmount: number | null;
  suggestion: string;
  income: Income[];
  needsConfirm: boolean;
  guest: string | null; listing: string | null; startDate: string | null; endDate: string | null; nights: number | null;
  stays: Stay[]; found: boolean; cancelled: boolean;
  /** The counted stays' net added up; null when the code is not in the system. */
  systemNet: number | null;
  payments: Payment[];
  /** Reservation lines, Adjustment + Resolution Adjustment lines, other Resolution Payouts, AirCover. */
  reservation: number; adjustment: number; extra: number; aircover: number;
  /** System net − what Airbnb kept paid for the reservation (reservation lines + adjustments). The spec's 差额 leaves
   *  the adjustments out, which showed 0.00 beside a refund the system still had to take in; the rules themselves use
   *  both figures as the spec says. Null when there is nothing to set against. */
  difference: number | null;
}

const KNOWN = ['Reservation', 'Adjustment', 'Resolution Adjustment', 'Resolution Payout', 'Payout'];
const isAirCover = (t: ReconTxn) => t.type === 'Resolution Payout' && /aircover/i.test(t.details ?? '');
const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const rmText = (sen: number) => `RM ${(Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dayText = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const monthText = (month: string) => `${MON[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** One confirmation code: its Airbnb lines (any month) against its stays in the system. */
export function classify(code: string, rows: ReconTxn[], stays: Stay[], ctx: { month: string; today: string }): Line {
  const sorted = [...rows].sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.id.localeCompare(b.id));
  const res = sorted.filter(t => t.type === 'Reservation');
  const adjRows = sorted.filter(t => t.type === 'Adjustment');
  const resAdj = sorted.filter(t => t.type === 'Resolution Adjustment');
  const air = sorted.filter(isAirCover);
  const extras = sorted.filter(t => t.type === 'Resolution Payout' && !isAirCover(t));
  const unknown = sorted.filter(t => !KNOWN.includes(t.type));
  const reservation = sum(res), adjustment = sum(adjRows) + sum(resAdj), extra = sum(extras), aircover = sum(air);
  /** What Airbnb kept paid for the stay itself. */
  const kept = reservation + adjustment;
  const active = stays.filter(s => COUNTED_STATES.includes(s.state));
  const found = stays.length > 0, cancelled = found && !active.length;
  const systemNet = found ? active.reduce((n, s) => n + s.net, 0) : null;
  const facts = res[0] ?? sorted[0];
  const nights = facts?.nights ?? null;
  const monthStart = `${ctx.month}-01`;

  const incomeOf = (t: ReconTxn, kind: IncomeKind, note: string): Income => ({ kind, amount: t.amount, date: t.txnDate, txnIds: [t.id], note });
  const airIncome = air.map(t => incomeOf(t, 'aircover', 'AirCover damage reimbursement'));
  const extraIncome = (except?: ReconTxn) => extras.filter(t => t !== except).map(t => incomeOf(t, 'extra_charge', 'Resolution payout'));
  const units = active.length > 1 ? ` It covers ${active.length} units; split the amount between them.` : '';

  const line = (rule: Rule, action: Action, suggestion: string, o: { newAmount?: number | null; income?: Income[]; sure?: Line['sure'] } = {}): Line => {
    // A code is compared whole, but its company income belongs to the month each line is dated in.
    const income = (o.income ?? [...airIncome, ...extraIncome()]).filter(i => i.date.slice(0, 7) === ctx.month);
    const also = income.length && !suggestion.includes('company income')
      ? ` Also record ${rmText(income.reduce((n, i) => n + i.amount, 0))} as company income (${[...new Set(income.map(i => INCOME_KINDS[i.kind].toLowerCase()))].join(', ')}).`
      : '';
    return {
      code, rule, sure: o.sure ?? null, action, newAmount: o.newAmount ?? null, suggestion: suggestion + also, income,
      // Something to write or to look at; R5 is "confirm only" in the spec. Equal, waiting and already-cancelled lines are not.
      needsConfirm: action === 'set_amount' || action === 'cancel' || action === 'check' || income.length > 0 || rule === 'R5',
      guest: facts?.guest ?? null, listing: facts?.listing ?? null, startDate: facts?.startDate ?? null, endDate: facts?.endDate ?? null, nights,
      stays, found, cancelled, systemNet,
      payments: res.map(t => ({ id: t.id, date: t.txnDate, amount: t.amount, inMonth: t.txnDate.slice(0, 7) === ctx.month })),
      reservation, adjustment, extra, aircover,
      difference: systemNet != null && !cancelled && res.length ? systemNet - kept : null,
    };
  };

  if (unknown.length) return line('R99', 'check', `Airbnb line type “${unknown[0].type}” is not one this page knows. Check by hand.`);

  // No booking payment in any uploaded file: money for a stay Airbnb paid for earlier (October: AirCover lines and
  // refunds to guests for September stays).
  if (!res.length) {
    if (adjustment < 0) {
      return line('R13', 'check', `Airbnb took back ${rmText(-adjustment)} (refund to the guest) for a reservation it paid for before these files. Decide whether it comes off the owner’s statement.`);
    }
    const what = air.length && extras.length ? 'AirCover and resolution money' : air.length ? 'AirCover reimbursement' : 'A resolution payout';
    return line('R13', 'none', `${what} for a reservation Airbnb paid for before these files. Record ${rmText(aircover + extra)} as company income.`);
  }

  if (!found) {
    if (near(kept, 0)) return line('R3', 'none', 'Cancelled and fully refunded. Not in the system, so nothing to record.');
    if (facts.startDate && facts.startDate < monthStart) {
      return line('R9', 'check', `Not in the system. The stay started on ${dayText(facts.startDate)}, before ${monthText(ctx.month)}: it belongs to last month. Look for it there, or add it.`);
    }
    if (facts.endDate && facts.endDate > ctx.today) {
      return line('R11', 'check', `Not in the system and the stay ends on ${dayText(facts.endDate)}, after today. Check the reservation is in the system.`);
    }
    if (kept > 0 && adjustment === 0) {
      return line('R10', 'none', `Not in the system: cancelled but Airbnb still paid ${rmText(kept)}. Record it as company income; confirm each one.`,
        { income: [...res.map(t => incomeOf(t, 'cancelled_paid', 'Cancelled but paid')), ...airIncome, ...extraIncome()] });
    }
    return line('R99', 'check', `Not in the system. Airbnb paid ${rmText(reservation)} and took back ${rmText(-adjustment)}. Check by hand.`);
  }

  if (cancelled) {
    if (near(kept, 0)) return line('R3', 'none', 'Cancelled in the system and fully refunded. Nothing to change.');
    if (kept > 0) {
      const after = adjustment < 0 ? `, after ${rmText(-adjustment)} refunded` : '';
      return line('R10', 'none', `Cancelled in the system but Airbnb paid ${rmText(kept)}${after}. Record it as company income; confirm each one.`,
        { income: [{ kind: 'cancelled_paid', amount: kept, date: res[res.length - 1].txnDate, txnIds: [...res, ...adjRows, ...resAdj].map(t => t.id), note: 'Cancelled but paid' }, ...airIncome, ...extraIncome()] });
    }
    return line('R99', 'check', `Cancelled in the system, and Airbnb took back more than it paid (${rmText(-kept)}). Check by hand.`);
  }

  const sys = systemNet!;
  if (adjustment === 0 && near(sys, reservation)) return line('R1', 'none', 'Equal. Nothing to do.');

  // R2: the system's amount holds a charge Airbnb paid apart through the Resolution Centre (e.g. an airport pickup):
  // one of those payouts, or all of them. chew: split it out ("拆出来") — the booking keeps the room, the extra goes to
  // company income.
  const parts = extras.length > 1 ? [...extras.map(t => [t]), extras] : extras.map(t => [t]);
  const inside = parts.find(p => near(sys, kept + sum(p)));
  if (inside) {
    const x = sum(inside);
    return line('R2', 'set_amount', `The system’s ${rmText(sys)} includes ${rmText(x)} that Airbnb paid apart (extra charge). Set the reservation to ${rmText(kept)} and record ${rmText(x)} as company income.${units}`,
      { newAmount: kept });
  }

  if (near(kept, 0)) return line('R3', 'cancel', `Airbnb refunded the whole reservation. Mark it cancelled (RM 0.00).${units}`, { newAmount: 0 });

  // R4: Airbnb took money back (Adjustment) and paid the same amount again through the Resolution Centre.
  const deductions = adjRows.filter(t => t.amount < 0);
  const totalDeducted = -sum(deductions);
  const won = deductions.length ? extras.find(p => deductions.some(d => near(-d.amount, p.amount)) || near(totalDeducted, p.amount)) : undefined;
  if (won) {
    return line('R4', 'set_amount', `Airbnb took back ${rmText(totalDeducted)} and paid ${rmText(won.amount)} back through the Resolution Centre. Set the reservation to ${rmText(kept)} (the owner’s) and record ${rmText(won.amount)} as company income (money won back). Confirm by hand.${units}`,
      { newAmount: kept, income: [...airIncome, incomeOf(won, 'won_back', 'Money won back'), ...extraIncome(won)] });
  }

  if (adjustment !== 0 && near(sys, kept)) return line('R5', 'none', `Equal after Airbnb’s adjustment of ${rmText(-adjustment)}. Nothing to change; confirm only.`);

  // R6: chew, 10 Nov 2026 — Airbnb mostly pays even a long stay in one go, so only a long stay Airbnb has paid less
  // than the system for, with nothing taken back, waits for the rest.
  if ((nights ?? 0) >= 28 && adjustment === 0 && kept < sys) {
    return line('R6', 'wait', `A long stay (${nights} nights) Airbnb has paid ${rmText(kept)} of ${rmText(sys)} for so far. Nothing to change; the rest should come in a later file.`);
  }

  if (res.length >= 2) {
    const likely = near(sys, res[0].amount);
    const paid = res.map(t => `${dayText(t.txnDate)} ${rmText(t.amount)}`).join('; ');
    return line('R7', 'set_amount', likely
      ? `Extended and paid in ${res.length} parts (${paid}); the system still has the first. Set the reservation to ${rmText(kept)}.${units}`
      : `Paid in ${res.length} parts (${paid}), and the system’s ${rmText(sys)} matches none of them. Likely extended more than once: set the reservation to ${rmText(kept)}, after a closer look.${units}`,
    { newAmount: kept, sure: likely ? 'likely' : 'look' });
  }

  if (adjustment === 0 && reservation > sys) {
    return line('R8', 'set_amount', `Airbnb paid ${rmText(reservation)} in one payment, ${rmText(reservation - sys)} more than the system. Likely extended before check-in: set the reservation to ${rmText(reservation)}. It can be another reason too.${units}`,
      { newAmount: reservation });
  }

  if (adjustment < 0 && near(sys, reservation)) {
    return line('R99', 'check', `Airbnb paid ${rmText(reservation)}, the amount in the system, then took back ${rmText(-adjustment)} (refund to the guest). Decide whether the reservation should be ${rmText(kept)}.`);
  }
  return line('R99', 'check', `The system has ${rmText(sys)}; Airbnb paid ${rmText(reservation)}${adjustment ? ` and took back ${rmText(-adjustment)}` : ''}. Check by hand.`);
}

/** R12: Airbnb stays checking in during the month that no uploaded file has a booking payment for. */
function notPaidLines(stays: Stay[], paidCodes: Set<string>, shown: Set<string>, month: string): Line[] {
  const byCode = new Map<string, Stay[]>();
  for (const s of stays) {
    if (s.checkIn.slice(0, 7) !== month || !COUNTED_STATES.includes(s.state) || paidCodes.has(s.code) || shown.has(s.code)) continue;
    byCode.set(s.code, [...(byCode.get(s.code) ?? []), s]);
  }
  return [...byCode.entries()].map(([code, group]): Line => {
    const net = group.reduce((n, s) => n + s.net, 0);
    const first = group[0];
    return {
      code, rule: 'R12', sure: null, action: 'wait', newAmount: null, income: [], needsConfirm: false,
      suggestion: `Checks in on ${dayText(first.checkIn)}; no payment in these files yet. Airbnb pays after check-in, so it is usually in the next month’s file.`,
      guest: null, listing: null, startDate: first.checkIn, endDate: first.checkOut, nights: null,
      stays: group, found: true, cancelled: false, systemNet: net, payments: [], reservation: 0, adjustment: 0, extra: 0, aircover: 0, difference: null,
    };
  });
}

export interface RuleTotal { rule: Rule; label: string; count: number; system: number; airbnb: number; difference: number }
export interface MonthRecon {
  lines: Line[];
  summary: RuleTotal[];
  /** Payout lines of the month (no confirmation code): Airbnb's transfers to the bank. */
  payouts: ReconTxn[];
  /** Lines with no confirmation code that are not payouts. */
  loose: ReconTxn[];
  totals: {
    /** Paid out to the bank in the month. */
    bank: number;
    /** Every coded line of the month added up: what the transfers should be made of. */
    money: number;
    reservations: number; adjustments: number; resolutions: number;
    income: Record<IncomeKind, number>;
    needsConfirm: number;
  };
}

/** The month's reconciliation: every code with a line dated in the month (compared whole, with its lines from other
 *  months), then the month's check-ins nobody paid for yet. `txns` holds those codes' lines in every month plus the
 *  month's own; `stays` the system's stays for those codes plus the month's Airbnb check-ins. */
export function reconcileMonth(month: string, txns: ReconTxn[], stays: Stay[], today: string): MonthRecon {
  const inMonth = (t: ReconTxn) => t.txnDate.slice(0, 7) === month;
  const monthRows = txns.filter(inMonth);
  const byCode = new Map<string, ReconTxn[]>();
  for (const t of txns) if (t.code) byCode.set(t.code, [...(byCode.get(t.code) ?? []), t]);
  const staysByCode = new Map<string, Stay[]>();
  for (const s of stays) staysByCode.set(s.code, [...(staysByCode.get(s.code) ?? []), s]);
  const codes = [...new Set(monthRows.filter(t => t.code).map(t => t.code!))];
  const lines = codes.map(c => classify(c, byCode.get(c) ?? [], staysByCode.get(c) ?? [], { month, today }));
  const paid = new Set(txns.filter(t => t.type === 'Reservation' && t.code).map(t => t.code!));
  lines.push(...notPaidLines(stays, paid, new Set(codes), month));
  lines.sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) || a.code.localeCompare(b.code));

  const summary = RULE_ORDER.map((rule): RuleTotal => {
    const of = lines.filter(l => l.rule === rule);
    return {
      rule, label: RULES[rule], count: of.length,
      system: of.reduce((n, l) => n + (l.cancelled ? 0 : l.systemNet ?? 0), 0),
      airbnb: of.reduce((n, l) => n + l.reservation + l.adjustment, 0),
      difference: of.reduce((n, l) => n + (l.difference ?? 0), 0),
    };
  }).filter(r => r.count > 0);
  const coded = monthRows.filter(t => t.code);
  const income = { extra_charge: 0, won_back: 0, cancelled_paid: 0, aircover: 0 } as Record<IncomeKind, number>;
  for (const l of lines) for (const i of l.income) income[i.kind] += i.amount;
  return {
    lines, summary,
    payouts: monthRows.filter(t => t.type === 'Payout').sort((a, b) => a.txnDate.localeCompare(b.txnDate)),
    loose: monthRows.filter(t => !t.code && t.type !== 'Payout'),
    totals: {
      bank: monthRows.filter(t => t.type === 'Payout').reduce((n, t) => n + t.paidOut, 0),
      money: sum(coded),
      reservations: sum(coded.filter(t => t.type === 'Reservation')),
      adjustments: sum(coded.filter(t => t.type === 'Adjustment' || t.type === 'Resolution Adjustment')),
      resolutions: sum(coded.filter(t => t.type === 'Resolution Payout')),
      income,
      needsConfirm: lines.filter(l => l.needsConfirm).length,
    },
  };
}
