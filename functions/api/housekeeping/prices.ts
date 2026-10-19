import { type Env, all, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasCleanPrices, PRICE_KINDS, LAYOUTS } from '../../_lib/cleaningPrices';
import { hasServicePrices, serviceBook, writePrices } from '../../_lib/servicePrices';

const amountOk = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0);

/** GET /api/housekeeping/prices — the cleaning price table: for each clean type and unit layout, the internal cost (what
 *  the cleaner is paid) and the external charge (what is charged for the clean), in sen; null = price not set. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return json({ ready: false, kinds: PRICE_KINDS, layouts: LAYOUTS, rows: [], mayEdit: false });
  // Since Service prices (0127): the cleaning item of each clean type, at its prices in force today.
  const book = (await hasServicePrices(env)) ? await serviceBook(env, []) : null;
  const rows = book ? PRICE_KINDS.flatMap(kind => LAYOUTS.map(layout => {
    const a = book.amounts(book.itemForKind(kind)?.id ?? null, null, layout, mytToday());
    return { kind, layout, internal_cost: a.internal, external_charge: a.owner };
  })) : await all<{ kind: string; layout: string; internal_cost: number | null; external_charge: number | null }>(env,
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
  if (await hasServicePrices(env)) {
    // A change from today on the clean type's item in Service prices; the old table is no longer read.
    const book = await serviceBook(env, []);
    for (const kind of PRICE_KINDS) {
      const item = book.itemForKind(kind), rows = b.rows.filter((r: any) => r.kind === kind);
      if (!rows.length) continue;
      if (!item) return fail('NOT_FOUND', 'There is no active cleaning item for that clean type in Service prices.', 404);
      await writePrices(env, item.id, { effectiveFrom: mytToday(), note: 'Set from Cleaning > Prices', rows: rows.map((r: any) => ({ layout: r.layout, ownerPrice: r.externalCharge ?? null, internalCost: r.internalCost ?? null })) }, session.userId);
    }
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.prices', entityTable: 'service_items', entityId: 'cleaning', after: { rows: b.rows, effectiveFrom: mytToday() } });
    return json({ ok: true, saved: b.rows.length });
  }
  const now = nowIso();
  await run(env, `INSERT INTO cleaning_prices (kind, layout, internal_cost, external_charge, updated_at, updated_by)
    SELECT x.kind, x.layout, x.internal_cost, x.external_charge, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(kind text, layout text, internal_cost int, external_charge int)
    ON CONFLICT (kind, layout) DO UPDATE SET internal_cost = excluded.internal_cost, external_charge = excluded.external_charge, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    now, session.userId, JSON.stringify(b.rows.map((r: any) => ({ kind: r.kind, layout: r.layout, internal_cost: r.internalCost ?? null, external_charge: r.externalCharge ?? null }))));
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.prices', entityTable: 'cleaning_prices', entityId: 'table', after: { rows: b.rows } });
  return json({ ok: true, saved: b.rows.length });
};
