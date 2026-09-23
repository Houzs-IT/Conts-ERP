import { type Env, all, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { DEFAULT_ZONE_PREFIX_MAP, ZONES, invalidZone, toZonePayload, type ZoneRow } from '../../_lib/delivery-zones';
import { strOrNull, flag, genId } from '../../_lib/scm-util';

const COLS = 'id, zone, prefix_start, prefix_end, label, is_active';

/** GET /api/delivery-zones — the company map + whether the in-code default is in force. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<ZoneRow>(env, `SELECT ${COLS} FROM delivery_zone_postcodes ORDER BY prefix_start`);
  const active = rows.filter(r => r.is_active === 1);
  return json({
    generatedAt: nowIso(),
    data: rows.map(toZonePayload),
    usingDefault: active.length === 0,
    defaultMap: DEFAULT_ZONE_PREFIX_MAP,
    knownZones: [...ZONES],
  });
};

/** POST /api/delivery-zones — add one prefix rule, or seed the default map with {loadDefault:true}. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit the zone map.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.loadDefault === true) {
    const existing = await all<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM delivery_zone_postcodes');
    if ((existing[0]?.n ?? 0) > 0) return fail('CONFLICT', 'The map already has rules — clear them before loading the default.', 409);
    for (const r of DEFAULT_ZONE_PREFIX_MAP) {
      await run(env, 'INSERT INTO delivery_zone_postcodes (id, zone, prefix_start, prefix_end, label, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        genId('dz'), r.zone, r.prefixStart, r.prefixEnd, null, now, now);
    }
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_zone.load_default', entityTable: 'delivery_zone_postcodes', entityId: 'default', after: { count: DEFAULT_ZONE_PREFIX_MAP.length } });
    return json({ loaded: DEFAULT_ZONE_PREFIX_MAP.length }, 201);
  }

  const bad = invalidZone(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const id = genId('dz');
  await run(env, 'INSERT INTO delivery_zone_postcodes (id, zone, prefix_start, prefix_end, label, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, (b.zone as string).trim(), Number(b.prefixStart), Number(b.prefixEnd), strOrNull(b.label), flag(b.isActive) ?? 1, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_zone.create', entityTable: 'delivery_zone_postcodes', entityId: id, after: { zone: b.zone, prefixStart: b.prefixStart, prefixEnd: b.prefixEnd } });
  return json({ id }, 201);
};
