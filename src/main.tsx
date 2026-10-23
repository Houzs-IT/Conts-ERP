import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { CrashScreen } from './components/CrashScreen';
import './styles/tokens.css';
import './styles/devices.css';
import './styles/theme-dark.css';
import './styles/hover.css';
import { initTheme } from './lib/theme';
import { setNavigate } from './lib/go';

initTheme();

// Self-heal after a deploy. Pages are lazy-loaded, so a browser holding a stale
// index.html asks for an old chunk hash that no longer exists; Cloudflare Pages
// serves index.html for it and the import fails with a MIME/"failed to fetch
// dynamically imported module" error. Reload once to pick up the fresh
// index.html + chunk names. The sessionStorage guard prevents a reload loop if
// the failure is real (e.g. truly offline). Covers both Vite's preloadError and
// the raw rejected dynamic import.
function healChunkError(reason: unknown): boolean {
  const msg = String((reason as { message?: string })?.message ?? reason ?? '');
  if (!/dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading dynamically imported module/i.test(msg)) return false;
  try {
    // Loop-safe: reload at most once per 10s. A genuine offline failure then
    // stops reloading; a stale-chunk failure heals on the first reload.
    const last = Number(sessionStorage.getItem('chunk-reload-at') ?? 0);
    if (Date.now() - last < 10000) return false;
    sessionStorage.setItem('chunk-reload-at', String(Date.now()));
    window.location.reload();
    return true;
  } catch { return false; /* storage blocked: skip the reload rather than risk a loop */ }
}
// Swallow the error only when a reload is on its way. Swallowed without one, the lazy import resolves to nothing
// and the page crashed blank; left alone it reaches CrashScreen, which offers Reload.
window.addEventListener('vite:preloadError', e => { if (healChunkError((e as unknown as { payload?: unknown }).payload)) e.preventDefault(); });
window.addEventListener('unhandledrejection', e => healChunkError(e.reason));

// Addresses used to carry the screen after a '#' (/#/owners/5). Links already sent by email, WhatsApp or saved as
// bookmarks still do, so they are moved to the plain address before the app reads it.
if (window.location.hash.startsWith('#/')) window.history.replaceState(null, '', window.location.hash.slice(1));

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
setNavigate(router.navigate);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><CrashScreen><RouterProvider router={router} /></CrashScreen></React.StrictMode>
);
