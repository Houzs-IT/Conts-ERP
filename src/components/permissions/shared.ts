import { useApi, type Query } from '../../lib/useApi';
import type { AccessLevel, AccessOrigin, AccessSetting, DepartmentKind, DepartmentsPayload, UserSide } from '../../lib/types';

export const LEVEL_LABEL: Record<AccessLevel, string> = { none: 'No access', view: 'View only', edit: 'Edit', full: 'Full' };
export const LEVEL_NOTE: Record<AccessLevel, string> = {
  none: 'Hidden from the menu and cannot be changed.',
  view: 'Can open and read, cannot change anything.',
  edit: 'Day-to-day work: create and update records.',
  full: 'Everything, including management-only actions such as deleting and approving.',
};
export const LEVEL_COLOR: Record<AccessLevel, string> = {
  none: 'var(--color-neutral-fg)', view: 'var(--color-info-fg)',
  edit: 'var(--color-warning-fg)', full: 'var(--color-success-fg)',
};
export const MUTED = 'var(--color-text-muted)';
export const SELECT = 'h-8 w-full max-w-[200px] px-2 py-0 [font-family:inherit] text-copy bg-card border border-solid rounded-control outline-none';

/** The origin tags on a person's grid. */
export const ORIGIN_LABEL: Record<AccessOrigin, string> = { user: 'Custom', position: 'Position', department: 'Dept', fixed: 'Fixed', none: 'Not set' };

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
  conts: ['Dream Crafter'],
  dream_crafter: ['Workspace', 'Operations', 'Growth'],
  both: [],
};
export const closedBySide = (kind: DepartmentKind, side: UserSide, group: string): boolean => kind !== 'management' && CLOSED_BY_SIDE[side].includes(group);

/** The Cleaning and Maintenance departments hold the cleaners' and technicians' logins, which are managed on Workers
 *  only: Users and roles never lists, offers or changes them. */
export const isFieldKind = (kind: DepartmentKind): boolean => kind === 'cleaning' || kind === 'maintenance';
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

/** A level or 'inherit' to its label; a category with nothing set reads "Not set". */
export const settingLabel = (s: AccessSetting | undefined | null): string => (s && s !== 'inherit' ? LEVEL_LABEL[s] : 'Not set');

/** The managed list of departments and positions (GET /api/departments). `path` null skips the request. */
export function useDepartments(enabled = true): Query<DepartmentsPayload> {
  return useApi<DepartmentsPayload>(enabled ? '/departments' : null);
}

/** Small tag next to a value, e.g. Override or Dept. */
export const TAG = 'flex-none text-[11px] leading-none font-semibold py-[3px] px-1.5 rounded-[4px] border border-solid';
