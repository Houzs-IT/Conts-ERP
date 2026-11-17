import { useEffect, useRef, type ReactNode } from 'react';

const SAVE_BAR = 'sticky bottom-[var(--sticky-bottom-offset,0px)] z-[2] flex items-center justify-between gap-3 flex-wrap py-3 px-5 max-md:px-4 bg-card [border-top:1px_solid_var(--color-line)]';
const HEIGHT_VARIABLE = '--save-bar-height';

export function SaveBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const rootStyle = document.documentElement.style;
    const observer = new ResizeObserver(() => rootStyle.setProperty(HEIGHT_VARIABLE, `${element.offsetHeight}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      rootStyle.removeProperty(HEIGHT_VARIABLE);
    };
  }, []);

  return <div ref={bar} data-save-bar className={SAVE_BAR}>{children}</div>;
}
