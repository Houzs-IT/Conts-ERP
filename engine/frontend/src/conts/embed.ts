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

/** Follows Property OS's menu: { type: "conts:navigate", path } moves this app without reloading it. */
export function listenForContsNavigation(): void {
  if (!CONTS_EMBEDDED) return;
  window.addEventListener("message", (e: MessageEvent) => {
    if (!trusted(e.origin)) return;
    const d = e.data as { type?: string; path?: string } | null;
    if (d?.type !== "conts:navigate" || typeof d.path !== "string" || !d.path.startsWith("/") || d.path.startsWith("//")) return;
    if (d.path === window.location.pathname + window.location.search) return;
    window.history.pushState(null, "", d.path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  // Lets Property OS know the frame is ready to be steered, and when the session has ended.
  try { window.parent.postMessage({ type: "conts:ready" }, "*"); } catch { /* no parent */ }
}
