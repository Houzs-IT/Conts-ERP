import { type Env, one, all, json, fail } from '../../_lib/db';
import { can } from '../../_lib/access';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { fromSql, columnsSql, toRow } from '../../_lib/bookingList';
import { moneySchema, ledger, toPayment, OTA_CHANNELS, type PaymentRow } from '../../_lib/bookingMoney';
import { WORKBOOK_MONEY_MARK } from '../../_lib/hostplatformImportDb';
import { applyMove, isRefusal, movesFor, enteredOn, mytDay, dayLabel, type State } from '../../_lib/bookingLifecycle';
import { documentsFor, invoiceRefusal } from '../../_lib/guestDocuments';
import { pendingFor } from '../../_lib/approvals';

/** Per-booking money columns added by migration 0052. Read only where they exist, so this works before and after it. */
const OPTIONAL_MONEY = {
  room_revenue: 'roomRevenue', guest_cleaning_fee: 'guestCleaningFee', extra_fees: 'extraFees', sst_amount: 'sstAmount',
  tourism_tax: 'tourismTax', ota_tax: 'otaTax', payment_processing_fee: 'paymentProcessingFee',
  deposit_collected: 'depositCollected', deposit_refunded: 'depositRefunded', payout_amount: 'payoutAmount',
  payout_date: 'payoutDate', payment_method: 'paymentMethod', rate_plan: 'ratePlan', guest_nationality: 'guestNationality',
} as const;
/** Which optional columns this database has. Remembered once all are there, so opening a booking stops paying a
 *  catalogue query on every request; until then it is asked each time, so a migration applied later is seen. */
let optionalSeen: { column_name: string }[] | null = null;
async function optionalColumns(env: Env): Promise<{ column_name: string }[]> {
  if (optionalSeen) return optionalSeen;
  const wanted = [...Object.keys(OPTIONAL_MONEY), 'staff_notes'];
  const rows = await all<{ column_name: string }>(env, `
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'reservations' AND table_schema = ANY(current_schemas(false))
      AND column_name IN (${wanted.map(c => `'${c}'`).join(', ')})`);
  if (rows.length === wanted.length) optionalSeen = rows;
  return rows;
}
const TEXT_FIELDS = new Set(['payout_date', 'payment_method', 'rate_plan', 'guest_nationality']);

const CHANNEL_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', maintenance_block: 'Block', owner_stay: 'Owner stay',
};
const STATE_LABEL: Record<string, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Upcoming', checked_in: 'Currently hosting',
  checked_out: 'Past', cancelled: 'Cancelled', no_show: 'No-show',
};

interface TimelineEvent { at: string; label: string; detail?: string; actor?: string; upcoming?: boolean }

