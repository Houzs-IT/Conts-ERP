import { type Env, one, all, json, fail, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { auditUnit } from '../../../_lib/properties';
import { bankAccountsReady } from '../../../_lib/ownerBank';

interface AccountTail { id: string; bank_name: string | null; account_last4: string }
const MAIN = "Owner's main account";
const tail = (a: AccountTail | null): string => (a ? `${a.bank_name ?? 'Bank'} ····${a.account_last4}` : MAIN);

/** PATCH /api/units/:id/bank-account { accountId: string | null }: which of the owner's extra accounts this unit's
 *  payout goes to; null clears it (the owner's main account). The account must belong to the unit's owner (422).
 *  Management and finance: the route follows the Owners area (ROUTE_AREAS in _lib/access.ts). Audited by bank and
 *  last four only. A choice made here, the main account included, is never changed by a later import. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management and finance can change where a unit is paid.', 403);

  const id = String(params.id);
  const b = await request.json<{ accountId?: unknown }>().catch(() => null);
  if (!b || typeof b !== 'object' || !('accountId' in b) || (b.accountId !== null && typeof b.accountId !== 'string')) {
    return fail('VALIDATION', 'Say which account, or null for the owner\'s main account.', 422, { accountId: 'Pick an account.' });
  }
  const accountId = b.accountId || null;

  if (!(await bankAccountsReady(env))) return fail('NOT_READY', 'Several bank accounts need the latest database update.', 501);
  const unit = await one<{ owner_id: string; bank_account_id: string | null; bank_account_chosen: boolean }>(env,
    'SELECT owner_id, bank_account_id, bank_account_chosen FROM units WHERE id = ?', id);
  if (!unit) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  let to: AccountTail | null = null;
  if (accountId) {
    to = await one<AccountTail>(env, 'SELECT id, bank_name, account_last4 FROM owner_bank_accounts WHERE id = ? AND owner_id = ?', accountId, unit.owner_id);
    if (!to) return fail('VALIDATION', "That account is not one of this unit's owner's accounts.", 422, { accountId: "Pick one of the owner's accounts." });
  }
  if ((unit.bank_account_id ?? null) === accountId && unit.bank_account_chosen) return json({ ok: true, changed: false });

  const from = unit.bank_account_id ? await one<AccountTail>(env, 'SELECT id, bank_name, account_last4 FROM owner_bank_accounts WHERE id = ?', unit.bank_account_id) : null;
  // The owner must still be the one checked above, so an account of the old owner can never land on the unit.
  const done = await all<{ id: string }>(env,
    'UPDATE units SET bank_account_id = ?, bank_account_chosen = true, updated_at = ? WHERE id = ? AND owner_id = ? RETURNING id',
    accountId, nowIso(), id, unit.owner_id);
  if (!done.length) return fail('CONFLICT', "This unit's owner changed while you were choosing. Open the unit again and choose.", 409);
  await auditUnit(env, session, 'unit.bank_account', id, { paysTo: tail(to) }, { paysTo: tail(from) });
  return json({ ok: true, changed: true });
};
