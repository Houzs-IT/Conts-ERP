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
import { statusOf } from '../lib/status';
import { usePortalLang, usePortalText, usePortalDates } from '../lib/portalI18n';
import type { PayslipDoc } from '../lib/payslipPdf';

/* ------------------------------------------------------------------ *
 * Portal > Pay: the person's payslip for a month once the office has
 * approved it, or an estimate of the month so far from their punches and
 * leave (HR phase 4, ported from Hookka's worker pay screen). Either can
 * be saved as a PDF (in English: its fonts carry no Chinese or Burmese).
 * ------------------------------------------------------------------ */

export default function FieldPayPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const { data, loading, error, reload } = useApi<FieldPayPayload>(`/field/pay${asked && /^\d{4}-\d{2}$/.test(asked) ? `?month=${asked}` : ''}`);
  const f = data?.payslip ?? data?.estimate ?? null;
  const t = usePortalText();
  const lang = usePortalLang();
  const { month: monthName } = usePortalDates();
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
          <h1 className="m-0 text-title font-semibold">{t.pay.title}</h1>
          <div className="text-copy text-muted-ink">{data ? `${data.name}${data.employeeId ? ` · ${data.employeeId}` : ''}` : t.common.loading}</div>
        </div>
        {data && data.months.length > 1 && (
          <Select label={t.pay.month} value={data.month} onChange={m => setParams(p => { const n = new URLSearchParams(p); n.set('month', m); return n; }, { replace: true })}
            options={data.months.map(m => ({ value: m, label: monthName(m) }))} />
        )}
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data && <span className="text-copy text-muted-ink">{t.common.loading}</span>}
      {data && !f && <span className="text-copy text-muted-ink">{t.pay.nothing(monthName(data.month))}</span>}

      {data && f && (
        <>
          <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-meta text-muted-ink">{monthName(data.month)}</span>
              {data.payslip ? <StatusBadge tone={statusOf('payslip', data.payslip.status).tone} label={t.payslipStatus[data.payslip.status]} size="sm" dot /> : <StatusBadge tone="warning" label={t.pay.estimate} size="sm" />}
            </span>
            <span className={`text-[28px] leading-tight font-bold tabular-nums ${f.netSen < 0 ? 'text-danger' : ''}`}>{rm(f.netSen)}</span>
            <span className="text-meta text-muted-ink">{data.payslip ? t.pay.takeHome : t.pay.takeHomeSoFar}</span>
          </section>

          <section className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col">
            <span className="text-meta font-semibold text-muted-ink pb-1">{t.pay.earnings}</span>
            {line(data.payslip?.payBasis === 'daily' ? t.pay.daysWorked(f.daysWorked) : t.pay.basic, rm(data.payslip?.payBasis === 'daily' ? f.daysWorked * f.dayRateSen : f.basicSalarySen))}
            {f.absentDays > 0 && line(t.pay.absent(t.common.days(f.absentDays)), rm(f.absenceDeductionSen), { minus: true })}
            {f.lateShortHours > 0 && line(t.pay.lateShort(f.lateShortHours), rm(f.lateShortSen), { minus: true })}
            {f.otHours > 0 && line(t.pay.overtime(f.otHours), rm(f.otSen))}
            {f.sundayHours > 0 && line(t.pay.sunday(f.sundayHours), rm(f.sundaySen))}
            {f.holidayHours > 0 && line(t.pay.holiday(f.holidayHours), rm(f.holidaySen))}
            {f.allowanceSen > 0 && line(t.pay.leaderAllowance, rm(f.allowanceSen))}
            {line(t.pay.gross, rm(f.grossSen), { strong: true })}
            <span className="text-meta font-semibold text-muted-ink pt-3 pb-1">{t.pay.deductions}</span>
            {line('EPF', rm(f.epfEmployeeSen), { minus: true })}
            {line('SOCSO', rm(f.socsoEmployeeSen), { minus: true })}
            {line('EIS', rm(f.eisEmployeeSen), { minus: true })}
            {pcbHasFigure(f.pcbStatus) ? line(t.pay.pcb, rm(f.pcbSen), { minus: true }) : f.pcbStatus !== 'DISABLED' && line(t.pay.pcb, t.pay.notWorkedOut)}
            {f.advanceSen > 0 && line(t.pay.advance, rm(f.advanceSen), { minus: true })}
            {f.penaltySen > 0 && line(t.pay.penalty, rm(f.penaltySen), { minus: true })}
            <span className="text-meta text-muted-ink pt-2">{t.pay.summary(f.daysWorked, f.workingDays, f.paidLeaveDays, f.absentDays)}</span>
          </section>

          <Button size="touch" variant="secondary" className="w-full" icon={<Icon name="Download" size="sm" />} onClick={() => void pdf()}>
            {data.payslip ? t.pay.savePayslip : t.pay.saveEstimate}
          </Button>
          {lang !== 'en' && <span className="text-meta text-muted-ink text-center">{t.pay.pdfEnglish}</span>}
        </>
      )}
    </div>
  );
}
