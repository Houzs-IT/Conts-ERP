/** Menu items are real links (chew, 11 Nov 2026: right-click on the menu had no "Open link in new tab"), so the browser can open them in a
 *  new tab: right-click, Ctrl or Cmd + click, middle click. A plain left click still opens the page inside the app,
 *  through its own navigation (which asks first when a form has unsaved changes). No imports, so node --test can read
 *  this file (src/lib/linkClick.test.mjs). */
export interface LinkClick { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }

/** True for a plain left click, which the app handles itself; false for one the browser should handle. */
export function opensInPlace(e: LinkClick): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
