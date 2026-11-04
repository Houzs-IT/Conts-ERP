import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { contractTypesReady, parseTypeFields } from '../../_lib/contractTypes';

interface TypeRecord { code: string; label: string; package: string | null; revenue_model: string; blurb: string | null; is_default_for_model: boolean; sort_order: number; is_active: boolean }

/** PATCH /api/contract-types/:code { label?, package?, blurb?, sortOrder?, isActive?, isDefaultForModel?, revenueModel? } — change a type.
 *  A hidden type is not offered for new contracts, but the contracts that have it keep it. The code never changes (other rows
 *  point at it). The income model can change only while no contract uses the type. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the contract types.', 403);
  if (!(await contractTypesReady(env))) return fail('NOT_READY', 'The contract types cannot be changed on this database yet.', 409);

  const code = decodeURIComponent(String(params.code));
  const cur = await one<TypeRecord>(env, 'SELECT code, label, package, revenue_model, blurb, is_default_for_model, sort_order, is_active FROM contract_types WHERE code = ?', code);
  if (!cur) return fail('NOT_FOUND', 'That contract type is not on the list.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  if (b.code !== undefined && b.code !== code) return fail('VALIDATION', 'The code cannot be changed.', 422, { code: 'The code cannot be changed. Add a new type instead.' });
  const { set, fields } = parseTypeFields(b);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract type.', 422, fields);

  const model = set.revenueModel ?? cur.revenue_model;
  if (model !== cur.revenue_model) {
    const used = await one<{ n: number }>(env, 'SELECT count(*)::int AS n FROM owner_contracts WHERE contract_code = ?', code);
    const n = Number(used?.n ?? 0);
    if (n > 0) return fail('CONFLICT', `${n} contract${n === 1 ? ' uses' : 's use'} ${code}, so its income model cannot change.`, 409, { revenueModel: 'In use by contracts. Add a new type for the other model.' });
    if (cur.is_default_for_model) return fail('CONFLICT', 'Make another type the default for its model first.', 409, { revenueModel: 'This is the default for its model. Make another type the default first.' });
  }
  if (set.isDefaultForModel === false && cur.is_default_for_model) return fail('CONFLICT', 'Make another type the default instead.', 409, { isDefaultForModel: 'Make another type the default instead.' });

  const next = {
    label: set.label ?? cur.label, package: set.package === undefined ? cur.package : set.package, blurb: set.blurb === undefined ? cur.blurb : set.blurb,
    sortOrder: set.sortOrder ?? Number(cur.sort_order), isActive: set.isActive ?? cur.is_active, isDefault: set.isDefaultForModel ?? cur.is_default_for_model,
  }, now = nowIso();
  const inUse = await transaction(env, async tx => {
    // Checked again here: a contract saved since the check above would be left on a code of another model.
    if (model !== cur.revenue_model && await one(tx, 'SELECT 1 AS x FROM owner_contracts WHERE contract_code = ? LIMIT 1', code)) return true;
    if (next.isDefault && !cur.is_default_for_model) await run(tx, 'UPDATE contract_types SET is_default_for_model = false, updated_at = ? WHERE revenue_model = ? AND code <> ?', now, model, code);
    await run(tx, 'UPDATE contract_types SET label = ?, package = ?, revenue_model = ?, blurb = ?, is_default_for_model = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE code = ?',
      next.label, next.package, model, next.blurb, next.isDefault, next.sortOrder, next.isActive, now, code);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'contract_type.update', entityTable: 'contract_types', entityId: code,
      before: { label: cur.label, package: cur.package, revenueModel: cur.revenue_model, blurb: cur.blurb, isDefaultForModel: cur.is_default_for_model, sortOrder: Number(cur.sort_order), isActive: cur.is_active },
      after: { label: next.label, package: next.package, revenueModel: model, blurb: next.blurb, isDefaultForModel: next.isDefault, sortOrder: next.sortOrder, isActive: next.isActive } });
    return false;
  });
  if (inUse) return fail('CONFLICT', `A contract now uses ${code}, so its income model cannot change.`, 409, { revenueModel: 'In use by contracts. Add a new type for the other model.' });
  return json({ ok: true });
};
