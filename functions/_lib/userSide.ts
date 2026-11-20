import { type Env, one } from './db';
import { hasColumn } from './auth';
import { isSide, isKind, sideSql, sideWithRolesSql, userRolesReady, type DepartmentKind, type Side } from './access';

/** Migration 0143: which side of the business a staff account works on (Side in access.ts). Before the migration
 *  runs every account reads 'both'. */
export const userSideReady = (env: Env) => hasColumn(env, 'users', 'side');

/** Where an account sits, read where a sign-in issues a fresh cookie (migration 0145). The side follows sideSql in
 *  access.ts: the department's, or the person's own in a department on both sides (and for an owner, who has none). */
export interface Place { side: Side; departmentId: string | null; department: string | null; positionId: string | null; kind: DepartmentKind | null; extraDepartmentIds: string[] }

export async function placeOf(env: Env, userId: string): Promise<Place> {
  const [sideCol, withRoles] = await Promise.all([userSideReady(env), userRolesReady(env)]);
  const side = sideCol ? (withRoles ? sideWithRolesSql('u', 'd') : sideSql('u', 'd')) : 'd.side';
  const row = await one<{ side: string | null; department_id: string | null; department: string | null; position_id: string | null; kind: string | null; extra: string | null }>(env,
    `SELECT ${side} AS side, ${withRoles ? "COALESCE((SELECT string_agg(DISTINCT p.department_id, ',') FROM user_roles r JOIN positions p ON p.id = r.position_id WHERE r.user_id = u.id), '')" : "''"} AS extra, u.department_id, d.name AS department, u.position_id, d.kind
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, userId);
  return { side: isSide(row?.side) ? row.side : 'both', departmentId: row?.department_id ?? null, department: row?.department ?? null, positionId: row?.position_id ?? null, kind: isKind(row?.kind) ? row.kind : null, extraDepartmentIds: row?.extra ? row.extra.split(',') : [] };
}

/** The account's side. */
export async function sideOf(env: Env, userId: string): Promise<Side> {
  return (await placeOf(env, userId)).side;
}
