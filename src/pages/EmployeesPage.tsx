import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import { StatTile, StatRow } from '../components/Metric';
import { EmptyState } from '../components/States';
import { useApi } from '../lib/useApi';
import { cx } from '../lib/design-tokens';
import type { AttendanceLine } from '../../functions/api/attendance/index';

const WorkingHoursTab = lazy(() => import('./workers/WorkingHoursTab'));
const AttendanceTab = lazy(() => import('./workers/AttendanceTab'));
const PayrollTab = lazy(() => import('./workers/PayrollTab'));
const AdvancesTab = lazy(() => import('./workers/AdvancesTab'));
const EmployeesTab = lazy(() => import('./workers/EmployeesTab'));
const LeaveTab = lazy(() => import('./workers/LeaveTab'));
const PenaltiesTab = lazy(() => import('./workers/PenaltiesTab'));
const LaborCostTab = lazy(() => import('./workers/LaborCostTab'));
const DepartmentLaborTab = lazy(() => import('./workers/DepartmentLaborTab'));

/* ------------------------------------------------------------------ *
 * HR > Employees: Hookka's Employees page (erp.hookka.com /employees),
 * its eleven tabs in its order with its labels and icons (owner, 26 Oct
 * 2026: follow Hookka's tabs). The cleaner and technician lists stay on
 * Operations > Workers. Leave is off the bar, as on Hookka ("hidden until
 * rollout"), and still opens from its notices at ?tab=leave.
 * ------------------------------------------------------------------ */

const TABS = [
  { key: 'working-hours', label: 'Working Hours', icon: 'Clock' },
  { key: 'attendance', label: 'Attendance', icon: 'UserCheck' },
  { key: 'labor-cost', label: 'Labor Cost', icon: 'DollarSign' },
  { key: 'efficiency', label: 'Efficiency Overview', icon: 'Activity' },
  { key: 'department-labor', label: 'Department Labor', icon: 'DollarSign' },
  { key: 'detail', label: 'Employee Performance', icon: 'Search' },
  { key: 'department-performance', label: 'Department Performance', icon: 'Activity' },
  { key: 'payroll', label: 'Payroll', icon: 'DollarSign' },
  { key: 'advances', label: 'Advances', icon: 'Download' },
  { key: 'penalties', label: 'Worker Penalty', icon: 'TriangleAlert' },
  { key: 'employee-master', label: 'Employee Master', icon: 'Users' },
] as const;
type TabKey = (typeof TABS)[number]['key'] | 'leave';
const isTab = (v: string | null): v is TabKey => v === 'leave' || TABS.some(t => t.key === v);

/** Tabs Hookka measures from factory job cards. The Conts has not decided what production time is for cleaning and
 *  repair jobs (owner, 26 Oct 2026), so they stay empty rather than show a made-up figure. */
const UNDECIDED: Partial<Record<TabKey, string>> = {
  efficiency: 'Each person\'s production time against the hours they clocked.',
  detail: 'One person\'s production hours, jobs and efficiency over a period.',
  'department-performance': 'Each department\'s production hours and efficiency, day by day.',
};

export default function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: TabKey = isTab(asked) ? asked : 'working-hours';
  const setTab = (t: TabKey) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('month'); n.delete('day'); n.delete('year'); return n; }, { replace: true });
  const today = useApi<{ data: AttendanceLine[] }>('/attendance');
  const lines = today.data?.data ?? [];
  const present = lines.filter(l => l.punch).length;
  const minutes = lines.reduce((n, l) => n + (l.punch?.minutes ?? 0), 0);

  let body: ReactNode;
  if (tab === 'working-hours') body = <WorkingHoursTab />;
  else if (tab === 'attendance') body = <AttendanceTab />;
  else if (tab === 'payroll') body = <PayrollTab />;
  else if (tab === 'advances') body = <AdvancesTab />;
  else if (tab === 'employee-master') body = <EmployeesTab />;
  else if (tab === 'leave') body = <LeaveTab />;
  else if (tab === 'penalties') body = <PenaltiesTab />;
  else if (tab === 'labor-cost') body = <LaborCostTab />;
  else if (tab === 'department-labor') body = <DepartmentLaborTab />;
  else {
    body = <EmptyState icon="Activity" title="Production time is not decided yet"
      body={`${UNDECIDED[tab] ?? ''} On Hookka this comes from factory job cards. It stays empty until The Conts decides what counts as production time for cleaning and repair jobs.`} />;
  }

  return (
    <>
      <PageHeader title="Employees & Attendance" sub="Worker attendance, production hours, and efficiency tracking" />
      <StatRow cols={4}>
        <StatTile label="Total Workers" value={today.data ? String(lines.length) : undefined} loading={today.loading && !today.data} />
        <StatTile label="Present" value={today.data ? String(present) : undefined} hint="Clocked in today" loading={today.loading && !today.data} />
        <StatTile label="Working Hours" value={today.data ? `${(minutes / 60).toFixed(1)} h` : undefined} hint="Today so far" loading={today.loading && !today.data} />
        <StatTile label="Avg Efficiency" value="—" hint="Production time not decided" />
      </StatRow>

      {/* All eleven tabs stay in view on a desk screen: they wrap instead of scrolling sideways, and the icons only show
          where the row has room for them. A phone keeps the sideways swipe, where wrapping would stack five rows. */}
      <div role="tablist" aria-label="Employees" className="flex flex-none gap-1 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible my-5 [border-bottom:1px_solid_var(--color-line)]">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cx('flex-none inline-flex items-center gap-1.5 h-10 px-2.5 mb-1.5 rounded-control text-meta whitespace-nowrap cursor-pointer border border-solid',
              tab === t.key ? 'border-ink text-ink font-semibold bg-card' : 'border-transparent text-muted-ink hover:text-ink')}>
            <span className="hidden min-[1600px]:inline-flex"><Icon name={t.icon} size="sm" /></span>{t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={null}>{body}</Suspense>
    </>
  );
}
