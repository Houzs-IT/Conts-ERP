// Conts only (not part of Houzs's code): a message in a full-width table row ("Failed to load", the empty-list
// sentence) is centred across the whole scrollable table, so on a wide table it runs past the right edge of what
// can be seen (QA sweep, 15 Oct 2026, finding 12). This pins the message to the left of the scroll area and gives
// it the visible width, so it is centred in what the person actually sees.
import { useEffect, useState, type ReactNode, type RefObject } from "react";

/** Horizontal padding of the cell the message sits in (DataTable's px-3). */
const CELL_PAD_X = 24;

export function VisibleWidth({ scrollRef, children }: { scrollRef: RefObject<HTMLElement | null>; children: ReactNode }) {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(0, el.clientWidth - CELL_PAD_X));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);
  return (
    <div className="sticky left-3 break-words" style={width != null ? { width } : undefined}>
      {children}
    </div>
  );
}