const ringgit = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** One audit row in words. Rows the drawer has nothing to say about return null. */
function describe(a: { action: string; actor_label: string; before_state: string | null; after_state: string | null }): Omit<TimelineEvent, 'at'> | null {
  const before = parse(a.before_state) ?? {}, after = parse(a.after_state) ?? {};
  switch (a.action) {
    case 'reservation.create': return { label: 'Reservation created', actor: a.actor_label };
    case 'reservation.block': return { label: after.channel === 'owner_stay' ? 'Owner stay created' : 'Block created', detail: after.reason ? `Note: ${after.reason}` : undefined, actor: a.actor_label };
    case 'reservation.duplicate': return { label: 'Created as a copy of another reservation', actor: a.actor_label };
    case 'reservation.status':
    case 'reservation.cancel': {
      const to = STATE_LABEL[after.state] ?? after.state;
      const from = STATE_LABEL[before.state] ?? before.state;
      const label = after.state === 'cancelled' ? 'Cancelled' : after.state === 'no_show' ? 'Marked no-show'
        : after.state === 'checked_in' && before.state === 'checked_out' ? 'Checkout undone'
        : after.state === 'confirmed' && before.state === 'checked_in' ? 'Check-in undone'
        : after.state === 'confirmed' && (before.state === 'cancelled' || before.state === 'no_show') ? 'Reinstated'
        : after.state === 'checked_in' ? 'Checked in' : after.state === 'checked_out' ? 'Checked out'
        : `Status changed from ${from} to ${to}`;
      const bits = [after.reason && after.reason !== 'operator_cancelled' ? `Reason: ${after.reason}` : null,
        after.tasksRemoved ? `${after.tasksRemoved} unstarted ${after.tasksRemoved === 1 ? 'cleaning job' : 'cleaning jobs'} removed` : null].filter(Boolean);
      return { label, actor: a.actor_label, detail: bits.join(' · ') || undefined };
    }
    case 'reservation.dates':
      return {
        label: 'Dates changed', actor: a.actor_label,
        detail: [
          before.checkIn ? `${dayLabel(before.checkIn)} – ${dayLabel(before.checkOut)} to ${dayLabel(after.checkIn)} – ${dayLabel(after.checkOut)}` : null,
          after.grossBookingValue != null ? `Guest total ${ringgit(before.grossBookingValue ?? 0)} to ${ringgit(after.grossBookingValue)}` : null,
        ].filter(Boolean).join(' · ') || undefined,
      };
    case 'reservation.prepare': return { label: 'Check-in prepared', detail: 'A cleaning job was added for the unit', actor: a.actor_label };
    case 'reservation.payment': return { label: after.kind === 'refund' ? 'Refund recorded' : after.kind === 'ota_payout' ? 'Host payout recorded' : 'Payment recorded', detail: after.amount != null ? `${ringgit(after.amount)}${after.receivedOn ? ` on ${dayLabel(after.receivedOn)}` : ''}` : undefined, actor: a.actor_label };
    case 'document.issue': return { label: `${after.type === 'receipt' ? 'Official receipt' : 'Invoice'} ${after.docNo} issued`, detail: after.amount != null ? ringgit(after.amount) : undefined, actor: a.actor_label };
    case 'document.void': return { label: `${after.docNo} voided`, detail: after.reason ? `Reason: ${after.reason}` : undefined, actor: a.actor_label };
    case 'reservation.payment_removed': return { label: 'Payment removed', detail: before.amount != null ? ringgit(before.amount) : undefined, actor: a.actor_label };
    case 'reservation.late_checkout': return { label: 'Late checkout requested', detail: `By ${after.checkoutTime} for ${ringgit(after.amount ?? 0)}${after.remark ? ` · ${after.remark}` : ''}`, actor: a.actor_label };
    case 'reservation.late_checkout_paid': return { label: 'Late checkout paid', detail: `Checkout by ${after.checkOutTime} · ${ringgit(after.amount ?? 0)}${after.receivedOn ? ` on ${dayLabel(after.receivedOn)}` : ''}`, actor: a.actor_label };
    case 'reservation.late_checkout_cancelled': return { label: 'Late checkout request cancelled', detail: before.checkoutTime ? `By ${before.checkoutTime} for ${ringgit(before.amount ?? 0)}` : undefined, actor: a.actor_label };
    case 'reservation.details': return { label: after.checkInTime || after.checkOutTime ? 'Check-in or checkout time changed' : 'Notes changed', detail: after.checkInTime || after.checkOutTime ? [after.checkInTime ? `Check-in from ${after.checkInTime}` : null, after.checkOutTime ? `Checkout by ${after.checkOutTime}` : null].filter(Boolean).join(' · ') : undefined, actor: a.actor_label };
    default: return null;
  }
}

