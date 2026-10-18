import { useState } from 'react';
import { MoneyText } from '../../components/MoneyText';
import { cx } from '../../lib/design-tokens';

export interface PnlRow { label: string; amount: number; type: string; items?: { label: string; amount: number }[] }

/** A P&L as the owner's report and an Airbnb earnings page read it: each row in the report's words, and under it what
 *  makes it up (every reservation, every bill). Long lists fold after a few lines. */
export function PnlTable({ rows, hideZero = false }: { rows: PnlRow[]; hideZero?: boolean }) {
  const [all, setAll] = useState(false);
  // hideZero: a cost line at RM 0.00 says nothing, so a short card lists only lines with money on them. Income, subtotals
  // and the net always show, and the totals are the same either way.
  const zero = (l: PnlRow) => l.amount === 0 && !(l.items?.length) && l.type !== 'gross' && l.type !== 'net' && l.type !== 'subtotal';
  const hidden = hideZero ? rows.filter(zero).length : 0;
  const shown = hidden && !all ? rows.filter(l => !zero(l)) : rows;
  return (
    <div>
      {shown.map((l, i) => <Row key={i} l={l} />)}
      {hidden > 0 && (
        <div className="py-2.5 px-5 [border-top:1px_solid_var(--color-line-soft)]">
          <button type="button" onClick={() => setAll(a => !a)} aria-expanded={all}
            className="p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-gold-ink">
            {all ? 'Hide lines at RM 0.00' : `Show all lines (${hidden} at RM 0.00)`}
          </button>
        </div>
      )}
    </div>
  );
}

const FOLD = 6;

function Row({ l }: { l: PnlRow }) {
  const [open, setOpen] = useState(false);
  const net = l.type === 'net', sub = l.type === 'subtotal';
  const items = l.items ?? [];
  const shown = open ? items : items.slice(0, FOLD);
  return (
    <div className={cx('py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0', net ? 'bg-page' : 'bg-card')}>
      <div className="flex items-center justify-between gap-5">
        <span className={cx('text-copy min-w-0', net || sub ? 'font-semibold text-ink' : l.type === 'gross' ? 'font-medium text-ink' : 'font-normal text-muted-ink')}>{l.label}</span>
        <MoneyText sen={l.amount} mode="exact" className={cx('text-right whitespace-nowrap', net ? 'text-heading font-semibold' : 'text-copy font-medium')} />
      </div>
      {items.length > 0 && (
        <div className="mt-1.5 pl-3 flex flex-col gap-1">
          {shown.map((it, j) => (
            <div key={j} className="flex items-baseline justify-between gap-4 text-meta text-muted-ink">
              {/* "Guest · 2 Oct – 5 Oct · 3 nights · Airbnb": the guest on the first line, the rest small underneath. */}
              {(() => { const [head, ...rest] = it.label.split(' · '); return (
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="text-ink-2 truncate">{head}</span>
                  {rest.length > 0 && <span className="text-[12px] text-muted-ink truncate">{rest.join(' · ')}</span>}
                </span>
              ); })()}
              {(items.length > 1 || it.amount !== l.amount) && it.amount !== 0 && <MoneyText sen={it.amount} mode="exact" tone="muted" className="text-meta whitespace-nowrap" />}
            </div>
          ))}
          {items.length > FOLD && (
            <button type="button" onClick={() => setOpen(o => !o)} className="self-start p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-gold-ink">
              {open ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
