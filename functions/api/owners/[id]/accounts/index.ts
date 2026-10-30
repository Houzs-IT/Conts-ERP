import { type Env, one, all, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { can } from '../../../../_lib/access';
import { bankAccountsReady, parseAccountInput, last4Of } from '../../../../_lib/ownerBank';

const NOT_READY = () => fail('NOT_READY', 'Several bank accounts need the latest database update.', 501);

/** GET /api/owners/:id/accounts: the owner's extra bank accounts (the main one is on the owner itself), tail only:
 *  { data: [{ id, label, bankName, accountHolder, last4, inUse }] }, inUse = how many units pay to it.
 *  The same people who see the main account's full number (owners/[id]/reveal.ts). Never the full number: see
 *  ./[accountId]/reveal. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(session.manage || can(session, 'finance', 'view'))) return fail('FORBIDDEN', 'Only management and finance can see an owner\'s other bank accounts.', 403);

  const id = String(params.id);
  if (!(await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', id))) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  if (!(await bankAccountsReady(env))) return json({ data: [] });

  const rows = await all<{ id: string; label: string | null; bank_name: string | null; account_holder: string | null; account_last4: string; in_use: number }>(env, `
    SELECT a.id, a.label, a.bank_name, a.account_holder, a.account_last4, (SELECT COUNT(*)::int FROM units u WHERE u.bank_account_id = a.id) AS in_use
    FROM owner_bank_accounts a WHERE a.owner_id = ? ORDER BY a.created_at, a.id`, id);
  return json({ data: rows.map(r => ({ id: r.id, label: r.label, bankName: r.bank_name ?? '', accountHolder: r.account_holder ?? '', last4: r.account_last4, inUse: Number(r.in_use) })) });
};

/** POST /api/owners/:id/accounts { label?, bankName, accountNumber, accountHolder }: adds an extra account.
 *  Audited on the owner's History; the number is never copied into the log. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management and finance can change an owner\'s bank accounts.', 403);

  const id = String(params.id);
  const owner = await one<{ display_name: string }>(env, 'SELECT display_name FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  if (!(await bankAccountsReady(env))) return NOT_READY();

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to save.', 422);
  const { fields, set } = parseAccountInput(b, true);
  const { accountNumber } = set;
  if (Object.keys(fields).length || !accountNumber) return fail('VALIDATION', Object.values(fields)[0] ?? 'Enter the account number.', 422, fields);

  const accountId = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO owner_bank_accounts (id, owner_id, label, bank_name, account_number, account_holder, account_last4, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    accountId, id, set.label ?? null, set.bankName ?? null, accountNumber, set.accountHolder ?? null, last4Of(accountNumber), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.account_add', entityTable: 'owners', entityId: id,
    after: { accountId, label: set.label ?? null, bankName: set.bankName ?? null, accountHolder: set.accountHolder ?? null, accountNumber: 'changed' } });
  return json({ id: accountId }, 201);
};
