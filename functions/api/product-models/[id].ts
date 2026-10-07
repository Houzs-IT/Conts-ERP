import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isCategory, toModelPayload, strOrNull, flag, type ModelRow } from '../../_lib/product-models';

const COLS = 'id, model_code, name, category, branding, description, photo_url, allowed_options, active';

/** GET /api/product-models/:id */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const row = await one<ModelRow>(env, `SELECT ${COLS} FROM product_models WHERE id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That model does not exist.', 404);
  return json({ data: toModelPayload(row) });
};

/** PATCH /api/product-models/:id — only fields present in the body change. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit product models.', 403);

  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM product_models WHERE id = ?', id)) return fail('NOT_FOUND', 'That model does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = [];
  const args: unknown[] = [];

  if (b.name !== undefined) { const name = String(b.name).trim(); if (!name) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' }); sets.push('name = ?'); args.push(name); }
  if (b.category !== undefined) { if (!isCategory(b.category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' }); sets.push('category = ?'); args.push(b.category); }
  if (b.modelCode !== undefined) {
    const code = String(b.modelCode).trim();
    if (!code) return fail('VALIDATION', 'Enter a model code.', 422, { modelCode: 'Enter a model code.' });
    if (await one(env, 'SELECT 1 AS x FROM product_models WHERE lower(model_code) = lower(?) AND id <> ?', code, id)) {
      return fail('CONFLICT', 'A model with this code already exists.', 409, { modelCode: 'This code is already used.' });
    }
    sets.push('model_code = ?'); args.push(code);
  }
  if (b.branding !== undefined) { sets.push('branding = ?'); args.push(strOrNull(b.branding)); }
  if (b.description !== undefined) { sets.push('description = ?'); args.push(strOrNull(b.description)); }
  if (b.photoUrl !== undefined) { sets.push('photo_url = ?'); args.push(strOrNull(b.photoUrl)); }
  if (b.active !== undefined) { sets.push('active = ?'); args.push(flag(b.active) ?? 1); }

  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);
  await run(env, `UPDATE product_models SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product_model.update', entityTable: 'product_models', entityId: id, after: b });
  return json({ id });
};

/** DELETE /api/product-models/:id */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete product models.', 403);

  const id = String(params.id);
  const cur = await one<{ model_code: string }>(env, 'SELECT model_code FROM product_models WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That model does not exist.', 404);
  await run(env, 'DELETE FROM product_models WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product_model.delete', entityTable: 'product_models', entityId: id, before: { modelCode: cur.model_code } });
  return new Response(null, { status: 204 });
};
