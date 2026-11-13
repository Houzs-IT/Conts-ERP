import { useEffect, useState } from 'react';
import { BUILD_ID } from '../lib/buildId';
import { hasUnsavedWork, NEW_VERSION_EVENT } from '../lib/unsavedWork';

const CHECK_EVERY_MS = 5 * 60_000;
const REMIND_AFTER_MS = 30 * 60_000;

/** Tells someone with Conts open that a newer version has been deployed. Compares this bundle's build id
 *  with dist/version.json every few minutes and whenever the tab comes back into view. It never reloads
 *  by itself, so a half-filled form is not lost; the user reloads when ready. */
export default function UpdateNotice() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // A deploy took away a file this tab needed while a form held unsaved typing (main.tsx): no reload by itself, and
  // the notice asks for the work to be saved first.
  const [saveFirst, setSaveFirst] = useState(false);

  useEffect(() => {
    const onNewVersion = () => { setStale(true); setDismissed(false); setSaveFirst(hasUnsavedWork()); };
    window.addEventListener(NEW_VERSION_EVENT, onNewVersion);
    return () => window.removeEventListener(NEW_VERSION_EVENT, onNewVersion);
  }, []);

  useEffect(() => {
    let live = true;
    let last = 0;
    async function check() {
      // Coming back to the tab fires both focus and visibilitychange: one request is enough.
      if (Date.now() - last < 10_000) return;
      last = Date.now();
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (!(live && version && BUILD_ID && version !== BUILD_ID)) return;
        // Nothing can be lost on the sign-in screen, so take the new version straight away.
        if (window.location.pathname.endsWith('/login')) { window.location.reload(); return; }
        setStale(true);
      } catch { /* offline or mid-deploy: try again at the next check */ }
    }
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, []);

  // "Later" hides it for a while, not for good: an old tab would otherwise stay old all day.
  useEffect(() => {
    if (!dismissed) return;
    const t = window.setTimeout(() => setDismissed(false), REMIND_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [dismissed]);

  if (!stale || dismissed) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 bottom-5 z-[90] flex items-center gap-3 w-[min(560px,calc(100vw-24px))] py-2.5 pl-4 pr-2.5 rounded-card bg-black text-white shadow-[var(--shadow-overlay)] text-[13.5px] max-md:left-3 max-md:right-3 max-md:w-auto max-md:translate-x-0 max-md:bottom-[calc(76px+env(safe-area-inset-bottom))] [body:has([data-action-bar])_&]:bottom-[calc(104px+env(safe-area-inset-bottom))]">
      <span className="flex-1 min-w-0 leading-snug">{saveFirst
        ? 'A new version of The Conts is ready. Save your work, then reload.'
        : 'A new version of The Conts is ready. Reloading keeps you signed in.'}</span>
      <button type="button" onClick={() => window.location.reload()}
        className="h-8 px-3 rounded-control border-none cursor-pointer font-sans text-[13px] font-semibold bg-gold text-black whitespace-nowrap">Reload</button>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Later"
        className="h-8 px-2 rounded-control border-none cursor-pointer font-sans text-[13px] bg-transparent text-white/70 hover:text-white whitespace-nowrap">Later</button>
    </div>
  );
}
