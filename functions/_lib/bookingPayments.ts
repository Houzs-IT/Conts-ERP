import { type Env, run, nowIso } from './db';
import { toPayment, PAYMENT_KINDS } from './bookingMoney';

/** Recording money against a booking: shared by one booking's Record payment and the bulk "payouts received". */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function validatePayment(b: any): Record<string, string> | null {
  const errs: Record<string, string> = {};
  const amount = Number(b?.amount);
  if (!Number.isFinite(amount) || Math.round(amount) <= 0) errs.amount = 'Enter an amount more than zero.';
  else if (amount > 100_000_000) errs.amount = 'That amount is too large.';
  if (!b?.receivedOn || !ISO_DAY.test(b.receivedOn)) errs.receivedOn = 'Pick the date it was received.';
  else if (b.receivedOn > new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)) errs.receivedOn = 'The date cannot be in the future.';
  if (b?.kind != null && !(PAYMENT_KINDS as readonly string[]).includes(b.kind)) errs.kind = 'Pick what this payment is.';
  return Object.keys(errs).length ? errs : null;
}

export async function insertPayment(env: Env, x: { reservationId: string; amount: number; receivedOn: string; method: string | null; reference: string | null; kind: string; note: string | null; userId: string }) {
  const pid = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO booking_payments (id, reservation_id, amount, received_on, status, method, reference, kind, note, source, created_by, created_at)
    VALUES (?, ?, ?, ?, 'received', ?, ?, ?, ?, 'manual', ?, ?)`, pid, x.reservationId, x.amount, x.receivedOn, x.method, x.reference, x.kind, x.note, x.userId, now);
  return toPayment({ id: pid, reservation_id: x.reservationId, amount: x.amount, received_on: x.receivedOn, status: 'received', method: x.method, reference: x.reference, kind: x.kind, note: x.note, source: 'manual', created_by: x.userId, created_at: now });
}
