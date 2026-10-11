import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { dateShort, plural, rmShort } from '../../lib/format';

export interface NightSelection {
  unitId: string; unitNumber: string;
  /** First and last night, inclusive. Check-out is the day after `last`. */
  first: string; last: string; nights: number;
  /** Nights in the range somebody already holds, with who holds the first of them. */
  taken: number; takenBy: string | null;
  /** The web price of the first night, sen. */
  priceNow: number;
  /** Where to open, in viewport pixels. */
  x: number; y: number;
}

const rangeLabel = (a: string, b: string) => {
  if (a === b) return dateShort(a);
  const [da, ma] = dateShort(a).split(' '), [db, mb] = dateShort(b).split(' ');
  return ma === mb ? `${da}–${db} ${mb}` : `${dateShort(a)} – ${dateShort(b)}`;
};

/** What to do with nights picked on the board: book them, block them or change their price. A compact card by the
 *  pointer on desktop, a sheet along the bottom on phones. */
export function SelectionPopover({ sel, phone, canSetRates, onBook, onBlock, onPrice, onClose }: {
  sel: NightSelection; phone: boolean; canSetRates: boolean;
  onBook: () => void; onBlock: () => void; onPrice: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (phone || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const left = Math.min(Math.max(12, sel.x - r.width / 2), window.innerWidth - r.width - 12);
    const below = sel.y + 18;
    const top = below + r.height > window.innerHeight - 12 ? Math.max(12, sel.y - r.height - 18) : below;
    setPos({ left, top });
  }, [sel, phone]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    // Next tick, so the pointer-up that opened it does not close it.
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); window.clearTimeout(t); };
  }, [onClose]);

  const free = sel.nights - sel.taken;
  const summary = sel.taken === 0
    ? `${sel.nights === 1 ? 'Available' : `All ${sel.nights} nights available`}${sel.priceNow > 0 ? ` · now ${rmShort(sel.priceNow)} / night` : ''}`
    : `${free} of ${plural(sel.nights, 'night')} available · ${sel.takenBy || 'a reservation'} holds ${plural(sel.taken, 'night')}`;
  const blocked = sel.taken > 0;
  const big = 'flex-1 min-w-0 min-h-16 px-2 py-2 rounded-[10px] flex flex-col items-center justify-center gap-0.5 cursor-pointer font-sans text-copy border border-solid disabled:cursor-default disabled:opacity-45';

  return (
    <div ref={ref} role="dialog" aria-label={`${sel.unitNumber}, ${rangeLabel(sel.first, sel.last)}`}
      className={phone
        ? 'fixed left-0 right-0 bottom-0 z-[55] bg-card rounded-t-card shadow-[var(--shadow-overlay)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] flex flex-col gap-3'
        : 'fixed z-[55] w-[380px] bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] p-[18px] flex flex-col gap-3'}
      style={phone ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-heading font-semibold text-ink">{sel.unitNumber} · {rangeLabel(sel.first, sel.last)} · {plural(sel.nights, 'night')}</div>
          <div className="text-meta text-muted-ink">{summary}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex-none w-8 h-8 -mr-1 -mt-1 grid place-items-center rounded-control bg-transparent border-none cursor-pointer text-muted-ink hover:bg-muted">
          <Icon name="X" size="sm" />
        </button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onBook} disabled={blocked} title={blocked ? 'Some of these nights are taken' : undefined} className={`${big} bg-card border-line text-ink hover:bg-muted`}>
          <b>Book</b><span className="text-caption text-muted-ink">Direct / owner stay</span>
        </button>
        <button type="button" onClick={onBlock} disabled={blocked} title={blocked ? 'Some of these nights are taken' : undefined} className={`${big} bg-card border-line text-ink hover:bg-muted`}>
          <b>Block</b><span className="text-caption text-muted-ink">Repair / other</span>
        </button>
        {canSetRates && (
          <button type="button" onClick={onPrice} className={`${big} bg-black border-black text-white hover:opacity-90`}>
            <b>Change price</b><span className="text-caption opacity-80">{sel.nights === 1 ? 'This night' : `These ${sel.nights} nights`}</span>
          </button>
        )}
      </div>
      <div className="text-caption text-muted-ink">{phone ? 'Tip: tap a first night, then a last night, to pick several.' : 'Tip: drag across the nights of a unit to pick several.'}</div>
    </div>
  );
}
