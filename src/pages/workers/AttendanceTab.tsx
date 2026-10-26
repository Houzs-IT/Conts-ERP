import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { DateField, TimeField } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { date, time } from '../../lib/format';
import { ON_SITE_METRES, type Nearest } from '../../../functions/_lib/attendanceCalc';
import type { AttendanceLine } from '../../../functions/api/attendance/index';

/* ------------------------------------------------------------------ *
 * HR > Workers > Attendance: who clocked in on a day, when, where and
 * with which selfie (HR phase 2). The office fixes a forgotten clock-out
 * here; the portal's Clock screen is where people punch.
 * ------------------------------------------------------------------ */

interface DayPayload { date: string; today: string; buildingsWithLocation: number; data: AttendanceLine[] }

const hm = (min: number): string => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
/** "08:30" in Malaysia time, for the fix form. */
const hhmm = (iso: string): string => time(iso).slice(0, 5);
const place = (p: Nearest | null): string =>
  !p ? '' : p.metres <= ON_SITE_METRES ? `At ${p.name}` : `${p.metres >= 1000 ? `${(p.metres / 1000).toFixed(1)} km` : `${p.metres} m`} from ${p.name}`;
const mytDay = (iso: string): string => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
const rowKey = (l: AttendanceLine): string => l.employee.id ?? l.employee.cleanerId ?? l.employee.technicianId ?? l.employee.name;

function stateOf(l: AttendanceLine): { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' } {
  const p = l.punch;
  if (!p) return { label: 'Not in', tone: 'neutral' };
  if (p.forgotOut) return { label: 'No clock-out', tone: 'warning' };
  return p.clockOutAt ? { label: 'Done', tone: 'success' } : { label: 'In now', tone: 'info' };
}

/** What the office should look at: a punch without a selfie or a location, or one fixed by hand. */
function flags(l: AttendanceLine): string[] {
  const p = l.punch;
  if (!p) return [];
  const out: string[] = [];
  if (!p.inPhoto || (p.clockOutAt && !p.outPhoto)) out.push('No photo');
  if (!p.inGps || (p.clockOutAt && !p.outGps)) out.push('No GPS');
  if (p.note) out.push('Fixed by office');
  return out;
}

export default function AttendanceTab({ tabs }: { tabs: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('day');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const { data, loading, error, reload } = useApi<DayPayload>(`/attendance${day ? `?date=${day}` : ''}`);
  const { user } = useSession();
  const mayFix = mayWork(user, 'hr');
  const [fixing, setFixing] = useState<AttendanceLine | null>(null);

  const shown = data?.date ?? day ?? '';
  const setDay = (d: string) => setParams(p => { const n = new URLSearchParams(p); n.set('day', d); return n; }, { replace: true });
  const lines = data?.data ?? [];
  const count = (label: string) => lines.filter(l => stateOf(l).label === label).length;

  const columns = useMemo<Column<AttendanceLine>[]>(() => [
    { key: 'name', label: 'Name', value: l => l.employee.name, hideable: false, width: 190, render: l => <span className="font-semibold">{l.employee.name}</span> },
    { key: 'empNo', label: 'Employee ID', value: l => l.employee.employeeId, width: 110 },
    { key: 'state', label: 'Status', type: 'status', value: l => stateOf(l).label, status: stateOf, width: 130 },
    { key: 'in', label: 'In', value: l => l.punch?.clockInAt ?? null, width: 90, render: l => l.punch ? time(l.punch.clockInAt) : '' },
    { key: 'out', label: 'Out', value: l => l.punch?.clockOutAt ?? null, width: 90, render: l => l.punch?.clockOutAt ? time(l.punch.clockOutAt) : '' },
    { key: 'hours', label: 'Hours', type: 'number', value: l => l.punch?.minutes ?? null, width: 90, render: l => l.punch && !l.punch.forgotOut ? hm(l.punch.minutes) : '' },
    { key: 'where', label: 'Where', value: l => place(l.inPlace), width: 220, render: l => l.punch ? (place(l.inPlace) || <span className="text-muted-ink">No location</span>) : '' },
    { key: 'photos', label: 'Selfies', noExport: true, sortable: false, filter: false, width: 130, render: l => <Selfies line={l} /> },
    { key: 'flags', label: 'Check', value: l => flags(l).join(', '), width: 190, render: l => (
      <span className="flex gap-1 flex-wrap">{flags(l).map(f => <StatusBadge key={f} tone={f === 'Fixed by office' ? 'neutral' : 'warning'} label={f} size="sm" />)}</span>
    ) },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 110, align: 'right',
      render: l => mayFix && l.punch ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setFixing(l)}>Fix</Button> : null },
  ], [mayFix]);

  return (
    <>
      <PageHeader title="Workers" sub={data ? `${date(`${shown}T12:00:00+08:00`)} · ${count('In now')} in now · ${count('Done')} done · ${count('Not in')} not in${count('No clock-out') ? ` · ${count('No clock-out')} no clock-out` : ''}` : 'Loading the day…'} />
      <div className="mb-4">{tabs}</div>
      {error && <StaleBanner message={`Showing the last day we have. ${error}`} onRetry={reload} />}

      <div className="flex items-end gap-2 flex-wrap mb-4">
        <Button size="sm" variant="secondary" icon={<Icon name="ChevronLeft" size="sm" />} disabled={!shown} onClick={() => setDay(shift(shown, -1))}>Day before</Button>
        <DateField aria-label="Day" value={shown} max={data?.today} onChange={v => v && setDay(v)} />
        <Button size="sm" variant="secondary" disabled={!shown || !data || shown >= data.today} onClick={() => setDay(shift(shown, 1))}>Next day</Button>
        {data && shown !== data.today && <Button size="sm" variant="tertiary" onClick={() => setDay(data.today)}>Today</Button>}
      </div>
      {data && data.buildingsWithLocation === 0 && (
        <p className="m-0 mb-3 text-meta text-muted-ink">No building has a map location yet, so "Where" stays empty. Add one on the building to see where people clocked in.</p>
      )}

      <DataTable<AttendanceLine>
        id="attendance" columns={columns} rows={loading && lines.length === 0 ? null : lines} rowKey={rowKey}
        pageSize={0} noun={['person', 'people']} exportName={`attendance-${shown}`}
        rowTone={l => (l.punch ? null : 'muted')}
        header={
          <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Attendance</span>
            <span className="text-meta text-muted-ink">People clock in and out on their phone, with a selfie and their location.</span>
          </div>
        }
        empty={{ title: 'No in-house staff yet.', body: 'Add an internal cleaner or an in-house technician first.' }}
        renderCard={l => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{l.employee.name}</span>
              <StatusBadge tone={stateOf(l).tone} label={stateOf(l).label} size="sm" />
            </span>
            {l.punch && (
              <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap tabular-nums">
                <span>{time(l.punch.clockInAt)} – {l.punch.clockOutAt ? time(l.punch.clockOutAt) : '…'}</span>
                {!l.punch.forgotOut && <span>{hm(l.punch.minutes)}</span>}
                <span>{place(l.inPlace) || 'No location'}</span>
              </span>
            )}
            {flags(l).length > 0 && <span className="flex gap-1 flex-wrap">{flags(l).map(f => <StatusBadge key={f} tone="warning" label={f} size="sm" />)}</span>}
            {l.punch && <span className="flex items-center gap-2 pt-1"><Selfies line={l} />{mayFix && <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setFixing(l)}>Fix</Button>}</span>}
          </span>
        )}
      />

      {fixing?.punch && <FixModal line={fixing} onClose={() => setFixing(null)} onSaved={() => { setFixing(null); reload(); }} />}
    </>
  );
}

