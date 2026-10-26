import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner } from '../../components/DataState';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { DateField, NumberInput } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { date, time, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import type { HoursPayload, HoursPerson, HoursPunch } from '../../../functions/api/working-hours/index';
import { DEPARTMENTS, DEPARTMENT_LABEL, type Department } from '../../../functions/_lib/hrFields';
import type { PublicHoliday } from '../../../functions/_lib/leaveRules';

/* ------------------------------------------------------------------ *
 * HR > Employees > Working Hours: Hookka's Working Hours tab. The hours
 * each employee worked per day per department (Cleaning, Maintenance),
 * filled from the phone punches and corrected here; payroll reads them.
 * The public holiday list sits on top, as on Hookka.
 * ------------------------------------------------------------------ */

interface Row {
  key: string;
  /** The saved entry this row came from; null for a row not saved yet. */
  entryId: string | null;
  /** The saved row's day, department and person, so moving it can drop the old one. */
  savedAs: string | null;
  person: string;
  date: string;
  department: Department;
  hours: number | null;
  notes: string;
  attendanceId: string | null;
  origin: 'saved' | 'punch' | 'new';
  dirty: boolean;
}

/** A person's key in the grid: their HR record, or their roster entry before they have one. */
const personKey = (p: Pick<HoursPerson, 'id' | 'cleanerId' | 'technicianId'>): string => p.id ?? (p.cleanerId ? `c:${p.cleanerId}` : `t:${p.technicianId}`);
const identity = (r: Pick<Row, 'person' | 'date' | 'department'>): string => `${r.person}|${r.date}|${r.department}`;
const shiftDay = (d: string, by: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const dayText = (d: string): string => date(`${d}T12:00:00+08:00`);
let seq = 0;
const newKey = (): string => `row-${++seq}`;

/** The grid as the data gives it: saved rows, plus a draft row for each punched day nothing was saved for. */
function rowsFrom(data: HoursPayload): Row[] {
  const people = new Map(data.people.map(p => [p.id, p]));
  const saved: Row[] = data.entries.map(e => ({
    key: newKey(), entryId: e.id, savedAs: `${e.employeeId}|${e.date}|${e.department}`, person: e.employeeId, date: e.date, department: e.department,
    hours: e.hours, notes: e.notes ?? '', attendanceId: e.attendanceId, origin: 'saved', dirty: false,
  }));
  const logged = new Set(saved.map(r => `${r.person}|${r.date}`));
  const drafts: Row[] = data.punches.filter(p => !logged.has(`${p.employeeId}|${p.date}`)).map(p => ({
    key: newKey(), entryId: null, savedAs: null, person: p.employeeId, date: p.date, department: people.get(p.employeeId)?.home ?? 'cleaning',
    hours: p.hours, notes: '', attendanceId: p.attendanceId, origin: 'punch', dirty: true,
  }));
  return [...saved, ...drafts].sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person) || a.department.localeCompare(b.department));
}

