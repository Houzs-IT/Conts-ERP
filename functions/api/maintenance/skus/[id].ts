import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

const CATEGORIES = ['plumbing', 'electrical', 'aircon', 'furniture', 'appliance', 'cleaning', 'general', 'other'];
const UNIT_LABELS = ['job', 'unit', 'hour'];
const WRITE_ROLES = ['management', 'operations_manager', 'operations_staff'];

/** PATCH /api/maintenance/skus/:id { name?, category?, unitLabel?, defaultPrice?, active?, notes? }
 *  Edit a catalog item or retire it (active:false). Retiring keeps the history on past jobs. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!WRITE_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only operations and management can change the catalog.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (b?.category !== undefined && !CATEGORIES.includes(b.category)) return fail('VALIDATION', 'Pick a category.', 422);
  if (b?.unitLabel !== undefined && !UNIT_LABELS.includes(b.unitLabel)) return fail('VALIDATION', 'Pick what the price is per.', 422);
  if (b?.defaultPrice != null && (!Number.isInteger(b.defaultPrice) || b.defaultPrice < 0)) return fail('VALIDATION', 'The price must be a whole number of sen.', 422, { defaultPrice: 'Enter a price.' });

  const cur = await one<any>(env, 'SELECT id, active, default_price FROM maintenance_skus WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That catalog item no longer exists.', 404);

  await run(env, `
    UPDATE maintenance_skus SET
      name          = COALESCE(?, name),
      category      = COALESCE(?, category),
      unit_label    = COALESCE(?, unit_label),
      default_price = COALESCE(?, default_price),
      active        = COALESCE(?, active),
      notes         = COALESCE(?, notes),
      updated_at    = ?
    WHERE id = ?`,
    typeof b?.name === 'string' ? b.name.trim().slice(0, 120) : null,
    b?.category ?? null,
    b?.unitLabel ?? null,
    b?.defaultPrice ?? null,
    typeof b?.active === 'boolean' ? (b.active ? 1 : 0) : null,
    typeof b?.notes === 'string' ? b.notes.slice(0, 500) : null,
    nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance_sku.update', entityTable: 'maintenance_skus', entityId: id, before: { active: !!cur.active, defaultPrice: cur.default_price }, after: { active: b?.active ?? !!cur.active, defaultPrice: b?.defaultPrice ?? cur.default_price } });
  return json({ ok: true });
};
