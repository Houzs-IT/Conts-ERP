import { useEffect, useState } from 'react';

const CHECK_EVERY_MS = 5 * 60_000;
const REMIND_AFTER_MS = 30 * 60_000;

/** Tells someone with Conts open that a newer version has been deployed. Compares this bundle's build id
 *  with dist/version.json every few minutes and whenever the tab comes back into view. It never reloads
 *  by itself, so a half-filled form is not lost; the user reloads when ready. */
export default function UpdateNotice() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    async function check() {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (!(live && version && version !== __BUILD_ID__)) return;
        // Nothing can be lost on the sign-in screen, so take the new version straight away.
        if (window.location.hash.startsWith('#/login') || window.location.pathname.endsWith('/login')) { window.location.reload(); return; }
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
      className="fixed left-1/2 -translate-x-1/2 bottom-5 z-[90] flex items-center gap-3 max-w-[calc(100vw-24px)] py-2.5 pl-4 pr-2.5 rounded-card bg-black text-white shadow-[var(--shadow-overlay)] text-[13.5px]">
      <span>A new version of The Conts is ready. Reloading takes a second and keeps you signed in.</span>
      <button type="button" onClick={() => window.location.reload()}
        className="h-8 px-3 rounded-control border-none cursor-pointer font-sans text-[13px] font-semibold bg-gold text-black whitespace-nowrap">Reload</button>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Later"
        className="h-8 px-2 rounded-control border-none cursor-pointer font-sans text-[13px] bg-transparent text-white/70 hover:text-white whitespace-nowrap">Later</button>
    </div>
  );
}
