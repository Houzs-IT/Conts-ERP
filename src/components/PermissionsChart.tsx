import { useEffect, useMemo, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { useToast } from './Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import type { AccessLevel } from '../lib/types';

interface Cell { level: AccessLevel; builtIn: AccessLevel; chosen: boolean }
interface AreaRow { key: string; label: string; group: string; managed: boolean; roles: Record<string, Cell> }
interface Chart { roles: string[]; levels: AccessLevel[]; areas: AreaRow[]; canEdit: boolean }

const ROLE_LABEL: Record<string, string> = {
  operations_manager: 'Operations manager', operations_staff: 'Operations staff', finance_admin: 'Finance admin',
};
const LEVEL_LABEL: Record<AccessLevel, string> = { none: 'No access', view: 'View only', edit: 'Edit', full: 'Full' };
const LEVEL_NOTE: Record<AccessLevel, string> = {
  none: 'Hidden from the menu and cannot be changed.',
  view: 'Can open and read, cannot change anything.',
  edit: 'Day-to-day work: create and update records.',
  full: 'Everything, including management-only actions such as deleting and approving.',
};
const LEVEL_COLOR: Record<AccessLevel, string> = {
  none: 'var(--color-neutral-fg)', view: 'var(--color-info-fg)',
  edit: 'var(--color-warning-fg)', full: 'var(--color-success-fg)',
};
/** The other four of the seven roles: their access is fixed, so they have no column. */
const FIXED_ROLES = [
  { name: 'Management', note: 'full access to everything, always.' },
  { name: 'Cleaner', note: 'the field app only: their own cleaning jobs.' },
  { name: 'Technician', note: 'the field app only: their own maintenance jobs.' },
  { name: 'Owner', note: 'the owner portal only: their own units, statements and documents.' },
];
const GRID ='grid grid-cols-[minmax(190px,1.4fr)_110px_repeat(3,minmax(150px,1fr))] gap-2.5 items-center px-5';

/** The editable permissions chart: one row per area, one column per role management can change. */
export default function PermissionsChart() {
  const { data, loading, error, reload } = useApi<Chart>('/users/access');
  const toast = useToast();
  // key `${role}:${area}` -> the level picked but not yet saved; null puts the area back on its built-in rule
  const [draft, setDraft] = useState<Record<string, AccessLevel | null>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft({}); }, [data]);

  const groups = useMemo(() => {
    const out: { group: string; areas: AreaRow[] }[] = [];
    for (const a of data?.areas ?? []) {
      const g = out.find(x => x.group === a.group);
      if (g) g.areas.push(a); else out.push({ group: a.group, areas: [a] });
    }
    return out;
  }, [data]);

  if (error) return <Card><div className="p-5 text-copy text-muted-ink">{error}</div></Card>;
  if (loading || !data) return <Card><div className="p-5 text-copy text-muted-ink">Loading the permissions chart…</div></Card>;

  const pending = Object.keys(draft).length;
  const shown = (a: AreaRow, role: string): AccessLevel => {
    const d = draft[`${role}:${a.key}`];
    return d === undefined ? a.roles[role].level : d ?? a.roles[role].builtIn;
  };
  const pick = (a: AreaRow, role: string, level: AccessLevel) => {
    const cell = a.roles[role];
    setDraft(prev => {
      const next = { ...prev };
      // Picking what is already saved clears the pending change; picking the built-in level removes the override.
      if (level === cell.level && (cell.chosen || level !== cell.builtIn)) delete next[`${role}:${a.key}`];
      else if (level === cell.builtIn && !cell.chosen) delete next[`${role}:${a.key}`];
      else next[`${role}:${a.key}`] = level === cell.builtIn ? null : level;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const changes = Object.entries(draft).map(([k, level]) => {
        const [role, area] = k.split(':');
        return { role, area, level };
      });
      await api.put('/users/access', { changes });
      toast({ tone: 'success', title: `${changes.length} permission ${changes.length === 1 ? 'change' : 'changes'} saved.`, body: 'People in that role see it the next time they open or refresh the system.' });
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'The changes were not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="py-[13px] px-5 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink leading-[1.5]">
        What each role can do in each part of the system. {data.canEdit ? 'Pick a level, then save.' : 'Only management can change this.'} Management
        always has full access and is not listed, so nobody can be locked out. Cleaners, technicians and owners use their own apps and are fixed.
      </div>
      <div className="flex gap-x-5 gap-y-1.5 flex-wrap py-[11px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        {data.levels.map(l => (
          <span key={l} className="text-caption text-muted-ink">
            <b style={{ color: LEVEL_COLOR[l] }}>{LEVEL_LABEL[l]}</b> — {LEVEL_NOTE[l]}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={`${GRID} py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-muted-ink`}>
            <div>Area</div>
            <div>Management</div>
            {data.roles.map(r => <div key={r}>{ROLE_LABEL[r] ?? r}</div>)}
          </div>
          {groups.map(g => (
            <div key={g.group}>
              <div className="px-5 pt-3 pb-1.5 text-caption font-semibold tracking-[0.08em] uppercase text-muted-ink">{g.group}</div>
              {g.areas.map(a => (
                <div key={a.key} className={`${GRID} py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]`}>
                  <div className="text-copy font-medium">{a.label}</div>
                  <div className="text-meta font-semibold" style={{ color: LEVEL_COLOR.full }}>Full</div>
                  {data.roles.map(r => {
                    const level = shown(a, r);
                    const changed = draft[`${r}:${a.key}`] !== undefined;
                    return (
                      <div key={r}>
                        <select
                          aria-label={`${ROLE_LABEL[r] ?? r} access to ${a.label}`}
                          value={level} disabled={!data.canEdit || saving}
                          onChange={e => pick(a, r, e.target.value as AccessLevel)}
                          className="h-8 w-full max-w-[150px] px-2 py-0 [font-family:inherit] text-copy font-semibold bg-card border border-solid rounded-control outline-none"
                          style={{ color: LEVEL_COLOR[level], borderColor: changed ? 'var(--color-gold)' : 'var(--color-line)' }}
                        >
                          {data.levels.map(l => (
                            <option key={l} value={l}>{LEVEL_LABEL[l]}{l === a.roles[r].builtIn ? ' (standard)' : ''}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 py-3 [border-top:1px_solid_var(--color-line)]">
        <div className="text-caption font-semibold tracking-[0.08em] uppercase text-muted-ink mb-1.5">Roles not on this chart</div>
        {FIXED_ROLES.map(r => (
          <div key={r.name} className="text-copy leading-[1.7]"><b>{r.name}</b> <span className="text-muted-ink">— {r.note}</span></div>
        ))}
      </div>
      {data.canEdit && (
        <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap bg-page">
          <span className="text-meta text-muted-ink">
            {pending === 0 ? 'No unsaved changes. “(standard)” marks the level a role has when nothing is chosen.' : `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}.`}
          </span>
          <span className="flex gap-2">
            <Button onClick={() => setDraft({})} disabled={pending === 0 || saving}>Discard</Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={pending === 0}>Save changes</Button>
          </span>
        </div>
      )}
    </Card>
  );
}
