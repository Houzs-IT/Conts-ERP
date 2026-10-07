import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidResRule, toResRulePayload, type ResRuleRow } from '../../_lib/residence-rules';
import { strOrNull, intOrNull, flag, genId } from '../../_lib/scm-util';

const COLS = 'id, building_type, service_duration_minutes, earliest_delivery_time, latest_delivery_time, requires_lift_booking, requires_registration, notes, is_active';

/** GET /api/residence-rules?active=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const active = url.searchParams.get('active');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (active === '1' || active === '0') { where.push('is_active = ?'); args.push(Number(active)); }
  if (search) { where.push('lower(building_type) LIKE ?'); args.push(`%${search.toLowerCase()}%`); }
  const rows = await all<ResRuleRow>(env, `SELECT ${COLS} FROM delivery_residence_rules WHERE ${where.join(' AND ')} ORDER BY building_type`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toResRulePayload) });
};

/** POST /api/residence-rules — create a per-building-type rule. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit residence rules.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidResRule(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const buildingType = (b.buildingType as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM delivery_residence_rules WHERE lower(building_type) = lower(?)', buildingType)) return fail('CONFLICT', 'A rule for that building type already exists.', 409, { buildingType: 'This building type already has a rule.' });
  const id = genId('rr');
  const now = nowIso();
  await run(env, `INSERT INTO delivery_residence_rules (id, building_type, service_duration_minutes, earliest_delivery_time, latest_delivery_time, requires_lift_booking, requires_registration, notes, is_active, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, buildingType, Math.max(0, intOrNull(b.serviceDurationMinutes) ?? 0), strOrNull(b.earliestDeliveryTime), strOrNull(b.latestDeliveryTime),
    flag(b.requiresLiftBooking) ?? 0, flag(b.requiresRegistration) ?? 0, strOrNull(b.notes), flag(b.isActive) ?? 1, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'residence_rule.create', entityTable: 'delivery_residence_rules', entityId: id, after: { buildingType } });
  return json({ id }, 201);
};
