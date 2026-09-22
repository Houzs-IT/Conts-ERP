import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';

// Self-heal after a deploy. Pages are lazy-loaded, so a browser holding a stale
// index.html asks for an old chunk hash that no longer exists; Cloudflare Pages
// serves index.html for it and the import fails with a MIME/"failed to fetch
// dynamically imported module" error. Reload once to pick up the fresh
// index.html + chunk names. The sessionStorage guard prevents a reload loop if
// the failure is real (e.g. truly offline). Covers both Vite's preloadError and
// the raw rejected dynamic import.
function healChunkError(reason: unknown) {
  const msg = String((reason as { message?: string })?.message ?? reason ?? '');
  if (!/dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading dynamically imported module/i.test(msg)) return;
  try {
    // Loop-safe: reload at most once per 10s. A genuine offline failure then
    // stops reloading; a stale-chunk failure heals on the first reload.
    const last = Number(sessionStorage.getItem('chunk-reload-at') ?? 0);
    if (Date.now() - last < 10000) return;
    sessionStorage.setItem('chunk-reload-at', String(Date.now()));
    window.location.reload();
  } catch { /* storage blocked: skip the reload rather than risk a loop */ }
}
window.addEventListener('vite:preloadError', e => { e.preventDefault(); healChunkError((e as unknown as { payload?: unknown }).payload); });
window.addEventListener('unhandledrejection', e => healChunkError(e.reason));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>
);
