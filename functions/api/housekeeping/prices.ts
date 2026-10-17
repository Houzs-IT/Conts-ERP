import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasCleanPrices, PRICE_KINDS, LAYOUTS } from '../../_lib/cleaningPrices';

const amountOk = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0);

/** GET /api/housekeeping/prices — the cleaning price table: for each clean type and unit layout, the internal cost (what
 *  the cleaner is paid) and the external charge (what is charged for the clean), in sen; null = price not set. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return json({ ready: false, kinds: PRICE_KINDS, layouts: LAYOUTS, rows: [], mayEdit: false });
  const rows = await all<{ kind: string; layout: string; internal_cost: number | null; external_charge: number | null }>(env,
    'SELECT kind, layout, internal_cost, external_charge FROM cleaning_prices');
  const at = new Map(rows.map(r => [`${r.kind}:${r.layout}`, r]));
  return json({
    ready: true, kinds: PRICE_KINDS, layouts: LAYOUTS, mayEdit: !!session.manage,
    rows: PRICE_KINDS.flatMap(kind => LAYOUTS.map(layout => {
      const r = at.get(`${kind}:${layout}`);
      return { kind, layout, internalCost: r?.internal_cost ?? null, externalCharge: r?.external_charge ?? null };
    })),
  });
};

/** PUT /api/housekeeping/prices { rows: [{ kind, layout, internalCost, externalCharge }] } — management only. Changes the
 *  amount of cleans not yet finished; a finished clean keeps what it was charged. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return fail('NOT_CONFIGURED', 'Cleaning prices need a database update (migration 0126) that is not applied yet.', 501);
  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows) || b.rows.length > 200) return fail('VALIDATION', 'Send the price rows.', 422);
  for (const r of b.rows) {
    if (!(PRICE_KINDS as readonly string[]).includes(r?.kind) || !(LAYOUTS as readonly string[]).includes(r?.layout)) return fail('VALIDATION', 'Unknown clean type or layout.', 422);
    if (!amountOk(r.internalCost ?? null) || !amountOk(r.externalCharge ?? null)) return fail('VALIDATION', 'Amounts are sen, RM 0.00 or more, or empty.', 422);
  }
  const now = nowIso();
  for (const r of b.rows) {
    await run(env, `INSERT INTO cleaning_prices (kind, layout, internal_cost, external_charge, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, layout) DO UPDATE SET internal_cost = excluded.internal_cost, external_charge = excluded.external_charge, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      r.kind, r.layout, r.internalCost ?? null, r.externalCharge ?? null, now, session.userId);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.prices', entityTable: 'cleaning_prices', entityId: 'table', after: { rows: b.rows } });
  return json({ ok: true, saved: b.rows.length });
};
