import { kindOf, type DepartmentKind } from './access';
/**
 * One app, several doors. The host a request arrives on decides which roles may
 * sign in there: owner.theconts.com is for owners only, erp.theconts.com (staff
 * ops door — "ops" is still accepted as an alias) for staff only. Any other host
 * (localhost, *.pages.dev, portal.*) accepts every role.
 */
export type Door = 'owner' | 'ops' | 'any';

export function doorFor(request: Request): Door {
  const host = new URL(request.url).hostname.toLowerCase();
  const first = host.split('.')[0];
  if (first === 'owner') return 'owner';
  if (first === 'ops' || first === 'erp') return 'ops';
  return 'any';
}

/** null when the role may use this door, otherwise the user-safe refusal. */
export function doorRefusal(door: Door, role: string): string | null {
  if (door === 'owner' && role !== 'owner') {
    return 'This sign-in is for unit owners. Staff sign in at erp.theconts.com.';
  }
  if (door === 'ops' && role === 'owner') {
    return 'Owners sign in at owner.theconts.com.';
  }
  return null;
}

/** Where a person lands after signing in, from their department's kind and name (PLAN.md). Login, password reset and
 *  View as all issue a fresh session and tell the client where to send the browser. Management opens the dashboard,
 *  the Finance department the owner statements, every other staff account the day's operations, field accounts their
 *  app, owners their portal. A Dream Crafter-only account would land on a rental screen its side closes (access.ts),
 *  so it starts on the sales orders instead. */
export function homeFor(who: { role: string; kind?: DepartmentKind | null; side?: string; department?: string | null }): string {
  const { role, side, department } = who;
  if (role === 'owner') return '/owner';
  const kind = kindOf({ role, kind: who.kind });
  if (kind === 'management') return '/';
  if (kind === 'cleaning' || kind === 'maintenance') return '/worker/today';
  if (department?.trim().toLowerCase() === 'finance') return '/owners?view=statements';
  return side === 'dream_crafter' ? '/sales/orders' : '/operations/today';
}
