import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';

/** PATCH /api/categories/:id — id is immutable; label/icon/tbc/hero/sort change. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit categories.', 403);

  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM product_categories WHERE id = ?', id)) return fail('NOT_FOUND', 'That category does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = [];
  const args: unknown[] = [];
  if (b.label !== undefined) { const l = String(b.label).trim(); if (!l) return fail('VALIDATION', 'Enter a label.', 422, { label: 'Enter a label.' }); sets.push('label = ?'); args.push(l); }
  if (b.icon !== undefined) { const i = String(b.icon).trim(); if (!i) return fail('VALIDATION', 'Enter an icon name.', 422, { icon: 'Enter an icon name.' }); sets.push('icon = ?'); args.push(i); }
  if (b.tbc !== undefined) { sets.push('tbc = ?'); args.push(flag(b.tbc) ?? 0); }
  if (b.heroImageKey !== undefined) { sets.push('hero_image_key = ?'); args.push(strOrNull(b.heroImageKey)); }
  if (b.sortOrder !== undefined) { sets.push('sort_order = ?'); args.push(intOrNull(b.sortOrder) ?? 0); }

  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);
  await run(env, `UPDATE product_categories SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'category.update', entityTable: 'product_categories', entityId: id, after: b });
  return json({ id });
};

/** DELETE /api/categories/:id */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete categories.', 403);

  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM product_categories WHERE id = ?', id)) return fail('NOT_FOUND', 'That category does not exist.', 404);
  await run(env, 'DELETE FROM product_categories WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'category.delete', entityTable: 'product_categories', entityId: id });
  return new Response(null, { status: 204 });
};
