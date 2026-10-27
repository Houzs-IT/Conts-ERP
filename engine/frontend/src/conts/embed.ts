// Conts only (not part of Houzs's code): running inside Property OS.
//
// Property OS shows these screens in a frame under its own Supply chain menu. It signs the person in on
// their behalf and hands the session over in the address fragment (never sent to a server, removed at
// once), then tells the frame where to go when a menu item is clicked. Inside the frame this app hides
// its own side menu: Property OS's menu is the one people use.
import { tokenStore, passStore } from "../api/client";
import "./embed.css";

/** Pages allowed to hold this app in a frame and steer it. */
const PARENTS = [
  /^https:\/\/erp\.theconts\.com$/,
  /^https:\/\/([a-z0-9-]+\.)?theconts-os\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];
const trusted = (origin: string) => PARENTS.some((p) => p.test(origin));

export const CONTS_EMBEDDED: boolean = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

// Inside the frame this app's own top bars are not drawn (Layout.tsx); embed.css keys off this class.
if (CONTS_EMBEDDED) {
  try { document.documentElement.classList.add("conts-embedded"); } catch { /* no document */ }
}

/** Takes the hand-over from the address fragment: #conts=<base64url of {t, sp?, p}>. */
export function consumeContsSignIn(): void {
  const m = /^#conts=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!m) return;
  try {
    const json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const { t, sp, p } = JSON.parse(json) as { t?: string; sp?: string; p?: string };
    // Session storage: the hand-over is repeated on every visit, so nothing needs to outlive the tab.
    if (t) tokenStore.set(t, false);
    if (t && sp) passStore.set(sp, false);
    const path = typeof p === "string" && p.startsWith("/") && !p.startsWith("//") ? p : "/";
    window.history.replaceState(null, "", path);
  } catch {
    window.history.replaceState(null, "", "/");
  }
}

/** The Property OS page holding the frame, once known: the only page told where the frame is, since the
 *  address can name a record. */
let parentOrigin = (() => {
  try {
    const o = document.referrer ? new URL(document.referrer).origin : "";
    return trusted(o) ? o : "";
  } catch { return ""; }
})();
const here = () => window.location.pathname + window.location.search;
const tellLocation = () => {
  if (!parentOrigin) return;
  try { window.parent.postMessage({ type: "conts:location", path: here() }, parentOrigin); } catch { /* no parent */ }
};

/** The Dream Crafter screens' look for the theme Property OS is in: its dark theme is the "night" skin, anything else
 *  the light "vision" one. null when the message is not a theme the ERP can send. */
export function betaSkinFor(theme: unknown): "night" | "vision" | null {
  if (theme === "dark") return "night";
  if (theme === "light") return "vision";
  return null;
}

/** Follows Property OS's menu: { type: "conts:navigate", path } moves this app without reloading it, and
 *  { type: "conts:theme", theme: "light" | "dark" } sets the Beta screens' look.
 *  Tells Property OS where it is after every move ({ type: "conts:location", path }), so its menu follows links
 *  inside these screens. */
export function listenForContsNavigation(): void {
  if (!CONTS_EMBEDDED) return;
  window.addEventListener("message", (e: MessageEvent) => {
    if (!trusted(e.origin)) return;
    parentOrigin = e.origin;
    const d = e.data as { type?: string; path?: string; theme?: unknown } | null;
    // Property OS's light or dark theme: the Beta screens read it as data-beta-skin on <html> (renovationBetaTheme.ts).
    // Opened on its own this app never hears it, so it stays light.
    if (d?.type === "conts:theme") {
      const skin = betaSkinFor(d.theme);
      if (skin) document.documentElement.dataset.betaSkin = skin;
      return;
    }
    if (d?.type !== "conts:navigate" || typeof d.path !== "string" || !d.path.startsWith("/") || d.path.startsWith("//")) return;
    if (d.path !== here()) window.history.pushState(null, "", d.path);
    // Also on the same address: the phone screens keep the open record out of the address, so this takes them
    // back to the menu item's own screen.
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  // The router moves with pushState / replaceState, which raise no event of their own.
  for (const k of ["pushState", "replaceState"] as const) {
    const move = window.history[k].bind(window.history);
    window.history[k] = (...args: Parameters<History["pushState"]>) => { move(...args); tellLocation(); };
  }
  window.addEventListener("popstate", tellLocation);
  // Lets Property OS know the frame is ready to be steered, and when the session has ended.
  try { window.parent.postMessage({ type: "conts:ready" }, "*"); } catch { /* no parent */ }
  // And when a screen is on view: until then the frame is blank while it signs in and loads, so Property OS keeps
  // its own loading message up.
  const shown = window.setInterval(() => {
    const main = document.querySelector("main");
    if (!main || (main.textContent ?? "").trim().length < 20) return;
    window.clearInterval(shown);
    try { window.parent.postMessage({ type: "conts:shown" }, "*"); } catch { /* no parent */ }
  }, 150);
}
