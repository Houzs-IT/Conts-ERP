import { StatTile, StatRow } from '../../components/Metric';
import { EmptyState } from '../../components/States';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Employee Performance: the Dream Crafter
 * version of The Conts' Employee Performance tab. Its one job card is the
 * renovation project. Dream Crafter has no employees in HR yet, so the tab
 * stays empty: no counts until there are people to count.
 * ------------------------------------------------------------------ */

// shortcut: standard minutes are 0 until the office decides how long a project takes; move to a setting once they do.
const JOB_CARDS = [{ kind: 'renovation_project', label: 'Renovation project', minutes: 0 }] as const;

export default function DcEmployeePerformanceTab() {
  return (
    <div className="flex flex-col gap-5">
      <StatRow cols={2}>
        {JOB_CARDS.map(c => <StatTile key={c.kind} label={c.label} value="—" hint={`Standard time ${c.minutes} min per job`} />)}
        <StatTile label="Efficiency" value="—" hint="Not worked out while the standard minutes are 0" />
      </StatRow>
      <EmptyState icon="Users" title="No Dream Crafter employees yet"
        body="Once Dream Crafter staff are added to HR, each person's finished renovation projects show here per month. The standard time is 0 min a project until the office decides it, so efficiency is not worked out yet." />
    </div>
  );
}
