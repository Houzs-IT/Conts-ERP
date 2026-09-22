import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isCategory, strOrNull, intOrNull } from '../../_lib/products';

/** POST /api/products/batch-import { rows: [...] } — upsert products by code.
 *  Data-loss-safe: on an update only the cells that are present are written, so a
 *  blank column never zeroes an existing value. Mirrors Houzs's batch-import. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can import products.', 403);

  const b = await request.json<{ rows?: unknown }>().catch(() => null);
  const rows = Array.isArray(b?.rows) ? (b!.rows as Record<string, unknown>[]) : [];
  if (!rows.length) return fail('VALIDATION', 'There are no rows to import.', 422);
  if (rows.length > 500) return fail('VALIDATION', 'Import up to 500 rows at a time.', 422);

  const now = nowIso();
  let upserted = 0;
  const failures: { code: string; reason: string }[] = [];

  for (const r of rows) {
    const code = String(r.code ?? '').trim();
    const name = String(r.name ?? '').trim();
    const category = String(r.category ?? '').trim().toUpperCase();
    if (!code) { failures.push({ code: '(blank)', reason: 'Missing code.' }); continue; }
    if (!name || !isCategory(category)) { failures.push({ code, reason: 'Needs a name and a valid category.' }); continue; }

    const cells: Record<string, unknown> = {
      name, category,
      description: strOrNull(r.description),
      base_model: strOrNull(r.base_model ?? r.baseModel),
      size_label: strOrNull(r.size_label ?? r.sizeLabel),
      branding: strOrNull(r.branding),
      barcode: strOrNull(r.barcode),
      unit_m3_milli: intOrNull(r.unit_m3_milli ?? r.unitM3Milli),
      cost_price_sen: intOrNull(r.cost_price_sen ?? r.costPriceSen),
      base_price_sen: intOrNull(r.base_price_sen ?? r.basePriceSen),
      price1_sen: intOrNull(r.price1_sen ?? r.price1Sen),
      sell_price_sen: intOrNull(r.sell_price_sen ?? r.sellPriceSen),
    };

    const existing = await one<{ id: string }>(env, 'SELECT id FROM products WHERE lower(code) = lower(?)', code);
    if (existing) {
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [col, v] of Object.entries(cells)) {
        if (v !== null && v !== undefined) { sets.push(`${col} = ?`); args.push(v); }
      }
      sets.push('updated_at = ?'); args.push(now);
      args.push(existing.id);
      await run(env, `UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...args);
    } else {
      const id = `prod-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await run(env, `
        INSERT INTO products (id, code, name, category, description, base_model, size_label, branding, barcode,
          unit_m3_milli, status, cost_price_sen, base_price_sen, price1_sen, sell_price_sen, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
        id, code, name, category, cells.description, cells.base_model, cells.size_label, cells.branding, cells.barcode,
        cells.unit_m3_milli ?? 0, cells.cost_price_sen ?? 0, cells.base_price_sen, cells.price1_sen, cells.sell_price_sen, now, now);
    }
    upserted++;
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'product.import', entityTable: 'products', entityId: 'batch', after: { upserted, failed: failures.length } });
  return json({ upserted, failed: failures.length, failures });
};
