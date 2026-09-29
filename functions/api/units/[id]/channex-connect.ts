import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';
import { channexConfigured, channexOneTimeToken, channexChannelScreenUrl } from '../../../_lib/channex';

/** POST /api/units/:id/channex-connect — a one-time link to Channex's channel screen for this unit, where
 *  staff connect Airbnb, Booking.com or Agoda with their own OTA sign-in. The link is used once and expires. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change channel connections.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501);

  const id = String(params.id);
  const u = await one<{ channex_property_id: string | null }>(env, 'SELECT channex_property_id FROM units WHERE id = ?', id);
  if (!u) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  if (!u.channex_property_id) return fail('NOT_LINKED', 'Set this unit up in Channex first.', 409);

  const t = await channexOneTimeToken(env, { propertyId: u.channex_property_id, username: session.email });
  const token = t.body?.data?.token;
  if (!t.ok || !token) return fail('CHANNEX_REFUSED', `Channex did not open the channel screen (${t.status}). Try again in a moment.`, 502);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.channex_channels_opened', entityTable: 'units', entityId: id });
  return json({ url: channexChannelScreenUrl(env, { token, propertyId: u.channex_property_id }) });
};
