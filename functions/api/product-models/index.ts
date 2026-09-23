import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isCategory, invalidModel, toModelPayload, strOrNull, flag, type ModelRow } from '../../_lib/product-models';

const COLS = 'id, model_code, name, category, branding, description, photo_url, allowed_options, active';

/** GET /api/product-models?category=&search=&active= — model master, ordered by category, code. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const search = (url.searchParams.get('search') ?? '').trim();
  const active = url.searchParams.get('active');

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isCategory(category)) { where.push('category = ?'); args.push(category); }
  if (active === '0' || active === '1') { where.push('active = ?'); args.push(Number(active)); }
  if (search) {
    where.push(`(lower(model_code) LIKE ? OR lower(name) LIKE ? OR lower(coalesce(branding, '')) LIKE ?)`);
    const q = `%${search.toLowerCase()}%`;
    args.push(q, q, q);
  }

  const rows = await all<ModelRow>(env, `SELECT ${COLS} FROM product_models WHERE ${where.join(' AND ')} ORDER BY category, model_code`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toModelPayload) });
};

/** POST /api/product-models — create a model. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can add product models.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidModel(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const modelCode = (b.modelCode as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM product_models WHERE lower(model_code) = lower(?)', modelCode)) {
    return fail('CONFLICT', 'A model with this code already exists.', 409, { modelCode: 'This code is already used.' });
  }

  const id = `pmdl-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = nowIso();
  await run(env, `
    INSERT INTO product_models (id, model_code, name, category, branding, description, photo_url, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, modelCode, (b.name as string).trim(), b.category as string,
    strOrNull(b.branding), strOrNull(b.description), strOrNull(b.photoUrl), flag(b.active) ?? 1, now, now);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product_model.create', entityTable: 'product_models', entityId: id, after: { modelCode, name: b.name, category: b.category } });
  return json({ id, modelCode }, 201);
};
