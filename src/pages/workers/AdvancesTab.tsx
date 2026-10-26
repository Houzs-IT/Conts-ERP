import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner } from '../../components/DataState';
import { StatTile, StatRow } from '../../components/Metric';
import { Field } from '../../components/Field';
import { MoneyInput, DateField } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { mayRun } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, date, todayMyt } from '../../lib/format';
import { downloadTable } from '../../lib/export';
import type { PayrollPayload, PayrollLine, AdvanceView } from '../../../functions/api/payroll/index';
import { DEPARTMENT_LABEL } from '../../../functions/_lib/hrFields';
import { MonthSelect, monthName } from './PayrollTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Advances: Hookka's Salary Advances. Money handed out
 * before payday, by month: three summary cards, a batch entry (tick
 * everyone, then fill the column of amounts), the list with inline edit,
 * and the payout listing HR counts the cash against. The payslip of the
 * advance's own month takes it back.
 * ------------------------------------------------------------------ */

const keyOf = (l: PayrollLine): string => (l.employee.cleanerId ? `c:${l.employee.cleanerId}` : `t:${l.employee.technicianId}`);
const deptOf = (l: PayrollLine | undefined): string => (l ? DEPARTMENT_LABEL[l.employee.cleanerId ? 'cleaning' : 'maintenance'] : '');
const day = (d: string): string => date(`${d}T12:00:00+08:00`);
const th = 'py-2.5 px-3 font-medium text-left whitespace-nowrap';
const td = 'py-2 px-3 [border-top:1px_solid_var(--color-line-soft)]';
const LOCKED = 'Settled: the month\'s payroll is approved. Reopen it first.';

interface PayoutRow { employeeId: string; empNo: string; name: string; dept: string; items: AdvanceView[]; totalSen: number }

