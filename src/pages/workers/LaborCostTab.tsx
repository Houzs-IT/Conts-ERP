import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner } from '../../components/DataState';
import { StatTile, StatRow } from '../../components/Metric';
import { Select } from '../../components/Select';
import { DateField } from '../../components/inputs';
import { useApi } from '../../lib/useApi';
import { rm, date, todayMyt } from '../../lib/format';
import type { LaborCostPayload } from '../../../functions/_lib/laborCost';
import { DEPARTMENT_LABEL } from '../../../functions/_lib/hrFields';
import { monthName, shiftMonth } from './PayrollTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Labor Cost: Hookka's "Labor Cost vs Revenue". The
 * labour cost of the logged hours per department against what the
 * cleaning and repair jobs were billed, and for one finished month the
 * payroll reconciliation.
 * ------------------------------------------------------------------ */

const lastDay = (m: string): string => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** From / To and a month preset (Hookka's buildPeriodOptions), kept in the address. Shared with Department Labor. */
export function useRange(): { from: string; to: string; department: string; set: (patch: Record<string, string>) => void } {
  const [params, setParams] = useSearchParams();
  const today = todayMyt();
  const from = params.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = params.get('to') ?? today;
  const set = (patch: Record<string, string>) => setParams(p => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    return n;
  }, { replace: true });
  return { from, to, department: params.get('department') ?? '', set };
}

export function RangeControls({ from, to, set, extra }: { from: string; to: string; set: (patch: Record<string, string>) => void; extra?: ReactNode }) {
  const now = todayMyt().slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(now, -i));
  const preset = from.endsWith('-01') && (to === lastDay(from.slice(0, 7)) || (from.slice(0, 7) === now && to === todayMyt())) ? from.slice(0, 7) : '';
  return (
    <span className="flex items-end gap-2 flex-wrap">
      <Select label="Month" showLabel size="md" className="w-[180px]" value={preset} placeholder="Custom range"
        onChange={m => set({ from: `${m}-01`, to: m === now ? todayMyt() : lastDay(m) })} options={months.map(m => ({ value: m, label: monthName(m) }))} />
      <div className="w-[170px] flex-none"><DateField label="From" value={from} max={to} onChange={v => v && set({ from: v })} /></div>
      <div className="w-[170px] flex-none"><DateField label="To" value={to} min={from} onChange={v => v && set({ to: v })} /></div>
      {extra}
      <Button size="sm" variant="tertiary" icon={<Icon name="Printer" size="sm" />} onClick={() => window.print()}>Print</Button>
    </span>
  );
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-card rounded-card border border-solid border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center justify-between bg-transparent border-0 cursor-pointer text-left [font-family:inherit]">
        <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size="sm" />
      </button>
      {open && <div className="px-5 pb-5 overflow-x-auto">{children}</div>}
    </section>
  );
}

const pct = (cost: number, billed: number | null): string => (billed ? `${((cost / billed) * 100).toFixed(1)}%` : '—');

