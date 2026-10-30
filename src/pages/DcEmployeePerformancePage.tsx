import { useMemo } from 'react';
import PageHeader from '../components/PageHeader';
import { StatTile, StatRow } from '../components/Metric';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import type { DcEmployee } from '../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employee Performance: the Dream Crafter version of
 * The Conts' Employee Performance (HR > Employees). Its one job card is
 * the renovation project. Each active Dream Crafter employee is listed;
 * no project is linked to a person yet, so there are no counts to show.
 * ------------------------------------------------------------------ */

// shortcut: standard minutes are 0 until the office decides how long a project takes; move to a setting once they do.
const JOB_CARDS = [{ kind: 'renovation_project', label: 'Renovation project', minutes: 0 }] as const;
const NOT_YET = <span className="text-muted-ink">—</span>;

export default function DcEmployeePerformancePage() {
  const { data, loading, error, reload } = useApi<{ data: DcEmployee[] }>('/employees/dream-crafter');
  const people = (data?.data ?? []).filter(e => e.status === 'active');

  const columns = useMemo<Column<DcEmployee>[]>(() => [
    { key: 'name', label: 'Employee', value: e => e.name, hideable: false, width: 220, render: e => <span className="font-semibold">{e.name}</span> },
    { key: 'jobTitle', label: 'Job title', value: e => e.jobTitle, width: 180 },
    { key: 'projects', label: 'Renovation projects', value: () => null, render: () => NOT_YET, sortable: false, filter: false, width: 170 },
    { key: 'minutes', label: 'Production minutes', value: () => null, render: () => NOT_YET, sortable: false, filter: false, width: 170 },
    { key: 'efficiency', label: 'Efficiency', value: () => null, render: () => NOT_YET, sortable: false, filter: false, width: 120 },
  ], []);

  return (
    <>
      <PageHeader title="Employee Performance" sub="Renovation projects each Dream Crafter employee finishes, per month" />
      <StatRow cols={2}>
        {JOB_CARDS.map(c => <StatTile key={c.kind} label={c.label} value="—" hint={`Standard time ${c.minutes} min per job`} />)}
        <StatTile label="Efficiency" value="—" hint="Not worked out while the standard minutes are 0" />
      </StatRow>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <div className="mt-5">
        <DataTable<DcEmployee>
          id="dc-employee-performance" columns={columns} rows={loading && people.length === 0 ? null : people}
          rowKey={e => e.id} pageSize={0} noun={['employee', 'employees']}
          empty={{ title: 'No Dream Crafter employees yet.', body: 'Add Dream Crafter staff on HR > Employees and they show here.', icon: 'Users' }}
        />
        <p className="m-0 mt-3 text-meta text-muted-ink">
          Renovation projects are not linked to a person yet, and the standard time is 0 min a project until the office decides it, so counts and efficiency are not worked out.
        </p>
      </div>
    </>
  );
}
