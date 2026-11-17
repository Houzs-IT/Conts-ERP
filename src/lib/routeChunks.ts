/** The code of the main rental screens, fetched when the pointer rests on their menu link (Sidebar.tsx), so a click
 *  finds it downloaded or on its way (performance, 12 Nov 2026: a screen's first read waited 0.5-0.9 s behind its code).
 *  Each import is the same file App.tsx loads lazily, so the browser fetches the one chunk once, whichever asks first. */
const CHUNKS: Record<string, () => Promise<unknown>> = {
  '/': () => import('../pages/DashboardPage'),
  '/reservations/calendar': () => import('../pages/CalendarPage'),
  '/reservations/bookings': () => import('../pages/BookingsPage'),
  '/reservations/guests': () => import('../pages/GuestsPage'),
  '/operations/today': () => import('../pages/OperationsTodayPage'),
  '/operations/cleaning': () => import('../pages/CleaningPage'),
  '/operations/maintenance': () => import('../pages/MaintenancePage'),
  '/properties/units': () => import('../pages/UnitsPage'),
  '/owners': () => import('../pages/OwnersPage'),
  '/owners/statements': () => import('../pages/StatementsPage'),
  '/owners/payouts': () => import('../pages/PayoutsPage'),
  '/owners/contracts': () => import('../pages/ContractsPage'),
  '/portfolio/owner-report': () => import('../pages/OwnerOverallReportPage'),
  '/reports/yearly': () => import('../pages/YearlyReportPage'),
  '/reports/ygrr': () => import('../pages/YgrrReportPage'),
};

const asked = new Set<string>();

/** Starts downloading the screen at `path` (no-op for a screen not listed, or one already asked for). */
export function preloadRoute(path: string | undefined) {
  if (!path) return;
  const key = path.split('?')[0];
  const load = CHUNKS[key];
  if (!load || asked.has(key)) return;
  asked.add(key);
  // A failed download is retried by the screen's own lazy import when it is opened.
  load().catch(() => asked.delete(key));
}
