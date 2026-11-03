// Conts only: where the project and unit pickers' drop-down sits (chew 3 Nov 2026: "可能是往下显示", like AutoCount's
// Proj. No. list). Under the field when there is room, above it near the bottom of the screen, always inside the window.

export type Anchor = { top: number; bottom: number; left: number; width: number };
export type Placement = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const GAP = 4;
const EDGE = 8;
const TALLEST = 420;
const SHORTEST = 120;
/** Below this much room under the field, the list opens upward if there is more room above. */
const ENOUGH = 240;

export function placePanel(anchor: Anchor, view: { width: number; height: number }, wantWidth: number): Placement {
  const width = Math.min(Math.max(wantWidth, anchor.width), view.width - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(anchor.left, view.width - width - EDGE));
  const below = view.height - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  if (below >= ENOUGH || below >= above) return { left, width, top: anchor.bottom + GAP, maxHeight: Math.max(SHORTEST, Math.min(TALLEST, below)) };
  return { left, width, bottom: view.height - anchor.top + GAP, maxHeight: Math.max(SHORTEST, Math.min(TALLEST, above)) };
}
