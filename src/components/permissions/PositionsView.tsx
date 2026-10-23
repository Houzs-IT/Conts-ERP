import { useEffect, useMemo, useState } from 'react';
import { Button } from '../Button';
import { Select } from '../Select';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import type { AccessArea, AccessChange, AccessChart, AccessLevel, AccessSetting, Department } from '../../lib/types';
import { KIND_NOTE, LEVEL_COLOR, LEVEL_LABEL, MUTED, SELECT, TAG, settingLabel } from './shared';

interface Pending { key: string; level: AccessSetting | null }

const groupKey = (group: string) => `group:${group}`;
const GRID = 'grid grid-cols-[minmax(200px,1.4fr)_minmax(150px,1fr)_minmax(220px,1.2fr)_90px] gap-2.5 items-center px-5';

/** What a position falls back to when it sets nothing, and where that comes from (PLAN.md, "How a person's level in an area is worked out"). */
interface Fallback { level: AccessLevel | undefined; label: string }

/**
 * View 2 of the Permissions tab: one position at a time. Each row shows what its department gives (muted) and the
 * position's own setting, which wins over the department. "Inherit" means the position adds nothing for that row.
 */
export default function PositionsView({ onDirty }: { onDirty: (pending: number) => void }) {
  const toast = useToast();
  const [data, setData] = useState<AccessChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deptId, setDeptId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [draft, setDraft] = useState<Record<string, Pending>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { setData(await api.get<AccessChart>('/users/access')); setError(null); setDraft({}); }
    catch (e) { setError(errorMessage(e, 'The permissions could not be loaded.')); }
  };
  useEffect(() => { void load(); }, []);

  const pending = Object.keys(draft).length;
  useEffect(() => { onDirty(pending); }, [pending, onDirty]);

  // Only staff departments have rules to refine: management is always Full and the field departments use the field app.
  const staffDepts = useMemo(() => (data?.departments ?? []).filter(d => d.kind === 'staff'), [data]);
  const dept: Department | undefined = staffDepts.find(d => d.id === deptId) ?? staffDepts[0];
  const position = dept?.positions.find(p => p.id === positionId) ?? dept?.positions[0];

  if (error && !data) return <div className="p-5 text-copy text-muted-ink">{error}</div>;
  if (!data) return <div className="p-5 text-copy text-muted-ink">Loading the permissions chart…</div>;

  const { levels, rules } = data;
  const canEdit = data.canEdit && !saving;
  const switchTo = (apply: () => void) => { if (pending === 0 || window.confirm('Discard the unsaved changes?')) { setDraft({}); apply(); } };

  const deptRules = dept ? rules.department[dept.id] ?? {} : {};
  const posRules = position ? rules.position[position.id] ?? {} : {};
  const real = (s: AccessSetting | undefined): AccessLevel | undefined => (s && s !== 'inherit' ? s : undefined);

  // What the department alone gives: its area rule, else its category baseline, else nothing. Shown muted in column 2.
  const deptValue = (a: AccessArea | null, group: string): { level: AccessLevel | undefined; from: string } => {
    const own = a ? real(deptRules[a.key]) : undefined;
    if (own) return { level: own, from: `from ${dept?.name}` };
    const base = real(deptRules[groupKey(group)]);
    return base ? { level: base, from: `${dept?.name} baseline` } : { level: undefined, from: 'nothing set' };
  };
  // What the position gets when it sets nothing itself, in the order the server uses: the department's area rule,
  // then the position's own category baseline, then the department's. So a door the department closed explicitly
  // stays closed even if the position has a baseline for the category.
  const fallback = (a: AccessArea | null, group: string): Fallback => {
    const deptArea = a ? real(deptRules[a.key]) : undefined;
    if (deptArea) return { level: deptArea, label: `Dept: ${LEVEL_LABEL[deptArea]}` };
    const posLevel = real(currentSetting(groupKey(group)) ?? undefined);
    if (a && posLevel) return { level: posLevel, label: `Position baseline: ${LEVEL_LABEL[posLevel]}` };
    const deptBase = real(deptRules[groupKey(group)]);
    return deptBase ? { level: deptBase, label: `Dept: ${LEVEL_LABEL[deptBase]}` } : { level: undefined, label: a ? 'No access' : 'Not set' };
  };
  // The position's setting for a key: its draft if any (null = inherit), else the stored row.
  function currentSetting(key: string): AccessSetting | null | undefined {
    const p = draft[key];
    return p ? p.level : posRules[key];
  }

  const pick = (key: string, value: AccessSetting) => {
    const savedValue = real(posRules[key]) ?? 'inherit';
    setDraft(prev => {
      const copy = { ...prev };
      if (value === savedValue) delete copy[key];
      else copy[key] = { key, level: value === 'inherit' ? null : value };
      return copy;
    });
  };
  const resetRow = (key: string) => pick(key, 'inherit');
  // Every stored row of this position goes back to inheriting; saved as one batch with the rest.
  const resetAll = () => setDraft(Object.fromEntries(Object.keys(posRules).map(k => [k, { key: k, level: null }])));

  const save = async () => {
    if (!position) return;
    setSaving(true);
    try {
      const changes: AccessChange[] = Object.values(draft).map(p => ({ scope: 'position', scopeId: position.id, key: p.key, level: p.level }));
      await api.put('/users/access', { changes });
      toast({ tone: 'success', title: `${changes.length} permission ${changes.length === 1 ? 'change' : 'changes'} saved.`, body: `People in ${position.name} see it the next time they open or refresh the system.` });
      await load();
    } catch (e) {
      toast({ tone: 'critical', title: 'The changes were not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setSaving(false);
    }
  };

  /** One row's dropdown: Inherit (what it falls back to) and the four levels, with an Override badge and reset when set. */
  const cell = (key: string, a: AccessArea | null, group: string) => {
    const shown = currentSetting(key);
    const s: AccessSetting = real(shown ?? undefined) ?? 'inherit';
    const inherited = s === 'inherit';
    const fb = fallback(a, group);
    const level = inherited ? fb.level : s;
    return (
      <>
        <div className="flex items-center gap-1.5 min-w-0">
          <select aria-label={`${position?.name} setting for ${a?.label ?? group}`} value={s} disabled={!canEdit}
            onChange={e => pick(key, e.target.value as AccessSetting)}
            className={cx(SELECT, inherited ? 'font-normal' : 'font-semibold')}
            style={{ color: inherited || !level ? MUTED : LEVEL_COLOR[level], borderColor: draft[key] ? 'var(--color-gold)' : 'var(--color-line)' }}>
            <option value="inherit">Inherit ({fb.label})</option>
            {levels.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
          {!inherited && <span title="Overrides what the department gives" className={TAG}
            style={{ background: 'var(--color-info)', color: 'var(--color-info-fg)', borderColor: 'var(--color-info-line)' }}>Override</span>}
        </div>
        <div>{!inherited && canEdit && <Button size="sm" variant="tertiary" onClick={() => resetRow(key)} aria-label={`Reset ${a?.label ?? group} to the department`}>Reset</Button>}</div>
      </>
    );
  };
  const valueCell = (a: AccessArea | null, group: string) => {
    const v = deptValue(a, group);
    return (
      <div className="min-w-0 text-meta text-muted-ink">
        <span className="font-medium">{settingLabel(v.level)}</span> <span className="text-caption">{v.from}</span>
      </div>
    );
  };

  return (
    <>
      <div className="flex items-end gap-3 flex-wrap py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <Select label="Department" showLabel size="md" className="min-w-[200px]" value={dept?.id ?? ''} disabled={staffDepts.length === 0}
          onChange={v => switchTo(() => { setDeptId(v); setPositionId(''); })} options={staffDepts.map(d => ({ value: d.id, label: d.name }))} />
        <Select label="Position" showLabel size="md" className="min-w-[200px]" value={position?.id ?? ''} disabled={!dept || dept.positions.length === 0}
          onChange={v => switchTo(() => setPositionId(v))} options={(dept?.positions ?? []).map(p => ({ value: p.id, label: p.name }))} />
        {position && canEdit && (
          <Button size="sm" onClick={resetAll} disabled={Object.keys(posRules).length === 0 && pending === 0}>Reset position to department</Button>
        )}
      </div>
      <div className="py-[13px] px-5 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink leading-[1.5]">
        A position starts with what its department gives. Set a level here to give this position more or less than its department.
        An area the department set to a level stays as the department set it, unless the position sets that area itself.
        {data.categories.length > 0 && ' Management and field-app departments have no rules to refine, so they are not listed.'}
      </div>
      {!dept ? (
        <div className="p-5 text-copy text-muted-ink">No office departments yet. Add one under Departments and positions.</div>
      ) : !position ? (
        <div className="p-5 text-copy text-muted-ink">{dept.name} has no positions yet. Add one under Departments and positions.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={cx(GRID, 'py-2.5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold text-muted-ink')}>
              <div>Category and area</div><div>{dept.name} gives</div><div>{position.name} setting</div><div />
            </div>
            {data.categories.map(c => (
              <div key={c.group}>
                <div className={cx(GRID, 'py-2 bg-page [border-bottom:1px_solid_var(--color-line)]')}>
                  <div className="text-copy font-semibold text-ink">{c.group}<span className="ml-1.5 text-caption font-normal text-muted-ink">baseline</span></div>
                  {valueCell(null, c.group)}
                  {cell(groupKey(c.group), null, c.group)}
                </div>
                {c.areas.map(a => (
                  <div key={a.key} className={cx(GRID, 'py-[7px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                    <div className="pl-[18px] text-copy font-medium">{a.label}</div>
                    {valueCell(a, c.group)}
                    {cell(a.key, a, c.group)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {dept && KIND_NOTE[dept.kind] && <div className="px-5 py-3 text-meta text-muted-ink">{KIND_NOTE[dept.kind]}</div>}
      {data.canEdit && position && (
        <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap bg-page [border-top:1px_solid_var(--color-line)]">
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