export default function AdvancesTab() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const { data, loading, error, reload } = useApi<PayrollPayload>(`/payroll${asked && /^\d{4}-\d{2}$/.test(asked) ? `?period=${asked}` : ''}`);
  const { user } = useSession();
  const full = mayRun(user, 'hr');
  const period = data?.period ?? todayMyt().slice(0, 7);
  const setMonth = (m: string) => setParams(p => { const n = new URLSearchParams(p); n.set('month', m); return n; }, { replace: true });
  const list = data?.advances ?? [];
  const lineById = useMemo(() => new Map((data?.lines ?? []).filter(l => l.employee.id).map(l => [l.employee.id, l])), [data]);

  // One row per employee: the days they drew on and the total to hand out (Hookka's payout listing).
  const payout = useMemo<PayoutRow[]>(() => {
    const by = new Map<string, PayoutRow>();
    for (const a of list) {
      const l = lineById.get(a.employeeId);
      const row = by.get(a.employeeId) ?? { employeeId: a.employeeId, empNo: l?.employee.employeeId ?? '', name: a.name, dept: deptOf(l), items: [], totalSen: 0 };
      row.items.push(a);
      row.totalSen += a.amountSen;
      by.set(a.employeeId, row);
    }
    return [...by.values()].sort((x, y) => x.empNo.localeCompare(y.empNo) || x.name.localeCompare(y.name));
  }, [list, lineById]);
  const totalSen = payout.reduce((n, r) => n + r.totalSen, 0);

  function exportPayout() {
    const rm2 = (sen: number): string => (sen / 100).toFixed(2);
    downloadTable('csv', `advance-payout-${period}`, 'Advances', [
      { label: 'Employee No', kind: 'text' }, { label: 'Employee Name', kind: 'text' }, { label: 'Department', kind: 'text' },
      { label: 'Advances', kind: 'number' }, { label: 'Dates', kind: 'text' }, { label: 'Notes', kind: 'text' }, { label: 'Total Advance', kind: 'money' },
    ], [
      ...payout.map(r => [r.empNo, r.name, r.dept, r.items.length, r.items.map(a => `${a.date} ${rm2(a.amountSen)}`).join('; '),
        r.items.map(a => a.note).filter(Boolean).join('; '), r.totalSen]),
      // A payout sheet without its own total is one somebody adds up by hand before counting the cash.
      ['', 'TOTAL', '', '', '', '', totalSen],
    ]);
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last advances we have. ${error}`} onRetry={reload} />}
      <StatRow cols={3}>
        <StatTile label="Advanced This Month" value={data ? rm(totalSen) : undefined} tone={totalSen > 0 ? 'critical' : undefined} hint="Cash already handed out, taken back on this month's net pay" loading={loading && !data} />
        <StatTile label="Employees" value={data ? String(payout.length) : undefined} hint={`${list.length} ${list.length === 1 ? 'advance' : 'advances'} recorded`} loading={loading && !data} />
        <StatTile label="Settled" value={data ? `${list.filter(a => a.status === 'settled').length} / ${list.length}` : undefined} hint="Locked once this month's payroll is approved" loading={loading && !data} />
      </StatRow>

      <section className="bg-card rounded-card border border-solid border-line">
        <div className="pt-5 pb-4 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Salary Advances - {monthName(period)}</span>
          <span className="flex items-center gap-2 flex-wrap">
            <MonthSelect value={period} latest={data?.today.slice(0, 7) ?? period} onChange={setMonth} />
            {payout.length > 0 && <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} title="One row per employee: the sheet HR counts the cash against" onClick={exportPayout}>Export Payout Listing</Button>}
            {payout.length > 0 && <Button size="sm" variant="tertiary" icon={<Icon name="Printer" size="sm" />} onClick={() => window.print()}>Print Report</Button>}
          </span>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {full && data && <BatchEntry lines={data.lines} period={period} onDone={reload} />}
          {loading && !data ? <p className="m-0 text-copy text-muted-ink">Loading advances…</p>
            : list.length === 0 ? <p className="m-0 py-6 text-center text-copy text-muted-ink">No advances recorded for {monthName(period)}.</p>
            : <AdvanceTable list={list} lineById={lineById} payoutCount={payout.length} totalSen={totalSen} full={full} onChange={reload} />}
        </div>
      </section>
    </div>
  );
}

/** Record advances: one date for the batch, tick everyone, then fill the amounts. Picking one person is a batch of one,
 *  so there is no second path. Each row posts on its own; the ones that fail stay on screen with their amounts. */
function BatchEntry({ lines, period, onDone }: { lines: PayrollLine[]; period: string; onDone: () => void }) {
  const toast = useToast();
  const today = todayMyt();
  const [handedOn, setHandedOn] = useState(today.startsWith(period) ? today : `${period}-01`);
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const byKey = new Map(lines.map(l => [keyOf(l), l]));
  const options = lines.filter(l => `${l.employee.employeeId ?? ''} ${l.employee.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const ready = picked.filter(k => (amount[k] ?? 0) > 0);
  const readySen = ready.reduce((n, k) => n + (amount[k] ?? 0), 0);
  const toggle = (k: string) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  const clear = () => { setPicked([]); setAmount({}); setNote({}); setQuery(''); };

  async function save() {
    setBusy(true);
    const failed: string[] = [];
    for (const k of ready) {
      const l = byKey.get(k);
      if (!l) continue;
      try {
        await api.post('/payroll/advances', { cleanerId: l.employee.cleanerId, technicianId: l.employee.cleanerId ? null : l.employee.technicianId, date: handedOn, amountSen: amount[k], note: note[k] ?? '' });
      } catch (e) {
        failed.push(k);
        notifyFailure(e);
      }
    }
    const ok = ready.length - failed.length;
    if (ok > 0) toast({ tone: 'success', title: `${ok} ${ok === 1 ? 'advance' : 'advances'} recorded.`, body: `Taken back on the ${monthName(handedOn.slice(0, 7))} payslip.` });
    if (failed.length) {
      // Money: say out loud which did not save, and keep them listed for a retry without re-keying.
      toast({ tone: 'critical', title: `Could not record ${failed.length}.`, body: `${failed.map(k => byKey.get(k)?.employee.name ?? k).join(', ')}. They are still listed.` });
      setPicked(failed);
    } else clear();
    setBusy(false);
    onDone();
  }

  return (
    <div className="rounded-control border border-solid border-line bg-page p-4 flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <span className="text-meta font-semibold text-muted-ink">RECORD ADVANCES</span>
        <div className="w-[180px] flex-none"><DateField label="Date handed over" value={handedOn} onChange={v => v && setHandedOn(v)} /></div>
      </div>
      <div className="relative">
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
          className="w-full min-h-10 px-3 flex items-center justify-between gap-2 rounded-control border border-solid border-line bg-card text-copy text-left cursor-pointer [font-family:inherit]">
          <span className={picked.length ? 'text-ink' : 'text-muted-ink'}>{picked.length ? `${picked.length} ${picked.length === 1 ? 'employee' : 'employees'} selected` : 'Select employees'}</span>
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size="sm" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-control border border-solid border-line bg-card shadow-[var(--shadow-raised)]">
            <div className="p-2 [border-bottom:1px_solid_var(--color-line-soft)]"><Field aria-label="Search employees" autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Type to search…" /></div>
            <div className="max-h-64 overflow-y-auto py-1">
              {options.map(l => (
                <label key={keyOf(l)} className="flex items-center gap-2.5 min-h-10 px-3 cursor-pointer text-copy hover:bg-page">
                  <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={picked.includes(keyOf(l))} onChange={() => toggle(keyOf(l))} />
                  <span>{l.employee.employeeId ? `${l.employee.employeeId} · ` : ''}{l.employee.name}</span>
                </label>
              ))}
              {options.length === 0 && <p className="m-0 px-3 py-3 text-copy text-muted-ink">No employee matches that.</p>}
            </div>
            <div className="px-3 py-2 flex items-center justify-between [border-top:1px_solid_var(--color-line-soft)]">
              <Button size="sm" variant="tertiary" onClick={clear}>Clear all</Button>
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </div>

      {picked.length > 0 && (
        <div className="flex flex-col gap-2">
          {picked.map(k => {
            const l = byKey.get(k);
            return (
              <div key={k} className="grid gap-2 items-center grid-cols-1 md:grid-cols-[minmax(0,4fr)_minmax(0,3fr)_minmax(0,4fr)_auto]">
                <span className="flex flex-col min-w-0"><span className="text-copy font-semibold truncate">{l?.employee.name ?? k}</span><span className="text-meta text-muted-ink">{l?.employee.employeeId ?? '-'} · {deptOf(l)}</span></span>
                <MoneyInput aria-label={`Amount for ${l?.employee.name ?? k}`} placeholder="Amount (RM)" valueSen={amount[k] ?? null} onChangeSen={v => setAmount(a => ({ ...a, [k]: v }))} />
                <Field aria-label={`Note for ${l?.employee.name ?? k}`} placeholder="Note (optional)" value={note[k] ?? ''} onChange={e => setNote(n => ({ ...n, [k]: e.target.value }))} />
                <Button size="sm" variant="tertiary" aria-label={`Remove ${l?.employee.name ?? k} from this batch`} icon={<Icon name="X" size="sm" />} onClick={() => toggle(k)}>Remove</Button>
              </div>
            );
          })}
          <div className="pt-2 flex items-center justify-between gap-3 flex-wrap [border-top:1px_solid_var(--color-line-soft)]">
            <span className="text-meta text-muted-ink">{ready.length} of {picked.length} ready · <span className="font-semibold text-ink tabular-nums">{rm(readySen)}</span>{ready.length < picked.length ? ' · rows without an amount are skipped' : ''}</span>
            <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} disabled={busy || ready.length === 0} onClick={() => void save()}>
              {busy ? 'Recording…' : `Add ${ready.length || ''} ${ready.length === 1 ? 'advance' : 'advances'}`}
            </Button>
          </div>
        </div>
      )}
      <p className="m-0 text-meta text-muted-ink">An advance comes off the pay of the month its date falls in. Draft payslips for that month need a Regenerate on the Payroll tab before Net Pay shows it.</p>
    </div>
  );
}

