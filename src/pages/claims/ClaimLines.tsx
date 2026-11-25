import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { ComboSelect, type SelectOption } from '../../components/Select';
import { ChoiceChips } from '../../components/ChoiceChips';
import { MoneyInput } from '../../components/inputs';
import Icon from '../../components/Icon';
import { useApi } from '../../lib/useApi';
import { rm, buildingName } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { DEPARTMENT, type LineDepartment, type LineSubDepartment, type NewLine } from '../../lib/claims';
import { TWO_COLUMN_GRID, ReadOnlyValue, RowHelp, SPAN_ALL } from './FormLayout';

/* subDepartmentId: '' starts the line on the person's own department (the engine fills it); else the one chosen (SOP 1.1, the department
   starts as the person's and may be changed; chew 16 Nov 2026). */
export type LineDraft = { where: 'none' | 'unit' | 'job' | 'project'; unitId: string; jobId: string; projectId: string; amountSen: number | null; description: string; subDepartmentId: string;
  /** A line for a unit whose owner pays it back (a payment request, chew 20 Nov 2026; a claim, 23 Nov): the whole line unless an amount is typed. */
  recover?: boolean; recoverSen?: number | null };

export const blankLine = (): LineDraft => ({ where: 'none', unitId: '', jobId: '', projectId: '', amountSen: null, description: '', subDepartmentId: '' });

type LineProject = { id: number; code: string | null; name: string; side?: LineDepartment; renoKind?: 'RENOVATION' | 'INHOUSE_RENOVATION' | null };
interface LineTargets {
  unitOptions: SelectOption[];
  jobOptions: SelectOption[];
  /** The projects that fit a sub-department, as the payment voucher offers them: its side, and a Renovation one's brand. */
  projectsFor: (sub: LineSubDepartment | null) => SelectOption[];
  subs: LineSubDepartment[];
  /** The sub-departments, grouped by department, and the person's own (the one a line starts on). */
  subOptions: SelectOption[];
  mineSub: LineSubDepartment | null;
}

/** What a line can be for (units grouped by building, jobs with their unit, projects). */
export function useLineTargets(): LineTargets {
  const units = useApi<{ units: { id: string; building: string; unitNumber: string }[] }>('/claims/units');
  const jobs = useApi<{ jobs: { id: string; unitId: string; title: string }[] }>('/claims/jobs');
  const projects = useApi<{ projects: LineProject[] }>('/claims/projects');
  const subs = useApi<{ subDepartments: LineSubDepartment[]; mine: string | null }>('/claims/sub-departments');
  return useMemo(() => {
    const unitOptions = (units.data?.units ?? []).map(u => ({ value: u.id, label: `${buildingName(u.building)} ${u.unitNumber}`, group: buildingName(u.building) }));
    const unitLabels = new Map(unitOptions.map(o => [o.value, o.label]));
    const jobOptions = (jobs.data?.jobs ?? []).map(j => ({ value: j.id, label: j.title, hint: unitLabels.get(j.unitId) }));
    const all = projects.data?.projects ?? [];
    const projectsFor = (sub: LineSubDepartment | null) => all
      .filter(p => !sub || (sub.department !== 'shared' && (!p.side || p.side === sub.department) && (!sub.renoKind || !p.renoKind || p.renoKind === sub.renoKind)))
      .map(p => ({ value: String(p.id), label: [p.code, p.name].filter(Boolean).join(' ') }));
    const list = subs.data?.subDepartments ?? [];
    const mineSub = list.find(x => x.id === subs.data?.mine) ?? null;
    const subOptions = list.map(x => ({ value: x.id, label: x.id === mineSub?.id ? `${x.name} (your department)` : x.name, group: DEPARTMENT[x.department] }));
    return { unitOptions, jobOptions, projectsFor, subs: list, subOptions, mineSub };
  }, [units.data, jobs.data, projects.data, subs.data]);
}

