import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { bankAccountsReady, parseAccountInput, last4Of } from '../../../../_lib/ownerBank';

interface AccountRow { id: string; label: string | null; bank_name: string | null; account_number: string; account_holder: string | null }
const SELECT = 'SELECT id, label, bank_name, account_number, account_holder FROM owner_bank_accounts WHERE id = ? AND owner_id = ?';

/** PATCH /api/owners/:id/accounts/:accountId { label?, bankName?, accountNumber?, accountHolder? }: changes an extra
 *  account. A blank or masked accountNumber keeps the stored one. The account must belong to that owner (404 otherwise).
 *  Audited; the number is recorded as changed, never copied into the log. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management and finance can change an owner\'s bank accounts.', 403);

  const ownerId = String(params.id), id = String(params.accountId);
  if (!(await bankAccountsReady(env))) return fail('NOT_READY', 'Several bank accounts need the latest database update.', 501);
  const cur = await one<AccountRow>(env, SELECT, id, ownerId);
  if (!cur) return fail('NOT_FOUND', 'That bank account no longer exists.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to save.', 422);
  const { fields, set } = parseAccountInput(b, false);
  if (Object.keys(fields).length) return fail('VALIDATION', Object.values(fields)[0], 422, fields);

  const sets: string[] = [], args: unknown[] = [];
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const [key, col, was] of [['label', 'label', cur.label], ['bankName', 'bank_name', cur.bank_name], ['accountHolder', 'account_holder', cur.account_holder]] as const) {
    const v = set[key];
    if (v === undefined || v === was) continue;
    sets.push(`${col} = ?`); args.push(v); before[key] = was; after[key] = v;
  }
  if (set.accountNumber !== undefined && set.accountNumber !== cur.account_number) {
    sets.push('account_number = ?', 'account_last4 = ?'); args.push(set.accountNumber, last4Of(set.accountNumber));
    before.accountNumber = 'unchanged'; after.accountNumber = 'changed';
  }
  if (!sets.length) return json({ ok: true, changed: false });

  await run(env, `UPDATE owner_bank_accounts SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`, ...args, nowIso(), id, ownerId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.account_update', entityTable: 'owners', entityId: ownerId, before: { accountId: id, ...before }, after: { accountId: id, ...after } });
  return json({ ok: true, changed: true });
};

/** DELETE /api/owners/:id/accounts/:accountId: refused (409) while any unit pays to it. Audited. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management and finance can change an owner\'s bank accounts.', 403);

  const ownerId = String(params.id), id = String(params.accountId);
  if (!(await bankAccountsReady(env))) return fail('NOT_READY', 'Several bank accounts need the latest database update.', 501);
  const cur = await one<AccountRow>(env, SELECT, id, ownerId);
  if (!cur) return fail('NOT_FOUND', 'That bank account no longer exists.', 404);

  const used = await one<{ n: number }>(env, 'SELECT COUNT(*)::int AS n FROM units WHERE bank_account_id = ?', id);
  const n = Number(used?.n ?? 0);
  if (n > 0) return fail('CONFLICT', `${n} unit${n === 1 ? '' : 's'} still pay${n === 1 ? 's' : ''} to this account. Change ${n === 1 ? 'that unit' : 'those units'} to another account first.`, 409);

  await run(env, 'DELETE FROM owner_bank_accounts WHERE id = ? AND owner_id = ?', id, ownerId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.account_delete', entityTable: 'owners', entityId: ownerId,
    before: { accountId: id, label: cur.label, bankName: cur.bank_name, accountHolder: cur.account_holder, accountNumber: 'removed' } });
  return json({ ok: true });
};
