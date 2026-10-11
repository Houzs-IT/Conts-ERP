import { useLayoutEffect, useState } from 'react';

/**
 * Sizes a scroll box (a long table, a side list) so it ends exactly at the bottom of the app's scrolling area.
 *
 * A fixed height (`calc(100dvh - 300px)`, `70vh`, `calc(100vh - 100px)`) was wrong both ways: on a tall window it
 * stopped short and left an empty band under the list, and on a short one the box ran past the bottom of the window,
 * so the page scrolled as well as the list and the end of the list was cut off until it did.
 *
 * - Default (a list that is the page's main content, like a table under its toolbar): the box takes the room left
 *   under whatever sits above it, less whatever must stay visible under it (the pager), so the page has one scroller.
 *   When the content above leaves too little room (a report with charts first), the box takes a full screen instead
 *   and the page scrolls it into view once.
 * - `column` (a side list next to a taller record, usually `position: sticky`): only the box's own column counts, and
 *   the size follows the page's scroll so the list always runs from where it is shown to the bottom of the window.
 *
 * Only inside the app shell's scrolling area (`[data-app-main]`); elsewhere (a dialog, the owner portal) the box keeps
 * `fallback`. Returns the ref to put on the box (it may mount after the page, once rows load).
 */
export function useFillHeight({
  enabled = true, min = 240, fallback, column = false, prop = 'maxHeight',
}: { enabled?: boolean; min?: number; fallback: string; column?: boolean; prop?: 'maxHeight' | 'height' }) {
  const [box, setBox] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!box) return;
    const main = enabled ? box.closest<HTMLElement>('[data-app-main]') : null;
    if (!main || box.closest('[role=dialog], [role=alertdialog]')) {
      box.style[prop] = fallback;
      return;
    }
    let raf = 0;
    const set = (h: number) => {
      const px = `${Math.max(min, Math.floor(h))}px`;
      if (box.style[prop] !== px) box.style[prop] = px;
    };
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!box.isConnected || box.offsetParent === null) return; // hidden: the phone shows cards instead
        const mr = main.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        const padBottom = parseFloat(getComputedStyle(main).paddingBottom) || 0;
        const view = main.clientHeight;
        if (column) {
          // Where the box shows now (it may be stuck under the top), and what of its own column must show under it.
          let sticky: HTMLElement | null = null;
          for (let el: HTMLElement | null = box; el && el !== main; el = el.parentElement) {
            if (getComputedStyle(el).position === 'sticky') { sticky = el; break; }
          }
          let shownTop = br.top - mr.top;
          if (sticky) {
            const sr = sticky.getBoundingClientRect();
            const stuckTop = (parseFloat(getComputedStyle(sticky).top) || 0) + (br.top - sr.top);
            shownTop = Math.max(stuckTop, shownTop);
          }
          const holder = sticky ?? box.parentElement ?? box;
          const under = Math.max(0, holder.getBoundingClientRect().bottom - br.bottom);
          set(view - shownTop - under - padBottom);
          return;
        }
        const top = br.top - mr.top + main.scrollTop;
        let end = 0;
        for (const c of main.children) end = Math.max(end, c.getBoundingClientRect().bottom - mr.top + main.scrollTop);
        end += padBottom;
        const below = Math.max(0, end - (top + br.height));
        let h = view - top - below;
        if (h < Math.max(min, view * 0.45)) h = view - below;
        set(h);
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(main);
    for (const c of main.children) ro.observe(c);
    if (column) main.addEventListener('scroll', fit, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (column) main.removeEventListener('scroll', fit);
    };
  }, [box, enabled, min, fallback, column, prop]);
  return setBox;
}