/** The lines as the engine takes them (no department, no account: the engine and finance set those); a message when something is missing. */
export function toLines(lines: LineDraft[], totalSen: number): { ok: true; lines: NewLine[] } | { ok: false; message: string } {
  const out: NewLine[] = [];
  for (const l of lines) {
    const amountSen = lines.length === 1 ? totalSen : l.amountSen ?? 0;
    if (amountSen <= 0) return { ok: false, message: 'Every line needs an amount.' };
    if (l.where === 'unit' && !l.unitId) return { ok: false, message: 'Choose the unit.' };
    if (l.where === 'job' && !l.jobId) return { ok: false, message: 'Choose the maintenance job.' };
    if (l.where === 'project' && !l.projectId) return { ok: false, message: 'Choose the project.' };
    out.push({
      amountSen, description: l.description.trim() || undefined,
      ...(l.where === 'unit' ? { unitId: l.unitId } : {}), ...(l.where === 'job' ? { maintenanceIssueId: l.jobId } : {}),
      ...(l.where === 'project' ? { projectId: Number(l.projectId) } : {}),
      ...(l.where !== 'job' && l.subDepartmentId ? { subDepartmentId: l.subDepartmentId } : {}),
      ...(l.where === 'unit' && l.recover ? { recoverSen: l.recoverSen ?? amountSen } : {}),
    });
    const back = out.at(-1)!.recoverSen;
    if (back != null && (back <= 0 || back > amountSen)) return { ok: false, message: 'What the owner pays back is more than RM 0.00 and no more than the line.' };
  }
  if (out.reduce((n, l) => n + l.amountSen, 0) !== totalSen) return { ok: false, message: 'The lines must add up to the amount.' };
  return { ok: true, lines: out };
}


/** The cost lines, as the payment voucher takes them (chew, 17 Nov 2026): the department first (the person's own to start
 *  with, which they may change; SOP 1.1), then what it brings: a Rental line's unit or Rental project (and a Maintenance
 *  line's job), a Renovation line's project of its brand (optional), nothing for the Company. Finance sets the account. */
/** What a line's department brings, as on the payment voucher: Rental its unit or a Rental project (Maintenance also a job),
 *  Renovation a project of its brand (optional), the Company nothing. One of them at a time. */
/* What a Rental line is for: its unit, a maintenance job (Maintenance only) or the company's own Rental project (none
   open, no chip: chew, 17 Nov 2026). With two or three, chips pick one and its box shows; with only the unit, just the box. */
type RentalFor = Exclude<LineDraft['where'], 'none'>;
const FOR_LABEL: Record<RentalFor, string> = { unit: 'Unit', job: 'Maintenance job', project: 'Project' };

const rentalChoices = (sub: LineSubDepartment | null, targets: LineTargets): RentalFor[] =>
  ['unit', ...(sub?.maintenance ? ['job' as const] : []), ...(targets.projectsFor(sub).length > 0 ? ['project' as const] : [])];

function LineForFields({ line: l, sub, targets, onPick }: { line: LineDraft; sub: LineSubDepartment | null; targets: LineTargets; onPick: (p: Partial<LineDraft>) => void }) {
  const [chosen, setChosen] = useState<RentalFor | null>(null);
  const only = (where: LineDraft['where'], patch: Partial<LineDraft>): Partial<LineDraft> =>
    ({ where, unitId: '', jobId: '', projectId: '', ...patch });
  const projects = targets.projectsFor(sub);
  if (sub?.department === 'shared') return <ReadOnlyValue label="For" value="Whole company" />;
  if (sub?.department === 'supply') {
    if (projects.length === 0) return <ReadOnlyValue label="Project" value={`No open project of this brand: ${sub.name}'s own cost`} />;
    return <ComboSelect label="Project (optional)" value={l.where === 'project' ? l.projectId : ''} onChange={v => onPick(v ? only('project', { projectId: v }) : only('none', {}))}
      placeholder={`No project: ${sub.name}'s own cost`} options={projects} />;
  }
  const choices = rentalChoices(sub, targets);
  /* The chip last tapped, else the line's target, else Unit. Tapping a chip only shows its box: the line keeps what it has
     until something is picked there, as when every box showed at once. An empty line saves as a Rental general cost. */
  const shown: RentalFor = chosen && choices.includes(chosen) ? chosen : l.where !== 'none' ? l.where : 'unit';
  const choose = (kind: RentalFor) => setChosen(kind);
  const savedOptions: Record<RentalFor, SelectOption[]> = { unit: targets.unitOptions, job: targets.jobOptions, project: projects };
  const savedId: Record<RentalFor, string> = { unit: l.unitId, job: l.jobId, project: l.projectId };
  const saved = l.where === 'none' || l.where === shown ? null : l.where;
  const kept = saved
    ? `${FOR_LABEL[saved]} ${savedOptions[saved].find(o => o.value === savedId[saved])?.label ?? ''} stays on this line until you pick ${shown === 'job' ? 'a job' : shown === 'project' ? 'a project' : 'a unit'}.`
    : null;
  const pick = (where: Exclude<LineDraft['where'], 'none'>, key: 'unitId' | 'jobId' | 'projectId') => (v: string) =>
    onPick(v ? only(where, { [key]: v }) : only('none', {}));
  const box = shown === 'job'
    ? <ComboSelect label="Maintenance job" value={l.where === 'job' ? l.jobId : ''} onChange={pick('job', 'jobId')} placeholder="Type the job or its unit" options={targets.jobOptions} />
    : shown === 'project'
      ? <ComboSelect label="Project" value={l.where === 'project' ? l.projectId : ''} onChange={pick('project', 'projectId')} placeholder="Type the project name or code" options={projects} />
      : <ComboSelect label="Unit" value={l.where === 'unit' ? l.unitId : ''} onChange={pick('unit', 'unitId')} placeholder="Type a building or unit" options={targets.unitOptions} />;
  if (choices.length === 1) return box;
  return (
    <>
      <ChoiceChips label="For" value={shown} onChange={choose} options={choices.map(value => ({ value, label: FOR_LABEL[value] }))} />
      <div className={cx('min-w-0 flex flex-col gap-1.5', SPAN_ALL)}>
        {box}
        {kept && <span className="text-meta text-muted-ink">{kept}</span>}
      </div>
    </>
  );
}

