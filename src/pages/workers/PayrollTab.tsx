import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, DateField } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { mayRun } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, date, todayMyt } from '../../lib/format';
import type { PayrollPayload, PayrollLine, AdvanceView } from '../../../functions/api/payroll/index';
import type { PayFigures } from '../../../functions/_lib/payrollCalc';
import { PayRulesPanel } from './PayRules';
import { pcbHasFigure } from '../../../functions/_lib/pcb';
import type { PayslipDoc } from '../../lib/payslipPdf';

/* ------------------------------------------------------------------ *
 * HR > Workers > Payroll: the month's pay for every in-house cleaner and
 * technician (HR phase 4, ported from Hookka). Run the month to make
 * draft payslips, check them, approve once the month has ended, then mark
 * them paid. Advances and the pay rules are kept here too.
 * ------------------------------------------------------------------ */

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (p: string): string => `${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
export const shiftMonth = (p: string, by: number): string => {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const figuresOf = (l: PayrollLine): PayFigures | null => l.payslip ?? l.estimate;
const statusOf = (l: PayrollLine): string => l.payslip?.status ?? 'none';
const pcbCell = (f: PayFigures): string => (pcbHasFigure(f.pcbStatus) ? rm(f.pcbSen) : f.pcbStatus === 'DISABLED' ? 'Off' : 'Not worked out');

export default function PayrollTab() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const { data, loading, error, reload } = useApi<PayrollPayload>(`/payroll${asked && /^\d{4}-\d{2}$/.test(asked) ? `?period=${asked}` : ''}`);
  const { user } = useSession();
  const full = mayRun(user, 'hr');
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const [open, setOpen] = useState<PayrollLine | null>(null);
  const [busy, setBusy] = useState(false);

  const period = data?.period ?? todayMyt().slice(0, 7);
  const setMonth = (m: string) => setParams(p => { const n = new URLSearchParams(p); n.set('month', m); return n; }, { replace: true });
  const lines = data?.lines ?? [];
  const drafts = lines.filter(l => l.payslip?.status === 'draft');
  const netTotal = lines.reduce((n, l) => n + (figuresOf(l)?.netSen ?? 0), 0);

  async function run() {
    setBusy(true);
    try {
      const r = await api.post<{ written: number; kept: number }>('/payroll/generate', { period });
      toast({ tone: 'success', title: `${r.written} draft ${r.written === 1 ? 'payslip' : 'payslips'} ready.`, body: r.kept ? `${r.kept} approved or paid left as they are.` : 'Check them, then approve once the month has ended.' });
      reload();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }

  async function approveAll() {
    if (await ask({ title: `Approve ${drafts.length} payslips for ${monthName(period)}?`, body: 'Each person sees their payslip on the phone, and the month\'s advances count as taken back. You can reopen one until it is marked paid.', confirmLabel: 'Approve all' }) === null) return;
    setBusy(true);
    try {
      for (const l of drafts) if (l.payslip) await api.post(`/payroll/${l.payslip.id}/status`, { action: 'approve' });
      toast({ tone: 'success', title: 'Payslips approved.', body: `${drafts.length} for ${monthName(period)}.` });
      reload();
    } catch (e) { notifyFailure(e); reload(); }
    finally { setBusy(false); }
  }

  const columns = useMemo<Column<PayrollLine>[]>(() => [
    { key: 'name', label: 'Name', value: l => l.employee.name, hideable: false, width: 190, render: l => <span className="font-semibold">{l.employee.name}</span> },
    { key: 'status', label: 'Payslip', type: 'status', entity: 'payslip', value: statusOf, width: 120 },
    { key: 'days', label: 'Worked / absent', value: l => figuresOf(l)?.daysWorked ?? null, width: 140, render: l => { const f = figuresOf(l); return f ? <span className="tabular-nums">{f.daysWorked} / {f.absentDays}</span> : ''; } },
    { key: 'gross', label: 'Gross', type: 'money', value: l => figuresOf(l)?.grossSen ?? null, width: 130 },
    { key: 'statutory', label: 'EPF+SOCSO+EIS', type: 'money', value: l => { const f = figuresOf(l); return f ? f.epfEmployeeSen + f.socsoEmployeeSen + f.eisEmployeeSen : null; }, width: 150 },
    { key: 'pcb', label: 'PCB', value: l => { const f = figuresOf(l); return f ? pcbCell(f) : null; }, width: 140,
      render: l => { const f = figuresOf(l); return f ? <span className={pcbHasFigure(f.pcbStatus) || f.pcbStatus === 'DISABLED' ? '' : 'text-warning'} title={f.pcbNote}>{pcbCell(f)}</span> : ''; } },
    { key: 'advance', label: 'Advance', type: 'money', value: l => figuresOf(l)?.advanceSen ?? null, width: 120 },
    { key: 'net', label: 'Net pay', type: 'money', value: l => figuresOf(l)?.netSen ?? null, width: 130,
      render: l => { const f = figuresOf(l); return f ? <span className={`font-semibold tabular-nums ${f.netSen < 0 ? 'text-danger' : ''}`}>{rm(f.netSen)}</span> : ''; } },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 100, align: 'right',
      render: l => figuresOf(l) ? <Button size="sm" variant="tertiary" onClick={() => setOpen(l)}>Open</Button> : null },
  ], []);

  return (
    <>
      {confirmDialog}
      <p className="m-0 mb-4 text-copy text-muted-ink">{data ? `Payroll ${monthName(period)} · ${lines.length} people · net ${rm(netTotal)}${data.ended ? '' : ' so far'}` : 'Loading payroll…'}</p>
      {error && <StaleBanner message={`Showing the last payroll we have. ${error}`} onRetry={reload} />}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <span className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Icon name="ChevronLeft" size="sm" />} onClick={() => setMonth(shiftMonth(period, -1))}>Previous</Button>
          <span className="text-copy font-semibold px-2">{monthName(period)}</span>
          <Button size="sm" variant="secondary" disabled={!data || period >= data.today.slice(0, 7)} onClick={() => setMonth(shiftMonth(period, 1))}>Next</Button>
        </span>
        {full && data && (
          <span className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<Icon name="RefreshCw" size="sm" />} disabled={busy} onClick={() => void run()}>
              {lines.some(l => l.payslip) ? 'Refresh drafts' : 'Run payroll'}
            </Button>
            <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} disabled={busy || !data.ended || drafts.length === 0}
              title={data.ended ? undefined : 'A month can be approved once it has ended.'} onClick={() => void approveAll()}>
              Approve {drafts.length || ''} drafts
            </Button>
          </span>
        )}
      </div>
      {data && !data.ended && <p className="m-0 mb-3 text-meta text-muted-ink">{monthName(period)} is still running: figures cover the days up to today and change as people clock in. Approve once the month has ended.</p>}

      <div className="flex flex-col gap-5">
        <DataTable<PayrollLine>
          id="payroll" columns={columns} rows={loading && !data ? null : lines} rowKey={l => l.employee.id ?? l.employee.cleanerId ?? l.employee.technicianId ?? l.employee.name}
          pageSize={0} noun={['person', 'people']} exportName={`payroll-${period}`} onRowClick={l => figuresOf(l) && setOpen(l)}
          header={
            <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Payslips</span>
              <span className="text-meta text-muted-ink">"Not run" rows show what the month comes to now. Run payroll to make draft payslips.</span>
            </div>
          }
          empty={{ title: 'Nobody on payroll this month.', body: 'In-house cleaners and technicians show here.' }}
          renderCard={l => {
            const f = figuresOf(l);
            return (
              <span className="flex flex-col gap-[3px]">
                <span className="flex items-center gap-2 flex-wrap"><span className="text-copy font-semibold">{l.employee.name}</span><StatusBadge entity="payslip" value={statusOf(l)} size="sm" /></span>
                {f && <span className="text-meta text-muted-ink tabular-nums">Gross {rm(f.grossSen)} · Net {rm(f.netSen)} · PCB {pcbCell(f)}</span>}
              </span>
            );
          }}
        />

        {data && <PayRulesPanel rules={data.rules} full={full} onSaved={reload} />}
      </div>

      {open && data && <SlipModal line={open} month={data} full={full} onClose={() => setOpen(null)} onChange={() => { setOpen(null); reload(); }} />}
    </>
  );
}

export function Advances({ advances, full, onChange }: { advances: AdvanceView[]; full: boolean; onChange: () => void }) {
  const toast = useToast();
  async function remove(a: AdvanceView) {
    try { await api.del(`/payroll/advances/${a.id}`); toast({ tone: 'success', title: 'Advance removed.', body: `${a.name}, ${rm(a.amountSen)}.` }); onChange(); }
    catch (e) { notifyFailure(e); }
  }
  return (
    <section className="bg-card rounded-card border border-solid border-line">
      <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">Advances this month</span>
        <span className="text-meta text-muted-ink">Taken back in full on this month's payslip.</span>
      </div>
      <div className="px-5 py-2 flex flex-col">
        {advances.length === 0 && <span className="text-copy text-muted-ink py-2">No advances this month.</span>}
        {advances.map(a => (
          <span key={a.id} className="flex items-center justify-between gap-3 min-h-11 text-copy [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
            <span className="flex flex-col"><span className="font-semibold">{a.name} · {rm(a.amountSen)}</span><span className="text-meta text-muted-ink">{date(`${a.date}T12:00:00+08:00`)}{a.note ? ` · ${a.note}` : ''}</span></span>
            {a.status === 'settled' ? <span className="text-meta text-muted-ink">Taken back</span>
              : full && <Button size="sm" variant="tertiary" icon={<Icon name="Trash2" size="sm" />} onClick={() => void remove(a)}>Remove</Button>}
          </span>
        ))}
      </div>
    </section>
  );
}

function SlipModal({ line, month, full, onClose, onChange }: { line: PayrollLine; month: PayrollPayload; full: boolean; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = figuresOf(line);
  if (!f) return null;
  const slip = line.payslip;
  const doc: PayslipDoc = {
    ...f, period: month.period, employeeName: line.employee.name, employeeNo: line.employee.employeeId, payBasis: line.employee.payBasis,
    paymentMethod: line.employee.paymentMethod, bankName: line.employee.bankName, bankAccount: slip?.bankAccount ?? null,
    status: slip?.status ?? 'estimate',
  };
  async function move(action: 'approve' | 'pay' | 'reopen') {
    setBusy(true);
    try {
      await api.post(`/payroll/${slip?.id}/status`, { action });
      toast({ tone: 'success', title: action === 'approve' ? 'Payslip approved.' : action === 'pay' ? 'Marked paid.' : 'Back to draft.', body: line.employee.name });
      onChange();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  async function pdf() {
    try { const { downloadPayslip } = await import('../../lib/payslipPdf'); await downloadPayslip(doc, month.company); }
    catch (e) { notifyFailure(e); }
  }
  const row = (k: string, v: ReactNode, strong = false) => (
    <span className={`flex justify-between gap-3 py-1 text-copy ${strong ? 'font-semibold' : ''}`}><span className={strong ? '' : 'text-muted-ink'}>{k}</span><span className="tabular-nums">{v}</span></span>
  );
  return (
    <Modal title={`${line.employee.name} · ${monthName(month.period)}`} sub={slip ? `Payslip ${slip.status}` : 'Not run yet: what the month comes to now'} onClose={onClose} width={560}
      footer={<>
        <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => void pdf()}>PDF</Button>
        {full && slip?.status === 'approved' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void move('reopen')}>Reopen</Button>}
        {full && slip?.status === 'draft' && <Button size="sm" variant="primary" disabled={busy || !month.ended} title={month.ended ? undefined : 'Once the month has ended.'} onClick={() => void move('approve')}>Approve</Button>}
        {full && slip?.status === 'approved' && <Button size="sm" variant="primary" disabled={busy} onClick={() => void move('pay')}>Mark paid</Button>}
      </>}>
      <div className="grid gap-x-6 gap-y-4 grid-cols-1 sm:grid-cols-2">
        <div className="flex flex-col">
          <span className="text-meta font-semibold text-muted-ink pb-1">EARNINGS</span>
          {row(line.employee.payBasis === 'daily' ? `Days worked ${f.daysWorked} x ${rm(f.dayRateSen)}` : 'Basic salary', rm(line.employee.payBasis === 'daily' ? f.daysWorked * f.dayRateSen : f.basicSalarySen))}
          {f.absentDays > 0 && row(`Absent ${f.absentDays} d`, rm(-f.absenceDeductionSen))}
          {f.lateShortHours > 0 && row(`Late / short ${f.lateShortHours} h`, rm(-f.lateShortSen))}
          {f.otHours > 0 && row(`Overtime ${f.otHours} h`, rm(f.otSen))}
          {f.sundayHours > 0 && row(`Sunday ${f.sundayHours} h`, rm(f.sundaySen))}
          {f.holidayHours > 0 && row(`Public holiday ${f.holidayHours} h`, rm(f.holidaySen))}
          {f.allowanceSen > 0 && row('Leader allowance', rm(f.allowanceSen))}
          {row('Gross', rm(f.grossSen), true)}
        </div>
        <div className="flex flex-col">
          <span className="text-meta font-semibold text-muted-ink pb-1">DEDUCTIONS</span>
          {row('EPF', rm(f.epfEmployeeSen))}
          {row('SOCSO', rm(f.socsoEmployeeSen))}
          {row('EIS', rm(f.eisEmployeeSen))}
          {row('PCB', <span title={f.pcbNote}>{pcbCell(f)}</span>)}
          {f.advanceSen > 0 && row('Advance', rm(f.advanceSen))}
          {row('Total', rm(f.totalDeductionsSen + f.advanceSen), true)}
        </div>
      </div>
      <div className="mt-4 px-4 py-3 rounded-control bg-page flex justify-between text-[18px] font-bold"><span>Net pay</span><span className={`tabular-nums ${f.netSen < 0 ? 'text-danger' : ''}`}>{rm(f.netSen)}</span></div>
      <p className="m-0 mt-3 text-meta text-muted-ink">
        Working days {f.workingDays} · worked {f.daysWorked} · paid leave {f.paidLeaveDays} · absent {f.absentDays}. Employer pays EPF {rm(f.epfEmployerSen)}, SOCSO {rm(f.socsoEmployerSen)}, EIS {rm(f.eisEmployerSen)}.
      </p>
      {!pcbHasFigure(f.pcbStatus) && f.pcbStatus !== 'DISABLED' && <p className="m-0 mt-2 text-meta text-warning">{f.pcbNote}</p>}
    </Modal>
  );
}

export function AdvanceModal({ lines, period, onClose, onDone }: { lines: PayrollLine[]; period: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [who, setWho] = useState('');
  const today = todayMyt();
  const [day, setDay] = useState(today.startsWith(period) ? today : `${period}-01`);
  const [amountSen, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const key = (l: PayrollLine): string => l.employee.cleanerId ? `c:${l.employee.cleanerId}` : `t:${l.employee.technicianId}`;
  const picked = lines.find(l => key(l) === who);
  async function save() {
    if (!picked || !amountSen) return;
    setBusy(true);
    try {
      await api.post('/payroll/advances', { cleanerId: picked.employee.cleanerId, technicianId: picked.employee.cleanerId ? null : picked.employee.technicianId, date: day, amountSen, note });
      toast({ tone: 'success', title: 'Advance recorded.', body: `${picked.employee.name}, ${rm(amountSen)}. Taken back on the ${monthName(day.slice(0, 7))} payslip.` });
      onDone();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Add advance" sub="Money paid out before payday. The payslip of the same month takes it back." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" onClick={() => void save()} disabled={busy || !picked || !amountSen}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <div className="flex flex-col gap-3">
        <Select label="Who" showLabel size="md" value={who} placeholder="Pick a person" onChange={setWho} options={lines.map(l => ({ value: key(l), label: l.employee.name }))} />
        <DateField label="Paid on" value={day} onChange={v => v && setDay(v)} required />
        <MoneyInput label="Amount (RM)" valueSen={amountSen} onChangeSen={setAmount} />
        <Field label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} placeholder="Cash for a family emergency" />
      </div>
    </Modal>
  );
}
