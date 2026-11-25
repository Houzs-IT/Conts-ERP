// Column widths the person drags on a line table's header, kept per table in this browser (chew, 25 Nov 2026: 我要可以自己
// 调整之间的距离，主要就是description太小). The table lays out fixed at the sum of the widths, so dragging one edge moves
// only that column; a wrapper scrolls sideways when the sum is wider than the card.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const MIN_W = 48;

const read = (key: string): Record<string, number> => {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
};

/** The table's column widths: the defaults, then whatever this browser kept for `storageKey`. */
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const kept = read(storageKey);
    const out: Record<string, number> = { ...defaults };
    for (const k of Object.keys(defaults)) if (typeof kept[k] === 'number' && kept[k] >= MIN_W) out[k] = kept[k];
    return out;
  });
  /* Kept only once the person drags (or resets), so changing the defaults reaches everyone who never did. */
  const dragged = useRef(false);
  useEffect(() => {
    if (!dragged.current) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* private mode: widths last this visit */ }
  }, [storageKey, widths]);
  const resize = useCallback((col: string, w: number) => { dragged.current = true; setWidths((prev) => ({ ...prev, [col]: Math.max(MIN_W, Math.round(w)) })); }, []);
  const reset = useCallback(() => {
    dragged.current = false;
    try { window.localStorage.removeItem(storageKey); } catch { /* nothing kept */ }
    setWidths({ ...defaults });
  }, [defaults, storageKey]);
  const total = Object.values(widths).reduce((s, w) => s + w, 0);
  return { widths, resize, reset, total };
}

/** A header cell with a grip on its right edge: drag to widen or narrow the column; double-click puts it back. */
export function ResizableTh({ col, width, onResize, onReset, style, children }: {
  col: string; width: number; onResize: (col: string, w: number) => void; onReset?: () => void; style?: CSSProperties; children?: ReactNode;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    start.current = { x: e.clientX, w: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!start.current) return;
    onResize(col, start.current.w + e.clientX - start.current.x);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    start.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  return (
    <th style={{ ...style, position: 'relative', width }}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to change the column width; double-click to reset"
        title="Drag to change the width · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onReset}
        style={{
          position: 'absolute', top: 4, bottom: 4, right: 0, width: 8, cursor: 'col-resize', touchAction: 'none',
          borderRight: '2px solid var(--border-weak, #e3e1da)',
        }}
      />
    </th>
  );
}
