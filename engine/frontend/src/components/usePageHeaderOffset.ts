import { useEffect, useRef } from "react";

/** Publishes where a pinned page header ENDS as `--page-header-offset` on <html>, for frozen table headers and
 *  scroll-into-view targets to clear. Measured, not guessed: the height changes with breakpoint and wrapping. */
export function usePageHeaderOffset() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      const stickyTop = parseFloat(getComputedStyle(el).top);
      const offset = (Number.isFinite(stickyTop) ? stickyTop : 0) + el.offsetHeight;
      document.documentElement.style.setProperty("--page-header-offset", `${offset}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    // The sticky `top` is breakpoint-dependent, and a resize that changes only
    // the breakpoint may not change our own box, so observe the viewport too.
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
      document.documentElement.style.removeProperty("--page-header-offset");
    };
  }, []);
  return hostRef;
}
