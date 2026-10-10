import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isCategory, strOrNull, intOrNull } from '../../_lib/products';
import { checkSen, checkInt, invalid, type Fields } from '../../_lib/validate';

/** PATCH /api/products/:id — edit a product. Only the fields present in the body change. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit products.', 403);

  const id = String(params.id);
  const cur = await one<{ id: string }>(env, 'SELECT id FROM products WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That product does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkInt(fields, 'unitM3Milli', b.unitM3Milli, { label: 'Unit (m³)', min: 0 });
  checkSen(fields, 'costPriceSen', b.costPriceSen, { label: 'Cost price' });
  checkSen(fields, 'basePriceSen', b.basePriceSen, { label: 'Base price' });
  checkSen(fields, 'price1Sen', b.price1Sen, { label: 'Price 1' });
  checkSen(fields, 'sellPriceSen', b.sellPriceSen, { label: 'Sell price' });
  const bad = invalid(fields); if (bad) return bad;
  const sets: string[] = [];
  const args: unknown[] = [];
  const setStr = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(strOrNull(v)); } };
  const setInt = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(intOrNull(v)); } };

  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' });
    sets.push('name = ?'); args.push(name);
  }
  if (b.category !== undefined) {
    if (!isCategory(b.category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' });
    sets.push('category = ?'); args.push(b.category);
  }
  if (b.status !== undefined) {
    if (b.status !== 'ACTIVE' && b.status !== 'INACTIVE') return fail('VALIDATION', 'Unknown status.', 422);
    sets.push('status = ?'); args.push(b.status);
  }
  if (b.code !== undefined) {
    const code = String(b.code).trim();
    if (!code) return fail('VALIDATION', 'Enter a product code.', 422, { code: 'Enter a product code.' });
    if (await one(env, 'SELECT 1 AS x FROM products WHERE lower(code) = lower(?) AND id <> ?', code, id)) {
      return fail('CONFLICT', 'A product with this code already exists.', 409, { code: 'This code is already used.' });
    }
    sets.push('code = ?'); args.push(code);
  }
  setStr('description', b.description);
  setStr('base_model', b.baseModel);
  setStr('size_code', b.sizeCode);
  setStr('size_label', b.sizeLabel);
  setStr('branding', b.branding);
  setStr('barcode', b.barcode);
  setInt('unit_m3_milli', b.unitM3Milli);
  setInt('cost_price_sen', b.costPriceSen);
  setInt('base_price_sen', b.basePriceSen);
  setInt('price1_sen', b.price1Sen);
  setInt('sell_price_sen', b.sellPriceSen);

  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);
  await run(env, `UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product.update', entityTable: 'products', entityId: id, after: b });
  return json({ id });
};

/** DELETE /api/products/:id — remove a product. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete products.', 403);

  const id = String(params.id);
  const cur = await one<{ code: string }>(env, 'SELECT code FROM products WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That product does not exist.', 404);

  await run(env, 'DELETE FROM products WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product.delete', entityTable: 'products', entityId: id, before: { code: cur.code } });
  return new Response(null, { status: 204 });
};