function AdvanceTable({ list, lineById, payoutCount, totalSen, full, onChange }: {
  list: AdvanceView[]; lineById: Map<string | null, PayrollLine>; payoutCount: number; totalSen: number; full: boolean; onChange: () => void;
}) {
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editSen, setEditSen] = useState<number | null>(null);
  const [editNote, setEditNote] = useState('');
  const [busy, setBusy] = useState(false);

  const start = (a: AdvanceView) => { setEditing(a.id); setEditDate(a.date); setEditSen(a.amountSen); setEditNote(a.note ?? ''); };
  async function saveEdit(a: AdvanceView) {
    setBusy(true);
    try {
      await api.put(`/payroll/advances/${a.id}`, { date: editDate, amountSen: editSen, note: editNote });
      toast({ tone: 'success', title: 'Advance updated.', body: a.name });
      setEditing(null);
      onChange();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  async function remove(a: AdvanceView) {
    if (await ask({ title: 'Delete this advance?', body: `${a.name} · ${day(a.date)} · ${rm(a.amountSen)}. It no longer comes off that month's pay; regenerate the month's draft payslips afterwards.`, confirmLabel: 'Delete', danger: true }) === null) return;
    try { await api.del(`/payroll/advances/${a.id}`); toast({ tone: 'success', title: 'Advance deleted.', body: `${a.name}, ${rm(a.amountSen)}.` }); onChange(); }
    catch (e) { notifyFailure(e); }
  }

  return (
    <div className="overflow-x-auto rounded-control border border-solid border-line">
      {confirmDialog}
      <table className="w-full min-w-max border-collapse text-copy">
        <thead><tr className="text-meta text-muted-ink bg-page">
          <th className={th}>Date</th><th className={`${th} min-w-[180px]`}>Employee</th><th className={`${th} text-right`}>Amount</th><th className={th}>Note</th>
          <th className={th} title="Locked once the month's payroll is approved">Status</th>{full && <th className={`${th} text-right`}>Actions</th>}
        </tr></thead>
        <tbody>
          {list.map(a => {
            const l = lineById.get(a.employeeId);
            const settled = a.status === 'settled';
            const on = editing === a.id;
            return (
              <tr key={a.id}>
                <td className={`${td} whitespace-nowrap`}>{on ? <div className="w-[170px]"><DateField aria-label="Date" value={editDate} onChange={v => v && setEditDate(v)} /></div> : day(a.date)}</td>
                <td className={td}><span className="flex flex-col"><span className="font-semibold">{a.name}</span><span className="text-meta text-muted-ink">{l?.employee.employeeId ?? '-'} · {deptOf(l)}</span></span></td>
                <td className={`${td} text-right tabular-nums`}>{on ? <div className="w-[140px] ml-auto"><MoneyInput aria-label="Amount" valueSen={editSen} onChangeSen={setEditSen} /></div> : <span className="font-semibold text-danger">{rm(a.amountSen)}</span>}</td>
                <td className={`${td} text-muted-ink`}>{on ? <Field aria-label="Note" value={editNote} onChange={e => setEditNote(e.target.value)} /> : a.note || '-'}</td>
                <td className={td}><StatusBadge tone={settled ? 'info' : 'neutral'} label={settled ? 'Settled' : 'Unsettled'} size="sm" /></td>
                {full && (
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {on ? (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="primary" disabled={busy || !editSen} onClick={() => void saveEdit(a)}>Save</Button>
                        <Button size="sm" variant="tertiary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="tertiary" aria-label={`Edit advance for ${a.name}`} icon={<Icon name="Pencil" size="sm" />} disabled={settled}
                          disabledReason={LOCKED} onClick={() => start(a)}>Edit</Button>
                        <Button size="sm" variant="tertiary" aria-label={`Delete advance for ${a.name}`} icon={<Icon name="Trash2" size="sm" />} disabled={settled}
                          disabledReason={LOCKED} onClick={() => void remove(a)}>Delete</Button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          <tr className="font-semibold bg-page">
            <td className={td} /><td className={td}>TOTAL ({payoutCount} {payoutCount === 1 ? 'employee' : 'employees'})</td>
            <td className={`${td} text-right tabular-nums text-danger`}>{rm(totalSen)}</td><td className={td} /><td className={td} />{full && <td className={td} />}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
