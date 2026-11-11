import { useState } from 'react';
import { useApi, type Query } from '../../lib/useApi';
import type { AccessCategory, AccessChart, AccessLevel, Department, DepartmentKind, DepartmentsPayload, UserSide } from '../../lib/types';

export const LEVEL_LABEL: Record<AccessLevel, string> = { none: 'No access', view: 'View only', edit: 'Edit', full: 'Full' };
export const LEVEL_COLOR: Record<AccessLevel, string> = {
  none: 'var(--color-neutral-fg)', view: 'var(--color-info-fg)',
  edit: 'var(--color-warning-fg)', full: 'var(--color-success-fg)',
};
export const MUTED = 'var(--color-text-muted)';
export const SELECT = 'h-8 w-full max-w-[200px] px-2 py-0 [font-family:inherit] text-copy bg-card border border-solid rounded-control outline-none';

/** The Conts, Dream Crafter or both. A person's side is their department's side. */
export const SIDE_OPTIONS: { value: UserSide; label: string }[] = [
  { value: 'conts', label: 'The Conts' },
  { value: 'dream_crafter', label: 'Dream Crafter' },
  { value: 'both', label: 'Both' },
];
export const sideLabel = (s: UserSide | undefined): string => SIDE_OPTIONS.find(o => o.value === (s ?? 'both'))?.label ?? 'Both';

/** The area groups each side closes. Same table as CLOSED_BY_SIDE and closedBySide in functions/_lib/access.ts: keep them
 *  in step. Management always sees both sides; Finance and System are on neither list, so they follow the rules. */
const CLOSED_BY_SIDE: Record<UserSide, string[]> = {
  conts: ['Service cases', 'Projects', 'Supply chain'],
  dream_crafter: ['Home', 'Reports', 'Reservations', 'Operations', 'HR', 'Units', 'Growth'],
  both: [],
};
export const closedBySide = (kind: DepartmentKind, side: UserSide, group: string): boolean => kind !== 'management' && CLOSED_BY_SIDE[side].includes(group);
/** The company a category belongs to: the side that does not close it. Finance and System belong to both. */
export const categorySide = (group: string): UserSide =>
  CLOSED_BY_SIDE.dream_crafter.includes(group) ? 'conts' : CLOSED_BY_SIDE.conts.includes(group) ? 'dream_crafter' : 'both';

/** The Cleaning and Maintenance departments hold the cleaners' and technicians' logins, which are managed on Workers
 *  only: Users and roles never lists, offers or changes them. */
export const isFieldKind = (kind: DepartmentKind): boolean => kind === 'cleaning' || kind === 'maintenance';
export const needsPosition = (kind: DepartmentKind): boolean => kind !== 'management';

export interface DeskCompany { side: UserSide; label: string; departments: Department[] }

export const deskCompaniesOf = (departments: Department[]): DeskCompany[] =>
  SIDE_OPTIONS
    .map(option => ({
      side: option.value,
      label: option.value === 'both' ? 'Both companies' : option.label,
      departments: departments.filter(department => !isFieldKind(department.kind) && department.side === option.value),
    }))
    .filter(company => company.departments.length > 0);

export const COMPANY_HEADING = 'py-2 px-3 bg-muted hover:bg-page [border-bottom:1px_solid_var(--color-line)] text-ink';
export const DEPARTMENT_HEADING = 'flex items-baseline gap-2 py-2.5 px-4 bg-card [border-bottom:1px_solid_var(--color-line-soft)]';
export const LIST_ROW = 'flex w-full items-center gap-3 text-left border-0 [border-bottom:1px_solid_var(--color-line-soft)] [font-family:inherit] min-h-14 py-2.5 pr-4 pl-8';
export const SAVE_BAR = 'sticky bottom-[var(--sticky-bottom-offset,0px)] z-[2] flex items-center justify-between gap-3 flex-wrap py-3 px-5 max-md:px-4 bg-card [border-top:1px_solid_var(--color-line)]';
export const SELECTED_ROW ='bg-info-bg shadow-[inset_3px_0_0_var(--color-gold)]';
export const KIND_OPTIONS: { value: DepartmentKind; label: string }[] = [
  { value: 'staff', label: 'Staff (office work)' },
  { value: 'management', label: 'Management (full access)' },
];
/** Short note for the kinds that are not set by rules. */
export const KIND_NOTE: Partial<Record<DepartmentKind, string>> = {
  management: 'Management always has full access to everything.',
  cleaning: 'Uses the field app only.',
  maintenance: 'Uses the field app only.',
};

/** The managed list of departments and positions (GET /api/departments). `path` null skips the request. */
export function useDepartments(enabled = true): Query<DepartmentsPayload> {
  return useApi<DepartmentsPayload>(enabled ? '/departments' : null);
}

export interface RoleTarget { departmentId: string; positionId: string | null }

export interface ToggleSet { has: (key: string) => boolean; toggle: (key: string) => void }

export function useToggleSet(): ToggleSet {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setKeys(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return { has: key => keys.has(key), toggle };
}

export const isSameRole =(first: RoleTarget | null, second: RoleTarget): boolean =>
  first !== null && first.departmentId === second.departmentId && first.positionId === second.positionId;

export function useAccessChart(): Query<AccessChart> {
  return useApi<AccessChart>('/users/access');
}

export const visibleCategoriesOf = (categories: AccessCategory[], department: Department): AccessCategory[] =>
  categories.filter(category => !closedBySide(department.kind, department.side, category.group));

export const headCountWithoutPosition = (department: Department): number =>
  department.headCount - department.positions.reduce((total, position) => total + position.headCount, 0);

export const defaultRoleName = (department: Department): string =>
  department.positions.some(position => position.name.trim().toLowerCase() === 'staff') ? 'Staff (no position)' : 'Staff';

export const closedCompanyLabel = (side: UserSide): string => (side === 'conts' ? 'Dream Crafter' : 'The Conts');

/** Small tag next to a value, e.g. Override or Dept. */
export const TAG = 'flex-none text-[11px] leading-none font-semibold py-[3px] px-1.5 rounded-[4px] border border-solid';
