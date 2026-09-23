import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { invalidProduct, isCategory, toProductPayload, strOrNull, intOrNull, type ProductRow } from '../../_lib/products';

const SELECT = `SELECT id, code, name, category, description, base_model, size_code, size_label, branding, barcode,
                       unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, sell_price_sen
                FROM products`;

/** GET /api/products?category=&search=&status= — the product master, browsed by category. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const search = (url.searchParams.get('search') ?? '').trim();
  const status = url.searchParams.get('status');

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isCategory(category)) { where.push('category = ?'); args.push(category); }
  if (status === 'ACTIVE' || status === 'INACTIVE') { where.push('status = ?'); args.push(status); }
  if (search) {
    where.push(`(lower(code) LIKE ? OR lower(name) LIKE ? OR lower(coalesce(description, '')) LIKE ? OR coalesce(barcode, '') LIKE ?)`);
    const q = `%${search.toLowerCase()}%`;
    args.push(q, q, q, `%${search}%`);
  }

  const rows = await all<ProductRow>(env, `${SELECT} WHERE ${where.join(' AND ')} ORDER BY category, code`, ...args);
  const canCost = canSeeFinance(session.role);
  return json({ generatedAt: nowIso(), data: rows.map(r => toProductPayload(r, canCost)) });
};

/** POST /api/products { code, name, category, description?, baseModel?, sizeLabel?, branding?, barcode?, unitM3Milli?, basePriceSen?, price1Sen?, sellPriceSen?, costPriceSen? } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can add products.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidProduct(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const code = (b.code as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM products WHERE lower(code) = lower(?)', code)) {
    return fail('CONFLICT', 'A product with this code already exists.', 409, { code: 'This code is already used.' });
  }

  const id = `prod-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = nowIso();
  const category = b.category as string;
  // Price 1 does not apply to a mattress (single price) or a service line.
  const price1 = category === 'MATTRESS' || category === 'SERVICE' ? null : intOrNull(b.price1Sen);
  const basePrice = intOrNull(b.basePriceSen);

  await run(env, `
    INSERT INTO products (id, code, name, category, description, base_model, size_code, size_label, branding, barcode,
      unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, sell_price_sen, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
    id, code, (b.name as string).trim(), category,
    strOrNull(b.description), strOrNull(b.baseModel), strOrNull(b.sizeCode), strOrNull(b.sizeLabel), strOrNull(b.branding), strOrNull(b.barcode),
    intOrNull(b.unitM3Milli) ?? 0, intOrNull(b.costPriceSen) ?? 0, basePrice, price1, intOrNull(b.sellPriceSen) ?? basePrice, now, now);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product.create', entityTable: 'products', entityId: id, after: { code, name: b.name, category } });
  return json({ id, code }, 201);
};
