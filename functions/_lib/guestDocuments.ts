/** Numbered guest documents (migration 0097): an Invoice for a booking and an Official Receipt for money the guest
 *  paid us, printed on the company letterhead (letterhead.ts).
 *
 *    Invoice   a direct booking: the guest total with its breakdown. A booking-site booking only when the guest also
 *              paid us something directly (the site invoices its guests for the rest): the lines are those payments.
 *    Receipt   one received guest payment (booking_payments kind guest_payment). Never a site payout or a refund.
 *
 *  Numbers: INV-YYMM-NNNN / OR-YYMM-NNNN, YYMM the Malaysian month of issue, from document_counters, taken in the
 *  same transaction as the document so a failed issue gives its number back and two at once never share one.
 *  A document is never edited or deleted: a mistake is voided with a reason, keeps its number, and a new one is issued.
 *  What is printed is frozen in `snapshot` at issue. */
import { type Env, all, one, run, audit, nowIso, transaction } from './db';
import type { Session } from './auth';
import { ledger, toPayment, OTA_CHANNELS, type PaymentRow } from './bookingMoney';
import { companyDetails, type Company } from './letterhead';

export type DocType = 'invoice' | 'receipt';
export const DOC_LABEL: Record<DocType, string> = { invoice: 'Invoice', receipt: 'Official receipt' };
const PREFIX: Record<DocType, string> = { invoice: 'INV', receipt: 'OR' };
const CHANNEL_LABEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct' };

export class DocRefused extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

/** YYMM of a moment in Malaysia time. */
export const periodOf = (iso: string) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(2, 7).replace('-', '');
export const docNo = (t: DocType, period: string, n: number) => `${PREFIX[t]}-${period}-${String(n).padStart(4, '0')}`;

/** The next number for the type and month. Atomic: the row is created or incremented and read back in one statement,
 *  which holds the row lock until the surrounding transaction ends. */
export async function nextNumber(tx: Env, t: DocType, period: string): Promise<number> {
  const r = await one<{ last_no: number }>(tx, `
    INSERT INTO document_counters (doc_type, period, last_no) VALUES (?, ?, 1)
    ON CONFLICT (doc_type, period) DO UPDATE SET last_no = document_counters.last_no + 1
    RETURNING last_no`, t, period);
  return Number(r!.last_no);
}

/* ------------------------------------------------------------------ */
/* What gets printed                                                   */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  docType: DocType; docNo: string; issuedAt: string; issuedBy: string; company: Company;
  guest: { name: string; email: string | null; phone: string | null };
  booking: { id: string; ref: string | null; channel: string; channelLabel: string; unit: string; address: string | null; checkIn: string; checkOut: string; nights: number; guests: number };
  lines: { label: string; sub?: string; amount: number }[];
  total: number;
  /** Invoice: what the guest had paid us when it was issued, and what was left. Receipt: the same after this payment. */
  paidToDate: number; balance: number;
  payment?: { id: string; receivedOn: string | null; method: string | null; reference: string | null; amount: number };
  note: string | null;
}

interface Booking {
  id: string; channel: string; state: string; external_ref: string | null; check_in: string; check_out: string; guests_count: number;
  gross_booking_value: number; channel_fee: number; collected_revenue: number; unit_number: string; property_name: string; address_line: string | null;
  guest_name: string | null; guest_email: string | null; guest_phone: string | null;
  room_revenue: number | null; guest_cleaning_fee: number | null; extra_fees: number | null; sst_amount: number | null; tourism_tax: number | null;
  ota_tax: number | null; payment_processing_fee: number | null; payout_amount: number | null; payout_date: string | null; payment_method: string | null; notes: string | null;
}

async function loadBooking(env: Env, id: string): Promise<{ b: Booking; payments: PaymentRow[] }> {
  const b = await one<Booking>(env, `
    SELECT r.id, r.channel, r.state, r.external_ref, r.check_in, r.check_out, r.guests_count, r.gross_booking_value, r.channel_fee, r.collected_revenue,
           u.unit_number, p.name AS property_name, p.address_line, g.full_name AS guest_name, g.email AS guest_email, g.phone AS guest_phone,
           r.room_revenue, r.guest_cleaning_fee, r.extra_fees, r.sst_amount, r.tourism_tax, r.ota_tax, r.payment_processing_fee,
           r.payout_amount, r.payout_date, r.payment_method, r.notes
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.id = ?`, id);
  if (!b) throw new DocRefused('NOT_FOUND', 'That booking does not exist.', 404);
  const payments = (await all<any>(env, `SELECT * FROM booking_payments WHERE reservation_id = ? ORDER BY COALESCE(received_on, '9999'), created_at, id`, id)).map(toPayment);
  return { b, payments };
}

const nightsOf = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
const n = (v: unknown) => (v == null ? null : Number(v));
/** Money the guest paid us directly, less refunds. */
const guestPaid = (ps: PaymentRow[]) => ps.filter(p => p.status === 'received' && (p.kind === 'guest_payment' || p.kind === 'refund'))
  .reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0);

