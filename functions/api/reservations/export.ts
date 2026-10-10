import { type Env, all, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { fromSql, columnsSql, parseListQuery, viewWhere, todoWhere, toRow } from '../../_lib/bookingList';
import { moneySchema } from '../../_lib/bookingMoney';

const VIEW_LABEL: Record<string, string> = {
  upcoming: 'Upcoming', inhouse: 'In house', past: 'Checked out', cancelled: 'Cancelled', all: 'All bookings',
};
const TODO_LABEL: Record<string, string> = {
  arriving: 'arriving today', departing: 'departing today', unpaid: 'direct, not fully paid', payout: 'booking-site payout pending',
};
const CHANNEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', owner_stay: 'Owner stay', maintenance_block: 'Maintenance block',
};
const STATE: Record<string, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};
const KIND: Record<string, string> = { guest_payment: 'guest payment', ota_payout: 'payout', refund: 'refund' };
const MAX_ROWS = 50000;

/** GET /api/reservations/export — the same tab, card, filters and searches as the list, every matching row, as CSV:
 *  the money breakdown, what the platform took, what we expect and have received, each payment, and nationality. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);

  const q = parseListQuery(new URL(request.url));
  const schema = await moneySchema(env);
  const parts = schema.payoutCols
    ? ', r.room_revenue, r.guest_cleaning_fee, r.extra_fees, r.sst_amount, r.tourism_tax, r.ota_tax, r.payment_processing_fee'
    : '';
  const raw = await all<any>(env, `
    SELECT ${columnsSql(schema)}${parts} ${fromSql(schema)}
    WHERE ${q.where} AND ${viewWhere(q.view, q.today)} AND ${q.todo ? todoWhere(q.todo, q.today, schema) : 'TRUE'}
    ORDER BY ${q.orderBy} LIMIT ${MAX_ROWS}`, ...q.args);
  const pays = new Map<string, string[]>();
  if (schema.payments && raw.length) {
    const list = await all<any>(env, `
      SELECT reservation_id, amount, received_on, status, kind, method, reference FROM booking_payments
      WHERE reservation_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY status = 'expected', COALESCE(received_on, '9999'), created_at, id`,
      JSON.stringify(raw.map(r => r.id)));
    for (const p of list) {
      const s = `${p.received_on ?? (p.status === 'expected' ? 'expected' : 'date not recorded')} ${KIND[p.kind] ?? p.kind} ${money(Number(p.amount) * (p.kind === 'refund' ? -1 : 1))}${p.method ? ` ${p.method}` : ''}${p.reference ? ` ref ${p.reference}` : ''}`;
      pays.set(p.reservation_id, [...(pays.get(p.reservation_id) ?? []), s]);
    }
  }

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const opt = (sen: unknown) => (sen == null ? '' : money(Number(sen)));
  const rows = raw.map(r => ({ r, x: toRow(r) }));
  const filters = [VIEW_LABEL[q.view] ?? q.view, ...(q.todo ? [TODO_LABEL[q.todo]] : []),
    ...(q.filters.channel ? [`channel ${CHANNEL[q.filters.channel]}`] : []), ...(q.filters.property ? ['one building'] : []),
    ...(q.filters.from || q.filters.to ? [`stays touching ${q.filters.from ?? 'any date'} to ${q.filters.to ?? 'any date'}`] : []),
    ...Object.entries(q.searches).map(([k, v]) => `${k === 'q' ? 'search' : k} contains "${v}"`)];
  if (q.sortLabel) filters.push(`sorted by ${q.sortLabel}`);
  const sum = (f: (x: ReturnType<typeof toRow>) => number) => rows.reduce((n, { x }) => n + f(x), 0);

  const head = ['Reference', 'Guest', 'Guests', 'Contact', 'Nationality', 'Unit', 'Building', 'Channel', 'Check-in', 'Check-out', 'Nights', 'Status',
    'Room as recorded (RM)', 'Cleaning fee (RM)', 'Other fees (RM)', 'SST (RM)', 'Tourism tax (RM)', 'Guest total (RM)', 'Tax kept by the site (RM)',
    'Commission (RM)', 'Payment processing (RM)', 'Expected to receive (RM)', 'Received (RM)', 'Outstanding (RM)', 'Payments'];
  const lines = [
    `# Filters applied: ${filters.join(', ')}`,
    `# Scope: ${rows.length} bookings, ${sum(x => x.nights)} nights, guest total RM ${money(sum(x => x.grossBookingValue))}, commission RM ${money(sum(x => x.channelFee))}, received RM ${money(sum(x => x.received))}, outstanding RM ${money(sum(x => ['cancelled', 'no_show'].includes(x.state) ? 0 : x.outstanding))} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Asia/Kuala_Lumpur dates`,
    '',
    head.map(esc).join(','),
    ...rows.map(({ r, x }) => [
      x.externalRef, x.guestName, x.guestsCount, x.guestPhone, x.guestNationality ?? x.guestCountry ?? '', x.unitNumber, x.propertyName, CHANNEL[x.channel] ?? x.channel,
      x.checkIn, x.checkOut, x.nights, STATE[x.state] ?? x.state,
      opt(r.room_revenue), opt(r.guest_cleaning_fee), opt(r.extra_fees), opt(r.sst_amount), opt(r.tourism_tax), money(x.grossBookingValue), opt(r.ota_tax),
      money(x.channelFee), opt(r.payment_processing_fee), money(x.expectedPayout), money(x.received), money(['cancelled', 'no_show'].includes(x.state) ? 0 : x.outstanding),
      (pays.get(x.id) ?? []).join('; '),
    ].map(esc).join(',')),
  ];
  // The BOM makes Excel read the file as UTF-8, so guest names in other scripts survive.
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="bookings-${q.todo ?? q.view}-${q.today}.csv"`,
      'cache-control': 'no-store',
    },
  });
};

function money(sen: number) { return (sen / 100).toFixed(2); }
