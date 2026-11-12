import { prefetch, prefetchAs } from './useApi';
import { readDevice } from './deviceClass';
import { bookingsPath, guestsListPath } from './screenQueries';

/** Today in Malaysia, yyyy-mm-dd, as the screens ask for it (components/ops/OpsUi mytDay, lib/format todayMyt, which
 *  this file must not pull into the entry script). */
const mytToday = (offsetDays = 0) => new Date(Date.now() + 8 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** The month before this one in Malaysia, yyyy-mm (the Unit report's default month). */
const lastMonth = () => {
  const t = mytToday();
  let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) - 1;
  if (!m) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
};

interface Who { role?: string; access?: Record<string, string> }

/** The reads a screen makes first, started as soon as its address is opened, so they run while the screen's code is
 *  still downloading instead of after it (performance, 12 Nov 2026: a screen's first read started 0.5-0.9 s after the
 *  shell was ready). Each path must be exactly the one the screen's useApi asks for, so the screen joins it rather
 *  than asking again (lib/useApi.ts prefetch). Only reads every visitor of that screen makes on its default view: an
 *  address carrying a filter the screen reads into its query is left to the screen, unless the query is built in
 *  lib/screenQueries.ts, which both use. */
export function prefetchScreen(pathname: string, search: string, who?: Who | null) {
  const q = new URLSearchParams(search);
  switch (pathname) {
    case '/': {
      // DashboardPage: the four parts everyone sees, and Portfolio's two for those who may open Portfolio.
      prefetch('/dashboard/kpis');
      prefetch('/dashboard/trend?range=12m');
      prefetch('/dashboard/today');
      prefetch('/dashboard/exceptions');
      const portfolio = who?.role === 'management' ? 'full' : who?.access?.portfolio ?? 'none';
      if (portfolio !== 'none') { prefetch('/portfolio/performance'); prefetch('/dashboard/channels'); }
      return;
    }
    case '/reservations/calendar': {
      // CalendarPage's board on a tablet or computer, on its default window (a phone opens the one-unit month instead).
      if (readDevice().cls === 'phone' || ['start', 'w', 'days', 'b'].some(k => q.get(k))) return;
      const from = plusDays(mytToday(), -2); // LEAD_DAYS (components/calendar/DatePicker)
      prefetch(`/reservations/calendar?from=${from}&to=${plusDays(from, 30 - 1)}`); // SPAN days
      prefetch('/integrations');
      return;
    }
    case '/reservations/bookings':
      prefetch(bookingsPath(q));
      prefetch('/units'); // the unit roster (lib/useUnitRoster)
      return;
    case '/reservations/guests':
      prefetch(guestsListPath(q));
      return;
    case '/operations/today':
      prefetch(`/operations/day?date=${mytToday()}`);
      return;
    case '/operations/cleaning':
      if (!q.get('tab') || q.get('tab') === 'board') {
        prefetch(`/housekeeping/board?date=${mytToday()}`);
        prefetch('/housekeeping/cleaners?active=1');
      }
      return;
    case '/operations/maintenance':
      // The full list and its first view are asked together (MaintenancePage).
      prefetch('/maintenance/issues?view=open&limit=50');
      prefetch('/maintenance/issues');
      return;
    case '/owners':
      if (q.get('month') || q.get('view')) return;
      prefetch('/owners');
      prefetch('/contract-types'); // lib/useContractTypes
      return;
    case '/portfolio/owner-report':
      if (q.get('month')) return;
      prefetch(`/portfolio/owner-report?month=${lastMonth()}`);
      return;
  }
  const unit = /^\/properties\/units(?:\/([^/]+))?$/.exec(pathname);
  if (unit && unit[1] !== 'new') {
    prefetch('/properties');
    prefetch('/units');
    prefetch('/contract-types'); // lib/useContractTypes
    if (q.get('view') === 'list') return;
    if (unit[1]) {
      // UnitsRoute decodes the id once more after the router has.
      let id = unit[1];
      try { id = decodeURIComponent(decodeURIComponent(id)); } catch { return; }
      prefetch(`/units/detail?unitId=${encodeURIComponent(id)}`);
    } else {
      // No unit in the address: the screen opens the first unit of its tree, which it only knows once /properties is in.
      // The server picks that unit by the same rule (?first=1) and sends its record now; the screen's read of
      // /units/detail?unitId=<that unit> then waits for this one instead of starting after the tree (lib/useApi.ts).
      prefetchAs<{ unit?: { id?: string } }>('/units/detail?first=1', '/units/detail?unitId=',
        r => (r.unit?.id ? `/units/detail?unitId=${encodeURIComponent(r.unit.id)}` : null));
    }
  }
}