/** Why this booking cannot have the document, or null. Shared with the drawer so its buttons say the same thing. */
export function invoiceRefusal(b: Pick<Booking, 'channel' | 'state' | 'gross_booking_value'>, payments: PaymentRow[]): string | null {
  if (b.channel === 'maintenance_block' || b.channel === 'owner_stay') return 'Blocks and owner stays have no guest to invoice.';
  if (b.state === 'cancelled' || b.state === 'no_show') return 'A cancelled or no-show booking is not invoiced.';
  if (OTA_CHANNELS.includes(b.channel)) {
    return payments.some(p => p.kind === 'guest_payment' && p.status === 'received') ? null
      : `${CHANNEL_LABEL[b.channel]} invoices its guests itself. An invoice here is only for money the guest paid us directly.`;
  }
  return Number(b.gross_booking_value) > 0 ? null : 'Set the booking total first: there is nothing to invoice.';
}
export function receiptRefusal(p: PaymentRow | undefined): string | null {
  if (!p) return 'That payment is not on this booking.';
  if (p.kind !== 'guest_payment') return p.kind === 'refund' ? 'A refund is money going back; it gets no receipt.' : 'A booking site payout is not money from the guest; it gets no receipt.';
  if (p.status !== 'received') return 'Only money already received gets a receipt.';
  return null;
}

function snapshotFor(t: DocType, no: string, now: string, who: Session, company: Company, b: Booking, payments: PaymentRow[], payment?: PaymentRow): Snapshot {
  const nights = nightsOf(b.check_in, b.check_out);
  const ota = OTA_CHANNELS.includes(b.channel);
  const L = ledger({
    channel: b.channel, state: b.state, nights, gross: Number(b.gross_booking_value), channelFee: Number(b.channel_fee), collected: Number(b.collected_revenue),
    roomRevenue: n(b.room_revenue), guestCleaningFee: n(b.guest_cleaning_fee), extraFees: n(b.extra_fees), sstAmount: n(b.sst_amount), tourismTax: n(b.tourism_tax),
    otaTax: n(b.ota_tax), paymentProcessingFee: n(b.payment_processing_fee), payoutAmount: n(b.payout_amount), payoutDate: b.payout_date, paymentMethod: b.payment_method, fromWorkbook: false,
  }, payments, CHANNEL_LABEL[b.channel] ?? b.channel);
  const direct = payments.filter(p => p.kind === 'guest_payment' && p.status === 'received');
  const paid = guestPaid(payments);
  let lines: Snapshot['lines'], total: number;
  if (t === 'receipt') {
    lines = [{ label: `Payment for booking ${b.external_ref ?? ''}`.trim(), sub: payment?.note ?? undefined, amount: payment!.amount }];
    total = payment!.amount;
  } else if (ota) {
    lines = direct.map(p => ({ label: p.note || 'Charges paid to us directly', sub: p.receivedOn ? `Paid ${p.receivedOn}` : undefined, amount: p.amount }));
    total = lines.reduce((s, l) => s + l.amount, 0);
  } else {
    lines = L.guestLines.length ? L.guestLines.map(l => ({ label: l.label, sub: l.sub, amount: l.amount })) : [{ label: `Accommodation, ${nights} ${nights === 1 ? 'night' : 'nights'}`, amount: L.guestTotal }];
    total = L.guestTotal;
  }
  const billed = ota ? direct.reduce((s, p) => s + p.amount, 0) : L.guestTotal;
  return {
    docType: t, docNo: no, issuedAt: now, issuedBy: who.fullName, company,
    guest: { name: b.guest_name || 'Guest', email: b.guest_email, phone: b.guest_phone },
    booking: {
      id: b.id, ref: b.external_ref, channel: b.channel, channelLabel: CHANNEL_LABEL[b.channel] ?? b.channel, unit: `${b.property_name} ${b.unit_number}`,
      address: b.address_line, checkIn: b.check_in.slice(0, 10), checkOut: b.check_out.slice(0, 10), nights, guests: Number(b.guests_count),
    },
    lines, total, paidToDate: paid, balance: Math.max(billed - paid, 0),
    payment: payment ? { id: payment.id, receivedOn: payment.receivedOn, method: payment.method, reference: payment.reference, amount: payment.amount } : undefined,
    note: null,
  };
}

/* ------------------------------------------------------------------ */
/* Issue and void                                                      */
/* ------------------------------------------------------------------ */

export interface DocRow {
  id: string; doc_type: DocType; doc_no: string; reservation_id: string; payment_id: string | null; amount: number; issued_at: string; issued_by: string;
  voided_at: string | null; voided_by: string | null; void_reason: string | null; snapshot: Snapshot | string;
}

