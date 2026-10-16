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
    <div className="flex items-center gap-2 max-sm:w-full min-w-0">
      <span className="w-[160px] max-sm:flex-1 min-w-0 [&_input]:w-full [&_input]:box-border"><DateField aria-label="From" value={from} max={to || undefined} onChange={v => onChange(v, to)} className="h-9 px-2.5 rounded-control border border-solid border-line bg-card text-ink font-sans text-meta w-full min-w-0" /></span>
      <span className="text-meta text-muted-ink">to</span>
      <span className="w-[160px] max-sm:flex-1 min-w-0 [&_input]:w-full [&_input]:box-border"><DateField aria-label="To" value={to} min={from || undefined} onChange={v => onChange(from, v)} className="h-9 px-2.5 rounded-control border border-solid border-line bg-card text-ink font-sans text-meta w-full min-w-0" /></span>
      {(from || to) && (
        <button type="button" onClick={() => onChange('', '')} className="p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-gold-ink whitespace-nowrap">Clear</button>
      )}
    </div>
  );
}