function Selfies({ line }: { line: AttendanceLine }) {
  const p = line.punch;
  if (!p) return null;
  const link = (side: 'in' | 'out') => (
    <a href={`/api/attendance/${p.id}/photo/${side}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 min-h-8 text-ink underline underline-offset-2">
      <Icon name="Image" size="sm" />{side === 'in' ? 'In' : 'Out'}
    </a>
  );
  return <span className="flex gap-3">{p.inPhoto && link('in')}{p.outPhoto && link('out')}</span>;
}

function FixModal({ line, onClose, onSaved }: { line: AttendanceLine; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const p = line.punch;
  const [clockIn, setClockIn] = useState(p ? hhmm(p.clockInAt) : '');
  const [clockOut, setClockOut] = useState(p?.clockOutAt ? hhmm(p.clockOutAt) : '');
  // The clock-out's own Malaysia day is after the work day: a shift past midnight.
  const [outNextDay, setOutNextDay] = useState(!!p?.clockOutAt && mytDay(p.clockOutAt) > p.date);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!p) return null;

  async function save() {
    if (!p) return;
    setBusy(true);
    setErrors({});
    try {
      await api.patch(`/attendance/${p.id}`, { clockIn, clockOut: clockOut || null, outNextDay, note });
      toast({ tone: 'success', title: 'Times fixed.', body: `${line.employee.name}, ${date(`${p.date}T12:00:00+08:00`)}.` });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={`Fix times: ${line.employee.name}`} sub={date(`${p.date}T12:00:00+08:00`)} onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-x-4 gap-y-3 grid-cols-1 sm:grid-cols-2">
          <TimeField label="Clocked in" value={clockIn} onChange={setClockIn} required error={errors.clockIn} />
          <TimeField label="Clocked out" value={clockOut} onChange={setClockOut} error={errors.clockOut} help="Empty if they are still in." />
        </div>
        <label className="flex items-center gap-2.5 min-h-10 cursor-pointer">
          <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={outNextDay} onChange={e => setOutNextDay(e.target.checked)} />
          <span className="text-copy">Clocked out the next day (shift past midnight)</span>
        </label>
        <Field label="Why the change" value={note} onChange={e => setNote(e.target.value)} placeholder="Forgot to clock out, left at 17:00" error={errors.note} />
        {p.note && <p className="m-0 text-meta text-muted-ink">Last fix: {p.note}</p>}
      </div>
    </Modal>
  );
}
