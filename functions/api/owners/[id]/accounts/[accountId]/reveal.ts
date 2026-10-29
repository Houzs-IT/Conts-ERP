import { type Env, one, json, fail, audit } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { can } from '../../../../../_lib/access';
import { bankAccountsReady } from '../../../../../_lib/ownerBank';

/** GET /api/owners/:id/accounts/:accountId/reveal: the full number of one extra account: { value }.
 *  Who may see it is the same as for the main account (owners/[id]/reveal.ts), and every reveal is written to the
 *  owner's audit log (who, which owner, which account, never the number). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(session.manage || can(session, 'finance', 'view'))) return fail('FORBIDDEN', 'Only management and finance can see full bank numbers.', 403);

  const ownerId = String(params.id), id = String(params.accountId);
  if (!(await bankAccountsReady(env))) return fail('NOT_FOUND', 'That bank account no longer exists.', 404);
  const a = await one<{ account_number: string; owner: string }>(env,
    'SELECT a.account_number, o.display_name AS owner FROM owner_bank_accounts a JOIN owners o ON o.id = a.owner_id WHERE a.id = ? AND a.owner_id = ?', id, ownerId);
  if (!a) return fail('NOT_FOUND', 'That bank account no longer exists.', 404);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.reveal_account', entityTable: 'owners', entityId: ownerId, after: { owner: a.owner, accountId: id } });
  return json({ value: a.account_number });
};
