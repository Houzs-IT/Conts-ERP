import { useEffect, useMemo, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import Icon from './Icon';
import { useToast } from './Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import type { AccessLevel, AccessSetting } from '../lib/types';

interface GroupCell { level: AccessLevel; builtIn: AccessLevel; chosen: boolean }
interface AreaCell { setting: AccessSetting; builtIn: AccessSetting; chosen: boolean; level: AccessLevel }
interface GroupRow { group: string; roles: Record<string, GroupCell> }
interface AreaRow { key: string; label: string; group: string; managed: boolean; roles: Record<string, AreaCell> }
interface Chart { roles: string[]; levels: AccessLevel[]; roleMax: Record<string, AccessLevel>; groups: GroupRow[]; areas: AreaRow[]; canEdit: boolean }
/** What a dropdown compares against: the saved value, the built-in one, and whether management chose it. */
interface Saved { value: AccessSetting; builtIn: AccessSetting; chosen: boolean }

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
/** Three of the seven roles have fixed access and no column; Management's column is fixed at Full. */
const FIXED_ROLES = [
  { name: 'Cleaner', note: 'the field app only: their own cleaning jobs.' },
  { name: 'Maintenance technician', note: 'the field app only: their own maintenance jobs, once any owner approval and parts are in.' },
  { name: 'Owner', note: 'the owner portal only: their own units, statements and documents.' },
];
const GRID = 'grid grid-cols-[minmax(200px,1.4fr)_96px_repeat(3,minmax(180px,1fr))] gap-2.5 items-center px-5';
const SELECT = 'h-8 w-full max-w-[200px] px-2 py-0 [font-family:inherit] text-copy bg-card border border-solid rounded-control outline-none';

const groupKey = (role: string, group: string) => `${role}:group:${group}`;
const areaKey = (role: string, area: string) => `${role}:${area}`;

/**
 * The permissions chart, category first. Each category header sets a baseline per role; each module under it
 * inherits that baseline unless it has its own override. Only management can change it.
 */
export default function PermissionsChart() {
  const { data, loading, error, reload } = useApi<Chart>('/users/access');
  const toast = useToast();
  // `${role}:group:${group}` or `${role}:${area}` -> the value picked but not yet saved; null puts it back on its built-in rule
  const [draft, setDraft] = useState<Record<string, AccessSetting | null>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft({}); }, [data]);

  const areasByGroup = useMemo(() => {
    const out = new Map<string, AreaRow[]>();
    for (const a of data?.areas ?? []) out.set(a.group, [...(out.get(a.group) ?? []), a]);
    return out;
  }, [data]);

  if (error) return <Card><div className="p-5 text-copy text-muted-ink">{error}</div></Card>;
  if (loading || !data) return <Card><div className="p-5 text-copy text-muted-ink">Loading the permissions chart…</div></Card>;

  const pending = Object.keys(draft).length;
  const rank = (l: AccessLevel) => data.levels.indexOf(l);
  // Operations staff are capped below Full (functions/_lib/access.ts ROLE_MAX), so Full is not offered to them.
  const levelsFor = (role: string) => data.levels.filter(l => !data.roleMax[role] || rank(l) <= rank(data.roleMax[role]));

  // A category header shows its draft when there is one (null = back to built in), else the saved baseline.
  const baseline = (g: GroupRow, role: string): AccessLevel => {
    const d = draft[groupKey(role, g.group)];
    if (d === undefined || d === 'inherit') return g.roles[role].level;
    return d ?? g.roles[role].builtIn;
  };
  const setting = (a: AreaRow, role: string): AccessSetting => {
    const d = draft[areaKey(role, a.key)];
    return d === undefined ? a.roles[role].setting : d ?? a.roles[role].builtIn;
  };
  // How a header change reaches its modules: nothing is copied down. A module set to 'inherit' works out its level
  // here, at render, from the header's shown baseline, so changing the header re-labels every inheriting module at
  // once. A module with its own override keeps its value because this never reads the baseline for it.
  const effective = (a: AreaRow, g: GroupRow, role: string): AccessLevel => {
    const s = setting(a, role);
    return s === 'inherit' ? baseline(g, role) : s;
  };

  const pick = (key: string, saved: Saved, value: AccessSetting) => {
    setDraft(prev => {
      const next = { ...prev };
      // Picking what is already in force clears the pending change; picking the built-in value removes the stored one.
      const inForce = saved.chosen ? saved.value : saved.builtIn;
      if (value === inForce) delete next[key];
      else next[key] = value === saved.builtIn ? null : value;
      return next;
    });
  };
  const toggle = (group: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const changes = Object.entries(draft).map(([k, level]) => {
        const [role, kind, ...rest] = k.split(':');
        return kind === 'group' ? { role, group: rest.join(':'), level } : { role, area: kind, level };
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
        What each role can do in each part of the system. Set a level on a category and every area under it follows, unless the area has
        its own override. {data.canEdit ? 'Pick a level, then save.' : 'Only management can change this.'} Management always has full
        access and cannot be changed, so nobody can be locked out. Operations staff can go up to Edit, never Full.
      </div>
      <div className="flex gap-x-5 gap-y-1.5 flex-wrap py-[11px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        {data.levels.map(l => (
          <span key={l} className="text-caption text-muted-ink">
            <b style={{ color: LEVEL_COLOR[l] }}>{LEVEL_LABEL[l]}</b> — {LEVEL_NOTE[l]}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
          <div className={`${GRID} py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-muted-ink`}>
            <div>Category and area</div>
            <div>Management</div>
            {data.roles.map(r => <div key={r}>{ROLE_LABEL[r] ?? r}</div>)}
          </div>
          {data.groups.map(g => {
            const open = !collapsed.has(g.group);
            const areas = areasByGroup.get(g.group) ?? [];
            return (
              <div key={g.group}>
                {/* Category header: its dropdown is the baseline every inheriting area below follows. */}
                <div className={`${GRID} py-2 bg-page [border-bottom:1px_solid_var(--color-line)]`}>
                  <button type="button" onClick={() => toggle(g.group)} aria-expanded={open}
                    className="flex items-center gap-1.5 min-w-0 p-0 border-none bg-transparent cursor-pointer text-left [font-family:inherit] text-copy font-semibold text-ink">
                    <span className={cx('grid transition-transform duration-150 text-muted-ink', !open && '-rotate-90')}><Icon name="ChevronDown" size="sm" /></span>
                    {g.group}
                    <span className="text-caption font-normal text-muted-ink">{areas.length} {areas.length === 1 ? 'area' : 'areas'}</span>
                  </button>
                  <div className="text-meta font-semibold" style={{ color: LEVEL_COLOR.full }}>Full</div>
                  {data.roles.map(r => {
                    const cell = g.roles[r];
                    const level = baseline(g, r);
                    const changed = draft[groupKey(r, g.group)] !== undefined;
                    return (
                      <div key={r}>
                        <select
                          aria-label={`${ROLE_LABEL[r] ?? r} baseline for ${g.group}`}
                          value={level} disabled={!data.canEdit || saving}
                          onChange={e => pick(groupKey(r, g.group), { value: cell.level, builtIn: cell.builtIn, chosen: cell.chosen }, e.target.value as AccessLevel)}
                          className={`${SELECT} font-semibold`}
                          style={{ color: LEVEL_COLOR[level], borderColor: changed ? 'var(--color-gold)' : 'var(--color-line)' }}
                        >
                          {levelsFor(r).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}{l === cell.builtIn ? ' (standard)' : ''}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
                {open && areas.map(a => (
                  <div key={a.key} className={`${GRID} py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]`}>
                    <div className="pl-[26px] text-copy font-medium">{a.label}</div>
                    <div className="text-meta text-muted-ink">Full</div>
                    {data.roles.map(r => {
                      const cell = a.roles[r];
                      const s = setting(a, r);
                      const level = effective(a, g, r);
                      const inherited = s === 'inherit';
                      const changed = draft[areaKey(r, a.key)] !== undefined;
                      return (
                        <div key={r} className="flex items-center gap-1.5 min-w-0">
                          <select
                            aria-label={`${ROLE_LABEL[r] ?? r} access to ${a.label}`}
                            value={s} disabled={!data.canEdit || saving}
                            onChange={e => pick(areaKey(r, a.key), { value: cell.setting, builtIn: cell.builtIn, chosen: cell.chosen }, e.target.value as AccessSetting)}
                            className={cx(SELECT, inherited ? 'font-normal' : 'font-semibold')}
                            // Inherited: muted, so the eye goes to the overrides. Overridden: the level's own colour.
                            style={{ color: inherited ? 'var(--color-text-muted)' : LEVEL_COLOR[level], borderColor: changed ? 'var(--color-gold)' : 'var(--color-line)' }}
                          >
                            <option value="inherit" title={`Inherit from ${g.group}`}>Inherit ({LEVEL_LABEL[baseline(g, r)]})</option>
                            {levelsFor(r).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}{l === cell.builtIn ? ' (standard)' : ''}</option>)}
                          </select>
                          {!inherited && (
                            <span title={`Overrides the ${g.group} baseline`}
                              className="flex-none text-[11px] leading-none font-semibold py-[3px] px-1.5 rounded-[4px] border border-solid"
                              style={{ background: 'var(--color-info)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' }}>
                              Override
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
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
            {pending === 0 ? 'No unsaved changes. “(standard)” marks the value a role has when nothing is chosen.' : `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}.`}
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
