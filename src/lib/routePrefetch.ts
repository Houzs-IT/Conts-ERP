import { prefetch } from './useApi';

/** Today in Malaysia, as the Cleaning board asks for it (components/ops/OpsUi mytDay, which this file must not pull
 *  into the entry script). */
const mytToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

/** The reads a screen makes first, started as soon as its address is opened, so they run while the screen's code is
 *  still downloading instead of after it (performance, 12 Nov 2026: Units' first read started about 0.7 s after the
 *  shell was ready). Each path must be exactly the one the screen's useApi asks for, so the screen joins it rather
 *  than asking again (lib/useApi.ts prefetch). Only reads every visitor of that screen makes on its default view. */
export function prefetchScreen(pathname: string, search: string) {
  const q = new URLSearchParams(search);
  if (pathname === '/operations/cleaning' && (!q.get('tab') || q.get('tab') === 'board')) {
    prefetch(`/housekeeping/board?date=${mytToday()}`);
    prefetch('/housekeeping/cleaners?active=1');
    return;
  }
  if (pathname === '/operations/maintenance') {
    // The full list and its first view are asked together (MaintenancePage).
    prefetch('/maintenance/issues?view=open&limit=50');
    prefetch('/maintenance/issues');
    return;
  }
  const unit = /^\/properties\/units(?:\/([^/]+))?$/.exec(pathname);
  if (unit && unit[1] !== 'new') {
    prefetch('/properties');
    prefetch('/units');
    if (unit[1] && q.get('view') !== 'list') {
      // UnitsRoute decodes the id once more after the router has.
      let id = unit[1];
      try { id = decodeURIComponent(decodeURIComponent(id)); } catch { return; }
      prefetch(`/units/detail?unitId=${encodeURIComponent(id)}`);
    }
  }
}
