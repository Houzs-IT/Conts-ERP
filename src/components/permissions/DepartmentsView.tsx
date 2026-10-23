import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import type { AccessArea, AccessChange, AccessChart, AccessLevel, AccessSetting, Department } from '../../lib/types';
import { LEVEL_COLOR, LEVEL_LABEL, LEVEL_NOTE, MUTED, SELECT, SIDE_OPTIONS, TAG, isFieldKind, settingLabel, sideLabel } from './shared';

/** A pending change: what is picked but not yet saved. `level` null deletes the stored row. */
interface Pending { scopeId: string; key: string; level: AccessSetting | null }
type SideFilter = 'all' | 'conts' | 'dream_crafter';

const groupKey = (group: string) => `group:${group}`;
const draftKey = (deptId: string, key: string) => `${deptId}\n${key}`;

const FILTERS: { value: SideFilter; label: string }[] = [
  { value: 'conts', label: SIDE_OPTIONS[0].label }, { value: 'dream_crafter', label: SIDE_OPTIONS[1].label }, { value: 'all', label: 'All' },
];

/**
 * View 1 of the Permissions tab: the category chart with one column per department. Each category header sets a
 * baseline per department; each area under it follows that baseline unless it has its own setting. A department
 * with no rule anywhere has No access, which the chart says as "Not set". Only management can change it.
 */
