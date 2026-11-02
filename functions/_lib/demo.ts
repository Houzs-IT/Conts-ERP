import { type Env, one } from './db';
import type { Session } from './auth';

/** Demo mode (Owner Hub plan, owner, 2 Nov 2026; migration 0199). A staff member's own switch: while it is on, the
 *  screens that read through tablesFor() show the real rows (read live) together with the sample rows in schema demo,
 *  and their changes to reservations and reviews save as sample data. The owner portal API, statements, payouts,
 *  accounting, exports and the channel outbox never call tablesFor(): they name the pos tables in their own SQL. */

export const DEMO_COOKIE = 'tc_demo';

/** Who may turn Demo mode on (owner, 2 Nov 2026): management and sales staff. Sales staff are desk accounts in the
 *  Sales department. Owner, cleaner and technician accounts never may (the session middleware also keeps them off
 *  /api/demo). */
const DEMO_DEPARTMENTS = ['sales'];

export async function demoAllowed(env: Env, session: Pick<Session, 'role' | 'departmentId'>): Promise<boolean> {
  if (session.role === 'management') return true;
  if (session.role !== 'operations_staff' || !session.departmentId) return false;
  const d = await one<{ name: string }>(env, 'SELECT name FROM departments WHERE id = ?', session.departmentId);
  return !!d && DEMO_DEPARTMENTS.includes(d.name.trim().toLowerCase());
}

/** Whether the browser asked for Demo mode (the switch's cookie). Never enough on its own: see demoOn. */
export const demoAsked = (request: Request): boolean =>
  new RegExp(`(?:^|;\\s*)${DEMO_COOKIE}=1(?:;|$)`).test(request.headers.get('cookie') ?? '');

/** Demo mode is on for this request: the switch is on and the person may use it, checked on every request. */
export async function demoOn(env: Env, request: Request, session: Pick<Session, 'role' | 'departmentId'>): Promise<boolean> {
  return demoAsked(request) && demoAllowed(env, session);
}

export interface Tables { reservations: string; reviews: string; units: string; owners: string; guests: string }
const LIVE: Tables = { reservations: 'reservations', reviews: 'reviews', units: 'units', owners: 'owners', guests: 'guests' };
const SAMPLE: Tables = { reservations: 'demo.v_reservations', reviews: 'demo.v_reviews', units: 'demo.v_units', owners: 'demo.v_owners', guests: 'demo.v_guests' };

/** The one place a screen's reads pick their source: the pos tables live, the combined views in Demo mode. The views
 *  carry demo_source ('real' | 'shadow' | 'demo'); sourceSql gives the same column on the pos tables. */
export const tablesFor = (demo: boolean): Tables => (demo ? SAMPLE : LIVE);
export const sourceSql = (demo: boolean, alias: string) => (demo ? `${alias}.demo_source` : `'real'::text`);

/** The marker a list row carries in Demo mode: 'demo' for a sample row, 'shadow' for a real row changed in Demo mode. */
export const sampleOf = (source: unknown): 'demo' | 'shadow' | undefined =>
  source === 'demo' || source === 'shadow' ? source : undefined;

export const newDemoId = (kind: 'r' | 'v' | 'g' | 'u' | 'o') => `demo-${kind}-${crypto.randomUUID()}`;
