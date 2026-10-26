import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { StatTile, StatRow } from '../../components/Metric';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { mayRun } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, todayMyt } from '../../lib/format';
import { downloadTable, type ExportColumn, type ExportCell } from '../../lib/export';
import type { PayrollPayload, PayrollLine } from '../../../functions/api/payroll/index';
import type { PayFigures } from '../../../functions/_lib/payrollCalc';
import { DEPARTMENT_LABEL } from '../../../functions/_lib/hrFields';
import { PayRulesPanel } from './PayRules';
import { pcbHasFigure } from '../../../functions/_lib/pcb';
import type { PayslipDoc } from '../../lib/payslipPdf';

/* ------------------------------------------------------------------ *
 * HR > Employees > Payroll: Hookka's Payroll Processing. The month's pay
 * for every in-house cleaner and technician in Hookka's columns, its four
 * summary cards and its Export CSV. Generate the month to make draft
 * payslips, check them, approve once the month has ended, then mark them
 * paid. The pay rules are kept here too.
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

/** Month picker for the payroll tabs (Hookka's month and year selects as one): the last two years, newest first. */
export function MonthSelect({ value, latest, onChange }: { value: string; latest: string; onChange: (m: string) => void }) {
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(latest, -i));
  if (!months.includes(value)) months.push(value);
  return <Select label="Month" size="md" className="w-[180px]" value={value} onChange={onChange} options={months.map(m => ({ value: m, label: monthName(m) }))} />;
}

const department = (l: PayrollLine): string => DEPARTMENT_LABEL[l.employee.cleanerId ? 'cleaning' : 'maintenance'];
const otTotal = (f: PayFigures): number => f.otSen + f.sundaySen + f.holidaySen;
const totalPay = (f: PayFigures): number => f.grossSen + f.epfEmployerSen + f.socsoEmployerSen + f.eisEmployerSen;
const basicEarned = (l: PayrollLine, f: PayFigures): number =>
  l.employee.payBasis === 'daily' ? f.daysWorked * f.dayRateSen : Math.max(0, f.basicSalarySen - f.absenceDeductionSen - f.lateShortSen);
const minus = (sen: number): ReactNode => (sen > 0 ? <span className="tabular-nums text-danger">-{rm(sen)}</span> : '');

function docOf(line: PayrollLine, month: PayrollPayload, f: PayFigures): PayslipDoc {
  const { employee: e, payslip: slip } = line;
  return {
    ...f, period: month.period, employeeName: e.name, employeeNo: e.employeeId, payBasis: e.payBasis,
    paymentMethod: e.paymentMethod, bankName: e.bankName, bankAccount: slip?.bankAccount ?? null, status: slip?.status ?? 'estimate',
  };
}
async function downloadPdf(line: PayrollLine, month: PayrollPayload): Promise<void> {
  const f = figuresOf(line);
  if (!f) return;
  try { const { downloadPayslip } = await import('../../lib/payslipPdf'); await downloadPayslip(docOf(line, month, f), month.company); }
  catch (e) { notifyFailure(e); }
}

