import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Icon from './Icon';
import { cx } from '../lib/design-tokens';

export interface TabItem<K extends string> { key: K; label: string; icon?: string }

export interface TabBarProps<K extends string> {
  tabs: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Names the tab list for screen readers. */
  label: string;
  /** Prefix for the tab and panel ids: the panel is `${id}-panel`, labelled by the active tab. */
  id: string;
}

const FADE = 32;

export const tabId = (id: string, key: string): string => `${id}-tab-${key}`;
export const panelId = (id: string): string => `${id}-panel`;

/** Horizontal tabs with an indigo underline: scrolls sideways on narrow screens with faded edges, arrow keys move. */
export function TabBar<K extends string>({ tabs, value, onChange, label, id }: TabBarProps<K>): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<K, HTMLButtonElement>());
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure); };
  }, [measure]);

  useEffect(() => {
    buttons.current.get(value)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex(t => t.key === value);
    const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    const next = tabs[to].key;
    onChange(next);
    buttons.current.get(next)?.focus();
  }

  const mask = `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'} 0, black ${FADE}px, black calc(100% - ${FADE}px), ${edges.end ? 'transparent' : 'black'} 100%)`;

  return (
    <div className="relative flex-none [border-bottom:1px_solid_var(--color-line)]">
      <div ref={scroller} role="tablist" aria-label={label} aria-orientation="horizontal" onKeyDown={onKeyDown}
        className="flex gap-1 md:gap-0 px-4 md:px-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {tabs.map(t => {
          const on = t.key === value;
          return (
            <button key={t.key} type="button" role="tab" id={tabId(id, t.key)} aria-selected={on} aria-controls={on ? panelId(id) : undefined}
              tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)}
              ref={el => { if (el) buttons.current.set(t.key, el); else buttons.current.delete(t.key); }}
              className={cx('flex-none inline-flex items-center gap-1.5 h-11 px-3 md:px-2 -mb-px text-meta whitespace-nowrap cursor-pointer bg-transparent [font-family:inherit]',
                'border-0 border-b-2 border-solid outline-none focus-visible:rounded-t-control focus-visible:bg-muted',
                on ? 'border-tab text-ink font-bold' : 'border-transparent text-muted-ink font-medium hover:text-ink')}>
              {t.icon && <span className="hidden min-[1600px]:inline-flex"><Icon name={t.icon} size="sm" /></span>}
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
