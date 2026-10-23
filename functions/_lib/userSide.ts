import { type Env, one } from './db';
import { hasColumn } from './auth';
import { isSide, isKind, type DepartmentKind, type Side } from './access';

/** Migration 0143: which side of the business a staff account works on (Side in access.ts). Before the migration
 *  runs every account reads 'both'. */
export const userSideReady = (env: Env) => hasColumn(env, 'users', 'side').catch(() => false);

/** Where an account sits, read where a sign-in issues a fresh cookie (migration 0145). The side is the department's;
 *  an owner has no department, so the account's own side stands. */
export interface Place { side: Side; departmentId: string | null; department: string | null; positionId: string | null; kind: DepartmentKind | null }

export async function placeOf(env: Env, userId: string): Promise<Place> {
  const row = await one<{ side: string | null; department_id: string | null; department: string | null; position_id: string | null; kind: string | null }>(env,
    `SELECT ${(await userSideReady(env)) ? 'COALESCE(d.side, u.side)' : 'd.side'} AS side, u.department_id, d.name AS department, u.position_id, d.kind
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, userId);
  return { side: isSide(row?.side) ? row.side : 'both', departmentId: row?.department_id ?? null, department: row?.department ?? null, positionId: row?.position_id ?? null, kind: isKind(row?.kind) ? row.kind : null };
}

/** The account's side. */
export async function sideOf(env: Env, userId: string): Promise<Side> {
  return (await placeOf(env, userId)).side;
}
