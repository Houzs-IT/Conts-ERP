import { lazy, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatTile, StatRow } from '../components/Metric';
import { EmptyState } from '../components/States';
import { TabBar, tabId, panelId } from '../components/TabBar';
import { Button } from '../components/Button';
import { useApi } from '../lib/useApi';
import type { AttendanceLine } from '../../functions/api/attendance/index';

const WorkingHoursTab = lazy(() => import('./workers/WorkingHoursTab'));
const AttendanceTab = lazy(() => import('./workers/AttendanceTab'));
const PayrollTab = lazy(() => import('./workers/PayrollTab'));
const AdvancesTab = lazy(() => import('./workers/AdvancesTab'));
const EmployeesTab = lazy(() => import('./workers/EmployeesTab'));
const OutsideTab = lazy(() => import('./workers/OutsideTab'));
const LeaveTab = lazy(() => import('./workers/LeaveTab'));
const PenaltiesTab = lazy(() => import('./workers/PenaltiesTab'));
const LaborCostTab = lazy(() => import('./workers/LaborCostTab'));
const DepartmentLaborTab = lazy(() => import('./workers/DepartmentLaborTab'));
const EmployeePerformanceTab = lazy(() => import('./workers/EmployeePerformanceTab'));

/* ------------------------------------------------------------------ *
 * HR > Employees: Hookka's Employees page (erp.hookka.com /employees),
 * its eleven tabs in its order with its labels and icons (owner, 26 Oct
 * 2026: follow Hookka's tabs), plus Outside Companies: the cleaning and
 * repair companies, which have no HR record (Operations > Workers is gone).
 * Leave is off the bar, as on Hookka ("hidden until rollout"), and still
 * opens from its notices at ?tab=leave.
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
  { key: 'outside', label: 'Outside Companies', icon: 'Building2' },
] as const;
type TabKey = (typeof TABS)[number]['key'] | 'leave';
const isTab = (v: string | null): v is TabKey => v === 'leave' || TABS.some(t => t.key === v);

/** Twelve tabs do not fit in one row, so the bar shows three sections and the second row shows the pages in the
 *  chosen section (owner, 27 Oct 2026). Hookka's order is kept inside each section. */
const SECTIONS = [
  { key: 'hours', label: 'Hours', tabs: ['working-hours', 'attendance', 'efficiency', 'detail', 'department-performance'] },
  { key: 'staff', label: 'Staff', tabs: ['employee-master', 'outside'] },
  { key: 'pay', label: 'Pay', tabs: ['payroll', 'advances', 'penalties', 'labor-cost', 'department-labor'] },
] as const satisfies readonly { key: string; label: string; tabs: readonly TabKey[] }[];
/** Leave is off the bar but belongs with Staff, so its notices still show the right section. */
const sectionOf = (t: TabKey): (typeof SECTIONS)[number] =>
  SECTIONS.find(s => (s.tabs as readonly TabKey[]).includes(t)) ?? SECTIONS[1];
const tabsIn = (section: (typeof SECTIONS)[number]): typeof TABS[number][] =>
  section.tabs.flatMap(k => TABS.filter(t => t.key === k));

/** Tabs Hookka measures from factory job cards. The Conts has not decided what production time is for cleaning and
 *  repair jobs (owner, 26 Oct 2026), so they stay empty rather than show a made-up figure. Employee Performance
 *  already counts each cleaner's Basic and Deep cleans, at 0 minutes a job until the times are decided. */
const UNDECIDED: Partial<Record<TabKey, string>> = {
  efficiency: 'Each person\'s production time against the hours they clocked.',
  'department-performance': 'Each department\'s production hours and efficiency, day by day.',
};

export default function EmployeesPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: TabKey = isTab(asked) ? asked : 'working-hours';
  const setTab = (t: TabKey) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('month'); n.delete('day'); n.delete('year'); return n; }, { replace: true });
  const section = sectionOf(tab);
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
  else if (tab === 'outside') body = <OutsideTab />;
  else if (tab === 'leave') body = <LeaveTab />;
  else if (tab === 'penalties') body = <PenaltiesTab />;
  else if (tab === 'labor-cost') body = <LaborCostTab />;
  else if (tab === 'department-labor') body = <DepartmentLaborTab />;
  else if (tab === 'detail') body = <EmployeePerformanceTab />;
  else {
    body = <EmptyState icon="Activity" title="Production time is not decided yet"
      body={`${UNDECIDED[tab] ?? ''} On Hookka this comes from factory job cards. It stays empty until The Conts decides what counts as production time for cleaning and repair jobs.`} />;
  }

  return (
    <>
      <PageHeader title="Employees & Attendance" sub="Worker attendance, production hours, and efficiency tracking" />
      {/* The two lists are for finding a person on a phone: today's attendance figures would push them off the screen. */}
      <div className={tab === 'employee-master' || tab === 'outside' ? 'hidden md:block' : undefined}>
        <StatRow cols={4}>
          <StatTile label="Total Workers" value={today.data ? String(lines.length) : undefined} loading={today.loading && !today.data} />
          <StatTile label="Present" value={today.data ? String(present) : undefined} hint="Clocked in today" loading={today.loading && !today.data} />
          <StatTile label="Working Hours" value={today.data ? `${(minutes / 60).toFixed(1)} h` : undefined} hint="Today so far" loading={today.loading && !today.data} />
          <StatTile label="Avg Efficiency" value="—" hint="Production time not decided" />
        </StatRow>
      </div>

      <div role="group" aria-label="Section" className="mt-5 mb-3 flex gap-2">
        {SECTIONS.map(s => (
          <Button key={s.key} size="sm" variant={s.key === section.key ? 'primary' : 'secondary'} aria-pressed={s.key === section.key}
            onClick={() => setTab(s.tabs[0])}>{s.label}</Button>
        ))}
      </div>
      <div className="mb-5 -mx-4 md:mx-0"><TabBar id="employees" label={`${section.label} pages`} tabs={tabsIn(section)} value={tab} onChange={setTab} /></div>

      <div role="tabpanel" id={panelId('employees')} aria-labelledby={tab === 'leave' ? undefined : tabId('employees', tab)}>
        <Suspense fallback={null}>{body}</Suspense>
      </div>
    </>
  );
}
