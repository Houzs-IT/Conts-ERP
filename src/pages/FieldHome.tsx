import { lazy, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Segmented, mytDay } from '../components/ops/OpsUi';
import { usePortalText } from '../lib/portalI18n';

const FieldTodayPage = lazy(() => import('./FieldTodayPage'));
const FieldRepairsPage = lazy(() => import('./FieldRepairsPage'));

/** The field app's home. A technician lands on repairs, a cleaner on today's cleans; the other list shows as a switch
 *  only when it has something for them (the office can give a repair to a cleaner, or a clean to a technician).
 *  ?task=<id> or ?repair=<id> (from the bell) opens that job on the right list. */
export default function FieldHome() {
  const { user } = useSession();
  const tech = user!.role === 'technician';
  const [view, setView] = useState<'cleaning' | 'repairs'>(tech ? 'repairs' : 'cleaning');
  const [params, setParams] = useSearchParams();
  const linkTask = params.get('task');
  const linkRepair = params.get('repair');
  useEffect(() => { if (linkTask) setView('cleaning'); else if (linkRepair) setView('repairs'); }, [linkTask, linkRepair]);
  const linked = () => setParams(p => { const n = new URLSearchParams(p); n.delete('task'); n.delete('repair'); return n; }, { replace: true });
  const cleans = useApi<{ rows: unknown[] }>(tech ? `/field/tasks?date=${mytDay(0)}` : null);
  const repairs = useApi<{ mine: { state: string }[] }>(tech ? null : '/field/repairs');
  const other = tech ? (cleans.data?.rows.length ?? 0) : (repairs.data?.mine.filter(r => r.state !== 'resolved').length ?? 0);
  const both = other > 0;
  const t = usePortalText();
  const toggle = both ? (
    <Segmented label={t.home.show} value={view} onChange={setView} className="self-start [&>button]:h-11" options={[
      { value: 'cleaning', label: <>{t.home.cleaning}{tech && <span className="text-muted-ink tabular-nums"> {other}</span>}</> },
      { value: 'repairs', label: <>{t.home.repairs}{!tech && <span className="text-muted-ink tabular-nums"> {other}</span>}</> },
    ]} />
  ) : null;
  return view === 'repairs'
    ? <FieldRepairsPage above={toggle} linkRepair={linkRepair} onLinked={linked} />
    : <>{toggle}<FieldTodayPage linkTask={linkTask} onLinked={linked} /></>;
}
