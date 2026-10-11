import { type Env, one } from './db';

/** A booking's money in three parts that must add up (owner-approved design, 10 Oct 2026):
 *    (1) what the guest paid   room + cleaning + other fees + SST + tourism tax = guest total
 *    (2) taken by the platform commission + payment processing
 *    (3) what we receive       expected, received, outstanding, payout dates
 *  The list's SQL (moneySql) and the drawer's ledger (ledger) follow the same rules, written down here once.
 *
 *  Expected: the payout the booking site reported when it reported one (the workbook's instalment lines, else
 *  payout_amount), otherwise (1) - (2). A site's own figure is never second-guessed by our arithmetic; when the
 *  two differ the drawer says so instead.
 *
 *  Received: the booking's received booking_payments (refunds subtract) plus what it carried from before that
 *  table, GREATEST(collected_revenue, payout_amount). A booking whose payouts came in as workbook instalment
 *  rows counts those rows only: the import writes the same money into collected_revenue and payout_amount
 *  too (owner statements read collected_revenue), so adding both would count it twice. */

export const OTA_CHANNELS = ['airbnb', 'booking_com', 'agoda'];
const TOLERANCE = 2; // sen: the exports round each part on its own

/** Whether migration 0052's payout columns and 0091's booking_payments exist. Checked so the list keeps working
 *  on a database that has not had them applied yet. */
let moneySchemaSeen: { payoutCols: boolean; payments: boolean } | null = null;
export async function moneySchema(env: Env): Promise<{ payoutCols: boolean; payments: boolean }> {
  // Once both are there they stay there: remembered for the life of the worker, so the booking list and every
  // booking stop paying a catalogue query (and a connection) on each request. A missing one is asked again.
  if (moneySchemaSeen) return moneySchemaSeen;
  const r = await one<{ cols: number; payments: number }>(env, `
    SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'reservations' AND table_schema = ANY(current_schemas(false))
              AND column_name IN ('payout_date', 'payout_amount', 'payment_processing_fee')) AS cols,
           (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'booking_payments' AND table_schema = ANY(current_schemas(false))) AS payments`);
  const found = { payoutCols: Number(r?.cols ?? 0) === 3, payments: Number(r?.payments ?? 0) === 1 };
  if (found.payoutCols && found.payments) moneySchemaSeen = found;
  return found;
}

/** The join and the three expressions the list filters and sums on. `bp` is one row per booking. */
export function moneySql(s: { payoutCols: boolean; payments: boolean }) {
  const join = s.payments ? `LEFT JOIN (
      SELECT reservation_id,
             SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END) FILTER (WHERE status = 'received') AS paid,
             SUM(amount) FILTER (WHERE source = 'owner_workbook' AND kind = 'ota_payout') AS reported,
             bool_or(source = 'owner_workbook') AS imported
      FROM booking_payments GROUP BY reservation_id) bp ON bp.reservation_id = r.id` : '';
  const legacy = s.payoutCols ? 'GREATEST(r.collected_revenue, COALESCE(r.payout_amount, 0))' : 'r.collected_revenue';
  const received = s.payments ? `(COALESCE(bp.paid, 0) + CASE WHEN COALESCE(bp.imported, false) THEN 0 ELSE ${legacy} END)` : legacy;
  const computed = `(r.gross_booking_value - r.channel_fee${s.payoutCols ? ' - COALESCE(r.payment_processing_fee, 0)' : ''})`;
  const expected = s.payoutCols
    ? `COALESCE(${s.payments ? 'bp.reported, ' : ''}r.payout_amount, ${computed})`
    : computed;
  return { join, received, expected, outstanding: `GREATEST(${expected} - ${received}, 0)` };
}

/* ------------------------------------------------------------------ */
/* The drawer's ledger                                                 */
/* ------------------------------------------------------------------ */

