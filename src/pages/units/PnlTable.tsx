import { useState } from 'react';
import { MoneyText } from '../../components/MoneyText';
import { cx } from '../../lib/design-tokens';

export interface PnlRow { label: string; amount: number; type: string; items?: { label: string; amount: number }[] }

/** A P&L as the owner's report and an Airbnb earnings page read it: each row in the report's words, and under it what
 *  makes it up (every reservation, every bill). Long lists fold after a few lines. */
export function PnlTable({ rows }: { rows: PnlRow[] }) {
  return <div>{rows.map((l, i) => <Row key={i} l={l} />)}</div>;
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
              <span className="min-w-0 [overflow-wrap:anywhere]">{it.label}</span>
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
