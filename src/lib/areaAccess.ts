import type { AccessLevel, SessionUser } from './types';

/**
 * The person's level in a permission area, from the levels the session carries (Users and roles > Permissions).
 * Management is Full everywhere; the field app and owner portal have no desk areas. A session that predates the
 * levels reads as Edit so a button is not hidden by mistake: the server still refuses what the person may not do.
 */
export function levelOf(user: SessionUser | null | undefined, area: string): AccessLevel {
  if (!user) return 'none';
  if (user.role === 'management') return 'full';
  if (user.role === 'housekeeper' || user.role === 'technician' || user.role === 'owner') return 'none';
  return user.access ? user.access[area] ?? 'none' : 'edit';
}

/** Can open the area's screens. */
export const maySee = (user: SessionUser | null | undefined, area: string): boolean => levelOf(user, area) !== 'none';

/** Can create and change records in the area (Edit or Full). */
export const mayWork = (user: SessionUser | null | undefined, area: string): boolean => {
  const level = levelOf(user, area);
  return level === 'edit' || level === 'full';
};

/** Has Full on the area: approving, deleting and other management-only actions. */
export const mayRun = (user: SessionUser | null | undefined, area: string): boolean => levelOf(user, area) === 'full';
