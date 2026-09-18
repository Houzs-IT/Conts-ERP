import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/** Uplift per channel over the base web rate. Direct is the reference because it
 *  carries no commission — that is also why it is marked in gold in the UI. */
const UPLIFT: Record<string, number> = {
  direct: 1, airbnb: 1.12, booking_com: 1.18, agoda: 1.16,
};
const WEEKEND = 1.22;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'Pricing is visible to finance, operations managers and management.', 403);
  }

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.base_rate, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.is_listed = 1 ORDER BY p.name, u.unit_number`);

  const integrations = await all<any>(env, 'SELECT provider, state FROM integrations');
  const syncOf = (ch: string) => {
    if (ch === 'direct') return { label: 'No commission', tone: 'neutral' };
    const i = integrations.find((x: any) => x.provider === ch);
    if (!i) return { label: 'Not connected', tone: 'neutral' };
    return i.state === 'connected'
      ? { label: 'Synced', tone: 'success' }
      : { label: i.state[0].toUpperCase() + i.state.slice(1), tone: 'critical' };
  };

  return json({
    generatedAt: new Date().toISOString(),
    weekendMultiplier: WEEKEND,
    units: units.map((u: any) => ({
      unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name,
      baseRate: u.base_rate,
      rates: Object.entries(UPLIFT).map(([ch, mult]) => ({
        channel: ch,
        weekday: Math.round(u.base_rate * mult),
        weekend: Math.round(u.base_rate * mult * WEEKEND),
        sync: syncOf(ch),
      })),
    })),
  });
};

/** PATCH /api/pricing { unitId, baseRate } — baseRate in integer sen. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Finance or management access is required.', 403);

  const { unitId, baseRate } = await request.json<{ unitId: string; baseRate: number }>();
  if (typeof baseRate !== 'number' || baseRate <= 0) {
    return fail('VALIDATION', 'Enter a nightly rate above RM 0.00.', 422, { baseRate: 'Enter a rate above RM 0.00.' });
  }

  const before = await all<any>(env, 'SELECT base_rate FROM units WHERE id = ?', unitId);
  await run(env, 'UPDATE units SET base_rate = ?, updated_at = ? WHERE id = ?', baseRate, nowIso(), unitId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'pricing.update',
    entityTable: 'units', entityId: unitId,
    before: { baseRate: before[0]?.base_rate }, after: { baseRate },
  });
  return json({ ok: true });
};