/** GET /api/reservations/:id — one booking in the list's row shape, plus its real money lines, a timeline
 *  built only from what was recorded, and the status moves this user may make now. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Reservations are not available to cleaners and technicians.', 403);
  const id = String(params.id);

  const present = await optionalColumns(env);
  const extra = present.map(c => c.column_name).filter(c => c in OPTIONAL_MONEY);
  const hasStaffNotes = present.some(c => c.column_name === 'staff_notes');
  const schema = await moneySchema(env);
  const row = await one<any>(env, `SELECT ${columnsSql(schema)}, r.unit_id, r.notes, r.guest_id, g.email AS guest_email${hasStaffNotes ? ', r.staff_notes' : ''}${extra.map(c => `, r.${c} AS x_${c}`).join('')}
    ${fromSql(schema)} WHERE r.id = ?`, id);
  if (!row) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const lines: Record<string, number | string | null> = {};
  for (const [col, key] of Object.entries(OPTIONAL_MONEY)) {
    const v = extra.includes(col) ? row[`x_${col}`] : null;
    lines[key] = v == null || v === '' ? null : v instanceof Date ? v.toISOString() : TEXT_FIELDS.has(col) ? String(v) : Number(v);
  }
  const payments: PaymentRow[] = schema.payments ? (await all<any>(env, `
    SELECT bp.*, u.full_name AS created_by_name FROM booking_payments bp LEFT JOIN users u ON u.id = bp.created_by
    WHERE bp.reservation_id = ? ORDER BY bp.status = 'expected', COALESCE(bp.received_on, '9999'), bp.created_at, bp.id`, id)).map(toPayment) : [];

  const [auditRows, messages, notices] = await Promise.all([
    all<any>(env, `SELECT action, actor_label, before_state, after_state, occurred_at FROM audit_log
      WHERE entity_table = 'reservations' AND entity_id = ? ORDER BY occurred_at LIMIT 100`, id),
    all<any>(env, `SELECT m.direction, m.sent_at, m.is_automated FROM messages m JOIN message_threads t ON t.id = m.thread_id
      WHERE t.reservation_id = ? ORDER BY m.sent_at LIMIT 50`, id),
    all<any>(env, `SELECT template, channel, state, queued_at, sent_at FROM notification_log
      WHERE entity_table = 'reservations' AND entity_id = ? ORDER BY queued_at LIMIT 50`, id),
  ]);

  const channel = CHANNEL_LABEL[row.channel] ?? row.channel;
  // A block or an owner stay is not a booking: its events say so, and it has a start and an end, not a check-in.
  const what = row.channel === 'maintenance_block' ? 'Block' : row.channel === 'owner_stay' ? 'Owner stay' : null;
  const timeline: TimelineEvent[] = [];
  if (!auditRows.some(a => a.action === 'reservation.create' || a.action === 'reservation.duplicate' || a.action === 'reservation.block')) {
    timeline.push({ at: row.created_at, label: what ? `${what} recorded` : 'Reservation recorded', detail: what ? undefined : `Channel: ${channel}` });
  }
  for (const a of auditRows) {
    const d = describe(a);
    if (d) timeline.push({ at: a.occurred_at, ...d, ...(what && d.label === 'Reservation created' ? { label: `${what} created` } : {}) });
  }
  for (const m of messages) {
    timeline.push({ at: m.sent_at, label: m.direction === 'inbound' ? 'Message from guest' : m.is_automated ? 'Automatic message sent' : 'Message sent to guest' });
  }
  for (const n of notices) {
    timeline.push({ at: n.sent_at ?? n.queued_at, label: `${n.template.replace(/[._]/g, ' ')} by ${n.channel}`, detail: n.state === 'sent' ? 'Sent' : n.state === 'failed' ? 'Failed to send' : 'Waiting to send' });
  }
  if (lines.payoutDate && !payments.some(p => p.source === 'owner_workbook')) timeline.push({ at: String(lines.payoutDate), label: 'Host payout received' });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const today = mytDay();
  if (['inquiry', 'pending', 'confirmed'].includes(row.state) && row.check_in >= today) {
    timeline.push({ at: `${row.check_in}T${row.check_in_time}:00+08:00`, label: what ? `${what} starts` : 'Check-in due', upcoming: true });
  }
  if (['inquiry', 'pending', 'confirmed', 'checked_in'].includes(row.state) && row.check_out >= today) {
    timeline.push({ at: `${row.check_out}T${row.check_out_time}:00+08:00`, label: what ? `${what} ends` : 'Checkout due', upcoming: true });
  }

  const moves = movesFor(row.state as State, {
    channel: row.channel, checkIn: row.check_in, checkOut: row.check_out, today,
    manage: !!session.manage, enteredOn: await enteredOn(env, id, row.state),
  });

  const n = toRow(row);
  const fromWorkbook = String(row.notes ?? '').includes(WORKBOOK_MONEY_MARK);
  const money = {
    gross: Number(row.gross_booking_value), channelFee: Number(row.channel_fee), collected: Number(row.collected_revenue),
    ...lines,
  } as any;
  const ota = OTA_CHANNELS.includes(row.channel);
  // Documents and money requests arrive with the booking, so the money section never fills in after it opens.
  const moneyRole = can(session, 'finance', 'view');
  const [documents, approvals] = moneyRole
    ? await Promise.all([documentsFor(env, id), pendingFor(env, session, 'reservations', id).catch(() => [])])
    : [[], []];
  const live =['inquiry', 'pending', 'confirmed', 'checked_in'].includes(row.state);
  return json({
    ...n,
    unitId: row.unit_id,
    guestId: row.guest_id ?? null,
    guestEmail: row.guest_email ?? null,
    nationality: lines.guestNationality ?? row.guest_country ?? null,
    notes: row.notes ?? null,
    staffNotes: hasStaffNotes ? row.staff_notes ?? null : null,
    money,
    ledger: ledger({ ...money, channel: row.channel, state: row.state, nights: n.nights, fromWorkbook }, payments, CHANNEL_LABEL[row.channel] ?? row.channel),
    timeline,
    moves,
    documents,
    approvals,
    can: {
      issueDocuments: moneyRole,
      invoiceReason: invoiceRefusal({ channel: row.channel, state: row.state, gross_booking_value: Number(row.gross_booking_value) }, payments),
      // A booking site owns its bookings' dates and price: they change on the site and come back through Channex.
      changeDates: live && !ota,
      changeDatesReason: !live ? 'A past, cancelled or no-show reservation cannot move.' : ota ? `This is a ${CHANNEL_LABEL[row.channel]} reservation: its dates and price are set on ${CHANNEL_LABEL[row.channel]}. Change them there; the change comes back here by itself.` : null,
      recordPayment: schema.payments && can(session, 'finance', 'edit') && row.channel !== 'maintenance_block' && row.channel !== 'owner_stay',
      editDetails: true,
      paymentsReady: schema.payments,
    },
  });
};

/** PATCH /api/reservations/:id { state, reason? } — a status move from the allowed map (_lib/bookingLifecycle.ts).
 *  ("status" is accepted for state.) Illegal moves are refused with 409 and the reason in words. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change reservations.', 403);

  const b = await request.json<any>().catch(() => null);
  const r = await applyMove(env, session, String(params.id), b?.state ?? b?.status, typeof b?.reason === 'string' ? b.reason : null);
  if (isRefusal(r)) return json(r.body, r.status);
  return json(r);
};
