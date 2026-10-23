import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, type Session } from '../../_lib/auth';
import { cleanLayout, cleanName, mayShare, mayUseViews, toView, type ViewRow } from '../../_lib/tableLayouts';

const COLS = 'id, table_key, user_id, name, is_default, layout, created_by, updated_at';

/** A person changes only their own views; company views need a management role. */
async function load(env: Env, id: string, userId: string, who: Session): Promise<ViewRow | Response> {
  const row = await one<ViewRow>(env, `SELECT ${COLS} FROM table_layouts WHERE id = ?`, id);
  if (!row || (row.user_id && row.user_id !== userId)) return fail('NOT_FOUND', 'That view no longer exists.', 404);
  if (!row.user_id && !mayShare(who)) return fail('FORBIDDEN', 'Only management can change company views.', 403);
  return row;
}

/** PATCH /api/table-layouts/:id { name?, layout?, isDefault? } */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseViews(session.role)) return fail('FORBIDDEN', 'Saved views are not available on this account.', 403);
  const row = await load(env, String(params.id), session.userId, session);
  if (row instanceof Response) return row;
  const b = await request.json<any>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to change.', 422);

  const sets: string[] = [];
  const args: unknown[] = [];
  const after: Record<string, unknown> = {};
  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name || name.length > 80) return fail('VALIDATION', 'Give the view a name of up to 80 characters.', 422, { name: 'Give the view a name of up to 80 characters.' });
    const clash = await one(env, `SELECT 1 AS x FROM table_layouts WHERE table_key = ? AND user_id IS NOT DISTINCT FROM ? AND lower(btrim(name)) = lower(?) AND id <> ?`,
      row.table_key, row.user_id, name, row.id);
    if (clash) return fail('CONFLICT', 'Another view here already has that name.', 409, { name: 'Another view here already has that name.' });
    sets.push('name = ?'); args.push(name); after.name = name;
  }
  if (b.layout !== undefined) {
    const layout = cleanLayout(b.layout);
    if (typeof layout === 'string') return fail('VALIDATION', layout, 422);
    sets.push('layout = ?::text::jsonb'); args.push(JSON.stringify(layout)); after.layout = layout;
  }
  const now = nowIso();
  if (b.isDefault !== undefined) {
    const on = !!b.isDefault;
    if (on) await run(env, `UPDATE table_layouts SET is_default = false, updated_at = ? WHERE table_key = ? AND user_id IS NOT DISTINCT FROM ? AND is_default AND id <> ?`, now, row.table_key, row.user_id, row.id);
    sets.push('is_default = ?'); args.push(on); after.isDefault = on;
  }
  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);
  await run(env, `UPDATE table_layouts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, now, row.id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'table_view.update', entityTable: 'table_layouts', entityId: row.id,
    before: { name: row.name, isDefault: row.is_default, ...(b.layout !== undefined ? { layout: row.layout } : {}) }, after,
  });
  const fresh = await one<ViewRow>(env, `SELECT ${COLS} FROM table_layouts WHERE id = ?`, row.id);
  return json(toView(fresh!, session.userId));
};

/** DELETE /api/table-layouts/:id — a saved view is only a preference; nothing else depends on it. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseViews(session.role)) return fail('FORBIDDEN', 'Saved views are not available on this account.', 403);
  const row = await load(env, String(params.id), session.userId, session);
  if (row instanceof Response) return row;
  await run(env, 'DELETE FROM table_layouts WHERE id = ?', row.id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'table_view.delete', entityTable: 'table_layouts', entityId: row.id,
    before: { table: row.table_key, name: row.name, scope: row.user_id ? 'mine' : 'company', isDefault: row.is_default, layout: row.layout },
  });
  return json({ deleted: true, id: row.id });
};
