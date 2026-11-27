import { useEffect, useState } from "react";

/** The live content width of an element, 0 until it is mounted. Pass the element from a callback ref. */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
