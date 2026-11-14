import { type Env, one, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { isConnectConfigured, assembleConnectContact, connectAutomations, CONNECT_FIELD_KEYS } from '../../_lib/connect';

/** GET /api/connect/preview?reservationId= | ?guestId= — the Connect template variables for a stay,
 *  for the operator to check before sending. Sensitive codes come back masked (bullets): the clear
 *  values never reach the browser, only the server-side send. Same ops/management gate as messaging. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only operations and management can message guests.', 403);

  const url = new URL(request.url);
  let reservationId = url.searchParams.get('reservationId');
  const guestId = url.searchParams.get('guestId');
  if (!reservationId && guestId) {
    const r = await one<{ id: string }>(env, `SELECT id FROM reservations WHERE guest_id = ? AND state != 'cancelled' ORDER BY check_in DESC LIMIT 1`, guestId);
    reservationId = r?.id ?? null;
  }
  if (!reservationId) return fail('NOT_FOUND', 'There is no reservation to build a template for.', 404);

  const assembled = await assembleConnectContact(env, reservationId, { mask: true });
  if (!assembled) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);

  return json({
    configured: isConnectConfigured(env),
    reservationId,
    name: assembled.name,
    phone: assembled.phone,
    attributes: assembled.attributes,
    missing: assembled.missing,
    fields: CONNECT_FIELD_KEYS,
    automations: connectAutomations(env.CONNECT_AUTOMATIONS),
  });
};