export function LinesEditor({ lines, setLines, totalSen, department, recoverOn = null }: { lines: LineDraft[]; setLines: (l: LineDraft[]) => void; totalSen: number | null; department: LineDepartment;
  /** A line for a unit can be paid back by the unit's owner, charged once finance pays the request ('paid') or checks the
   *  claim ('checked'; chew, 23 Nov 2026). None: no tick. */
  recoverOn?: 'paid' | 'checked' | null }) {
  const targets = useLineTargets();
  const { subOptions, mineSub, subs } = targets;
  const subOf = (l: LineDraft) => subs.find(x => x.id === (l.subDepartmentId || mineSub?.id)) ?? null;
  const set = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const split = lines.length > 1;
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <div key={i} className={cx('flex flex-col gap-3', i > 0 && 'pt-3 [border-top:1px_dashed_var(--color-line)]')}>
          {split && (
            <div className="flex items-center justify-between gap-2">
              <b className="text-copy">Line {i + 1}</b>
              <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          )}
          <div className={TWO_COLUMN_GRID}>
            <div className="min-w-0">
              {subOptions.length === 0 ? (
                <ReadOnlyValue label="Department" value={`${DEPARTMENT[department]} (from your department)`} />
              ) : (
                <ComboSelect label="Department" value={l.subDepartmentId || mineSub?.id || ''}
                  onChange={v => set(i, { subDepartmentId: v === mineSub?.id ? '' : v, where: 'none', unitId: '', jobId: '', projectId: '' })}
                  placeholder="Type a department" options={subOptions} />
              )}
            </div>
            <LineForFields line={l} sub={subOf(l)} targets={targets} onPick={patch => set(i, patch)} />
            <div className={cx('min-w-0', SPAN_ALL)}>
              <Field label="Description" value={l.description} onChange={e => set(i, { description: e.target.value })} placeholder="e.g. tap for the kitchen" maxLength={300} />
            </div>
            {split && <MoneyInput label="Amount" required valueSen={l.amountSen} onChangeSen={v => set(i, { amountSen: v })} />}
            {recoverOn && l.where === 'unit' && l.unitId && (
              <>
                <label className={cx('inline-flex items-center gap-2 text-meta text-ink cursor-pointer select-none min-h-11 sm:min-h-0', SPAN_ALL)}>
                  <input type="checkbox" checked={!!l.recover} onChange={e => set(i, { recover: e.target.checked, recoverSen: null })} />
                  The owner pays this back <span className="text-muted-ink">({recoverOn === 'checked' ? 'charged on the owner statement once finance checks it' : 'charged on the owner statement once finance pays'})</span>
                </label>
                {l.recover && (
                  <>
                    <MoneyInput label="Owner pays back" valueSen={l.recoverSen ?? (split ? l.amountSen : totalSen)} onChangeSen={v => set(i, { recoverSen: v })} />
                    <RowHelp>The whole line, or type part of it.</RowHelp>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={<Icon name="Plus" size="sm" />} onClick={() => setLines([...lines.map((l, j) => (j === 0 && !split ? { ...l, amountSen: totalSen } : l)), blankLine()])}>Split across more lines</Button>
        {split && totalSen != null && (
          <span className="text-meta text-muted-ink tabular-nums">
            Lines add up to {rm(lines.reduce((n, l) => n + (l.amountSen ?? 0), 0))} of {rm(totalSen)}
          </span>
        )}
      </div>
    </div>
  );
}
