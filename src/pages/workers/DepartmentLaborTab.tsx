import { StaleBanner } from '../../components/DataState';
import { StatTile, StatRow } from '../../components/Metric';
import { useApi } from '../../lib/useApi';
import { rm } from '../../lib/format';
import type { LaborCostPayload } from '../../../functions/_lib/laborCost';
import { DEPARTMENT_LABEL } from '../../../functions/_lib/hrFields';
import { useRange, RangeControls } from './LaborCostTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Department Labor: Hookka's Department Labor. Hours,
 * people and labour cost per department (Cleaning, Maintenance); for one
 * finished month with payroll run, the cost with employer statutory and
 * the part of pay no logged hour accounts for. Hookka's Sofa / Bedframe /
 * Accessory columns and department QR poster are factory-only.
 * ------------------------------------------------------------------ */

export default function DepartmentLaborTab() {
  const { from, to, set } = useRange();
  const { data, loading, error, reload } = useApi<LaborCostPayload>(`/labor-cost?from=${from}&to=${to}`);
  const depts = data?.departments ?? [];
  const loaded = !!data?.reconciliation;
  const hours = depts.reduce((n, d) => n + d.hours, 0);
  const cost = depts.reduce((n, d) => n + d.costSen, 0);
  const under = depts.reduce((n, d) => n + (d.underRecordedSen ?? 0), 0);
  const th = 'py-2.5 px-4 font-medium text-left';
  const td = 'py-2.5 px-4 [border-top:1px_solid_var(--color-line-soft)] tabular-nums';

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}
      <section className="bg-card rounded-card border border-solid border-line px-5 py-4 flex flex-col gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Department Labor</span>
          <span className="text-meta text-muted-ink">Hours and labour cost per department from Working Hours. Pick one finished month to see it with employer statutory and the payroll gap.</span>
        </span>
        <RangeControls from={from} to={to} set={set} />
      </section>

      <StatRow cols={3}>
        <StatTile label="Departments with activity" value={data ? String(depts.filter(d => d.hours > 0).length) : undefined} loading={loading && !data} />
        <StatTile label="Total hours" value={data ? `${hours.toFixed(1)} h` : undefined} loading={loading && !data} />
        <StatTile label="Estimated labor cost" value={data ? rm(loaded ? cost + under : cost) : undefined} hint={loaded ? 'Incl. employer statutory and paid days off' : 'Logged hours only'} loading={loading && !data} />
      </StatRow>

      <section className="bg-card rounded-card border border-solid border-line overflow-x-auto">
        <table className="w-full border-collapse text-copy">
          <thead><tr className="text-meta text-muted-ink">
            <th className={th}>Department</th><th className={th}>Total Hours</th><th className={th}>Workers</th>
            <th className={th}>{loaded ? 'Logged labor' : 'Estimated Labor Cost'}</th>
            {loaded && <><th className={th}>Under-recorded</th><th className={th}>Labor (incl. EPF)</th></>}
          </tr></thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.department}>
                <td className="py-2.5 px-4 [border-top:1px_solid_var(--color-line-soft)] font-semibold">{DEPARTMENT_LABEL[d.department]}</td>
                <td className={td}>{d.hours}</td><td className={td}>{d.workers}</td><td className={td}>{rm(d.costSen)}</td>
                {loaded && <><td className={td}>{rm(d.underRecordedSen ?? 0)}</td><td className={`${td} font-semibold`}>{rm(d.costSen + (d.underRecordedSen ?? 0))}</td></>}
              </tr>
            ))}
            <tr className="font-semibold bg-page">
              <td className="py-2.5 px-4 [border-top:1px_solid_var(--color-line)]">TOTAL</td>
              <td className={td}>{hours.toFixed(2)}</td><td className={td}>{depts.reduce((n, d) => n + d.workers, 0)}</td>
              <td className={td}>{rm(cost)}</td>
              {loaded && <><td className={td}>{rm(under)}</td><td className={td}>{rm(cost + under)}</td></>}
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
