import { DateField } from '../../components/inputs';
import { cx } from '../../lib/design-tokens';

/** Status chips with counts, in the owner's words: one is on at a time, "All" first. Wraps on a phone. */
export function StatusChips<K extends string>({ label, value, onChange, options }: {
  label: string; value: K; onChange: (k: K) => void; options: { key: K; label: string; count?: number }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5 min-w-0">
      {options.map(o => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.key)}
            className={cx('inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-solid font-sans text-meta cursor-pointer whitespace-nowrap',
              on ? 'bg-ink text-white border-ink font-semibold' : 'bg-card text-ink border-line hover:border-line-strong')}>
            {o.label}
            {o.count != null && <span className={cx('tabular-nums', on ? 'text-white/70' : 'text-muted-ink')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** From and To days (YYYY-MM-DD, '' = open); Clear empties both. */
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <DateField aria-label="From" value={from} max={to || undefined} onChange={v => onChange(v, to)} className="field-input h-9! w-[150px] max-sm:flex-1 max-sm:w-auto" />
      <span className="text-meta text-muted-ink">to</span>
      <DateField aria-label="To" value={to} min={from || undefined} onChange={v => onChange(from, v)} className="field-input h-9! w-[150px] max-sm:flex-1 max-sm:w-auto" />
      {(from || to) && (
        <button type="button" onClick={() => onChange('', '')} className="p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-gold-ink">Clear dates</button>
      )}
    </div>
  );
}