export default function LaborCostTab() {
  const { from, to, department, set } = useRange();
  const { data, loading, error, reload } = useApi<LaborCostPayload>(`/labor-cost?from=${from}&to=${to}${department ? `&department=${department}` : ''}`);
  const cost = (d: string) => data?.departments.find(x => x.department === d)?.costSen ?? 0;
  const total = (data?.departments ?? []).reduce((n, d) => n + d.costSen, 0);
  const revenue = data?.showRevenue ? (data.revenue ?? []).reduce((n, r) => n + r.billedSen, 0) : null;
  const jobCount = data?.revenue?.length ?? 0;
  const th = 'py-2 px-3 font-medium text-left';
  const td = 'py-2 px-3 [border-top:1px_solid_var(--color-line-soft)]';

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}
      <section className="bg-card rounded-card border border-solid border-line px-5 py-4 flex flex-col gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Labor Cost vs Earnings</span>
          <span className="text-meta text-muted-ink">Cost of the hours on Working Hours (the punch where nothing is saved), against what the jobs finished in the range were billed.</span>
        </span>
        <RangeControls from={from} to={to} set={set} extra={
          <Select label="Department" showLabel size="md" className="w-[180px]" value={department} placeholder="All departments"
            onChange={v => set({ department: v })} options={[{ value: '', label: 'All departments' }, { value: 'cleaning', label: 'Cleaning' }, { value: 'maintenance', label: 'Maintenance' }]} />
        } />
      </section>

      <StatRow cols={3}>
        <StatTile label="Cleaning Labor Cost" value={data ? rm(cost('cleaning')) : undefined} loading={loading && !data} />
        <StatTile label="Maintenance Labor Cost" value={data ? rm(cost('maintenance')) : undefined} loading={loading && !data} />
        <StatTile label="Total Labor Cost" value={data ? rm(total) : undefined} loading={loading && !data} />
        <StatTile label="Labor Cost incl. EPF & Allowances" value={data?.reconciliation ? rm(data.reconciliation.payrollSen) : data ? '—' : undefined}
          hint={data && !data.reconciliation ? 'For one finished month once payroll is run' : undefined} loading={loading && !data} />
        {data?.showRevenue && <StatTile label="Total Earnings" value={rm(revenue ?? 0)} />}
        {data?.showRevenue && <StatTile label="Remain" value={rm((revenue ?? 0) - total)} tone={(revenue ?? 0) - total < 0 ? 'critical' : undefined} hint="Earnings less labour cost" />}
      </StatRow>

      {data?.reconciliation && data.closedMonth && (
        <section className="bg-card rounded-card border border-solid border-line px-5 py-4 flex flex-col gap-2">
          <span className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Payroll Reconciliation ({monthName(data.closedMonth)})</span>
            <StatusBadge tone="success" label="Reconciled · 0 difference" size="sm" />
          </span>
          {[
            ['Logged labour (hours on Working Hours)', data.reconciliation.loggedSen],
            ['Paid beyond the logged hours (leave, paid days off, allowances, employer EPF, SOCSO, EIS)', data.reconciliation.underRecordedSen],
          ].map(([k, v]) => <span key={String(k)} className="flex justify-between gap-3 text-copy py-1"><span className="text-muted-ink">{k}</span><span className="tabular-nums">{rm(Number(v))}</span></span>)}
          <span className="flex justify-between gap-3 text-copy font-semibold py-1 [border-top:1px_solid_var(--color-line-soft)]">
            <span>Total Payroll Cost ({data.reconciliation.payslips} payslips)</span><span className="tabular-nums">{rm(data.reconciliation.payrollSen)}</span>
          </span>
        </section>
      )}

      {data && data.docked.length > 0 && (
        <section className="bg-card rounded-card border border-solid border-line px-5 py-4 flex flex-col gap-2">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Docked this month: unworked hours removed from pay</span>
          <table className="w-full border-collapse text-copy">
            <thead><tr className="text-meta text-muted-ink"><th className={th}>Employee</th><th className={th}>Hours docked</th><th className={th}>Amount</th></tr></thead>
            <tbody>{data.docked.map(d => <tr key={d.name}><td className={td}>{d.name}</td><td className={`${td} tabular-nums`}>{d.hours}</td><td className={`${td} tabular-nums`}>{rm(d.sen)}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <Collapsible title="Department Breakdown">
        <table className="w-full border-collapse text-copy">
          <thead><tr className="text-meta text-muted-ink">
            <th className={th}>Department</th><th className={th}>Hours</th><th className={th}>Labor Cost</th>
            {data?.showRevenue && <><th className={th}>Earnings</th><th className={th}>Cost / Earnings</th></>}
          </tr></thead>
          <tbody>{(data?.departments ?? []).map(d => (
            <tr key={d.department}>
              <td className={td}>{DEPARTMENT_LABEL[d.department]}</td><td className={`${td} tabular-nums`}>{d.hours}</td><td className={`${td} tabular-nums`}>{rm(d.costSen)}</td>
              {data?.showRevenue && <><td className={`${td} tabular-nums`}>{rm(d.revenueSen ?? 0)}</td><td className={`${td} tabular-nums`}>{pct(d.costSen, d.revenueSen)}</td></>}
            </tr>
          ))}</tbody>
        </table>
      </Collapsible>

      {data?.showRevenue && (
        <Collapsible title={`Earnings Raw Data (${jobCount} jobs)`}>
          <table className="w-full border-collapse text-copy">
            <thead><tr className="text-meta text-muted-ink"><th className={th}>Date</th><th className={th}>Job</th><th className={th}>Type</th><th className={th}>Billed</th></tr></thead>
            <tbody>{(data.revenue ?? []).map((r, i) => (
              <tr key={i}><td className={`${td} whitespace-nowrap`}>{date(`${r.date}T12:00:00+08:00`)}</td><td className={td}>{r.ref}</td><td className={td}>{r.kind === 'cleaning' ? 'Cleaning' : 'Repair'}</td><td className={`${td} tabular-nums`}>{rm(r.billedSen)}</td></tr>
            ))}</tbody>
          </table>
        </Collapsible>
      )}
    </div>
  );
}
