// The header of a line table (PV, AP invoice, journal): one heading row whose columns each person drags into the order
// they like and to the width they like (chew, 25 Nov 2026: header 我要可以 drag 来安排位置，根据 user). The arrangement is
// kept per person, on their account (lib/tableLayouts readMyLineLayout / saveMyLineLayout), so it follows them to another
// computer. The table lays out fixed at the sum of the widths, so dragging one edge moves only that column.
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { readMyLineLayout, saveMyLineLayout } from '../../../lib/tableLayouts';

const MIN_W = 48;

export interface LineColumn { key: string; label: ReactNode; width: number; align?: 'left' | 'right' }

/** The columns in this person's order and widths, with the moves that change them. Columns added to the code later
    join at the end; columns dropped from it are forgotten. */
export function useLineColumns(tableKey: string, defaults: readonly LineColumn[]) {
  const byKey = useMemo(() => new Map(defaults.map((c) => [c.key, c])), [defaults]);
  const [state, setState] = useState(() => {
    const kept = readMyLineLayout(tableKey);
    const order = [...kept.order.filter((k) => byKey.has(k)), ...defaults.map((c) => c.key).filter((k) => !kept.order.includes(k))];
    const widths: Record<string, number> = {};
    for (const c of defaults) {
      const w = kept.widths[c.key];
      widths[c.key] = typeof w === 'number' && w >= MIN_W ? w : c.width;
    }
    return { order, widths };
  });
  const move = useCallback((from: string, to: string) => {
    if (from === to) return;
    setState((s) => {
      const order = s.order.filter((k) => k !== from);
      order.splice(order.indexOf(to) + (s.order.indexOf(from) < s.order.indexOf(to) ? 1 : 0), 0, from);
      saveMyLineLayout(tableKey, order, s.widths);
      return { ...s, order };
    });
  }, [tableKey]);
  /* While an edge is dragged the width changes on screen only; it is kept when the drag ends. */
  const resize = useCallback((key: string, w: number) => setState((s) => ({ ...s, widths: { ...s.widths, [key]: Math.max(MIN_W, Math.round(w)) } })), []);
  const commit = useCallback(() => setState((s) => { saveMyLineLayout(tableKey, s.order, s.widths); return s; }), [tableKey]);
  const reset = useCallback(() => {
    setState({ order: defaults.map((c) => c.key), widths: Object.fromEntries(defaults.map((c) => [c.key, c.width])) });
    saveMyLineLayout(tableKey, [], {});
  }, [defaults, tableKey]);
  const cols = state.order.flatMap((k) => { const c = byKey.get(k); return c ? [{ ...c, width: state.widths[k] ?? c.width }] : []; });
  const total = cols.reduce((s, c) => s + c.width, 0);
  return { cols, move, resize, commit, reset, total };
}

/** The heading row: drag a heading onto another to move it there; drag its right edge to resize; double-click an
    edge to put every column back. `extra` is the width of the trailing actions column (no heading). */
export function LineTableHead({ columns, thStyle, extra }: {
  columns: ReturnType<typeof useLineColumns>; thStyle: CSSProperties; extra: number;
}) {
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const start = useRef<{ key: string; x: number; w: number } | null>(null);
  return (
    <thead>
      <tr>
        {columns.cols.map((c) => (
          <th key={c.key} draggable
            onDragStart={(e) => { dragging.current = c.key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key); }}
            onDragOver={(e) => { if (dragging.current) { e.preventDefault(); setOver(c.key); } }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); const from = dragging.current; dragging.current = null; setOver(null); if (from) columns.move(from, c.key); }}
            onDragEnd={() => { dragging.current = null; setOver(null); }}
            title="Drag to move this column"
            style={{
              ...thStyle, width: c.width, position: 'relative', cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis',
              textAlign: c.align ?? 'left', paddingRight: 14, ...(over === c.key ? { background: 'var(--c-primary-soft, #eef3f8)' } : {}),
            }}>
            {c.label}
            <span role="separator" aria-orientation="vertical" aria-label="Resize column; double-click to reset all columns"
              title="Drag to change the width · double-click to reset all columns" draggable={false}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); start.current = { key: c.key, x: e.clientX, w: c.width }; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { if (start.current) columns.resize(start.current.key, start.current.w + e.clientX - start.current.x); }}
              onPointerUp={(e) => { if (start.current) { start.current = null; columns.commit(); } try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* released */ } }}
              onDoubleClick={(e) => { e.stopPropagation(); columns.reset(); }}
              style={{ position: 'absolute', top: 4, bottom: 4, right: 0, width: 8, cursor: 'col-resize', touchAction: 'none', borderRight: '2px solid var(--border-weak, #e3e1da)' }} />
          </th>
        ))}
        <th style={{ ...thStyle, width: extra }} />
      </tr>
    </thead>
  );
}
