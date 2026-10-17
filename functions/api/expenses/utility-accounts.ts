import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const KINDS = ['electricity', 'water', 'internet', 'sewerage'];

/** POST /api/expenses/utility-accounts { unitId, kind, accountNo, provider? }
 *  Puts a utility account number on file for a unit, so the monthly utility bills screen lists it. Until now only the
 *  owner workbook import wrote these, so a unit missing from the workbook could not be entered there at all. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility accounts are kept by finance and management.', 403);
  const b = await request.json<any>().catch(() => null);
  const accountNo = String(b?.accountNo ?? '').trim();
  const provider = String(b?.provider ?? '').trim();
  const fields: Record<string, string> = {};
  if (!b?.unitId || typeof b.unitId !== 'string') fields.unitId = 'Pick the unit.';
  if (!KINDS.includes(b?.kind)) fields.kind = 'Choose electricity, water, Wi-Fi or IndahWater.';
  if (!accountNo) fields.accountNo = 'Enter the account number from the bill.';
  else if (accountNo.length > 60) fields.accountNo = 'At most 60 characters.';
  if (provider.length > 60) fields.provider = 'At most 60 characters.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the highlighted fields.', 422, fields);

  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', b.unitId))) return fail('NOT_FOUND', 'That unit does not exist.', 404, { unitId: 'Pick a unit that exists.' });
  if (await one(env, 'SELECT 1 AS x FROM unit_utility_accounts WHERE unit_id = ? AND kind = ? AND lower(account_no) = lower(?)', b.unitId, b.kind, accountNo)) {
    return fail('CONFLICT', 'That account number is already on file for this unit.', 409, { accountNo: 'Already on file.' });
  }
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO unit_utility_accounts (id, unit_id, kind, account_no, provider, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.unitId, b.kind, accountNo, provider || null, `Added by ${session.fullName}`, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'utility_account.create', entityTable: 'unit_utility_accounts', entityId: id,
    after: { unitId: b.unitId, kind: b.kind, accountNo, provider: provider || null } });
  return json({ id }, 201);
};
