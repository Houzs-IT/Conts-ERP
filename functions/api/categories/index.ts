import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidCategory, toCategoryPayload, type CategoryRow } from '../../_lib/categories';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';

const COLS = 'id, label, icon, tbc, hero_image_key, sort_order';

/** GET /api/categories — category display list, ordered by sort_order. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<CategoryRow>(env, `SELECT ${COLS} FROM product_categories ORDER BY sort_order, label`);
  return json({ generatedAt: nowIso(), data: rows.map(toCategoryPayload) });
};

/** POST /api/categories — create a category (id is an operator-set slug). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add categories.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidCategory(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const id = (b.id as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM product_categories WHERE lower(id) = lower(?)', id)) {
    return fail('CONFLICT', 'A category with this id already exists.', 409, { id: 'This id is already used.' });
  }

  const now = nowIso();
  await run(env, `INSERT INTO product_categories (id, label, icon, tbc, hero_image_key, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, (b.label as string).trim(), (b.icon as string).trim(), flag(b.tbc) ?? 0, strOrNull(b.heroImageKey), intOrNull(b.sortOrder) ?? 0, now, now);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'category.create', entityTable: 'product_categories', entityId: id, after: { label: b.label } });
  return json({ id }, 201);
};
