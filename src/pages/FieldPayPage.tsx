import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { StaleBanner } from '../components/DataState';
import { Select } from '../components/Select';
import { useApi } from '../lib/useApi';
import { notifyFailure } from '../lib/api';
import { rm } from '../lib/format';
import type { FieldPayPayload } from '../../functions/api/field/pay';
import { pcbHasFigure } from '../../functions/_lib/pcb';
import type { PayslipDoc } from '../lib/payslipPdf';

/* ------------------------------------------------------------------ *
 * Portal > Pay: the person's payslip for a month once the office has
 * approved it, or an estimate of the month so far from their punches and
 * leave (HR phase 4, ported from Hookka's worker pay screen). Either can
 * be saved as a PDF.
 * ------------------------------------------------------------------ */

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (p: string): string => `${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export default function FieldPayPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const { data, loading, error, reload } = useApi<FieldPayPayload>(`/field/pay${asked && /^\d{4}-\d{2}$/.test(asked) ? `?month=${asked}` : ''}`);
  const f = data?.payslip ?? data?.estimate ?? null;
  const status: PayslipDoc['status'] = data?.payslip?.status === 'paid' ? 'paid' : data?.payslip ? 'approved' : 'estimate';

  async function pdf() {
    if (!data || !f) return;
    try {
      const { downloadPayslip } = await import('../lib/payslipPdf');
      await downloadPayslip({
        ...f, period: data.month, employeeName: data.name, employeeNo: data.employeeId, status,
        payBasis: data.payslip?.payBasis ?? 'monthly', paymentMethod: data.payslip?.paymentMethod ?? 'transfer',
        bankName: data.payslip?.bankName ?? null, bankAccount: data.payslip?.bankAccount ?? null,
      }, data.company);
    } catch (e) { notifyFailure(e); }
  }

  const line = (k: string, v: string, o: { strong?: boolean; minus?: boolean } = {}) => (
    <span className={`flex justify-between gap-3 py-1.5 text-copy ${o.strong ? 'font-semibold' : ''}`}>
      <span className={o.strong ? '' : 'text-muted-ink'}>{k}</span><span className="tabular-nums">{o.minus ? `- ${v}` : v}</span>
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-title font-semibold">Pay</h1>
          <div className="text-copy text-muted-ink">{data ? `${data.name}${data.employeeId ? ` · ${data.employeeId}` : ''}` : 'Loading…'}</div>
        </div>
        {data && data.months.length > 1 && (
          <Select label="Month" value={data.month} onChange={m => setParams(p => { const n = new URLSearchParams(p); n.set('month', m); return n; }, { replace: true })}
            options={data.months.map(m => ({ value: m, label: monthName(m) }))} />
        )}
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data && <span className="text-copy text-muted-ink">Loading…</span>}
      {data && !f && <span className="text-copy text-muted-ink">Nothing for {monthName(data.month)} yet.</span>}

      {data && f && (
        <>
          <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-meta text-muted-ink">{monthName(data.month)}</span>
              {data.payslip ? <StatusBadge entity="payslip" value={data.payslip.status} size="sm" /> : <StatusBadge tone="warning" label="Estimate" size="sm" />}
            </span>
            <span className={`text-[28px] leading-tight font-bold tabular-nums ${f.netSen < 0 ? 'text-danger' : ''}`}>{rm(f.netSen)}</span>
            <span className="text-meta text-muted-ink">{data.payslip ? 'Take-home pay' : 'Take-home so far. It changes until the office approves the month.'}</span>
          </section>

          <section className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col">
            <span className="text-meta font-semibold text-muted-ink pb-1">EARNINGS</span>
            {line(data.payslip?.payBasis === 'daily' ? `Days worked (${f.daysWorked})` : 'Basic salary', rm(data.payslip?.payBasis === 'daily' ? f.daysWorked * f.dayRateSen : f.basicSalarySen))}
            {f.absentDays > 0 && line(`Absent ${f.absentDays} ${f.absentDays === 1 ? 'day' : 'days'}`, rm(f.absenceDeductionSen), { minus: true })}
            {f.lateShortHours > 0 && line(`Late / short ${f.lateShortHours} h`, rm(f.lateShortSen), { minus: true })}
            {f.otHours > 0 && line(`Overtime ${f.otHours} h`, rm(f.otSen))}
            {f.sundayHours > 0 && line(`Sunday ${f.sundayHours} h`, rm(f.sundaySen))}
            {f.holidayHours > 0 && line(`Public holiday ${f.holidayHours} h`, rm(f.holidaySen))}
            {f.allowanceSen > 0 && line('Leader allowance', rm(f.allowanceSen))}
            {line('Gross', rm(f.grossSen), { strong: true })}
            <span className="text-meta font-semibold text-muted-ink pt-3 pb-1">DEDUCTIONS</span>
            {line('EPF', rm(f.epfEmployeeSen), { minus: true })}
            {line('SOCSO', rm(f.socsoEmployeeSen), { minus: true })}
            {line('EIS', rm(f.eisEmployeeSen), { minus: true })}
            {pcbHasFigure(f.pcbStatus) ? line('PCB (tax)', rm(f.pcbSen), { minus: true }) : f.pcbStatus !== 'DISABLED' && line('PCB (tax)', 'Not worked out')}
            {f.advanceSen > 0 && line('Advance taken back', rm(f.advanceSen), { minus: true })}
            <span className="text-meta text-muted-ink pt-2">Worked {f.daysWorked} of {f.workingDays} working days · paid leave {f.paidLeaveDays} · absent {f.absentDays}</span>
          </section>

          <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="Download" size="sm" />} onClick={() => void pdf()}>
            Save {data.payslip ? 'payslip' : 'estimate'} as PDF
          </Button>
        </>
      )}
    </div>
  );
}
