/**
 * useHighlightParam.ts: "show me where it is" (owner, 27 Nov 2026).
 *
 * When the address carries ?highlight=<label> (the AI Connector's how_to / where_is / explain_screen links do), find
 * the visible element whose text matches the label (retrying for about 3 s while the screen loads its data), scroll it
 * into view, draw a pulsing gold outline with a small "Here" tag over it for about 6 s, then drop the parameter from the
 * address with replaceState.
 *
 * Read-only by design: it never clicks, focuses or changes the element; the outline is a separate
 * pointer-events:none overlay. No parameter: does nothing. requestAnimationFrame only, no timers. On a supply chain
 * engine screen the button sits inside the engine's frame, which this cannot reach: nothing is found and the
 * parameter is dropped after the 3 s.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { findHighlightElement } from './highlightMatch';

const FIND_FOR_MS = 3000;
const SHOW_FOR_MS = 6000;
const STYLE_ID = 'conts-highlight-style';

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const st = doc.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `@keyframes conts-highlight-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--color-brand-gold) 55%,transparent)}50%{box-shadow:0 0 0 8px transparent}}
[data-highlight-overlay]{position:fixed;pointer-events:none;z-index:2147483000;border:3px solid var(--color-brand-gold);border-radius:8px;animation:conts-highlight-pulse 1.2s ease-in-out infinite}
[data-highlight-overlay] > span{position:absolute;left:50%;bottom:100%;transform:translate(-50%,-6px);background:var(--color-brand-gold);color:var(--color-brand-black);font:600 12px/1.2 system-ui,sans-serif;padding:3px 8px;border-radius:6px;white-space:nowrap}
@media (prefers-reduced-motion: reduce){[data-highlight-overlay]{animation:none}}`;
  doc.head.appendChild(st);
}

/** Remove ?highlight from the address bar without a navigation (keeps router state). */
function dropParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('highlight')) return;
  url.searchParams.delete('highlight');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useHighlightParam(): void {
  const { search, pathname } = useLocation();
  useEffect(() => {
    const label = new URLSearchParams(search).get('highlight');
    if (!label || !label.trim()) return;
    const doc = document;
    let raf = 0;
    let overlay: HTMLDivElement | null = null;
    let target: HTMLElement | null = null;
    const t0 = performance.now();
    let shownAt = 0;
    let stopped = false;

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      overlay?.remove();
      overlay = null;
    };
    const place = () => {
      if (!overlay || !target) return;
      const r = target.getBoundingClientRect();
      const pad = 4;
      Object.assign(overlay.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    };
    const tick = (now: number) => {
      if (stopped) return;
      if (!target) {
        // The screen's own content first, so a menu entry with the same name is not outlined instead.
        const main = doc.querySelector('main') as Pick<ParentNode, 'querySelectorAll'> | null;
        target = (main && findHighlightElement(main, label)) || findHighlightElement(doc, label);
        if (target) {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          ensureStyle(doc);
          overlay = doc.createElement('div');
          overlay.setAttribute('data-highlight-overlay', '');
          overlay.setAttribute('aria-hidden', 'true');
          const tag = doc.createElement('span');
          tag.textContent = 'Here';
          overlay.appendChild(tag);
          doc.body.appendChild(overlay);
          shownAt = now;
          dropParam();
        } else if (now - t0 > FIND_FOR_MS) {
          dropParam();
          return;
        }
      }
      if (target) {
        if (now - shownAt > SHOW_FOR_MS || !target.isConnected) { cleanup(); return; }
        place();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return cleanup;
  }, [search, pathname]);
}

/** Mount once inside the router: outlines the element named by ?highlight=<label>. Renders nothing. */
export function HighlightFromUrl(): null {
  useHighlightParam();
  return null;
}
