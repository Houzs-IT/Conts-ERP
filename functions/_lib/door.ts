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

/** role -> landing path. Shared by login and password-reset, both of which issue
 *  a fresh session and need to tell the client where to send the browser. */
export const HOME: Record<string, string> = {
  management: '/', operations_manager: '/', operations_staff: '/operations/today',
  finance_admin: '/owners?view=statements', housekeeper: '/worker/today',
  technician: '/worker/today', owner: '/owner',
};