/** Hookka's Export CSV: one row per person with every figure and how the docks were worked out, for the accountant. */
function exportCsv(data: PayrollPayload): void {
  const cols: ExportColumn[] = [
    { label: 'Employee No', kind: 'text' }, { label: 'Employee Name', kind: 'text' }, { label: 'Department', kind: 'text' },
    { label: 'Basic Salary', kind: 'money' }, { label: 'Working Days', kind: 'number' }, { label: 'Days Worked', kind: 'number' },
    { label: 'Paid Leave Days', kind: 'number' }, { label: 'Absent Days', kind: 'number' }, { label: 'Absence Deduction', kind: 'money' },
    { label: 'Absence Formula', kind: 'text' }, { label: 'Late/Short Hours', kind: 'number' }, { label: 'Late/Short Deduction', kind: 'money' },
    { label: 'Late/Short Formula', kind: 'text' }, { label: 'Basic Earned', kind: 'money' },
    { label: 'OT Weekday Hrs', kind: 'number' }, { label: 'OT Sunday Hrs', kind: 'number' }, { label: 'OT PH Hrs', kind: 'number' },
    { label: 'Hourly Rate', kind: 'money' }, { label: 'OT Weekday Amt', kind: 'money' }, { label: 'OT Sunday Amt', kind: 'money' },
    { label: 'OT PH Amt', kind: 'money' }, { label: 'Total OT', kind: 'money' }, { label: 'Allowances', kind: 'money' },
    { label: 'Gross Pay', kind: 'money' }, { label: 'EPF EE', kind: 'money' }, { label: 'EPF ER', kind: 'money' },
    { label: 'SOCSO EE', kind: 'money' }, { label: 'SOCSO ER', kind: 'money' }, { label: 'EIS EE', kind: 'money' }, { label: 'EIS ER', kind: 'money' },
    { label: 'PCB', kind: 'money' }, { label: 'Total Deductions', kind: 'money' },
    // After the statutory total, where they sit in the sum: Gross - Total Deductions - Advance - Penalty = Net Pay.
    { label: 'Advance Taken', kind: 'money' }, { label: 'Advance Dates', kind: 'text' }, { label: 'Worker Penalty', kind: 'money' },
    { label: 'Net Pay', kind: 'money' }, { label: 'Bank Account', kind: 'text' }, { label: 'Status', kind: 'text' },
  ];
  const rm2 = (sen: number): string => (sen / 100).toFixed(2);
  const rows: ExportCell[][] = data.lines.flatMap(l => {
    const f = figuresOf(l);
    if (!f) return [];
    const advanceDates = data.advances.filter(a => a.employeeId === l.employee.id).map(a => `${a.date} ${rm2(a.amountSen)}`).join('; ');
    return [[
      l.employee.employeeId, l.employee.name, department(l), f.basicSalarySen, f.workingDays, f.daysWorked, f.paidLeaveDays, f.absentDays,
      f.absenceDeductionSen || null, f.absentDays > 0 ? `${rm2(f.dayRateSen)}/day x ${f.absentDays} = ${rm2(f.absenceDeductionSen)}` : '',
      f.lateShortHours || null, f.lateShortSen || null,
      f.lateShortHours > 0 ? `${f.lateShortHours}h x ${rm2(Math.round(f.lateShortSen / f.lateShortHours))}/h = ${rm2(f.lateShortSen)}` : '',
      basicEarned(l, f), f.otHours, f.sundayHours, f.holidayHours, f.hourRateSen, f.otSen, f.sundaySen, f.holidaySen, otTotal(f), f.allowanceSen,
      f.grossSen, f.epfEmployeeSen, f.epfEmployerSen, f.socsoEmployeeSen, f.socsoEmployerSen, f.eisEmployeeSen, f.eisEmployerSen,
      // A blank, not 0.00, where no PCB was worked out (as on screen).
      pcbHasFigure(f.pcbStatus) ? f.pcbSen : null, f.totalDeductionsSen,
      f.advanceSen || null, advanceDates, f.penaltySen || null, f.netSen, l.payslip?.bankAccount ?? '', l.payslip?.status ?? 'not run',
    ]];
  });
  downloadTable('csv', `payroll-${data.period}`, 'Payroll', cols, rows);
}

const money = (key: string, label: string, pick: (f: PayFigures) => number, width = 110, title?: string): Column<PayrollLine> =>
  ({ key, label, type: 'money', value: l => { const f = figuresOf(l); return f ? pick(f) : null; }, width, title, align: 'right' });
const hours = (key: string, label: string, pick: (f: PayFigures) => number): Column<PayrollLine> =>
  ({ key, label, type: 'number', value: l => { const f = figuresOf(l); return f ? pick(f) : null; }, width: 80, align: 'right' });
