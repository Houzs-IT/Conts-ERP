import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sizes a scroll box (a long table) so it ends exactly at the bottom of the app's scrolling area.
 *
 * A fixed height (the old `calc(100dvh - 300px)`) was wrong both ways: on a tall window it stopped short and left an
 * empty band under the list, and on a short one the page scrolled as well as the table, so two scrollbars fought.
 * Here the box takes the room left under whatever sits above it, so a list page has one scroller and its header stays
 * in view. When the content above leaves too little room (a report with charts first), the box takes a full screen
 * instead and the page scrolls it into view once.
 *
 * Only inside the app shell's scrolling area (`[data-app-main]`); elsewhere (a dialog, the owner portal) the box keeps
 * `fallback`.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, { enabled = true, min = 240, fallback }: { enabled?: boolean; min?: number; fallback: string }) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const main = enabled ? box.closest<HTMLElement>('[data-app-main]') : null;
    if (!main || box.closest('[role=dialog], [role=alertdialog]')) {
      box.style.maxHeight = fallback;
      return;
    }
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!box.isConnected || box.offsetParent === null) return; // hidden: the phone shows cards instead
        const mr = main.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        const top = br.top - mr.top + main.scrollTop;
        let end = 0;
        for (const c of main.children) end = Math.max(end, c.getBoundingClientRect().bottom - mr.top + main.scrollTop);
        end += parseFloat(getComputedStyle(main).paddingBottom) || 0;
        const below = Math.max(0, end - (top + br.height));
        const view = main.clientHeight;
        let h = view - top - below;
        if (h < Math.max(min, view * 0.45)) h = view - below;
        const px = `${Math.max(min, Math.floor(h))}px`;
        if (box.style.maxHeight !== px) box.style.maxHeight = px;
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(main);
    for (const c of main.children) ro.observe(c);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [ref, enabled, min, fallback]);
}
