/** What the Messages screen shows about a conversation, shared by the list and the single conversation. A conversation
 *  with no booking (an Airbnb inquiry before booking) takes its unit from the listing (message_threads.unit_id) and its
 *  guest's name from the channel (message_threads.guest_name). */
export const THREAD_COLUMNS = `t.id, t.channel, t.subject, t.is_read, t.last_message_at, t.reservation_id, t.channex_thread_id,
  COALESCE(g.full_name, t.guest_name) AS guest_name, g.phone AS guest_phone,
  u.id AS unit_id, u.unit_number, p.name AS property_name,
  r.check_in, r.check_out, r.state AS reservation_state, r.external_ref, r.guests_count`;

export const THREAD_FROM = `FROM message_threads t
  LEFT JOIN reservations r ON r.id = t.reservation_id
  LEFT JOIN guests g ON g.id = COALESCE(t.guest_id, r.guest_id)
  LEFT JOIN units u ON u.id = COALESCE(r.unit_id, t.unit_id)
  LEFT JOIN properties p ON p.id = u.property_id`;

export function threadOut(t: any) {
  return {
    id: t.id, channel: t.channel ?? null, subject: t.subject ?? null, isRead: !!t.is_read, lastMessageAt: t.last_message_at,
    guestName: t.guest_name || null, unitId: t.unit_id ?? null, unitNumber: t.unit_number ?? null, propertyName: t.property_name ?? null,
    reservationId: t.reservation_id ?? null, checkIn: t.check_in ?? null, checkOut: t.check_out ?? null,
    reservationState: t.reservation_state ?? null, bookingRef: t.external_ref ?? null, guestsCount: t.guests_count ?? null,
    inquiry: !t.reservation_id,
    // Whether a reply reaches the guest: Airbnb / Booking.com through Channex, direct guests on WhatsApp.
    linked: t.channel === 'direct' ? !!t.guest_phone : !!t.channex_thread_id,
  };
}

/** One message as the screen shows it. `delivery` only on replies sent from here once migration 0104 was in. */
export function messageOut(m: any) {
  return {
    id: m.id, direction: m.direction, body: m.body, sentAt: m.sent_at, isAutomated: !!m.is_automated,
    senderName: m.sender_name ?? null,
    delivery: m.delivery_state ?? null, deliveryReason: m.delivery_error ?? null,
    attachments: Array.isArray(m.attachments) ? m.attachments : typeof m.attachments === 'string' ? safeList(m.attachments) : [],
  };
}

function safeList(s: string) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }
