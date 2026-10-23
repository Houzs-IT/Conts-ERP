import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { resolveUnit } from '../../_lib/ops';
import { checkSen, checkDate, invalid, type Fields } from '../../_lib/validate';

const CONDITIONS = ['good', 'fair', 'replace_soon', 'damaged'];
const CATEGORIES = ['furniture', 'appliance', 'electronics', 'linen', 'kitchenware', 'fittings'];
const WRITE_ROLES = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)

/** GET /api/inventory?unitId= — every item, with what it cost (finance roles only). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Inventory is visible to operations and finance roles.', 403);

  const unitId = new URL(request.url).searchParams.get('unitId');
  const rows = await all<any>(env, `
    SELECT i.*, u.unit_number, p.name AS property_name
    FROM inventory_items i
    JOIN units u ON u.id = i.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE 1 = 1 ${unitId ? 'AND i.unit_id = ?' : ''}
    ORDER BY p.name, u.unit_number, i.name`, ...(unitId ? [unitId] : []));

  const money = session.manage;
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      name: r.name, category: r.category, quantity: r.quantity, condition: r.condition,
      suppliedInHouse: !!r.supplied_in_house,
      installedOn: r.installed_on, lastChecked: r.last_checked, replaceBy: r.replace_by, notes: r.notes ?? '',
      purchaseCost: money ? r.purchase_cost : null,
    })),
  });
};

/** POST /api/inventory { unitNumber, propertyName, name, category, quantity, condition, purchaseCost, installedOn, replaceBy, notes } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, WRITE_ROLES)) return fail('FORBIDDEN', 'Only operations and management can add inventory.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.name?.trim()) return fail('VALIDATION', 'Enter the item name.', 422, { name: 'Enter the item name.' });
  if (b.category !== undefined && !CATEGORIES.includes(b.category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' });
  if (b.condition !== undefined && !CONDITIONS.includes(b.condition)) return fail('VALIDATION', 'Unknown condition.', 422);
  const fields: Fields = {};
  checkSen(fields, 'purchaseCost', b.purchaseCost, { label: 'Purchase value' });
  checkDate(fields, 'installedOn', b.installedOn, { label: 'Installed on' });
  checkDate(fields, 'replaceBy', b.replaceBy, { label: 'Replace by' });
  const bad = invalid(fields); if (bad) return bad;

  const unit = await resolveUnit(env, b.unitId ?? b.unitNumber, b.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422);
  if (!unit) return fail('NOT_FOUND', 'That unit is not in the system. Add it under Units first.', 404, { unitNumber: 'Add this unit under Units first.' });

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO inventory_items (id, unit_id, name, category, quantity, condition, supplied_in_house, purchase_cost, installed_on, last_checked, replace_by, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    id, unit.id, b.name.trim(), b.category ?? 'furniture', String(b.quantity ?? '1'), b.condition ?? 'good',
    b.purchaseCost ?? null, b.installedOn ?? null, mytToday(), b.replaceBy ?? null, String(b.notes ?? '').slice(0, 500), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'inventory.create', entityTable: 'inventory_items', entityId: id, after: { unitId: unit.id, name: b.name } });
  return json({ id }, 201);
};

/** PATCH /api/inventory { id, condition?, notes?, replaceBy?, quantity? } */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, WRITE_ROLES)) return fail('FORBIDDEN', 'Only operations and management can change inventory.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.id) return fail('VALIDATION', 'Say which item.', 422);
  if (b.condition !== undefined && !CONDITIONS.includes(b.condition)) return fail('VALIDATION', 'Unknown condition.', 422);
  const fields: Fields = {};
  checkDate(fields, 'replaceBy', b.replaceBy, { label: 'Replace by' });
  const bad = invalid(fields); if (bad) return bad;
  const cur = await one<any>(env, 'SELECT id, condition FROM inventory_items WHERE id = ?', b.id);
  if (!cur) return fail('NOT_FOUND', 'That item no longer exists.', 404);

  await run(env, `
    UPDATE inventory_items SET condition = COALESCE(?, condition), notes = COALESCE(?, notes), replace_by = COALESCE(?, replace_by),
                               quantity = COALESCE(?, quantity), last_checked = ? WHERE id = ?`,
    b.condition ?? null, typeof b.notes === 'string' ? b.notes.slice(0, 500) : null, b.replaceBy ?? null, b.quantity ?? null, mytToday(), b.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: b.condition ? 'inventory.condition_change' : 'inventory.update', entityTable: 'inventory_items', entityId: b.id, before: { condition: cur.condition }, after: { condition: b.condition ?? cur.condition } });
  return json({ ok: true });
};
