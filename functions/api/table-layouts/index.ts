import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { seedCompanyViews } from '../../_lib/tableLayoutSeeds';
import { TABLE_KEY, cleanLayout, cleanName, mayShare, mayUseViews, toView, type ViewRow } from '../../_lib/tableLayouts';

const COLS = 'id, table_key, user_id, name, is_default, layout, created_by, updated_at';

/** GET /api/table-layouts?table=bookings — the signed-in person's own views of that table and the company's,
 *  each list default first then by name; `canShare` says whether this person may save company views. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseViews(session.role)) return fail('FORBIDDEN', 'Saved views are not available on this account.', 403);
  const table = new URL(request.url).searchParams.get('table') ?? '';
  if (!TABLE_KEY.test(table)) return fail('VALIDATION', 'Say which table.', 422);
  // A missing seed must never stop someone's own views from loading.
  await seedCompanyViews(env, table).catch(() => {});
  const rows = await all<ViewRow>(env, `SELECT ${COLS} FROM table_layouts WHERE table_key = ? AND (user_id = ? OR user_id IS NULL)
    ORDER BY is_default DESC, lower(name)`, table, session.userId);
  const views = rows.map(r => toView(r, session.userId));
  return json({
    table, canShare: mayShare(session.role),
    mine: views.filter(v => v.scope === 'mine'), company: views.filter(v => v.scope === 'company'),
  });
};

/** POST /api/table-layouts { table, name, layout, scope: 'mine' | 'company', isDefault }
 *  Saving under a name that already exists in that scope replaces that view's layout (same id). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseViews(session.role)) return fail('FORBIDDEN', 'Saved views are not available on this account.', 403);
  const b = await request.json<any>().catch(() => null);
  const table = String(b?.table ?? '');
  if (!TABLE_KEY.test(table)) return fail('VALIDATION', 'Say which table.', 422);
  const name = cleanName(b?.name);
  if (!name || name.length > 80) return fail('VALIDATION', 'Give the view a name of up to 80 characters.', 422, { name: 'Give the view a name of up to 80 characters.' });
  const layout = cleanLayout(b?.layout);
  if (typeof layout === 'string') return fail('VALIDATION', layout, 422);
  const company = b?.scope === 'company';
  if (company && !mayShare(session.role)) return fail('FORBIDDEN', 'Only management can save views for the whole company.', 403);
  const owner = company ? null : session.userId;
  const isDefault = !!b?.isDefault;

  const count = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM table_layouts WHERE table_key = ? AND user_id IS NOT DISTINCT FROM ?`, table, owner);
  const existing = await one<ViewRow>(env, `SELECT ${COLS} FROM table_layouts WHERE table_key = ? AND user_id IS NOT DISTINCT FROM ? AND lower(btrim(name)) = lower(?)`, table, owner, name);
  if (!existing && Number(count?.n ?? 0) >= 50) return fail('LIMIT', 'There are already 50 saved views of this table here. Delete one first.', 422);

  const now = nowIso();
  if (isDefault) await run(env, `UPDATE table_layouts SET is_default = false, updated_at = ? WHERE table_key = ? AND user_id IS NOT DISTINCT FROM ? AND is_default`, now, table, owner);
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await run(env, `UPDATE table_layouts SET layout = ?::text::jsonb, name = ?, is_default = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(layout), name, isDefault, now, id);
  } else {
    await run(env, `INSERT INTO table_layouts (id, table_key, user_id, name, is_default, layout, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?::text::jsonb, ?, ?, ?)`, id, table, owner, name, isDefault, JSON.stringify(layout), session.userId, now, now);
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: existing ? 'table_view.update' : 'table_view.create',
    entityTable: 'table_layouts', entityId: id,
    before: existing ? { name: existing.name, isDefault: existing.is_default, layout: existing.layout } : undefined,
    after: { table, name, scope: company ? 'company' : 'mine', isDefault, layout },
  });
  const row = await one<ViewRow>(env, `SELECT ${COLS} FROM table_layouts WHERE id = ?`, id);
  return json(toView(row!, session.userId), existing ? 200 : 201);
};
