import { type Env, one } from './db';
import { hasColumn } from './auth';
import { isSide, type Side } from './access';

/** Migration 0143: which side of the business a staff account works on (Side in access.ts). Before the migration
 *  runs every account reads 'both'. */
export const userSideReady = (env: Env) => hasColumn(env, 'users', 'side').catch(() => false);

/** The account's side, read where a sign-in issues a fresh cookie. */
export async function sideOf(env: Env, userId: string): Promise<Side> {
  if (!(await userSideReady(env))) return 'both';
  const row = await one<{ side: string }>(env, 'SELECT side FROM users WHERE id = ?', userId);
  return isSide(row?.side) ? row.side : 'both';
}
