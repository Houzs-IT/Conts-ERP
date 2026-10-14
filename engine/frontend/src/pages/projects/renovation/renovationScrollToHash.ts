/* Opening a renovation project at one of its sections (the Project List's step track links to
   /projects/:id#reno-design and the like, owner 15 Oct 2026). The page renders after its data loads, so the
   browser's own jump to the #id finds nothing; this waits for the section to appear, scrolls to it and
   outlines it for a moment. Only #reno-* hashes are handled. */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const WAIT_MS = 10_000;
const FLASH = ["ring-2", "ring-primary/60", "ring-offset-2"];

export function useScrollToRenovationSection(ready: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !/^#reno-[a-z-]+$/.test(hash)) return;
    const id = hash.slice(1);
    let done = false;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const go = (): boolean => {
      const el = document.getElementById(id);
      if (!el) return false;
      done = true;
      el.style.scrollMarginTop = "72px";
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.classList.add(...FLASH);
      flashTimer = setTimeout(() => el.classList.remove(...FLASH), 1800);
      return true;
    };
    if (go()) return () => clearTimeout(flashTimer);
    const obs = new MutationObserver(() => { if (!done && go()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    const stop = setTimeout(() => obs.disconnect(), WAIT_MS);
    return () => { obs.disconnect(); clearTimeout(stop); clearTimeout(flashTimer); };
  }, [hash, ready]);
}
