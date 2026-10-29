import { type Env, one, json, fail, audit } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { bankAccountsReady } from '../../../../../_lib/ownerBank';

/** GET /api/owners/:id/accounts/:accountId/reveal: the full number of one extra account: { value }.
 *  Management-side staff (session.manage) only, and every reveal is written to the owner's audit log (who, which
 *  owner, which account, never the number), the same as owners/[id]/reveal.ts for the main account. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can see full bank numbers.', 403);

  const ownerId = String(params.id), id = String(params.accountId);
  if (!(await bankAccountsReady(env))) return fail('NOT_FOUND', 'That bank account no longer exists.', 404);
  const a = await one<{ account_number: string; owner: string }>(env,
    'SELECT a.account_number, o.display_name AS owner FROM owner_bank_accounts a JOIN owners o ON o.id = a.owner_id WHERE a.id = ? AND a.owner_id = ?', id, ownerId);
  if (!a) return fail('NOT_FOUND', 'That bank account no longer exists.', 404);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.reveal_account', entityTable: 'owners', entityId: ownerId, after: { owner: a.owner, accountId: id } });
  return json({ value: a.account_number });
};
