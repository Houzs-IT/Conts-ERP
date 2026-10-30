import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import type { AccessArea, AccessChange, AccessChart, AccessLevel, AccessSetting, Department } from '../../lib/types';
import { LevelBoxes, TIERS } from './LevelBoxes';
import { LEVEL_COLOR, LEVEL_LABEL, LEVEL_NOTE, SELECT, SIDE_OPTIONS, TAG, categorySide, isFieldKind, sideLabel } from './shared';

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
  // Whole companies folded shut (The Conts, Dream Crafter, Both), apart from the categories inside them.
  const [shutCompanies, setShutCompanies] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<SideFilter>('all');
  const [deptId, setDeptId] = useState<string | null>(null);

  const load = async () => {
    try { setData(await api.get<AccessChart>('/users/access')); setError(null); setDraft({}); }
    catch (e) { setError(errorMessage(e, 'The permissions could not be loaded.')); }
  };
  useEffect(() => { void load(); }, []);

  const pending = Object.keys(draft).length;
  useEffect(() => { onDirty(pending); }, [pending, onDirty]);

  const departments = useMemo<Department[]>(
    () => (data?.departments ?? []).filter(d => !isFieldKind(d.kind) && (filter === 'all' || d.side === filter || d.side === 'both')),
    [data, filter],
  );
  // One department at a time: the chart is a single column, so it never scrolls sideways.
  const selected = departments.find(d => d.id === deptId) ?? departments[0];
  // Rows by company, The Conts first: a side's own categories, then the ones both companies share.
  const companies = useMemo(
    () => SIDE_OPTIONS
      .filter(o => filter === 'all' || o.value === filter || o.value === 'both')
      .map(o => ({ ...o, categories: (data?.categories ?? []).filter(c => categorySide(c.group) === o.value) }))
      .filter(o => o.categories.length > 0),
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
  const toggleCompany = (company: string) => setShutCompanies(prev => {
    const next = new Set(prev);
    if (next.has(company)) next.delete(company); else next.add(company);
    return next;
  });
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

  // Phone: name and three narrow box columns fit the screen, and the Override / Reset cell drops under the name.
  const ROW = 'grid gap-x-2.5 items-center px-5 grid-cols-[minmax(220px,1fr)_repeat(3,64px)_112px] max-md:px-4 max-md:gap-x-1 max-md:grid-cols-[minmax(0,1fr)_repeat(3,40px)]';
  const TAIL = 'max-md:col-span-full max-md:pl-[26px] max-md:pb-2 max-md:empty:hidden';
  // Desk: the first column stays put while the rest scrolls sideways; it needs its own background to hide what slides under.
  // -mr-2.5 + pr-2.5 stretches the cell over the grid gap, so scrolled cells don't peek out beside it.
  const STICKY = 'md:sticky md:left-0 z-[1] min-w-0 md:-mr-2.5 md:pr-2.5';

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
        <span className="text-caption text-muted-ink">Departments and categories marked Both always show.</span>
      </div>
      {selected && (
        <div className="flex items-center gap-2 flex-wrap py-2.5 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
          <label htmlFor="permissions-department" className="text-meta text-muted-ink">Department</label>
          <select id="permissions-department" value={selected.id} onChange={e => setDeptId(e.target.value)}
            className={cx(SELECT, 'max-w-[280px] font-semibold border-line')}>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name} · {sideLabel(d.side)}</option>)}
          </select>
          {pending > 0 && <span className="text-caption text-muted-ink">{pending} unsaved {pending === 1 ? 'change' : 'changes'} across all departments.</span>}
        </div>
      )}
      {!selected ? (
        <div className="p-5 text-copy text-muted-ink">No departments on this side yet. Add one under Departments and positions.</div>
      ) : (
        // Own scroll box: a sticky header can only pin inside the box that scrolls vertically.
        <div className="md:overflow-auto md:max-h-[70vh]">
          <div className="md:min-w-[604px]">
            <div className={cx(ROW, 'sticky top-0 z-[2] py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-ink')}>
              <div className={cx(STICKY, 'z-[3] bg-muted text-muted-ink')}>Category and area</div>
              {TIERS.map(t => <div key={t.level} className="text-center">{t.label}</div>)}
              <div className={TAIL} />
            </div>
            {companies.map(co => (
              <div key={co.value}>
                <button type="button" onClick={() => toggleCompany(co.value)} aria-expanded={!shutCompanies.has(co.value)}
                  className="flex w-full items-center gap-1.5 px-5 max-md:px-4 py-2 bg-muted border-none cursor-pointer text-left [font-family:inherit] [border-bottom:1px_solid_var(--color-line)]">
                  <span className={cx('grid transition-transform duration-150 text-muted-ink', shutCompanies.has(co.value) && '-rotate-90')}><Icon name="ChevronDown" size="sm" /></span>
                  <span className="text-caption font-semibold uppercase tracking-wide text-ink">{co.value === 'both' ? 'Both companies' : co.label}</span>
                  <span className="text-caption font-normal text-muted-ink">{co.categories.length} {co.categories.length === 1 ? 'category' : 'categories'}</span>
                </button>
                {!shutCompanies.has(co.value) && co.categories.map(c => {
                  const open = !collapsed.has(c.group);
                  const isManagement = selected.kind === 'management';
                  return (
                    <div key={c.group}>
                      {/* Category header: its boxes are the baseline every inheriting area below follows. */}
                      <div className={cx(ROW, 'py-2 bg-page [border-bottom:1px_solid_var(--color-line)]')}>
                        <button type="button" onClick={() => toggle(c.group)} aria-expanded={open}
                          className={cx(STICKY, 'bg-page flex items-center gap-1.5 p-0 border-none cursor-pointer text-left [font-family:inherit] text-copy font-semibold text-ink')}>
                          <span className={cx('grid transition-transform duration-150 text-muted-ink', !open && '-rotate-90')}><Icon name="ChevronDown" size="sm" /></span>
                          {c.group}
                          <span className="text-caption font-normal text-muted-ink">{c.areas.length} {c.areas.length === 1 ? 'area' : 'areas'}</span>
                        </button>
                        <LevelBoxes level={isManagement ? 'full' : baseline(selected, c.group)} label={`${selected.name} baseline for ${c.group}`}
                          disabled={!canEdit || isManagement} changed={draft[draftKey(selected.id, groupKey(c.group))] !== undefined}
                          onPick={next => pick(selected, groupKey(c.group), next === 'none' ? null : next, true)} />
                        <div className={TAIL} />
                      </div>
                      {open && c.areas.map(a => {
                        const s = setting(selected, a);
                        const inherited = s === 'inherit';
                        return (
                          <div key={a.key} className={cx(ROW, 'py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                            <div className={cx(STICKY, 'bg-card pl-[26px] text-copy font-medium')}>{a.label}</div>
                            <LevelBoxes level={isManagement ? 'full' : effective(selected, a, c.group)} label={`${selected.name} access to ${a.label}`}
                              disabled={!canEdit || isManagement} faded={inherited} changed={draft[draftKey(selected.id, a.key)] !== undefined}
                              onPick={next => pick(selected, a.key, next, false)} />
                            {!isManagement && !inherited ? (
                              <div className={cx('flex items-center gap-1.5 min-w-0', TAIL)}>
                                <span title={`Overrides the ${c.group} baseline`} className={TAG}
                                  style={{ background: 'var(--color-info)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' }}>Override</span>
                                {canEdit && (
                                  <button type="button" onClick={() => pick(selected, a.key, 'inherit', false)} title={`Follow ${c.group} again`}
                                    className="p-0 border-none bg-transparent cursor-pointer [font-family:inherit] text-caption text-muted-ink underline">Reset</button>
                                )}
                              </div>
                            ) : <div className={TAIL} />}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
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
