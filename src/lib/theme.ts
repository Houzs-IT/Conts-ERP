/**
 * Light / dark theme. Writes data-theme on <html>; tokens.css does the rest.
 * Light is the default. Dark only applies when the user picks it with the
 * toggle; the device's own dark setting is NOT followed until every page has
 * moved off hard-coded colours (see KNOWN-ISSUES.md, dark mode).
 * Call initTheme() once in main.tsx before render.
 */
export type ThemePref = 'light' | 'dark';
const KEY = 'theconts.theme';

function readPref(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }   // private mode / storage blocked
}
function writePref(v: ThemePref): void {
  try { localStorage.setItem(KEY, v); } catch { /* not saved; still applied for this tab */ }
}

export function getThemePref(): ThemePref {
  return readPref() === 'dark' ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref = getThemePref()): void {
  document.documentElement.dataset.theme = pref === 'dark' ? 'theconts-dark' : 'theconts';
}

export function setThemePref(pref: ThemePref): void {
  writePref(pref);
  applyTheme(pref);
}

export function initTheme(): void {
  applyTheme();
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('theme-ready')));
}

/** The desktop switch is in the top bar beside the bell (owner, 22 Oct 2026). This flag still hides the Light / Dark
 *  choice in the profile menu and on the phone's settings screen; flip it to show those too. */
export const DARK_MODE_READY = false;
