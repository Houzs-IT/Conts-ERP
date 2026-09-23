import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { invalidRack, toRackPayload, type RackRow } from '../../_lib/racks';
import { strOrNull, flag, genId } from '../../_lib/scm-util';

const LIST_SQL = `
  SELECT r.id, r.warehouse_id, r.rack, r.position, r.status, r.reserved, r.notes, w.code AS warehouse_code, w.name AS warehouse_name
  FROM warehouse_racks r JOIN warehouses w ON w.id = r.warehouse_id`;

/** GET /api/racks?warehouseId=&status=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const warehouseId = url.searchParams.get('warehouseId');
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (warehouseId) { where.push('r.warehouse_id = ?'); args.push(warehouseId); }
  if (status === 'ACTIVE' || status === 'INACTIVE') { where.push('r.status = ?'); args.push(status); }
  if (search) { where.push('(lower(r.rack) LIKE ? OR lower(coalesce(r.position, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q); }
  const rows = await all<RackRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY w.name, r.rack`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toRackPayload) });
};

/** POST /api/racks — create a rack/bin. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit racks.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidRack(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const warehouseId = (b.warehouseId as string).trim();
  if (!await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', warehouseId)) return fail('VALIDATION', 'Unknown warehouse.', 422, { warehouseId: 'Unknown warehouse.' });
  const rack = (b.rack as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM warehouse_racks WHERE warehouse_id = ? AND lower(rack) = lower(?)', warehouseId, rack)) return fail('CONFLICT', 'That rack already exists in this warehouse.', 409, { rack: 'This rack code is already used here.' });
  const id = genId('rk');
  const now = nowIso();
  await run(env, `INSERT INTO warehouse_racks (id, warehouse_id, rack, position, status, reserved, notes, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, warehouseId, rack, strOrNull(b.position), b.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', flag(b.reserved) ?? 0, strOrNull(b.notes), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rack.create', entityTable: 'warehouse_racks', entityId: id, after: { warehouseId, rack } });
  return json({ id }, 201);
};
