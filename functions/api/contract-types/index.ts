import { type Env, all, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { isUniqueViolation } from '../../_lib/accessRules';
import { requireSession } from '../../_lib/auth';
import {
  contractTypes, contractTypesReady, contractTypeOptionsReady, parseTypeFields, legacyOptions, mergeOptions, misfitOptions, changedOptionKeys,
  optionValues, OPTION_COLUMNS, OPTIONS_NOT_READY, CONTRACT_CODE_PATTERN, NO_GRR,
} from '../../_lib/contractTypes';

/** GET /api/contract-types — the contract types, hidden ones too, with how many contracts use each (staff, 4 Nov 2026).
 *  A reference list the Units, Owners and Contracts screens all pick from, so any signed-in desk user reads it. `ready`
 *  is false before migration 0206: the fixed list is returned and it cannot be changed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const [ready, rows] = await Promise.all([contractTypesReady(env), contractTypes(env)]);
  const optionsReady = ready && await contractTypeOptionsReady(env);
  const used = ready ? await all<{ code: string; n: number }>(env, 'SELECT contract_code AS code, count(*)::int AS n FROM owner_contracts WHERE contract_code IS NOT NULL GROUP BY contract_code') : [];
  const count = new Map(used.map(r => [r.code, Number(r.n)]));
  return json({ ready, optionsReady, mayEdit: !!session.manage, data: rows.map(r => ({ ...r, contracts: count.get(r.code) ?? 0 })) });
};

/** POST /api/contract-types { code, label, revenueModel, package?, blurb?, isDefaultForModel? } — a new type, listed last. The code
 *  is its key and cannot change afterwards. Making it the default of its model takes that from the type that had it. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the contract types.', 403);
  if (!(await contractTypesReady(env))) return fail('NOT_READY', 'The contract types cannot be changed on this database yet.', 409);

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  const code = typeof b.code === 'string' ? b.code.trim().replace(/\s+/g, ' ') : '';
  const { set, fields } = parseTypeFields(b);
  if (!CONTRACT_CODE_PATTERN.test(code)) fields.code = 'Use capital letters, numbers and spaces, up to 20 characters.';
  else if (code === 'GRR') fields.code = NO_GRR;
  if (!set.label && !fields.label) fields.label = 'Enter a name of up to 80 characters.';
  const model = set.revenueModel;
  if (!model && !fields.revenueModel) fields.revenueModel = 'Pick one income model.';
  const plainOptions = legacyOptions(code, model ?? 'management');
  const options = mergeOptions(plainOptions, set);
  if (model) Object.assign(fields, misfitOptions(model, options));
  if (!model || Object.keys(fields).length) return fail('VALIDATION', 'Check the contract type.', 422, fields);
  const hasOptionColumns = await contractTypeOptionsReady(env);
  if (!hasOptionColumns && changedOptionKeys(plainOptions, options).length) return fail('NOT_READY', OPTIONS_NOT_READY, 409);
  if (await one(env, 'SELECT 1 AS x FROM contract_types WHERE code = ?', code)) return fail('CONFLICT', 'That code is already on the list.', 409, { code: 'Already on the list. Show it again if it is hidden.' });

  const next = await one<{ n: number }>(env, 'SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM contract_types');
  const now = nowIso();
  const taken = (): Response => fail('CONFLICT', 'That code is already on the list.', 409, { code: 'Already on the list. Show it again if it is hidden.' });
  try { await transaction(env, async tx => {
    if (set.isDefaultForModel) await run(tx, 'UPDATE contract_types SET is_default_for_model = false, updated_at = ? WHERE revenue_model = ?', now, model);
    await run(tx, `INSERT INTO contract_types (code, label, package, revenue_model, blurb, is_default_for_model, sort_order, is_active, created_at, updated_at${hasOptionColumns ? `, ${OPTION_COLUMNS}` : ''})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasOptionColumns ? ', ?, ?, ?, ?' : ''})`, code, set.label, set.package ?? null, model, set.blurb ?? null, set.isDefaultForModel === true,
      set.sortOrder ?? Number(next?.n ?? 10), set.isActive ?? true, now, now, ...(hasOptionColumns ? optionValues(options) : []));
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'contract_type.create', entityTable: 'contract_types', entityId: code,
      after: { label: set.label, package: set.package ?? null, revenueModel: model, blurb: set.blurb ?? null, isDefaultForModel: set.isDefaultForModel === true,
        sortOrder: set.sortOrder ?? Number(next?.n ?? 10), isActive: set.isActive ?? true, ...options } });
  }); } catch (e) { if (isUniqueViolation(e)) return taken(); throw e; }
  return json({ code }, 201);
};