/** A deduction column: shown as a red minus, blank when nothing was taken. */
const dock = (key: string, label: string, pick: (f: PayFigures) => number, title: string): Column<PayrollLine> =>
  ({ ...money(key, label, pick, 110, title), render: l => { const f = figuresOf(l); return f ? minus(pick(f)) : ''; } });

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
  const figures = lines.map(figuresOf).filter((f): f is PayFigures => !!f);
  const sum = (pick: (f: PayFigures) => number): number => figures.reduce((n, f) => n + pick(f), 0);
  const pcbMissing = figures.filter(f => !pcbHasFigure(f.pcbStatus) && f.pcbStatus !== 'DISABLED').length;
  const stored = lines.some(l => l.payslip);
  const canGenerate = !stored || drafts.length > 0 || lines.some(l => !l.payslip && l.estimate);

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
    { key: 'name', label: 'Employee', value: l => l.employee.name, hideable: false, width: 190,
      render: l => <span className="flex flex-col"><span className="font-semibold whitespace-nowrap">{l.employee.name}</span><span className="text-meta text-muted-ink">{l.employee.employeeId ?? '-'} · {department(l)}</span></span> },
    money('basic', 'Basic', f => f.basicSalarySen),
    { key: 'days', label: 'Days', value: l => figuresOf(l)?.daysWorked ?? null, width: 80, align: 'center', title: 'Days worked of the working days in the month.',
      render: l => { const f = figuresOf(l); return f ? <span className="tabular-nums">{f.daysWorked}/{f.workingDays}</span> : ''; } },
    dock('absence', 'Absence', f => f.absenceDeductionSen, 'Whole working days missed, at the day rate.'),
    dock('late', 'Late/Short', f => f.lateShortSen, 'Hours short on days worked (late past the grace, left early), under the shift rules.'),
    hours('otWk', 'OT Wk', f => f.otHours),
    hours('otSun', 'OT Sun', f => f.sundayHours),
    hours('otPh', 'OT PH', f => f.holidayHours),
    money('otAmt', 'OT Amt', otTotal),
    money('allowance', 'Allowance', f => f.allowanceSen, 110, 'Leader allowance.'),
    money('gross', 'Gross', f => f.grossSen, 120),
    money('epfEe', 'EPF EE', f => f.epfEmployeeSen, 100),
    money('epfEr', 'EPF ER', f => f.epfEmployerSen, 100),
    money('socso', 'SOCSO', f => f.socsoEmployeeSen, 100, 'Employee share.'),
    money('eis', 'EIS', f => f.eisEmployeeSen, 90, 'Employee share.'),
    { key: 'pcb', label: 'PCB', value: l => { const f = figuresOf(l); return f ? pcbCell(f) : null; }, width: 120, align: 'right',
      render: l => { const f = figuresOf(l); return f ? <span className={`tabular-nums ${pcbHasFigure(f.pcbStatus) || f.pcbStatus === 'DISABLED' ? '' : 'text-warning'}`} title={f.pcbNote}>{pcbCell(f)}</span> : ''; } },
    dock('advance', 'Advance', f => f.advanceSen, 'Cash handed over during the month (Advances tab). Comes off after statutory.'),
    dock('penalty', 'Penalty', f => f.penaltySen, 'Approved worker penalties for the month (Worker Penalty tab).'),
    { ...money('net', 'Net Pay', f => f.netSen, 120),
      render: l => { const f = figuresOf(l); return f ? <span className={`font-semibold tabular-nums ${f.netSen < 0 ? 'text-danger' : ''}`}>{rm(f.netSen)}</span> : ''; } },
    { ...money('total', 'Total Pay', totalPay, 120, 'Gross + employer EPF, SOCSO and EIS: what this person costs. An advance does not reduce it.'),
      render: l => { const f = figuresOf(l); return f ? <span className="font-semibold tabular-nums">{rm(totalPay(f))}</span> : ''; } },
    { key: 'status', label: 'Status', type: 'status', entity: 'payslip', value: statusOf, width: 110 },
    { key: 'pdf', label: 'Print', noExport: true, sortable: false, filter: false, width: 80, align: 'center',
      render: l => figuresOf(l) && data ? <Button size="sm" variant="tertiary" aria-label={`Payslip PDF for ${l.employee.name}`} icon={<Icon name="Printer" size="sm" />}
        onClick={e => { e.stopPropagation(); void downloadPdf(l, data); }}>PDF</Button> : null },
  ], [data]);

  return (
    <>
      {confirmDialog}
      {error && <StaleBanner message={`Showing the last payroll we have. ${error}`} onRetry={reload} />}
      <div className="flex flex-col gap-5">
        {figures.length > 0 && (
          <StatRow cols={4}>
            <StatTile label="Total Pay" value={rm(sum(totalPay))} hint={`Gross + all employer statutory${sum(f => f.advanceSen) > 0 ? ` · ${rm(sum(f => f.advanceSen))} of it already handed out as advances` : ''}`} />
            <StatTile label="Gross Pay" value={rm(sum(f => f.grossSen))} hint="Basic - deductions + OT + allowance" />
            <StatTile label="Net Pay" value={rm(sum(f => f.netSen))} hint="Total take-home after statutory" />
            <StatTile label="Statutory (all)" value={rm(sum(f => f.epfEmployeeSen + f.epfEmployerSen + f.socsoEmployeeSen + f.socsoEmployerSen + f.eisEmployeeSen + f.eisEmployerSen + f.pcbSen))}
              hint={`EPF ${rm(sum(f => f.epfEmployeeSen + f.epfEmployerSen))} · SOCSO ${rm(sum(f => f.socsoEmployeeSen + f.socsoEmployerSen))} · EIS ${rm(sum(f => f.eisEmployeeSen + f.eisEmployerSen))} · PCB ${pcbMissing ? `not worked out for ${pcbMissing}` : rm(sum(f => f.pcbSen))}`}
              hintTone={pcbMissing ? 'warning' : undefined} />
          </StatRow>
        )}

        <DataTable<PayrollLine>
          id="payroll" columns={columns} rows={loading && !data ? null : lines} rowKey={l => l.employee.id ?? l.employee.cleanerId ?? l.employee.technicianId ?? l.employee.name}
          pageSize={0} noun={['person', 'people']} exportName={`payroll-${period}`} onRowClick={l => figuresOf(l) && setOpen(l)}
          header={
            <div className="pt-5 pb-4 px-5 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[16px] font-semibold tracking-[-0.01em]">Payroll Processing - {monthName(period)}</span>
                  {figures.length > 0 && <span className="text-meta text-muted-ink">{figures.length} active {figures.length === 1 ? 'worker' : 'workers'} · total salary {rm(sum(f => f.basicSalarySen))} · total pay {rm(sum(totalPay))}</span>}
                </span>
                <span className="flex items-center gap-2 flex-wrap">
                  <MonthSelect value={period} latest={data?.today.slice(0, 7) ?? period} onChange={setMonth} />
                  {full && data && canGenerate && (
                    <Button size="sm" variant={stored ? 'secondary' : 'primary'} icon={<Icon name="DollarSign" size="sm" />} disabled={busy} onClick={() => void run()}
                      title={stored ? 'Recompute this month\'s draft payslips from the current hours, salaries and rules. Approved and paid ones stay as they are.' : undefined}>
                      {busy ? 'Working…' : stored ? 'Regenerate' : data.ended ? 'Generate Payslips' : 'Generate (finalise)'}
                    </Button>
                  )}
                  {full && data && drafts.length > 0 && (
                    <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} disabled={busy || !data.ended}
                      title={data.ended ? undefined : 'A month can be approved once it has ended.'} onClick={() => void approveAll()}>Approve All</Button>
                  )}
                  {data && figures.length > 0 && <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => exportCsv(data)}>Export CSV</Button>}
                  {figures.length > 0 && <Button size="sm" variant="tertiary" icon={<Icon name="Printer" size="sm" />} onClick={() => window.print()}>Print Report</Button>}
                </span>
              </div>
              {data && !data.ended && (
                <p className="m-0 px-3 py-2 rounded-control bg-page text-meta text-muted-ink">
                  <span className="font-semibold text-ink">Estimate · month in progress.</span> Figures cover the days up to today and change as hours are logged. Generate at month-end to lock them in.
                </p>
              )}
            </div>
          }
          footer={figures.length > 0 ? (
            <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap text-copy font-semibold [border-top:1px_solid_var(--color-line)] bg-page">
              <span>TOTAL ({figures.length} {figures.length === 1 ? 'employee' : 'employees'})</span>
              <span className="flex gap-x-5 gap-y-1 flex-wrap tabular-nums">
                <span>Gross {rm(sum(f => f.grossSen))}</span><span>Net {rm(sum(f => f.netSen))}</span><span>Total Pay {rm(sum(totalPay))}</span>
              </span>
            </div>
          ) : undefined}
          empty={{ title: `No payslip records for ${monthName(period)}.`, body: 'In-house cleaners and technicians show here once they are on the payroll.' }}
          renderCard={l => {
            const f = figuresOf(l);
            return (
              <span className="flex flex-col gap-[3px]">
                <span className="flex items-center gap-2 flex-wrap"><span className="text-copy font-semibold">{l.employee.name}</span><StatusBadge entity="payslip" value={statusOf(l)} size="sm" /></span>
                {f && <span className="text-meta text-muted-ink tabular-nums">Gross {rm(f.grossSen)} · Net {rm(f.netSen)} · Total pay {rm(totalPay(f))}</span>}
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

function SlipModal({ line, month, full, onClose, onChange }: { line: PayrollLine; month: PayrollPayload; full: boolean; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = figuresOf(line);
  if (!f) return null;
  const slip = line.payslip;
  async function move(action: 'approve' | 'pay' | 'reopen') {
    setBusy(true);
    try {
      await api.post(`/payroll/${slip?.id}/status`, { action });
      toast({ tone: 'success', title: action === 'approve' ? 'Payslip approved.' : action === 'pay' ? 'Marked paid.' : 'Back to draft.', body: line.employee.name });
      onChange();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  const row = (k: string, v: ReactNode, strong = false) => (
    <span className={`flex justify-between gap-3 py-1 text-copy ${strong ? 'font-semibold' : ''}`}><span className={strong ? '' : 'text-muted-ink'}>{k}</span><span className="tabular-nums">{v}</span></span>
  );
  return (
    <Modal title={`${line.employee.name} · ${monthName(month.period)}`} sub={slip ? `Payslip ${slip.status}` : 'Not run yet: what the month comes to now'} onClose={onClose} width={560}
      footer={<>
        <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => void downloadPdf(line, month)}>PDF</Button>
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
          {f.penaltySen > 0 && row('Penalty', rm(f.penaltySen))}
          {row('Total', rm(f.totalDeductionsSen + f.advanceSen + f.penaltySen), true)}
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
