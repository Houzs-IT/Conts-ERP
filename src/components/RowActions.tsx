import { Fragment, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { cx } from '../lib/design-tokens';

export interface RowAction { key: string; label: string; icon: string; danger?: boolean; run: () => void }

/** The "..." button at the end of a row. The menu uses fixed positioning so the table's horizontal
 *  scroll box cannot clip it on the last rows; clicks stop here so they do not also open Edit. */
export function RowActions({ name, items }: { name: string; items: RowAction[] }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setAt(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    const shut = () => setAt(null);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', shut, true); window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', shut, true); window.removeEventListener('resize', shut);
    };
  }, [at]);
  return (
    <span ref={ref} onClick={e => e.stopPropagation()} className="flex-none">
      <button type="button" aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={!!at}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { top: Math.min(r.bottom + 4, window.innerHeight - 40 * items.length - 16), right: window.innerWidth - r.right });
        }}
        className="w-8 h-8 grid place-items-center rounded-control border-none bg-transparent text-muted-ink cursor-pointer hover:bg-muted hover:text-ink">
        <Icon name="MoreHorizontal" size="sm" />
      </button>
      {at && (
        <div role="menu" style={{ top: at.top, right: at.right }}
          className="fixed z-[55] w-[240px] p-1 bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)]">
          {items.map((a, i) => (
            <Fragment key={a.key}>
              {a.danger && i > 0 && !items[i - 1].danger && <div role="separator" className="my-1 mx-1 h-px bg-line-soft" />}
              <button type="button" role="menuitem" onClick={() => { setAt(null); a.run(); }}
                className={cx('w-full text-left flex gap-2.5 items-center px-2.5 py-2 rounded-[8px] border-none bg-transparent [font-family:inherit] text-copy cursor-pointer hover:bg-muted',
                  a.danger ? 'text-danger' : 'text-ink')}>
                <Icon name={a.icon} size="sm" />{a.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </span>
  );
}
