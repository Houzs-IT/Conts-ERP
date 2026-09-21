import { type Env, one, fail } from './db';
import { type Session, canSeeFinance } from './auth';

export interface OwnerRow { id: string; display_name: string; bank_name: string | null; bank_account_last4: string | null }

/** The owner whose money this request may see. An owner sees only their own account, and every owner query is filtered by the id resolved here.
 *  Finance and management may look at any owner by passing ?ownerId=. Anyone else is refused. */
export async function ownerFor(env: Env, session: Session, url: URL): Promise<OwnerRow | Response> {
  if (session.role === 'owner') {
    const o = await one<OwnerRow>(env, 'SELECT id, display_name, bank_name, bank_account_last4 FROM owners WHERE user_id = ?', session.userId);
    return o ?? fail('NOT_LINKED', 'Your account is not linked to a property yet. Contact The Conts.', 404);
  }
  const asOwner = url.searchParams.get('ownerId');
  if (canSeeFinance(session.role) && asOwner) {
    const o = await one<OwnerRow>(env, 'SELECT id, display_name, bank_name, bank_account_last4 FROM owners WHERE id = ?', asOwner);
    return o ?? fail('NOT_FOUND', 'That owner no longer exists.', 404);
  }
  return fail('FORBIDDEN', 'The owner portal is for owners, or finance and management viewing as one.', 403);
}

/** Provisional figures are never shown to owners. */
export const VISIBLE = `('finalised','sent','paid')`;
