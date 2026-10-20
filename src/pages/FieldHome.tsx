import { lazy, useState } from 'react';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Segmented, mytDay } from '../components/ops/OpsUi';

const FieldTodayPage = lazy(() => import('./FieldTodayPage'));
const FieldRepairsPage = lazy(() => import('./FieldRepairsPage'));

/** The field app's home. A technician lands on repairs, a cleaner on today's cleans; the other list shows as a switch
 *  only when it has something for them (the office can give a repair to a cleaner, or a clean to a technician). */
export default function FieldHome() {
  const { user } = useSession();
  const tech = user!.role === 'technician';
  const [view, setView] = useState<'cleaning' | 'repairs'>(tech ? 'repairs' : 'cleaning');
  const cleans = useApi<{ rows: unknown[] }>(tech ? `/field/tasks?date=${mytDay(0)}` : null);
  const repairs = useApi<{ mine: { state: string }[] }>(tech ? null : '/field/repairs');
  const other = tech ? (cleans.data?.rows.length ?? 0) : (repairs.data?.mine.filter(r => r.state !== 'resolved').length ?? 0);
  const both = other > 0;
  const toggle = both ? (
    <Segmented label="Show" value={view} onChange={setView} className="self-start [&>button]:h-11" options={[
      { value: 'cleaning', label: <>Cleaning{tech && <span className="text-muted-ink tabular-nums"> {other}</span>}</> },
      { value: 'repairs', label: <>Repairs{!tech && <span className="text-muted-ink tabular-nums"> {other}</span>}</> },
    ]} />
  ) : null;
  return view === 'repairs' ? <FieldRepairsPage above={toggle} /> : <>{toggle}<FieldTodayPage /></>;
}
