import { type Env, all, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { channexConfigured } from '../../../_lib/channex';
import { queueFullSync, flushChannexQueue } from '../../../_lib/channexQueue';
import { ensureOtaRatePlans } from '../../../_lib/channexSync';

/** POST /api/integrations/channex/full-sync — resends 500 days of availability, prices and restrictions
 *  for every linked unit, as two calls. Used when going live and to recover after an outage. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can send everything again.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'Channex is not connected on this environment yet.', 501);

  // A night without its own price is sent at the unit's base price, and Channex discards a zero price,
  // which would leave the prices covering fewer days than the availability.
  const unpriced = await all<{ unit_number: string }>(env, 'SELECT unit_number FROM units WHERE channex_property_id IS NOT NULL AND base_rate <= 0 ORDER BY unit_number');
  if (unpriced.length) return fail('NO_BASE_PRICE', `Set a nightly price first for: ${unpriced.map(u => u.unit_number).join(', ')} (Performance, then Pricing). Nothing was sent.`, 409);

  // Units linked before per-channel prices existed get their Airbnb / Booking.com / Agoda rate plans here.
  const linked = await all<{ id: string }>(env, 'SELECT id FROM units WHERE channex_property_id IS NOT NULL');
  try { for (const u of linked) await ensureOtaRatePlans(env, u.id); }
  catch (e) { return fail('CHANNEX_REFUSED', `${e instanceof Error ? e.message : 'Channex refused a rate plan'}. Nothing was sent.`, 502); }

  const { units } = await queueFullSync(env);
  if (!units) return fail('NOTHING_LINKED', 'No unit is set up in Channex yet. Set a unit up from its Channels card first.', 409);
  const sent = await flushChannexQueue(env, { fullSync: true });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channex.full_sync', entityTable: 'integrations', entityId: 'channex', after: { units, sent } });
  return json({ units, sent });
};
