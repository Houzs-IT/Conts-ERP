import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useNavigationType } from 'react-router-dom';

/** Where each screen was scrolled to, for this tab only (the content area and any `[data-keep-scroll]` box in it). */
const KEY = 'conts.scroll';
type Saved = Record<string, Record<string, number>>;

function read(): Saved {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Saved; } catch { return {}; }
}
function write(all: Saved) {
  try { sessionStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: positions simply are not kept */ }
}

function snapshot(main: HTMLElement): Record<string, number> {
  const pos: Record<string, number> = { main: main.scrollTop };
  main.querySelectorAll<HTMLElement>('[data-keep-scroll]').forEach(el => { if (el.scrollTop) pos[el.dataset.keepScroll!] = el.scrollTop; });
  return pos;
}

/**
 * The app shell's content area keeps one scroll position per screen.
 * - Opening another screen starts it at the top (the content area outlives the page, so it used to keep the old offset).
 * - Back and Forward return to where that list was, once its rows have loaded; any wheel, touch or key stops the wait.
 * - A change of filters or tab on the same screen (query string only) does not move the page.
 * - The content area takes focus on a new screen, so PageUp/PageDown and the arrows scroll it without a click first.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, path: string) {
  const navType = useNavigationType();
  const shown = useRef(path);

  useEffect(() => {
    const main = ref.current;
    if (!main) return;
    // The snapshot is taken as the screen scrolls: by the time this effect is cleaned up the next screen is already in.
    let t = 0;
    let last: Record<string, number> | null = null;
    const save = () => { if (!last) return; const all = read(); all[path] = last; write(all); last = null; };
    const onScroll = () => { if (shown.current !== path) return; last = snapshot(main); window.clearTimeout(t); t = window.setTimeout(save, 150); };
    main.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => { window.clearTimeout(t); main.removeEventListener('scroll', onScroll, { capture: true }); save(); };
  }, [ref, path]);

  useLayoutEffect(() => {
    const main = ref.current;
    if (!main) return;
    shown.current = path;
    const want = navType === 'POP' ? read()[path] : undefined;
    main.scrollTop = 0;

    // Focus the content area unless the new screen already put the cursor somewhere (a search box).
    const focusMain = () => {
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected) main.focus({ preventScroll: true });
    };
    const ft = window.setTimeout(focusMain, 0);

    if (!want) return () => window.clearTimeout(ft);
    // Rows arrive after the screen mounts: retry until each box is tall enough or the person scrolls themselves.
    let stopped = false;
    const stop = () => { stopped = true; };
    const opts = { passive: true, capture: true } as const;
    main.addEventListener('wheel', stop, opts);
    main.addEventListener('touchstart', stop, opts);
    window.addEventListener('keydown', stop, opts);
    const started = Date.now();
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      let done = true;
      for (const [k, top] of Object.entries(want)) {
        const el = k === 'main' ? main : main.querySelector<HTMLElement>(`[data-keep-scroll="${CSS.escape(k)}"]`);
        if (!el) { done = false; continue; }
        if (Math.abs(el.scrollTop - top) > 1) {
          el.scrollTop = top;
          if (Math.abs(el.scrollTop - top) > 1) done = false;
        }
      }
      if (!done && Date.now() - started < 4000) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      window.clearTimeout(ft);
      cancelAnimationFrame(raf);
      main.removeEventListener('wheel', stop, opts);
      main.removeEventListener('touchstart', stop, opts);
      window.removeEventListener('keydown', stop, opts);
    };
  }, [ref, path, navType]);
}