export function toDoc(r: any) {
  const snap: Snapshot = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
  return {
    id: r.id, type: r.doc_type as DocType, typeLabel: DOC_LABEL[r.doc_type as DocType], docNo: r.doc_no, reservationId: r.reservation_id, paymentId: r.payment_id,
    amount: Number(r.amount), issuedAt: r.issued_at, issuedBy: r.issued_by_name ?? snap?.issuedBy ?? null,
    voidedAt: r.voided_at ?? null, voidedBy: r.voided_by_name ?? null, voidReason: r.void_reason ?? null,
    guestName: snap?.guest?.name ?? null, bookingRef: snap?.booking?.ref ?? null, unit: snap?.booking?.unit ?? null, channel: snap?.booking?.channel ?? null,
    pdf: `/api/guest-documents/${encodeURIComponent(r.id)}/pdf`,
  };
}
export type DocView = ReturnType<typeof toDoc>;

export const DOC_SQL = `SELECT d.*, ib.full_name AS issued_by_name, vb.full_name AS voided_by_name
  FROM issued_documents d LEFT JOIN users ib ON ib.id = d.issued_by LEFT JOIN users vb ON vb.id = d.voided_by`;

/** Issues the next number and stores the document, in one transaction. */
export async function issue(env: Env, session: Session, x: { type: DocType; reservationId: string; paymentId?: string | null }): Promise<DocView> {
  const company = await companyDetails(env);
  try {
    const row = await transaction(env, async tx => {
      const { b, payments } = await loadBooking(tx, x.reservationId);
      let payment: PaymentRow | undefined;
      if (x.type === 'invoice') {
        const why = invoiceRefusal(b, payments);
        if (why) throw new DocRefused('NOT_INVOICEABLE', why, 422);
        const live = await one<{ doc_no: string }>(tx, `SELECT doc_no FROM issued_documents WHERE reservation_id = ? AND doc_type = 'invoice' AND voided_at IS NULL`, b.id);
        if (live) throw new DocRefused('ALREADY_ISSUED', `Invoice ${live.doc_no} is already issued for this booking. Void it first to issue a new one.`);
      } else {
        payment = payments.find(p => p.id === x.paymentId);
        const why = receiptRefusal(payment);
        if (why) throw new DocRefused('NOT_RECEIPTABLE', why, 422);
        const live = await one<{ doc_no: string }>(tx, `SELECT doc_no FROM issued_documents WHERE payment_id = ? AND doc_type = 'receipt' AND voided_at IS NULL`, payment!.id);
        if (live) throw new DocRefused('ALREADY_ISSUED', `Receipt ${live.doc_no} is already issued for this payment. Void it first to issue a new one.`);
      }
      const now = nowIso(), period = periodOf(now);
      const no = docNo(x.type, period, await nextNumber(tx, x.type, period));
      const snap = snapshotFor(x.type, no, now, session, company, b, payments, payment);
      const id = crypto.randomUUID();
      await run(tx, `INSERT INTO issued_documents (id, doc_type, doc_no, reservation_id, payment_id, amount, issued_at, issued_by, snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::text::jsonb)`, id, x.type, no, b.id, payment?.id ?? null, snap.total, now, session.userId, JSON.stringify(snap));
      await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: `document.issue`, entityTable: 'reservations', entityId: b.id,
        after: { documentId: id, type: x.type, docNo: no, amount: snap.total, paymentId: payment?.id ?? null } });
      return one<any>(tx, `${DOC_SQL} WHERE d.id = ?`, id);
    });
    return toDoc(row);
  } catch (e: any) {
    // Two people pressing Issue at the same moment: the second hits the one-live-document index and its number is rolled back.
    if (e?.code === '23505' && /live_(invoice|receipt)/.test(String(e?.constraint_name ?? e?.message))) {
      throw new DocRefused('ALREADY_ISSUED', x.type === 'invoice' ? 'An invoice was just issued for this booking by someone else.' : 'A receipt was just issued for this payment by someone else.');
    }
    throw e;
  }
}

export async function voidDoc(env: Env, session: Session, id: string, reason: string): Promise<DocView> {
  const text = reason.trim().slice(0, 500);
  if (!text) throw new DocRefused('VALIDATION', 'Say why the document is voided.', 422);
  return transaction(env, async tx => {
    const cur = await one<any>(tx, `SELECT * FROM issued_documents WHERE id = ? FOR UPDATE`, id);
    if (!cur) throw new DocRefused('NOT_FOUND', 'That document does not exist.', 404);
    if (cur.voided_at) throw new DocRefused('ALREADY_VOID', `${cur.doc_no} was already voided.`);
    const now = nowIso();
    await run(tx, `UPDATE issued_documents SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`, now, session.userId, text, id);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'document.void', entityTable: 'reservations', entityId: cur.reservation_id,
      before: { documentId: id, docNo: cur.doc_no, voided: false }, after: { documentId: id, docNo: cur.doc_no, voided: true, reason: text } });
    return toDoc(await one<any>(tx, `${DOC_SQL} WHERE d.id = ?`, id));
  });
}

/** The booking drawer's view: its documents and which payments can still get a receipt. */
export async function documentsFor(env: Env, reservationId: string): Promise<DocView[]> {
  try {
    return (await all<any>(env, `${DOC_SQL} WHERE d.reservation_id = ? ORDER BY d.issued_at`, reservationId)).map(toDoc);
  } catch {
    return []; // before migration 0097
  }
}
