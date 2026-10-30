import { StaleBanner } from '../../components/DataState';
import { StatTile, StatRow } from '../../components/Metric';
import { useApi } from '../../lib/useApi';
import type { CleanerJobsPayload, JobCard } from '../../../functions/_lib/cleanerJobs';
import { useRange, RangeControls } from './LaborCostTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Employee Performance: Hookka's job cards, as the two
 * cleaning jobs (Basic clean, Deep clean). How many each in-house cleaner
 * finished in the range; a job with two cleaners counts for both. The
 * standard minutes per job are 0 until the office decides them, so
 * production minutes are 0 and efficiency is not worked out yet.
 * ------------------------------------------------------------------ */

export default function EmployeePerformanceTab() {
  const { from, to, set } = useRange();
  const { data, loading, error, reload } = useApi<CleanerJobsPayload>(`/employees/performance?from=${from}&to=${to}`);
  // The two tiles keep their place while loading.
  const cards: JobCard[] = data?.cards ?? [{ kind: 'turnover', label: 'Basic clean', minutes: 0, done: 0 }, { kind: 'deep_clean', label: 'Deep clean', minutes: 0, done: 0 }];
  const people = data?.people ?? [];
  const th = 'py-2.5 px-4 font-medium text-left';
  const thNum = 'py-2.5 px-4 font-medium text-right';
  const td = 'py-2.5 px-4 [border-top:1px_solid_var(--color-line-soft)] tabular-nums text-right';

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}
      <section className="bg-card rounded-card border border-solid border-line px-5 py-4 flex flex-col gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Employee Performance</span>
          <span className="text-meta text-muted-ink">Basic and Deep clean jobs each cleaner finished, by the day the job was done. A job with two cleaners counts for both.</span>
        </span>
        <RangeControls from={from} to={to} set={set} />
      </section>

      <StatRow cols={2}>
        {cards.map(c => (
          <StatTile key={c.kind} label={c.label} value={data ? `${c.done} ${c.done === 1 ? 'job' : 'jobs'}` : undefined}
            hint={`Standard time ${c.minutes} min per job`} loading={loading && !data} />
        ))}
      </StatRow>

      <section className="bg-card rounded-card border border-solid border-line overflow-x-auto">
        <table className="w-full border-collapse text-copy">
          <thead><tr className="text-meta text-muted-ink">
            <th className={th}>Cleaner</th><th className={thNum}>Basic clean</th><th className={thNum}>Deep clean</th>
            <th className={thNum}>Total jobs</th><th className={thNum}>Production minutes</th><th className={thNum}>Efficiency</th>
          </tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={6} className="py-6 px-4 text-muted-ink">Loading…</td></tr>}
            {data && people.length === 0 && <tr><td colSpan={6} className="py-6 px-4 text-muted-ink">No in-house cleaners yet. Add them on Employee Master.</td></tr>}
            {people.map(p => (
              <tr key={p.cleanerId}>
                <td className="py-2.5 px-4 [border-top:1px_solid_var(--color-line-soft)] font-semibold">{p.name}</td>
                <td className={td}>{p.basic}</td><td className={td}>{p.deep}</td><td className={td}>{p.basic + p.deep}</td>
                <td className={td}>{p.productionMinutes}</td>
                <td className={`${td} text-muted-ink`} title="Not worked out while the standard minutes are 0">—</td>
              </tr>
            ))}
            {people.length > 0 && (
              <tr className="font-semibold bg-page">
                <td className="py-2.5 px-4 [border-top:1px_solid_var(--color-line)]">TOTAL</td>
                <td className={td}>{people.reduce((n, p) => n + p.basic, 0)}</td>
                <td className={td}>{people.reduce((n, p) => n + p.deep, 0)}</td>
                <td className={td}>{people.reduce((n, p) => n + p.basic + p.deep, 0)}</td>
                <td className={td}>{people.reduce((n, p) => n + p.productionMinutes, 0)}</td>
                <td className={`${td} text-muted-ink`}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <span className="text-meta text-muted-ink">Efficiency is production minutes against clocked hours. It is not worked out yet: the standard minutes per job are 0 until the office decides them.</span>
    </div>
  );
}
