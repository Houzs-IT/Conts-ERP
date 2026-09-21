import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];

/** POST /api/rates/bulk { unitIds, channels, from, to, baseRate } — the same price for every night from..to inclusive. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  const channels: string[] = Array.isArray(b?.channels) ? b.channels.map((c: string) => (c === 'direct' ? 'web' : c)) : [];
  if (!Array.isArray(b?.unitIds) || !b.unitIds.length || !channels.length || channels.some(c => !CHANNELS.includes(c))) return fail('VALIDATION', 'Pick at least one unit and one channel.', 422);
  if (!b.from || !b.to || b.to < b.from) return fail('VALIDATION', 'Pick a valid date range.', 422);
  if (!Number.isInteger(b.baseRate) || b.baseRate < 0) return fail('VALIDATION', 'The rate must be a whole number of sen.', 422, { baseRate: 'Enter a valid rate.' });

  const days: string[] = [];
  for (let t = Date.parse(b.from); t <= Date.parse(b.to) && days.length < 366; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));

  const now = nowIso();
  let written = 0;
  for (const unitId of b.unitIds) for (const channel of channels) for (const date of days) {
    await run(env, `
      INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
      unitId, channel, date, b.baseRate, now);
    written++;
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate.bulk', entityTable: 'units', entityId: 'bulk', after: { units: b.unitIds.length, channels, from: b.from, to: b.to, rate: b.baseRate } });
  return json({ ok: true, written });
};