export interface PaymentRow {
  id: string; amount: number; receivedOn: string | null; status: 'received' | 'expected'; method: string | null;
  reference: string | null; kind: 'guest_payment' | 'ota_payout' | 'refund'; note: string | null; source: 'manual' | 'owner_workbook';
  createdBy: string | null; createdAt: string;
}
export interface MoneyIn {
  channel: string; state: string; nights: number;
  gross: number; channelFee: number; collected: number;
  roomRevenue: number | null; guestCleaningFee: number | null; extraFees: number | null; sstAmount: number | null;
  tourismTax: number | null; otaTax: number | null; paymentProcessingFee: number | null;
  payoutAmount: number | null; payoutDate: string | null; paymentMethod: string | null; fromWorkbook: boolean;
}
export interface LedgerLine { key: string; label: string; sub?: string; amount: number }
export interface SourceFigure { label: string; amount: number | null; from: string }
export interface Ledger {
  /** (1) Lines that add up to guestTotal. Empty when only the total is known or the parts cannot be reconciled. */
  guestLines: LedgerLine[]; guestTotal: number;
  /** Paid by the guest to the site and kept by it: shown greyed, never part of our money. */
  otaTax: number | null;
  /** (2) */
  platformLines: LedgerLine[]; platformTotal: number;
  /** (3) */
  expected: number; received: number; outstanding: number;
  /** What the booking carried before booking_payments (HostPlatform's "Payment Received", Channex), when counted. */
  receivedBefore: number;
  payments: PaymentRow[];
  paymentMethod: string | null;
  /** Set when the sources do not agree: the sentence to show, and every figure involved. */
  disagree: string | null;
  sources: SourceFigure[];
}

/** Values a source writes when it has nothing to say. 'others' is HostPlatform's default for every Airbnb booking. */
const MEANINGLESS_METHOD = /^(others?|other|n\/?a|none|-|unknown)$/i;

