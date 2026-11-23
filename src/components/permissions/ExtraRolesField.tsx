import { useState } from 'react';
import type { Department } from '../../lib/types';
import { TONE, cx } from '../../lib/design-tokens';

export interface ExtraRolesFieldProps {
  departments: readonly Department[];
  /** The person's main position: shown ticked and fixed, since it is set above. */
  mainPositionId: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  error?: string;
}

/** Extra roles (migration 0349): desk positions a person holds besides their main one. Their access is the highest
 *  level any of their roles gives. Management is Full already and field departments keep one role, so only desk
 *  (staff) departments are offered. */
export function ExtraRolesField({ departments, mainPositionId, value, onChange, error }: ExtraRolesFieldProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const groups = departments
    .filter(d => d.kind === 'staff')
    .map(d => ({ department: d, positions: d.positions.filter(p => !needle || `${p.name} ${d.name}`.toLowerCase().includes(needle)) }))
    .filter(g => g.positions.length > 0);
  const total = departments.filter(d => d.kind === 'staff').reduce((n, d) => n + d.positions.length, 0);
  const picked = new Set(value);
  const toggle = (id: string) => onChange(picked.has(id) ? value.filter(v => v !== id) : [...value, id]);

  return (
    <fieldset className="flex flex-col gap-2 m-0 p-0 border-0 min-w-0">
      <legend className="text-meta font-medium text-ink mb-1.5">Extra roles</legend>
      <span className="text-meta text-muted-ink leading-[1.5]">
        Tick any other desk positions this person also works as. Their access is the highest level any of their roles gives; their own settings on Permissions &gt; People still decide first.
      </span>
      {total > 8 && (
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search positions" aria-label="Search positions"
          className="w-full box-border rounded-control border border-solid border-line bg-page px-2.5 min-h-10 text-copy" />
      )}
      <div className="flex flex-col rounded-control border border-solid border-line max-h-80 overflow-y-auto">
        {groups.map(({ department, positions }) => (
          <div key={department.id} className="flex flex-col">
            <span className="px-3 pt-2.5 pb-1 text-caption font-semibold tracking-[0.06em] uppercase text-muted-ink">{department.name}</span>
            {positions.map(p => {
              const main = p.id === mainPositionId;
              return (
                <label key={p.id} className={cx('flex items-center gap-2.5 px-3 min-h-11 text-copy', main ? 'text-muted-ink' : 'cursor-pointer hover:bg-muted')}>
                  <input type="checkbox" className="w-4 h-4 flex-none" checked={main || picked.has(p.id)} disabled={main} onChange={() => toggle(p.id)} />
                  <span className="flex-1 min-w-0 truncate">{p.name}</span>
                  {main && <span className="text-caption">Main role</span>}
                </label>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && <span className="px-3 py-3 text-meta text-muted-ink">{needle ? 'No position matches.' : 'No desk positions yet. Add them under Permissions > Setup.'}</span>}
      </div>
      {error && <span className={cx('text-meta', TONE.critical.text)}>{error}</span>}
    </fieldset>
  );
}
