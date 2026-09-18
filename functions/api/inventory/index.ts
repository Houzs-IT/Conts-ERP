import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  const rows = await all(env, `
    SELECT i.*, u.unit_number, p.name AS property_name
    FROM inventory_items i
    JOIN units u ON u.id = i.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE 1 = 1 ${unitId ? 'AND i.unit_id = ?' : ''}
    ORDER BY p.name, u.unit_number, i.name`, ...(unitId ? [unitId] : []));

  const money = canSeeFinance(session.role);
  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map((r: any) => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      name: r.name, quantity: r.quantity, condition: r.condition,
      suppliedInHouse: !!r.supplied_in_house,
      installedOn: r.installed_on, lastChecked: r.last_checked,
      ...(money ? { purchaseCost: r.purchase_cost } : {}),
    })),
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const { id, condition } = await request.json<{ id: string; condition: string }>();
  const allowed = ['good', 'fair', 'replace_soon', 'damaged'];
  if (!allowed.includes(condition)) return fail('VALIDATION', 'Unknown condition.', 422);

  await run(env, 'UPDATE inventory_items SET condition = ?, last_checked = ? WHERE id = ?',
    condition, nowIso().slice(0, 10), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'inventory.condition_change',
    entityTable: 'inventory_items', entityId: id, after: { condition },
  });
  return json({ ok: true });
};
