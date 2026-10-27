import { useEffect, useRef, useState } from 'react';

/** Live updates for the field app (cleaners and technicians). The bell asks for new notices every 15 seconds; when one
 *  arrives it announces it here, and the job lists reload at once instead of waiting for their own minute or a refresh. */

export const FIELD_CHANGED = 'conts:field-changed';
export const announceFieldChanged = (): void => { window.dispatchEvent(new Event(FIELD_CHANGED)); };

/** Runs `reload` when a new notice arrives and when the phone comes back to the app (focus, page shown, back online). */
export function useFieldRefresh(reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    // Coming back to the app fires focus, pageshow and more at once; one reload is enough.
    let last = 0;
    const go = (): void => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 2000) return;
      last = Date.now();
      latest.current();
    };
    const events = [[window, FIELD_CHANGED], [window, 'online'], [window, 'pageshow'], [window, 'focus']] as const;
    events.forEach(([target, name]) => target.addEventListener(name, go));
    return () => events.forEach(([target, name]) => target.removeEventListener(name, go));
  }, []);
}

/** How long a job that just arrived keeps its "New" mark. */
const FRESH_MS = 120_000;

/** The ids that were not in the list before: the first full load only sets the baseline, so nothing is "new" on opening
 *  the app. `scope` names which list this is (a day, a tab): changing it starts a new baseline. `ready` is false while the
 *  list for that scope has not loaded. */
export function useFreshIds(ids: readonly string[], scope: string, ready: boolean): ReadonlySet<string> {
  const seen = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join('|');
  useEffect(() => {
    if (!ready) return;
    const before = seen.current;
    if (!before || before.scope !== scope) { seen.current = { scope, ids: new Set(ids) }; setFresh(new Set()); return; }
    const added = ids.filter(id => !before.ids.has(id));
    ids.forEach(id => before.ids.add(id));
    if (added.length === 0) return;
    setFresh(f => new Set([...f, ...added]));
    window.setTimeout(() => setFresh(f => new Set([...f].filter(id => !added.includes(id)))), FRESH_MS);
  }, [key, scope, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return fresh;
}
