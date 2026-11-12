import { useMemo } from 'react';
import { StaleBanner } from '../../components/DataState';
import { StatTile, StatRow } from '../../components/Metric';
import { DataTable, type Column } from '../../components/DataTable';
import { useApi } from '../../lib/useApi';
import type { EmployeePerformancePayload } from '../../../functions/api/employees/performance';
import type { CleanerJobs } from '../../../functions/_lib/cleanerJobs';
import type { TechnicianJobs, RepairJob } from '../../../functions/_lib/technicianJobs';
import type { JobTotals } from '../../../functions/_lib/jobEfficiency';
import { useRange, RangeControls } from './LaborCostTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Employee Performance: Hookka's job cards. Each repair
 * an in-house technician finished, and each Basic and Deep clean an
 * in-house cleaner finished, against the card's standard minutes (HR >
 * Employees > Standard Times). The time taken is Start to Done on the job,
 * so the office sees who finishes early or late.
 * ------------------------------------------------------------------ */

const NONE = <span className="text-muted-ink">—</span>;

function earlyOrLate(minutesOverCard: number | null): string | null {
  if (minutesOverCard === null) return null;
  if (minutesOverCard === 0) return 'On time';
  return minutesOverCard < 0 ? `${-minutesOverCard} min early` : `${minutesOverCard} min late`;
}

function EarlyOrLate({ minutesOverCard }: { minutesOverCard: number | null }) {
  const label = earlyOrLate(minutesOverCard);
  if (!label) return NONE;
  const tone = minutesOverCard !== null && minutesOverCard > 0 ? 'text-critical' : 'text-success';
  return <span className={`font-medium ${tone}`}>{label}</span>;
}

function totalsColumns<R extends JobTotals>(): Column<R>[] {
  return [
    { key: 'jobs', label: 'Jobs', type: 'number', value: row => row.jobs, width: 90 },
    { key: 'cardMinutes', label: 'Card minutes', type: 'number', value: row => row.cardMinutes, width: 130, title: 'Jobs done times each card\'s standard minutes' },
    { key: 'actualMinutes', label: 'Actual minutes', type: 'number', value: row => row.actualMinutes, width: 130, title: 'Start to Done on the jobs that have both',
      sub: row => (row.untimedJobs ? `${row.untimedJobs} without times` : null) },
    { key: 'earlyLate', label: 'Early / late', value: row => row.minutesOverCard, width: 130, align: 'right', phone: 'right',
      render: row => <EarlyOrLate minutesOverCard={row.minutesOverCard} /> },
    { key: 'efficiency', label: 'Efficiency', type: 'number', value: row => row.efficiencyPercent, width: 110, phone: 'badge',
      title: 'Card minutes against actual minutes, on timed jobs whose card is set',
      render: row => (row.efficiencyPercent === null ? NONE : `${row.efficiencyPercent}%`) },
  ];
}

const sumOf = (rows: JobTotals[], pick: (row: JobTotals) => number): number => rows.reduce((sum, row) => sum + pick(row), 0);

function TotalsLine({ rows }: { rows: JobTotals[] }) {
  if (!rows.length) return null;
  return (
    <p className="m-0 px-4 py-3 text-meta text-muted-ink tabular-nums [border-top:1px_solid_var(--color-line-soft)]">
      Total {sumOf(rows, row => row.jobs)} jobs · {sumOf(rows, row => row.cardMinutes)} card min · {sumOf(rows, row => row.actualMinutes)} actual min
    </p>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <span className="flex flex-col gap-0.5 pt-2">
      <span className="text-heading font-bold tracking-[-0.005em]">{title}</span>
      <span className="text-meta text-muted-ink">{note}</span>
    </span>
  );
}

const minutesHint = (minutes: number): string => (minutes > 0 ? `Standard time ${minutes} min per job` : 'Standard time not set');

