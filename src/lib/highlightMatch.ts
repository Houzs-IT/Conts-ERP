/**
 * highlightMatch.ts: picks the on-screen element whose text matches a label, for the AI Connector's "show me where it
 * is" links (?highlight=<label>, owner 27 Nov 2026). how_to / where_is / explain_screen answers carry that parameter;
 * useHighlightParam (src/lib/useHighlightParam.ts) uses this to outline the button. The matching is pure so it is
 * unit-tested without a browser (src/lib/mcpScreens.test.mjs), and the screenshot script bundles the same file so its
 * red boxes land where the live outline would.
 */

/** Trim, collapse whitespace, lower-case. */
export function normaliseLabel(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface HighlightCandidate {
  /** The element's visible text. */
  text: string;
  ariaLabel?: string | null;
  title?: string | null;
  /** button / link / tab / menu item / form control. */
  interactive: boolean;
  visible: boolean;
}

/**
 * Index of the best candidate for `label`, or -1. Order of preference: 1. exact text (interactive before not),
 * 2. exact aria-label / title, 3. text that starts with the label (e.g. "Assign cleaner +2"), 4. text that contains it.
 * Shortest text wins inside a tier, so a button beats the card around it. Invisible candidates never match.
 */
export function pickHighlightTarget(cands: HighlightCandidate[], label: string): number {
  const want = normaliseLabel(label);
  if (!want) return -1;
  let best = -1;
  let bestRank = Infinity;
  cands.forEach((c, i) => {
    if (!c.visible) return;
    const t = normaliseLabel(c.text);
    const a = normaliseLabel(c.ariaLabel);
    const ti = normaliseLabel(c.title);
    let tier: number;
    if (t === want) tier = c.interactive ? 0 : 1;
    else if (a === want || ti === want) tier = c.interactive ? 2 : 3;
    else if (t.startsWith(want) && t.length <= want.length + 24) tier = c.interactive ? 4 : 5;
    else if (want.length >= 3 && t.includes(want) && t.length <= want.length * 3 + 24) tier = c.interactive ? 6 : 7;
    else return;
    const rank = tier * 10_000 + Math.min(t.length, 9_999);
    if (rank < bestRank) { bestRank = rank; best = i; }
  });
  return best;
}

/** Elements worth matching. */
export const HIGHLIGHT_SELECTOR =
  'button, a, [role="tab"], [role="menuitem"], [role="button"], [role="option"], [role="radio"], summary, label, th, h1, h2, h3, h4, legend, [aria-label], [title]';

const INTERACTIVE = /^(BUTTON|A|SUMMARY|SELECT|INPUT)$/;
const INTERACTIVE_ROLES = new Set(['tab', 'menuitem', 'button', 'option', 'link', 'radio']);

/** The best visible element under `root` for `label`, or null. */
export function findHighlightElement(root: Pick<ParentNode, 'querySelectorAll'>, label: string): HTMLElement | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>(HIGHLIGHT_SELECTOR)).filter(el => !el.closest('[data-highlight-overlay]'));
  const cands: HighlightCandidate[] = els.map(el => {
    const r = el.getBoundingClientRect();
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return {
      text: el.innerText ?? el.textContent ?? '',
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      interactive: INTERACTIVE.test(el.tagName) || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? ''),
      visible: r.width > 0 && r.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none',
    };
  });
  const i = pickHighlightTarget(cands, label);
  return i >= 0 ? els[i] : null;
}