export default function WorkingHoursTab() {
  const [params, setParams] = useSearchParams();
  const today = todayMyt();
  const from = params.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = params.get('to') ?? today;
  const { data, loading, error, reload } = useApi<HoursPayload>(`/working-hours?from=${from}&to=${to}`);
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<{ name: string; department: '' | Department; day: string }>({ name: '', department: '', day: '' });
  const [copyFrom, setCopyFrom] = useState(shiftDay(to, -1));

  useEffect(() => { if (data) { setRows(rowsFrom(data)); setRemoved([]); } }, [data]);
  const setRange = (f: string, t: string) => setParams(p => { const n = new URLSearchParams(p); n.set('from', f); n.set('to', t); return n; }, { replace: true });

  const people = useMemo(() => new Map((data?.people ?? []).map(p => [personKey(p), p])), [data]);
  const punchOf = useMemo(() => new Map((data?.punches ?? []).map(p => [`${p.employeeId}|${p.date}`, p])), [data]);
  const changes = rows.filter(r => r.dirty).length + removed.length;
  const multiDay = from !== to;

  const update = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  function remove(r: Row) {
    const { entryId } = r;
    if (entryId) setRemoved(x => [...x, entryId]);
    setRows(rs => rs.filter(x => x.key !== r.key));
  }
  const duplicate = (r: Row) => setRows(rs => {
    const other = DEPARTMENTS.find(d => d !== r.department) ?? r.department;
    const i = rs.findIndex(x => x.key === r.key);
    const copy: Row = { ...r, key: newKey(), entryId: null, savedAs: null, department: other, hours: null, notes: '', origin: 'new', dirty: true };
    return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
  });
  const addRow = () => {
    const first = data?.people[0];
    if (!first) return;
    setRows(rs => [...rs, { key: newKey(), entryId: null, savedAs: null, person: personKey(first), date: to, department: first.home, hours: null, notes: '', attendanceId: null, origin: 'new', dirty: true }]);
  };
  function copyDay(source: string, target: string) {
    const have = new Set(rows.filter(r => r.date === target).map(r => `${r.person}|${r.department}`));
    const copies = rows.filter(r => r.date === source && !have.has(`${r.person}|${r.department}`))
      .map(r => ({ ...r, key: newKey(), entryId: null, savedAs: null, date: target, attendanceId: null, origin: 'new' as const, dirty: true }));
    if (!copies.length) { toast({ tone: 'warning', title: 'Nothing to copy.', body: `No rows on ${dayText(source)} that ${dayText(target)} does not already have.` }); return; }
    setRows(rs => [...rs, ...copies]);
    toast({ tone: 'success', title: `${copies.length} ${copies.length === 1 ? 'row' : 'rows'} copied to ${dayText(target)}.`, body: 'Save All to keep them.' });
  }

  async function saveAll() {
    const bad = rows.find(r => r.dirty && (r.hours === null || r.hours < 0 || r.hours > 24));
    if (bad) { toast({ tone: 'critical', title: 'Some hours are missing.', body: `${people.get(bad.person)?.name ?? 'A row'} on ${dayText(bad.date)}: enter the hours (0 to 24).` }); return; }
    const dirty = rows.filter(r => r.dirty);
    // A saved row moved to another person, day or department: the old one goes, the row is written anew.
    const moved = dirty.flatMap(r => (r.entryId && r.savedAs !== identity(r) ? [r.entryId] : []));
    setBusy(true);
    try {
      const res = await api.put<{ saved: number; removed: number }>('/working-hours', {
        removed: [...removed, ...moved],
        rows: dirty.map(r => {
          const p = people.get(r.person);
          return { employeeId: p?.id ?? null, cleanerId: p?.id ? null : p?.cleanerId ?? null, technicianId: p?.id ? null : p?.technicianId ?? null,
            date: r.date, department: r.department, hours: r.hours, notes: r.notes, attendanceId: r.attendanceId };
        }),
      });
      toast({ tone: 'success', title: 'Working hours saved.', body: `${res.saved} saved${res.removed ? `, ${res.removed} removed` : ''}. Payroll uses them from the next refresh.` });
      reload();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }

  const shown = rows.filter(r => {
    const p = people.get(r.person);
    return (!filter.name || (p?.name ?? '').toLowerCase().includes(filter.name.toLowerCase()))
      && (!filter.department || r.department === filter.department) && (!filter.day || r.date === filter.day);
  });
  const dayTotal = (r: Row): number => rows.filter(x => x.person === r.person && x.date === r.date).reduce((n, x) => n + (x.hours ?? 0), 0);
  const totals = [...people.values()].map(p => {
    const mine = rows.filter(r => r.person === personKey(p));
    const days = new Map<string, number>();
    for (const r of mine) days.set(r.date, (days.get(r.date) ?? 0) + (r.hours ?? 0));
    return { p, hours: [...days.values()].reduce((a, b) => a + b, 0), over: [...days.values()].some(h => h > p.hoursPerDay) };
  }).filter(t => t.hours > 0);

  async function leave(go: () => void) {
    if (changes && await ask({ title: 'Leave without saving?', body: `${changes} ${changes === 1 ? 'change is' : 'changes are'} not saved.`, confirmLabel: 'Leave', danger: true }) === null) return;
    go();
  }

  return (
    <div className="flex flex-col gap-5">
      {confirmDialog}
      {error && <StaleBanner message={`Showing the last hours we have. ${error}`} onRetry={reload} />}
      <PublicHolidays holidays={data?.holidays ?? []} mayEdit={mayEdit} onChange={reload} year={to.slice(0, 4)} />

      <section className="bg-card rounded-card border border-solid border-line">
        <div className="pt-5 pb-3 px-5 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line-soft)]">
          <span className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Daily Working Hours</span>
            <span className="text-meta text-muted-ink">{data?.shiftRules ? 'Punch hours follow the shift rules (Payroll > Pay Rules).' : 'Punch hours are clock-out minus clock-in.'}</span>
          </span>
          <span className="flex items-end gap-2 flex-wrap">
            <DateField label="From" className="w-[170px]" value={from} max={to} onChange={v => v && void leave(() => setRange(v, to))} />
            <DateField label="To" className="w-[170px]" value={to} min={from} onChange={v => v && void leave(() => setRange(from, v))} />
            {mayEdit && <>
              <DateField label="Copy from" className="w-[170px]" value={copyFrom} onChange={v => v && setCopyFrom(v)} />
              <Button size="sm" variant="secondary" icon={<Icon name="Copy" size="sm" />} onClick={() => copyDay(copyFrom, to)}>Copy</Button>
              <Button size="sm" variant="secondary" onClick={() => copyDay(shiftDay(to, -1), to)}>Copy yesterday</Button>
              <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={addRow}>Add Row</Button>
              <Button size="sm" variant="primary" icon={<Icon name="Save" size="sm" />} disabled={busy || !changes} onClick={() => void saveAll()}>Save All ({changes})</Button>
            </>}
            <Button size="sm" variant="tertiary" icon={<Icon name="Printer" size="sm" />} onClick={() => window.print()}>Print</Button>
          </span>
          {totals.length > 0 && (
            <span className="flex gap-1.5 flex-wrap">
              {totals.map(t => (
                <span key={personKey(t.p)} className={cx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-pill text-meta border border-solid',
                  t.over ? 'bg-warning-bg border-warning-line text-ink' : 'bg-page border-line text-ink')}>
                  {t.p.name}<span className="tabular-nums text-muted-ink">{t.hours.toFixed(1)} h</span>
                </span>
              ))}
            </span>
          )}
          <span className="flex items-end gap-2 flex-wrap">
            {multiDay && <DateField label="Date" className="w-[170px]" value={filter.day} min={from} max={to} onChange={v => setFilter(f => ({ ...f, day: v }))} />}
            <Field label="Employee" value={filter.name} onChange={e => setFilter(f => ({ ...f, name: e.target.value }))} placeholder="Name" />
            <Select label="Department" showLabel size="md" className="w-[180px]" value={filter.department} placeholder="All departments"
              onChange={v => setFilter(f => ({ ...f, department: v === 'cleaning' || v === 'maintenance' ? v : '' }))}
              options={[{ value: '', label: 'All departments' }, ...DEPARTMENTS.map(d => ({ value: d, label: DEPARTMENT_LABEL[d] }))]} />
            {(filter.name || filter.department || filter.day) && <Button size="sm" variant="tertiary" onClick={() => setFilter({ name: '', department: '', day: '' })}>Clear</Button>}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-copy">
            <thead>
              <tr className="text-left text-meta text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">
                {multiDay && <th className="py-2.5 px-4 font-medium">Date</th>}
                <th className="py-2.5 px-4 font-medium">Employee</th>
                <th className="py-2.5 px-4 font-medium">Department</th>
                <th className="py-2.5 px-4 font-medium">Punch (in / out)</th>
                <th className="py-2.5 px-4 font-medium">Hours</th>
                <th className="py-2.5 px-4 font-medium">Notes</th>
                <th className="py-2.5 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={7} className="py-6 px-4 text-muted-ink">Loading…</td></tr>}
              {data && shown.length === 0 && <tr><td colSpan={7} className="py-6 px-4 text-muted-ink">No hours in this range yet. They fill in as people clock in, or use Add Row.</td></tr>}
              {shown.map(r => (
                <HoursRow key={r.key} row={r} multiDay={multiDay} people={data?.people ?? []} person={people.get(r.person)}
                  punch={punchOf.get(`${r.person}|${r.date}`)} total={dayTotal(r)} from={from} to={to} mayEdit={mayEdit}
                  onChange={patch => update(r.key, patch)} onDuplicate={() => duplicate(r)} onRemove={() => remove(r)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function HoursRow({ row: r, multiDay, people, person, punch, total, from, to, mayEdit, onChange, onDuplicate, onRemove }: {
  row: Row; multiDay: boolean; people: HoursPerson[]; person: HoursPerson | undefined; punch: HoursPunch | undefined; total: number;
  from: string; to: string; mayEdit: boolean; onChange: (patch: Partial<Row>) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const editable = mayEdit && r.origin === 'new';
  const standard = person?.hoursPerDay ?? 8;
  const flag = total > standard ? 'OT' : total > 0 && total < standard ? 'short' : null;
  return (
    <tr className={cx('align-top [border-bottom:1px_solid_var(--color-line-soft)]', r.dirty && 'bg-page')}>
      {multiDay && (
        <td className="py-2 px-4 whitespace-nowrap">
          {editable ? <DateField aria-label="Date" className="w-[160px]" value={r.date} min={from} max={to} onChange={v => v && onChange({ date: v, attendanceId: null })} /> : dayText(r.date)}
        </td>
      )}
      <td className="py-2 px-4 min-w-[180px]">
        {editable ? (
          <Select label="Employee" size="md" value={r.person} onChange={v => onChange({ person: v, attendanceId: null })}
            options={people.map(p => ({ value: personKey(p), label: p.employeeId ? `${p.employeeId} · ${p.name}` : p.name }))} />
        ) : (
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{person?.name ?? 'Unknown'}</span>
            <span className="flex items-center gap-1.5 text-meta text-muted-ink tabular-nums">
              {total.toFixed(1)} h{flag && ` · ${flag}`}
              {r.origin === 'punch' && <StatusBadge tone="warning" label="From punch, not saved" size="sm" />}
            </span>
          </span>
        )}
      </td>
      <td className="py-2 px-4 min-w-[160px]">
        {mayEdit ? (
          <Select label="Department" size="md" value={r.department} onChange={v => (v === 'cleaning' || v === 'maintenance') && onChange({ department: v })}
            options={DEPARTMENTS.map(d => ({ value: d, label: DEPARTMENT_LABEL[d] }))} />
        ) : DEPARTMENT_LABEL[r.department]}
      </td>
      <td className="py-2 px-4 whitespace-nowrap tabular-nums text-muted-ink">
        {punch ? <>{time(punch.clockInAt)} / {punch.forgotOut ? 'no clock-out' : punch.clockOutAt ? time(punch.clockOutAt) : 'in now'}<span className="block text-meta">{punch.hours} h</span></> : 'No punch'}
      </td>
      <td className="py-2 px-4 w-[120px]">
        {mayEdit ? <NumberInput aria-label="Hours" value={r.hours} decimals={2} min={0} max={24} onChange={v => onChange({ hours: v })} /> : <span className="tabular-nums">{r.hours ?? ''}</span>}
      </td>
      <td className="py-2 px-4 min-w-[180px]">
        {mayEdit ? <Field aria-label="Notes" value={r.notes} onChange={e => onChange({ notes: e.target.value })} placeholder="Note" /> : r.notes}
      </td>
      <td className="py-2 px-4 text-right whitespace-nowrap">
        {mayEdit && <>
          <Button size="sm" variant="tertiary" aria-label="Split into another department" title="Split into another department" icon={<Icon name="Plus" size="sm" />} onClick={onDuplicate}>Split</Button>
          <Button size="sm" variant="tertiary" aria-label="Remove row" icon={<Icon name="X" size="sm" />} onClick={onRemove}>Remove</Button>
        </>}
      </td>
    </tr>
  );
}

/** Hookka's Public Holidays card: "Mark dates so workers aren't deducted for not working that day." Saved straight away,
 *  through the one holiday list leave and payroll share (PUT /api/leaves/holidays). */
function PublicHolidays({ holidays, mayEdit, onChange, year }: { holidays: PublicHoliday[]; mayEdit: boolean; onChange: () => void; year: string }) {
  const toast = useToast();
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = holidays.filter(h => h.date.startsWith(`${year}-`));
  async function save(list: PublicHoliday[], done: string) {
    setBusy(true);
    try { await api.put('/leaves/holidays', list); toast({ tone: 'success', title: done, body: 'Payroll and leave use the list from now.' }); onChange(); }
    catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  const add = () => {
    if (!day) return;
    void save([...holidays.filter(h => h.date !== day), { date: day, name: name.trim() || 'Public holiday' }], `${dayText(day)} added.`);
    setDay(''); setName('');
  };
  return (
    <section className="bg-card rounded-card border border-solid border-line px-5 py-4 flex flex-col gap-3">
      <span className="flex flex-col gap-0.5">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Public Holidays</span>
        <span className="text-meta text-muted-ink">Mark dates so workers aren't deducted for not working that day.</span>
      </span>
      {mayEdit && (
        <span className="flex items-end gap-2 flex-wrap">
          <DateField label="Date" className="w-[170px]" value={day} onChange={setDay} />
          <Field label="Name (optional)" value={name} onChange={e => setName(e.target.value)} placeholder="Hari Merdeka" />
          <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} disabled={!day || busy} onClick={add}>Add</Button>
        </span>
      )}
      <span className="flex gap-1.5 flex-wrap">
        {shown.length === 0 && <span className="text-meta text-muted-ink">None for {year} yet.</span>}
        {shown.map(h => (
          <span key={h.date} className="inline-flex items-center gap-1.5 h-8 pl-3 pr-1.5 rounded-pill bg-page border border-solid border-line text-meta">
            <span className="tabular-nums">{dayText(h.date)}</span><span className="text-muted-ink">{h.name}</span>
            {mayEdit && (
              <button type="button" aria-label={`Remove ${h.name}`} disabled={busy}
                onClick={() => void save(holidays.filter(x => x.date !== h.date), `${dayText(h.date)} removed.`)}
                className="size-6 grid place-items-center rounded-pill bg-transparent border-0 cursor-pointer text-muted-ink hover:text-ink">
                <Icon name="X" size="sm" />
              </button>
            )}
          </span>
        ))}
      </span>
    </section>
  );
}