const ringgit = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ledger(m: MoneyIn, payments: PaymentRow[], site: string): Ledger {
  const v = (x: number | null) => (x == null ? 0 : x);
  const dead = m.state === 'cancelled' || m.state === 'no_show';
  const ota = OTA_CHANNELS.includes(m.channel);
  const guestTotal = m.gross;
  const notes: string[] = [];
  const sources: SourceFigure[] = [];

  // (1) The guest total is the booking's own total. The room line is what is left of it after the fees and taxes
  // listed, so the section always adds up; where the recorded room charge differs from that, the sources disagree.
  const others: LedgerLine[] = [];
  if (v(m.guestCleaningFee)) others.push({ key: 'cleaning', label: 'Cleaning fee', amount: v(m.guestCleaningFee) });
  if (v(m.extraFees)) others.push({ key: 'extras', label: 'Other fees', sub: 'Extra guest, early or late, add-ons', amount: v(m.extraFees) });
  if (v(m.sstAmount)) others.push({ key: 'sst', label: 'SST', amount: v(m.sstAmount) });
  if (v(m.tourismTax)) others.push({ key: 'tourism', label: 'Tourism tax', amount: v(m.tourismTax) });
  const otherSum = others.reduce((n, l) => n + l.amount, 0);
  const room = guestTotal - otherSum;
  let guestLines: LedgerLine[] = [];
  if (guestTotal > 0 && (m.roomRevenue != null || others.length)) {
    if (room < 0) {
      notes.push(`The fees and taxes recorded (${ringgit(otherSum)}) are more than the guest total (${ringgit(guestTotal)}).`);
    } else {
      guestLines = [{ key: 'room', label: `Room, ${m.nights} ${m.nights === 1 ? 'night' : 'nights'}`, amount: room }, ...others];
      if (m.roomRevenue != null && Math.abs(m.roomRevenue - room) > TOLERANCE
        // HostPlatform's "room rate" on an Airbnb booking is Airbnb's payout to us (the stay after Airbnb's fee,
        // cleaning included): that is its convention, not a disagreement.
        && !(m.channel === 'airbnb' && [m.gross - m.channelFee, m.payoutAmount, m.collected].some(x => x != null && Math.abs(m.roomRevenue! - x) <= TOLERANCE))) {
        notes.push(`HostPlatform recorded room charges of ${ringgit(m.roomRevenue)}; the guest total less the fees listed leaves ${ringgit(room)}.`);
      }
    }
  }
  sources.push({ label: 'Guest total', amount: guestTotal, from: m.fromWorkbook ? 'Owner workbook (Airbnb earnings report)' : ota ? `${site} via HostPlatform or Channex` : 'This booking' });
  if (m.roomRevenue != null) sources.push({ label: m.channel === 'airbnb' ? 'Room rate (on Airbnb bookings HostPlatform records the payout here)' : 'Room charges', amount: m.roomRevenue, from: 'HostPlatform export' });
  for (const l of others) sources.push({ label: l.label, amount: l.amount, from: l.key === 'cleaning' && m.fromWorkbook ? 'Owner workbook' : 'HostPlatform export' });

  // (2)
  const platformLines: LedgerLine[] = [];
  const base = guestTotal - v(m.sstAmount) - v(m.tourismTax);
  if (m.channelFee > 0) platformLines.push({ key: 'commission', label: `${ota ? site : 'Booking site'} commission`, sub: base > 0 ? `${(m.channelFee / base * 100).toFixed(1)}% of the room and fees` : undefined, amount: m.channelFee });
  if (v(m.paymentProcessingFee)) platformLines.push({ key: 'processing', label: 'Payment processing', amount: v(m.paymentProcessingFee) });
  const platformTotal = platformLines.reduce((n, l) => n + l.amount, 0);

  // (3)
  const imported = payments.filter(p => p.source === 'owner_workbook');
  const reported = imported.filter(p => p.kind === 'ota_payout').reduce((n, p) => n + p.amount, 0);
  const computed = guestTotal - platformTotal;
  const expected = imported.length ? reported : m.payoutAmount ?? computed;
  if ((imported.length || m.payoutAmount != null) && Math.abs(expected - computed) > TOLERANCE && !dead) {
    notes.push(`${site} reported a payout of ${ringgit(expected)}; the guest total less the platform's share is ${ringgit(computed)}. ${site}'s figure is used.`);
  }
  if (imported.length) sources.push({ label: `${site} payout lines (${imported.length})`, amount: reported, from: 'Owner workbook' });
  else if (m.payoutAmount != null) sources.push({ label: 'Payout reported', amount: m.payoutAmount, from: m.fromWorkbook ? 'Owner workbook' : 'HostPlatform export' });
  sources.push({ label: 'Commission', amount: m.channelFee, from: m.fromWorkbook ? 'Owner workbook' : ota ? `${site} via HostPlatform or Channex` : 'This booking' });

  const paid = payments.filter(p => p.status === 'received').reduce((n, p) => n + (p.kind === 'refund' ? -p.amount : p.amount), 0);
  const receivedBefore = imported.length ? 0 : Math.max(m.collected, v(m.payoutAmount));
  const received = paid + receivedBefore;
  if (receivedBefore > 0) sources.push({ label: 'Received before payments were recorded here', amount: receivedBefore, from: m.fromWorkbook ? 'Owner workbook' : 'HostPlatform export' });

  return {
    guestLines, guestTotal, otaTax: v(m.otaTax) || null,
    platformLines, platformTotal,
    expected: dead ? Math.min(expected, received) : expected, received,
    outstanding: dead ? 0 : Math.max(expected - received, 0), receivedBefore,
    payments,
    paymentMethod: m.paymentMethod && !MEANINGLESS_METHOD.test(m.paymentMethod.trim()) ? m.paymentMethod : null,
    disagree: notes.length ? notes.join(' ') : null,
    sources,
  };
}

export const PAYMENT_KINDS = ['guest_payment', 'ota_payout', 'refund'] as const;
export const PAYMENT_METHODS = ['Bank transfer', 'Cash', 'Card', 'DuitNow / QR', 'Booking site payout', 'Other'] as const;
/** Who may record or remove money received: management, finance and operations managers. */
export const MONEY_ROLES = ['management', 'finance_admin', 'operations_manager'];

export function toPayment(p: any): PaymentRow {
  return {
    id: p.id, amount: Number(p.amount), receivedOn: p.received_on ?? null, status: p.status, method: p.method ?? null,
    reference: p.reference ?? null, kind: p.kind, note: p.note ?? null, source: p.source, createdBy: p.created_by_name ?? p.created_by ?? null, createdAt: p.created_at,
  };
}
