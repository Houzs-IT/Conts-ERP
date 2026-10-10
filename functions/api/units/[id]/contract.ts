import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { todayMyt } from '../../../_lib/ops';
import { statementSettings, type Query } from '../../../_lib/ownerStatement';
import { invalidDraft, draftColumns, MODEL_LABEL, type ContractDraft } from '../../../_lib/revenueModel';
import { contractView, unitExample, lastMonth } from '../../../_lib/unitContract';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function unitOf(env: Env, id: string) {
  return one<any>(env, `
    SELECT u.id, u.owner_id, u.contract_id, u.unit_number, u.package, u.split_kind, u.split_value, u.misc_charges, p.name AS property_name, o.display_name AS owner_name
    FROM units u JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id WHERE u.id = ?`, id);
}

/** GET /api/units/:id/contract[?month=YYYY-MM] — the contract in force (one revenue model and its fields), the unit's
 *  earlier contracts, and last month's statement for this unit worked out by the statement engine (the example the
 *  Contract tab shows). Finance and management only: it carries the owner's money. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Contracts are visible to finance and management.', 403);
  const id = String(params.id);
  const u = await unitOf(env, id);
  if (!u) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  const url = new URL(request.url);
  const month = MONTH.test(url.searchParams.get('month') ?? '') ? url.searchParams.get('month')! : lastMonth(todayMyt());

  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const [settings, rows, shared, example] = await Promise.all([
    statementSettings(q),
    all<any>(env, `SELECT * FROM owner_contracts WHERE unit_id = ? OR id = ? ORDER BY starts_on DESC, created_at DESC`, id, u.contract_id),
    u.contract_id ? one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE contract_id = ? AND id <> ?', u.contract_id, id) : Promise.resolve(null),
    unitExample(q, id, month),
  ]);
  const current = rows.find(r => r.id === u.contract_id) ?? null;
  return json({
    generatedAt: nowIso(), month,
    unit: { id, label: `${u.property_name} ${u.unit_number}`, ownerId: u.owner_id, ownerName: u.owner_name },
    current: contractView(current, u, settings.defaultFeePct, Number(shared?.n ?? 0)),
    history: rows.filter(r => r.id !== u.contract_id).map(r => contractView(r, u, settings.defaultFeePct)),
    example,
  });
};

/** POST /api/units/:id/contract { ...draft, month? } — the example for terms not saved yet. Writes nothing. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Contracts are visible to finance and management.', 403);
  const id = String(params.id);
  const b = await request.json<ContractDraft & { month?: string }>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to work out.', 422);
  const fields = invalidDraft({ ...b, startsOn: b.startsOn || '2000-01-01' });
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract details.', 422, fields);
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', id))) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  const month = MONTH.test(b.month ?? '') ? b.month! : lastMonth(todayMyt());
  const example = await unitExample((sql, ...args) => all(env, sql, ...args), id, month, { ...b, startsOn: b.startsOn || '2000-01-01' });
  return json({ month, example });
};

/** PUT /api/units/:id/contract { ...draft, mode: 'update' | 'new' }
 *  'update' changes the contract in force. A contract record shared with other units (older agreements covered all of
 *  an owner's units) is not changed under them: this unit gets its own copy with the new terms.
 *  'new' starts a new contract from its start date: the one in force ends the day before and stays in the unit's
 *  history. Statements already final keep the figures they were made with; provisional ones change when regenerated. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only finance and management can change a contract.', 403);
  const id = String(params.id);
  const b = await request.json<ContractDraft & { mode?: string }>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  const fields = invalidDraft(b);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract details.', 422, fields);
  const u = await unitOf(env, id);
  if (!u) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  const c = draftColumns(b), now = nowIso();
  const cur = u.contract_id ? await one<any>(env, 'SELECT * FROM owner_contracts WHERE id = ?', u.contract_id) : null;
  const shared = cur ? Number((await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE contract_id = ? AND id <> ?', cur.id, id))?.n ?? 0) : 0;
  const mode = b.mode === 'new' ? 'new' : 'update';
  if (mode === 'new' && cur && cur.starts_on && c.starts_on <= String(cur.starts_on).slice(0, 10)) {
    return fail('VALIDATION', 'A new contract must start after the current one.', 422, { startsOn: `Start after ${String(cur.starts_on).slice(0, 10)}.` });
  }

  const cols = Object.keys(c) as (keyof typeof c)[];
  let contractId: string;
  if (cur && mode === 'update' && !shared) {
    contractId = cur.id;
    await run(env, `UPDATE owner_contracts SET ${cols.map(k => `${k} = ?`).join(', ')}, unit_id = COALESCE(unit_id, ?) WHERE id = ?`, ...cols.map(k => c[k]), id, cur.id);
  } else {
    contractId = crypto.randomUUID();
    await run(env, `INSERT INTO owner_contracts (id, owner_id, unit_id, created_at, ${cols.join(', ')}) VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')})`,
      contractId, u.owner_id, id, now, ...cols.map(k => c[k]));
    if (cur && mode === 'new') {
      const dayBefore = new Date(Date.parse(`${c.starts_on}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
      // The old contract ends the day before; a shared record keeps serving its other units, so its end is left alone.
      if (!shared && (!cur.ends_on || String(cur.ends_on).slice(0, 10) >= c.starts_on)) await run(env, 'UPDATE owner_contracts SET ends_on = ? WHERE id = ?', dayBefore, cur.id);
      if (!cur.unit_id && !shared) await run(env, 'UPDATE owner_contracts SET unit_id = ? WHERE id = ?', id, cur.id);
    }
    await run(env, 'UPDATE units SET contract_id = ?, updated_at = ? WHERE id = ?', contractId, now, id);
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: mode === 'new' ? 'contract.renew' : 'contract.update', entityTable: 'owner_contracts', entityId: contractId,
    before: cur ? { id: cur.id, revenueModel: cur.revenue_model, model: cur.model, fee: cur.management_fee_pct, rent: cur.grr_amount, guarantee: cur.minimum_guarantee } : null,
    after: { unitId: id, revenueModel: c.revenue_model, fee: c.management_fee_pct, rent: c.grr_amount, guarantee: c.minimum_guarantee, startsOn: c.starts_on, splitFrom: shared ? cur?.id : undefined },
  });
  return json({ id: contractId, revenueModel: c.revenue_model, label: MODEL_LABEL[c.revenue_model], split: !!(cur && shared && mode === 'update') });
};
