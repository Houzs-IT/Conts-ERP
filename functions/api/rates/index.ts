import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const rateChannel = (c: string) => (c === 'direct' ? 'web' : c);

/** PUT /api/rates { unitId, channel, date, rate } — one night, one channel. rate is integer sen. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  const channel = rateChannel(String(b?.channel ?? ''));
  if (!b?.unitId || !b.date || !CHANNELS.includes(channel)) return fail('VALIDATION', 'Unit, channel and date are required.', 422);
  if (!Number.isInteger(b.rate) || b.rate < 0) return fail('VALIDATION', 'The rate must be a whole number of sen.', 422, { rate: 'Enter a valid rate.' });

  await run(env, `
    INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
    b.unitId, channel, b.date, b.rate, nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate.set', entityTable: 'units', entityId: b.unitId, after: { channel, date: b.date, rate: b.rate } });
  return json({ ok: true });
};
