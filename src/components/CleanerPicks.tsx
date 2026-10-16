import type { Cleaner } from '../lib/useCleaners';
import Icon from './Icon';
import { cx } from '../lib/design-tokens';

/** Hint shown beside a cleaner in a picker: the outsourced company, or today's load. */
export const cleanerHint = (c: Cleaner) => (c.employmentType === 'outsourced' ? (c.vendorName ?? 'Outsourced') : `${c.busy} open today`);

/** Tick one or more cleaners (owner, 11 Oct 2026: a big unit can take two or three people). The order they are
 *  ticked in is kept: the first one is the job's main cleaner. */
export function CleanerChecklist({ cleaners, value, onChange, label = 'Cleaners', error }: {
  cleaners: Cleaner[]; value: string[]; onChange: (ids: string[]) => void; label?: string; error?: string | null;
}) {
  const toggle = (id: string, on: boolean) => onChange(on ? [...value.filter(v => v !== id), id] : value.filter(v => v !== id));
  return (
    <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5 min-w-0">
      <legend className="p-0 mb-1.5 text-meta font-semibold text-muted-ink">{label}{value.length > 1 ? ` · ${value.length} picked` : ''}</legend>
      <div className={cx('max-h-[240px] overflow-y-auto overscroll-contain rounded-control border border-solid', error ? 'border-danger' : 'border-line')}>
        {cleaners.length === 0 && <p className="m-0 p-3 text-copy text-muted-ink">No active cleaners on the roster.</p>}
        {cleaners.map(c => {
          const on = value.includes(c.id);
          const n = value.indexOf(c.id) + 1;
          return (
            <label key={c.id} className={cx('min-h-11 flex items-center gap-2.5 px-3 py-2 cursor-pointer text-copy [&+&]:[border-top:1px_solid_var(--color-line-soft)]', on ? 'bg-gold-tint' : 'hover:bg-page')}>
              <input type="checkbox" checked={on} onChange={e => toggle(c.id, e.target.checked)} className="w-4 h-4 m-0 flex-none accent-[var(--color-brand-black)]" />
              <span className="flex-1 min-w-0 truncate font-medium text-ink">{c.name}</span>
              {on && value.length > 1 && n === 1 && <span className="text-caption text-gold-ink whitespace-nowrap">Main</span>}
              <span className="text-meta text-muted-ink whitespace-nowrap">{cleanerHint(c)}</span>
            </label>
          );
        })}
      </div>
      {error && <span className="text-meta text-danger">{error}</span>}
    </fieldset>
  );
}

/** The cleaners on one job as removable chips, plus a picker to add another. Every change is saved at once by the
 *  caller (onChange gets the whole new list). */
export function CleanerChips({ cleaners, value, names, onChange, disabled }: {
  cleaners: Cleaner[]; value: string[]; names: Record<string, string>; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const others = cleaners.filter(c => !value.includes(c.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      {value.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-full border border-solid border-line bg-card text-copy max-w-full">
          <span className="truncate">{names[id] ?? cleaners.find(c => c.id === id)?.name ?? 'Cleaner'}</span>
          {i === 0 && value.length > 1 && <span className="text-caption text-gold-ink">Main</span>}
          <button type="button" disabled={disabled} onClick={() => onChange(value.filter(v => v !== id))} aria-label={`Take ${names[id] ?? 'this cleaner'} off the job`}
            title="Take off this job" className="w-6 h-6 grid place-items-center rounded-full border-0 bg-transparent text-muted-ink hover:bg-muted cursor-pointer disabled:cursor-default">
            <Icon name="X" size="sm" />
          </button>
        </span>
      ))}
      {others.length > 0 && (
        <select aria-label={value.length ? 'Add another cleaner' : 'Pick a cleaner'} disabled={disabled} value=""
          onChange={e => { const v = e.target.value; if (v) onChange([...value, v]); }}
          className={cx('h-8 rounded-full border border-solid px-2.5 bg-card text-copy text-ink cursor-pointer max-w-[200px]', value.length ? 'border-dashed border-line' : 'border-danger')}>
          <option value="">{value.length ? '+ Add cleaner' : 'Pick a cleaner'}</option>
          {others.map(c => <option key={c.id} value={c.id}>{c.name}{c.employmentType === 'outsourced' ? ' (outsourced)' : ''}</option>)}
        </select>
      )}
    </div>
  );
}