export default function EmployeePerformanceTab() {
  const { from, to, set } = useRange();
  const { data, loading, error, reload } = useApi<EmployeePerformancePayload>(`/employees/performance?from=${from}&to=${to}`);
  const isFirstLoad = loading && !data;

  const technicianColumns = useMemo<Column<TechnicianJobs>[]>(() => [
    { key: 'name', label: 'Technician', value: row => row.name, hideable: false, width: 200, phone: 'title', render: row => <span className="font-semibold">{row.name}</span> },
    ...totalsColumns<TechnicianJobs>(),
  ], []);
  const repairJobColumns = useMemo<Column<RepairJob>[]>(() => [
    { key: 'day', label: 'Done', type: 'date', value: row => row.day, width: 110 },
    { key: 'job', label: 'Job', value: row => `${row.unit} ${row.title}`, hideable: false, width: 240, phone: 'title',
      render: row => <span className="font-semibold">{[row.unit, row.title].filter(Boolean).join(' · ')}</span> },
    { key: 'technician', label: 'Technician', value: row => row.technician, width: 160 },
    { key: 'category', label: 'Card', value: row => data?.repairs.cards.find(card => card.category === row.category)?.label ?? row.category, width: 120 },
    { key: 'cardMinutes', label: 'Card minutes', type: 'number', value: row => row.cardMinutes, width: 120,
      render: row => (row.cardMinutes > 0 ? row.cardMinutes : NONE) },
    { key: 'actualMinutes', label: 'Actual minutes', type: 'number', value: row => row.actualMinutes, width: 130,
      render: row => (row.actualMinutes === null ? <span className="text-muted-ink">No start or finish</span> : row.actualMinutes) },
    { key: 'earlyLate', label: 'Early / late', width: 130, align: 'right', phone: 'right',
      value: row => (row.cardMinutes > 0 && row.actualMinutes !== null ? row.actualMinutes - row.cardMinutes : null),
      render: row => <EarlyOrLate minutesOverCard={row.cardMinutes > 0 && row.actualMinutes !== null ? row.actualMinutes - row.cardMinutes : null} /> },
  ], [data?.repairs.cards]);
  const cleanerColumns = useMemo<Column<CleanerJobs>[]>(() => [
    { key: 'name', label: 'Cleaner', value: row => row.name, hideable: false, width: 200, phone: 'title', render: row => <span className="font-semibold">{row.name}</span> },
    { key: 'basic', label: 'Basic clean', type: 'number', value: row => row.basic, width: 110 },
    { key: 'deep', label: 'Deep clean', type: 'number', value: row => row.deep, width: 110 },
    ...totalsColumns<CleanerJobs>(),
  ], []);

  const repairs = data?.repairs;
  const technicians = repairs?.people ?? [];
  const cleaners = data?.people ?? [];

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}
      <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] px-5 py-4 flex flex-col gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-heading font-bold tracking-[-0.005em]">Employee Performance</span>
          <span className="text-meta text-muted-ink">Repairs and cleaning jobs each in-house person finished, by the day the job was done, against the Standard Times cards. A job with two people counts for both.</span>
        </span>
        <RangeControls from={from} to={to} set={set} />
      </section>

      <SectionHeading title="Maintenance" note="Each repair against its category's standard time, from Start to Done." />
      {repairs && !repairs.ready ? (
        <p className="m-0 text-meta text-muted-ink">Repairs show here once the technician list (migration 0144) is on this database.</p>
      ) : (
        <>
          <StatRow cols={3}>
            {(repairs?.cards ?? []).map(card => (
              <StatTile key={card.category} label={card.label} value={`${card.done} ${card.done === 1 ? 'job' : 'jobs'}`} hint={minutesHint(card.minutes)} />
            ))}
            {isFirstLoad && <StatTile label="Repairs" value={undefined} loading />}
          </StatRow>
          <DataTable<TechnicianJobs>
            id="employee-performance-technicians" columns={technicianColumns} rows={isFirstLoad ? null : technicians}
            rowKey={row => row.technicianId} pageSize={0} noun={['technician', 'technicians']} noViews
            empty={{ title: 'No in-house technicians yet.', body: 'Add them on Staff > Employee Master.', icon: 'Wrench' }}
            footer={<TotalsLine rows={technicians} />}
          />
          <DataTable<RepairJob>
            id="employee-performance-repairs" columns={repairJobColumns} rows={isFirstLoad ? null : repairs?.jobs ?? []}
            rowKey={row => `${row.id}-${row.technicianId}`} pageSize={25} noun={['repair', 'repairs']} noViews
            empty={{ title: 'No repairs finished in this range.', body: 'Pick another month or range.', icon: 'Wrench' }}
          />
        </>
      )}

      <SectionHeading title="Cleaning" note="Basic and Deep clean jobs against their standard times, from Start to Done." />
      <StatRow cols={2}>
        {(data?.cards ?? []).map(card => (
          <StatTile key={card.kind} label={card.label} value={`${card.done} ${card.done === 1 ? 'job' : 'jobs'}`} hint={minutesHint(card.minutes)} />
        ))}
        {isFirstLoad && <StatTile label="Cleaning jobs" value={undefined} loading />}
      </StatRow>
      <DataTable<CleanerJobs>
        id="employee-performance-cleaners" columns={cleanerColumns} rows={isFirstLoad ? null : cleaners}
        rowKey={row => row.cleanerId} pageSize={0} noun={['cleaner', 'cleaners']} noViews
        empty={{ title: 'No in-house cleaners yet.', body: 'Add them on Staff > Employee Master.', icon: 'Users' }}
        footer={<TotalsLine rows={cleaners} />}
      />
      <span className="text-meta text-muted-ink">
        Efficiency is the card minutes against the actual minutes, counted only on jobs that have a Start and a Done and whose card is set. Over 100% means faster than the card. Set the cards on Standard Times.
      </span>
    </div>
  );
}
