// Back goes to where the page was opened from (chew, 19 Nov 2026: "finance 很多页面尤其是点 pv 那些时的返回"). The pages
// this tab visited are kept in order; Back walks it to the last page that is not this one and not a form passed through
// on the way (New, Edit, Copy, Print, Scan): saving a new voucher lands on the voucher, and Back from it returns to the
// list or ledger it was started from, not to the blank form. Opened with nothing behind it (a link, a fresh tab), Back
// falls to the page's own list as before. sessionStorage, per tab, same-origin paths only.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const BACK_TRAIL_KEY = "conts.backTrail.v1";
const MAX = 40;

const read = (): string[] => {
  try {
    const raw = sessionStorage.getItem(BACK_TRAIL_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.startsWith("/") && !x.startsWith("//")) : [];
  } catch {
    return [];
  }
};
const write = (trail: string[]) => {
  try { sessionStorage.setItem(BACK_TRAIL_KEY, JSON.stringify(trail.slice(-MAX))); } catch { /* storage blocked: Back falls to the list */ }
};
const pathOf = (p: string) => p.split("?")[0]!.split("#")[0]!.replace(/\/+$/, "");

/** A form passed through on the way, never a place to go back to. */
export function isPassThrough(p: string): boolean {
  const path = pathOf(p);
  const q = new URLSearchParams(p.includes("?") ? p.slice(p.indexOf("?") + 1) : "");
  return /\/(new|scan)$/.test(path) || /\/new\//.test(path) || q.has("edit") || q.has("copyFrom") || q.has("print");
}

/** Keep the trail: a new page is added; the same page with another query (a filter, a tab) replaces its own entry. */
export function recordVisit(trail: string[], here: string): string[] {
  const last = trail.at(-1);
  if (last === here) return trail;
  if (last != null && pathOf(last) === pathOf(here)) return [...trail.slice(0, -1), here];
  return [...trail, here];
}

/** Where Back goes from `here`, and the trail cut back to it; null when nothing is behind this page. */
export function backFrom(trail: string[], here: string): { to: string; trail: string[] } | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    const p = trail[i]!;
    if (pathOf(p) === pathOf(here) || isPassThrough(p)) continue;
    return { to: p, trail: trail.slice(0, i + 1) };
  }
  return null;
}

/** The page Back should open from `here` (cutting the trail to it), else null. */
export function takeBack(here: string): string | null {
  const r = backFrom(read(), here);
  if (!r) return null;
  write(r.trail);
  return r.to;
}

/** Records every page this tab opens; mounted once, inside the router. */
export function BackTrailRecorder(): null {
  const loc = useLocation();
  const here = `${loc.pathname}${loc.search}`;
  useEffect(() => { write(recordVisit(read(), here)); }, [here]);
  return null;
}
