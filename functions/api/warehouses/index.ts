import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { invalidWarehouse, toWarehousePayload, type WarehouseRow } from '../../_lib/warehouses';
import { strOrNull, flag, genId } from '../../_lib/scm-util';

const COLS = 'id, code, name, location, is_active, is_default';

/** GET /api/warehouses — warehouse master, default first then by name. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<WarehouseRow>(env, `SELECT ${COLS} FROM warehouses ORDER BY is_default DESC, name`);
  return json({ generatedAt: nowIso(), data: rows.map(toWarehousePayload) });
};

/** POST /api/warehouses — create a warehouse. Setting it default clears any other default. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can add warehouses.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidWarehouse(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const code = (b.code as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM warehouses WHERE lower(code) = lower(?)', code)) {
    return fail('CONFLICT', 'A warehouse with this code already exists.', 409, { code: 'This code is already used.' });
  }

  const isDefault = flag(b.isDefault) ?? 0;
  if (isDefault === 1) await run(env, 'UPDATE warehouses SET is_default = 0, updated_at = ?', nowIso());

  const id = genId('wh');
  const now = nowIso();
  await run(env, `INSERT INTO warehouses (id, code, name, location, is_active, is_default, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, code, (b.name as string).trim(), strOrNull(b.location), flag(b.isActive) ?? 1, isDefault, now, now);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'warehouse.create', entityTable: 'warehouses', entityId: id, after: { code, name: b.name } });
  return json({ id, code }, 201);
};
