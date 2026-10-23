import type { DepartmentKind } from './access';

/**
 * The two-step sign-in setting used to be a list of roles (security.require2faRoles). Roles are hidden now and the
 * setting is saved by department (security.require2faDepartments) plus one switch for owners (security.require2faOwners).
 * This is the one place that turns the old list into the new setting. migrations-pg/0146_retire_office_roles.sql does the
 * same mapping in SQL, so change both together:
 *
 *   management       -> the departments of kind management
 *   operations_staff -> every department of kind staff
 *   finance_admin    -> Finance
 *   operations_manager -> Operations
 *   housekeeper      -> the departments of kind cleaning
 *   technician       -> the departments of kind maintenance
 *   owner            -> no department: the owners switch
 */
export const LEGACY_2FA_ROLES = ['management', 'operations_staff', 'finance_admin', 'operations_manager', 'housekeeper', 'technician', 'owner'];

export interface DepartmentRef { id: string; name: string; kind: DepartmentKind }

/** A comma-separated setting value as a list. */
export const parseList = (v: string | undefined): string[] => (v ?? '').split(',').map(r => r.trim()).filter(Boolean);

const KIND_OF_ROLE: Record<string, DepartmentKind> = { management: 'management', operations_staff: 'staff', housekeeper: 'cleaning', technician: 'maintenance' };
const NAME_OF_ROLE: Record<string, string> = { finance_admin: 'finance', operations_manager: 'operations' };

/** The ids of the departments an old role list stands for, in the order `departments` came in (sort, then name). */
export function departmentsForLegacyRoles(roles: readonly string[], departments: readonly DepartmentRef[]): string[] {
  return departments
    .filter(d => roles.some(r => KIND_OF_ROLE[r] === d.kind || NAME_OF_ROLE[r] === d.name.trim().toLowerCase()))
    .map(d => d.id);
}

/** Owners have no department, so the old list asked for them by name. */
export const legacyRolesIncludeOwners = (roles: readonly string[]): boolean => roles.includes('owner');
