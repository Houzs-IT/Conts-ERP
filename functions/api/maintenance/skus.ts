import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

const CATEGORIES = ['plumbing', 'electrical', 'aircon', 'furniture', 'appliance', 'cleaning', 'general', 'other'];
const UNIT_LABELS = ['job', 'unit', 'hour'];
// Who may maintain the catalog. Same set as inventory master data.
const WRITE_ROLES = ['management', 'operations_manager', 'operations_staff'];

/** GET /api/maintenance/skus?q=&active= — the repair-item catalog with its preset selling price. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The maintenance catalog is visible to operations and finance roles.', 403);

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim();
  const activeOnly = url.searchParams.get('active') === '1';
  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (activeOnly) where.push('active = 1');
  if (q) { where.push('(name ILIKE ? OR code ILIKE ?)'); args.push(`%${q}%`, `%${q}%`); }

  const rows = await all<any>(env, `
    SELECT * FROM maintenance_skus
    WHERE ${where.join(' AND ')}
    ORDER BY active DESC, code`, ...args);

  const money = session.manage || WRITE_ROLES.includes(session.role);
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, code: r.code, name: r.name, category: r.category, unitLabel: r.unit_label,
      // The preset price is operational (it seeds a quote), so it is shown to the ops roles
      // that raise jobs, not only to finance.
      defaultPrice: money ? r.default_price : null,
      trackStock: !!r.track_stock, stockOnHand: Number(r.stock_on_hand ?? 0),
      active: !!r.active, notes: r.notes ?? '',
    })),
  });
};

/** POST /api/maintenance/skus { code, name, category, unitLabel, defaultPrice, notes } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!WRITE_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only operations and management can change the catalog.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.code?.trim()) return fail('VALIDATION', 'Give the item a short code.', 422, { code: 'Enter a code.' });
  if (!b?.name?.trim()) return fail('VALIDATION', 'Enter the item name.', 422, { name: 'Enter the item name.' });
  if (b.category !== undefined && !CATEGORIES.includes(b.category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' });
  if (b.unitLabel !== undefined && !UNIT_LABELS.includes(b.unitLabel)) return fail('VALIDATION', 'Pick what the price is per.', 422);
  if (b.defaultPrice != null && (!Number.isInteger(b.defaultPrice) || b.defaultPrice < 0)) return fail('VALIDATION', 'The price must be a whole number of sen.', 422, { defaultPrice: 'Enter a price.' });
  if (b.stockOnHand != null && (!Number.isInteger(b.stockOnHand) || b.stockOnHand < 0)) return fail('VALIDATION', 'Stock on hand must be a whole number.', 422, { stockOnHand: 'Enter a whole number.' });

  const code = b.code.trim().slice(0, 40);
  const clash = await one<any>(env, 'SELECT id FROM maintenance_skus WHERE lower(code) = lower(?)', code);
  if (clash) return fail('CONFLICT', 'A catalog item already uses that code.', 409, { code: 'This code is taken.' });

  const track = b.trackStock ? 1 : 0;
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO maintenance_skus (id, code, name, category, unit_label, default_price, track_stock, stock_on_hand, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    id, code, b.name.trim().slice(0, 120), b.category ?? 'general', b.unitLabel ?? 'job',
    b.defaultPrice ?? 0, track, track ? (b.stockOnHand ?? 0) : 0, String(b.notes ?? '').slice(0, 500) || null, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance_sku.create', entityTable: 'maintenance_skus', entityId: id, after: { code, name: b.name, defaultPrice: b.defaultPrice ?? 0 } });
  return json({ id }, 201);
};
