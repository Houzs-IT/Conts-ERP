import { type Env } from './db';
import { hasColumn } from './auth';

/** Whether dc_staff has the app login and switch-off columns (migration 0311). Without them Dream Crafter staff list as
 *  switched on with no login, and the access buttons do not show. */
export const hasDcStaff = (env: Env): Promise<boolean> => hasColumn(env, 'employees', 'dc_staff_id').catch(() => false);

export const withoutDreamCrafterSql = async (env: Env, employeeIdColumn: string): Promise<string> =>
  (await hasDcStaff(env)) ? ` AND ${employeeIdColumn} NOT IN (SELECT id FROM employees WHERE dc_staff_id IS NOT NULL)` : '';

export const hasDcAppAccess =(env: Env): Promise<boolean> => hasColumn(env, 'dc_staff', 'user_id').catch(() => false);

/** Dream Crafter's people with their HR record (employees.*), their login's EMP number and whether they are switched on:
 *  login_user_id, roster_active and emp_no come after e.* so no employees column can shadow them. */
export const dcPeopleSql = (hasAppAccess: boolean): string => `SELECT d.full_name, d.phone, e.*,
  ${hasAppAccess ? 'd.user_id AS login_user_id, d.is_active AS roster_active, u.employee_id AS emp_no' : 'NULL AS login_user_id, 1 AS roster_active, NULL AS emp_no'}
  FROM dc_staff d JOIN employees e ON e.dc_staff_id = d.id${hasAppAccess ? ' LEFT JOIN users u ON u.id = d.user_id' : ''}`;