export default function DepartmentsView({ onDirty }: { onDirty: (pending: number) => void }) {
  const toast = useToast();
  const [data, setData] = useState<AccessChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Pending>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<SideFilter>('all');

  const load = async () => {
    try { setData(await api.get<AccessChart>('/users/access')); setError(null); setDraft({}); }
    catch (e) { setError(errorMessage(e, 'The permissions could not be loaded.')); }
  };
  useEffect(() => { void load(); }, []);

  const pending = Object.keys(draft).length;
  useEffect(() => { onDirty(pending); }, [pending, onDirty]);

  const columns = useMemo<Department[]>(
    () => (data?.departments ?? []).filter(d => !isFieldKind(d.kind) && (filter === 'all' || d.side === filter || d.side === 'both')),
    [data, filter],
  );

  if (error && !data) return <div className="p-5 text-copy text-muted-ink">{error}</div>;
  if (!data) return <div className="p-5 text-copy text-muted-ink">Loading the permissions chart…</div>;

  const { levels, rules } = data;
  const canEdit = data.canEdit && !saving;
  const stored = (d: Department, key: string): AccessSetting | undefined => rules.department[d.id]?.[key];

  // A category header shows its draft when there is one (null = no rule), else the saved baseline.
  const baseline = (d: Department, group: string): AccessLevel | undefined => {
    const p = draft[draftKey(d.id, groupKey(group))];
    const s = p ? p.level : stored(d, groupKey(group));
    return s && s !== 'inherit' ? s : undefined;
  };
  // An area shows its draft when there is one (null = inherit), else its stored setting; no row means inherit.
  const setting = (d: Department, a: AccessArea): AccessSetting => {
    const p = draft[draftKey(d.id, a.key)];
    return (p ? p.level : stored(d, a.key)) ?? 'inherit';
  };
  // How a header change reaches its areas: nothing is copied down. An area set to 'inherit' works out its level
  // here, at render, from the header's shown baseline, so changing the header re-labels every inheriting area at
  // once. An area with its own setting keeps its value because this never reads the baseline for it. Saving a
  // header sends one row; the server resolves the same way, so what is shown is what people get.
  const effective = (d: Department, a: AccessArea, group: string): AccessLevel | undefined => {
    const s = setting(d, a);
    return s === 'inherit' ? baseline(d, group) : s;
  };

  // Picking what is already stored clears the pending change; picking Inherit / Not set deletes the stored row.
  const pick = (d: Department, key: string, value: AccessSetting | null, isCategory: boolean) => {
    const savedValue = stored(d, key);
    const current: AccessSetting | null = isCategory ? (savedValue && savedValue !== 'inherit' ? savedValue : null) : savedValue ?? 'inherit';
    setDraft(prev => {
      const copy = { ...prev };
      const k = draftKey(d.id, key);
      if (value === current) delete copy[k];
      else copy[k] = { scopeId: d.id, key, level: value === 'inherit' ? null : value };
      return copy;
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
      const changes: AccessChange[] = Object.values(draft).map(p => ({ scope: 'department', scopeId: p.scopeId, key: p.key, level: p.level }));
      await api.put('/users/access', { changes });
      toast({ tone: 'success', title: `${changes.length} permission ${changes.length === 1 ? 'change' : 'changes'} saved.`, body: 'People in those departments see it the next time they open or refresh the system.' });
      await load();
    } catch (e) {
      toast({ tone: 'critical', title: 'The changes were not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setSaving(false);
    }
  };

  const gridStyle = { gridTemplateColumns: `minmax(220px,1.4fr) repeat(${columns.length}, minmax(190px,1fr))` };
  const ROW = 'grid gap-2.5 items-center px-5';
  // The first column stays put while the rest scrolls sideways; it needs its own background to hide what slides under.
  const STICKY = 'sticky left-0 z-[1] min-w-0';

  return (
    <>
      <div className="flex gap-x-5 gap-y-1.5 flex-wrap py-[11px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        {levels.map(l => (
          <span key={l} className="text-caption text-muted-ink"><b style={{ color: LEVEL_COLOR[l] }}>{LEVEL_LABEL[l]}</b> — {LEVEL_NOTE[l]}</span>
        ))}
      </div>
      <div role="group" aria-label="Show departments for" className="flex items-center gap-2 flex-wrap py-2.5 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <span className="text-meta text-muted-ink">Show</span>
        {FILTERS.map(f => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
            className={cx('h-7 px-3 rounded-full border border-solid text-meta cursor-pointer [font-family:inherit]',
              filter === f.value ? 'bg-card border-ink font-semibold text-ink' : 'bg-transparent border-line text-muted-ink')}>{f.label}</button>
        ))}
        <span className="text-caption text-muted-ink">Departments marked Both always show.</span>
      </div>
      {columns.length === 0 ? (
        <div className="p-5 text-copy text-muted-ink">No departments on this side yet. Add one under Departments and positions.</div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: 220 + columns.length * 190 }}>
            <div className={cx(ROW, 'py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-muted-ink')} style={gridStyle}>
              <div className={cx(STICKY, 'bg-muted')}>Category and area</div>
              {columns.map(d => (
                <div key={d.id} className="min-w-0">
                  <div className="text-ink truncate" title={d.name}>{d.name}</div>
                  <span className="font-normal">{sideLabel(d.side)}</span>
                </div>
              ))}
            </div>
            {data.categories.map(c => {
              const open = !collapsed.has(c.group);
              return (
                <div key={c.group}>
                  {/* Category header: its dropdown is the baseline every inheriting area below follows. */}
                  <div className={cx(ROW, 'py-2 bg-page [border-bottom:1px_solid_var(--color-line)]')} style={gridStyle}>
                    <button type="button" onClick={() => toggle(c.group)} aria-expanded={open}
                      className={cx(STICKY, 'bg-page flex items-center gap-1.5 p-0 border-none cursor-pointer text-left [font-family:inherit] text-copy font-semibold text-ink')}>
                      <span className={cx('grid transition-transform duration-150 text-muted-ink', !open && '-rotate-90')}><Icon name="ChevronDown" size="sm" /></span>
                      {c.group}
                      <span className="text-caption font-normal text-muted-ink">{c.areas.length} {c.areas.length === 1 ? 'area' : 'areas'}</span>
                    </button>
                    {columns.map(d => {
                      if (d.kind === 'management') return <div key={d.id} className="text-meta font-semibold" style={{ color: LEVEL_COLOR.full }}>Full</div>;
                      const level = baseline(d, c.group);
                      const changed = draft[draftKey(d.id, groupKey(c.group))] !== undefined;
                      return (
                        <div key={d.id}>
                          <select aria-label={`${d.name} baseline for ${c.group}`} value={level ?? ''} disabled={!canEdit}
                            onChange={e => pick(d, groupKey(c.group), e.target.value === '' ? null : (e.target.value as AccessLevel), true)}
                            className={cx(SELECT, level ? 'font-semibold' : 'font-normal')}
                            style={{ color: level ? LEVEL_COLOR[level] : MUTED, borderColor: changed ? 'var(--color-gold)' : 'var(--color-line)' }}>
                            <option value="">Not set</option>
                            {levels.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  {open && c.areas.map(a => (
                    <div key={a.key} className={cx(ROW, 'py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]')} style={gridStyle}>
                      <div className={cx(STICKY, 'bg-card pl-[26px] text-copy font-medium')}>{a.label}</div>
                      {columns.map(d => {
                        if (d.kind === 'management') return <div key={d.id} className="text-meta text-muted-ink">Full</div>;
                        const s = setting(d, a);
                        const level = effective(d, a, c.group);
                        const inherited = s === 'inherit';
                        const changed = draft[draftKey(d.id, a.key)] !== undefined;
                        return (
                          <div key={d.id} className="flex items-center gap-1.5 min-w-0">
                            <select aria-label={`${d.name} access to ${a.label}`} value={s} disabled={!canEdit}
                              onChange={e => pick(d, a.key, e.target.value as AccessSetting, false)}
                              className={cx(SELECT, inherited ? 'font-normal' : 'font-semibold')}
                              // Inherited: muted, so the eye goes to the overrides. Overridden: the level's own colour.
                              style={{ color: inherited || !level ? MUTED : LEVEL_COLOR[level], borderColor: changed ? 'var(--color-gold)' : 'var(--color-line)' }}>
                              <option value="inherit" title={`Inherit from ${c.group}`}>Inherit ({settingLabel(baseline(d, c.group))})</option>
                              {levels.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                            </select>
                            {!inherited && (
                              <span title={`Overrides the ${c.group} baseline`} className={TAG}
                                style={{ background: 'var(--color-info)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' }}>Override</span>
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
      )}
      <div className="px-5 py-3 [border-top:1px_solid_var(--color-line)] text-meta text-muted-ink leading-[1.5]">
        Management is always Full and cannot be changed, so nobody can be locked out. Cleaning and Maintenance departments use the field app only.
        A department with nothing set has No access. An area set to a level always beats its category, so a door closed on purpose stays closed.
      </div>
      {data.canEdit && (
        <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap bg-page">
          <span className="text-meta text-muted-ink">
            {pending === 0 ? 'No unsaved changes.' : `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}.`}
          </span>
          <span className="flex gap-2">
            <Button onClick={() => setDraft({})} disabled={pending === 0 || saving}>Discard</Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={pending === 0}>Save changes</Button>
          </span>
        </div>
      )}
    </>
  );
}
