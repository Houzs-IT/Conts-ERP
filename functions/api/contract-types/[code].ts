import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import {
  contractTypesReady, contractTypeOptionsReady, parseTypeFields, legacyOptions, mergeOptions, misfitOptions, changedOptionKeys, storedOptions,
  optionValues, OPTIONS_NOT_READY, type StoredOptionColumns,
} from '../../_lib/contractTypes';

interface TypeRecord extends StoredOptionColumns { label: string; package: string | null; blurb: string | null; is_default_for_model: boolean; sort_order: number; is_active: boolean }

const IN_USE = 'In use by contracts. Add a new type instead.';

/** PATCH /api/contract-types/:code { label?, package?, blurb?, sortOrder?, isActive?, isDefaultForModel?, revenueModel?, has...? } — change a type.
 *  A hidden type is not offered for new contracts, but the contracts that have it keep it. The code never changes (other rows
 *  point at it). The income model and the options can change only while no contract uses the type. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the contract types.', 403);
  if (!(await contractTypesReady(env))) return fail('NOT_READY', 'The contract types cannot be changed on this database yet.', 409);

  const code = decodeURIComponent(String(params.code));
  const cur = await one<TypeRecord>(env, 'SELECT * FROM contract_types WHERE code = ?', code);
  if (!cur) return fail('NOT_FOUND', 'That contract type is not on the list.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  if (b.code !== undefined && b.code !== code) return fail('VALIDATION', 'The code cannot be changed.', 422, { code: 'The code cannot be changed. Add a new type instead.' });
  const { set, fields } = parseTypeFields(b);

  const model = set.revenueModel ?? cur.revenue_model;
  const modelChanged = model !== cur.revenue_model;
  const hasOptionColumns = await contractTypeOptionsReady(env);
  const curOptions = storedOptions(cur, hasOptionColumns);
  const options = mergeOptions(modelChanged ? legacyOptions(code, model) : curOptions, set);
  const changedKeys = changedOptionKeys(curOptions, options);
  Object.assign(fields, misfitOptions(model, options));
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract type.', 422, fields);
  if (!hasOptionColumns && !modelChanged && changedKeys.length) return fail('NOT_READY', OPTIONS_NOT_READY, 409);

  const termsChanged = modelChanged || changedKeys.length > 0;
  const inUseFields = modelChanged ? { revenueModel: 'In use by contracts. Add a new type for the other model.' } : Object.fromEntries(changedKeys.map(key => [key, IN_USE]));
  if (termsChanged) {
    const used = await one<{ n: number }>(env, 'SELECT count(*)::int AS n FROM owner_contracts WHERE contract_code = ?', code);
    const n = Number(used?.n ?? 0);
    if (n > 0) return fail('CONFLICT', `${n} contract${n === 1 ? ' uses' : 's use'} ${code}, so its income model and options cannot change.`, 409, inUseFields);
    if (modelChanged && cur.is_default_for_model) return fail('CONFLICT', 'Make another type the default for its model first.', 409, { revenueModel: 'This is the default for its model. Make another type the default first.' });
  }
  if (set.isDefaultForModel === false && cur.is_default_for_model) return fail('CONFLICT', 'Make another type the default instead.', 409, { isDefaultForModel: 'Make another type the default instead.' });

  const next = {
    label: set.label ?? cur.label, package: set.package === undefined ? cur.package : set.package, blurb: set.blurb === undefined ? cur.blurb : set.blurb,
    sortOrder: set.sortOrder ?? Number(cur.sort_order), isActive: set.isActive ?? cur.is_active, isDefault: set.isDefaultForModel ?? cur.is_default_for_model,
  }, now = nowIso();
  const inUse = await transaction(env, async tx => {
    // Checked again here: a contract saved since the check above would be left on a code of another model.
    if (termsChanged && await one(tx, 'SELECT 1 AS x FROM owner_contracts WHERE contract_code = ? LIMIT 1', code)) return true;
    if (next.isDefault && !cur.is_default_for_model) await run(tx, 'UPDATE contract_types SET is_default_for_model = false, updated_at = ? WHERE revenue_model = ? AND code <> ?', now, model, code);
    await run(tx, `UPDATE contract_types SET label = ?, package = ?, revenue_model = ?, blurb = ?, is_default_for_model = ?, sort_order = ?, is_active = ?, updated_at = ?${
      hasOptionColumns ? ', has_fixed_owner_amount = ?, has_agent_share = ?, has_no_operator_share = ?, has_rent_out_grid = ?' : ''} WHERE code = ?`,
      next.label, next.package, model, next.blurb, next.isDefault, next.sortOrder, next.isActive, now, ...(hasOptionColumns ? optionValues(options) : []), code);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'contract_type.update', entityTable: 'contract_types', entityId: code,
      before: { label: cur.label, package: cur.package, revenueModel: cur.revenue_model, blurb: cur.blurb, isDefaultForModel: cur.is_default_for_model, sortOrder: Number(cur.sort_order), isActive: cur.is_active, ...curOptions },
      after: { label: next.label, package: next.package, revenueModel: model, blurb: next.blurb, isDefaultForModel: next.isDefault, sortOrder: next.sortOrder, isActive: next.isActive, ...options } });
    return false;
  });
  if (inUse) return fail('CONFLICT', `A contract now uses ${code}, so its income model and options cannot change.`, 409, inUseFields);
  return json({ ok: true });
};
