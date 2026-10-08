import { type Env, all, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { FROM, COLUMNS, parseListQuery, viewWhere, toRow } from '../../_lib/bookingList';

const VIEW_LABEL: Record<string, string> = {
  upcoming: 'Upcoming and in house', arriving: 'Arriving today', inhouse: 'In house', pending: 'Pending payment',
  past: 'Past', cancelled: 'Cancelled', blocks: 'Blocks and owner stays', all: 'All bookings',
};
const CHANNEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', owner_stay: 'Owner stay', maintenance_block: 'Maintenance block',
};
const STATE: Record<string, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};
const MAX_ROWS = 50000;

/** GET /api/reservations/export — the same filters as the list, every matching row, as CSV. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);

  const q = parseListQuery(new URL(request.url));
  const rows = (await all<any>(env, `
    SELECT ${COLUMNS} ${FROM} WHERE ${q.where} AND ${viewWhere(q.view, q.today)}
    ORDER BY ${q.orderBy} LIMIT ${MAX_ROWS}`, ...q.args)).map(toRow);

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const money = (sen: number) => (sen / 100).toFixed(2);
  const filters = [VIEW_LABEL[q.view], ...Object.entries(q.searches).map(([k, v]) => `${k === 'q' ? 'search' : k} contains "${v}"`)];
  if (q.sortLabel) filters.push(`sorted by ${q.sortLabel}`);
  const nights = rows.reduce((n, r) => n + r.nights, 0);
  const gross = rows.reduce((n, r) => n + r.grossBookingValue, 0);
  const fees = rows.reduce((n, r) => n + r.channelFee, 0);

  const head = ['Reference', 'Guest', 'Guests', 'Contact', 'Unit', 'Property', 'Channel', 'Check-in', 'Check-out', 'Nights', 'Gross (RM)', 'Channel fee (RM)', 'Status'];
  const lines = [
    `# Filters applied: ${filters.join(', ')}`,
    `# Scope: ${rows.length} bookings, ${nights} nights, gross RM ${money(gross)}, channel fees RM ${money(fees)} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Asia/Kuala_Lumpur dates`,
    '',
    head.map(esc).join(','),
    ...rows.map(r => [
      r.externalRef, r.guestName, r.guestsCount, r.guestPhone, r.unitNumber, r.propertyName, CHANNEL[r.channel] ?? r.channel,
      r.checkIn, r.checkOut, r.nights, money(r.grossBookingValue), money(r.channelFee), STATE[r.state] ?? r.state,
    ].map(esc).join(',')),
  ];
  // The BOM makes Excel read the file as UTF-8, so guest names in other scripts survive.
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="bookings-${q.view}-${q.today}.csv"`,
      'cache-control': 'no-store',
    },
  });
};
