import { useSearchParams } from 'react-router-dom';
import { StaleBanner } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import type { DcAttendanceLine } from '../../../functions/api/attendance/dream-crafter';
import { DayAttendance, type PunchTimes } from './attendanceParts';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Attendance: everyone on Dream
 * Crafter's own staff on the day, with the punches they made on the
 * phone's Clock screen (selfie and location), the forgotten clock-outs,
 * and the day the office keys for someone who forgot. The same table as
 * The Conts' (attendanceParts.tsx). Dream Crafter has no punch sites or
 * leave yet, so a punch reads "Location kept" and nobody reads as on leave.
 * ------------------------------------------------------------------ */

interface DayPayload { date: string; today: string; buildingsWithLocation: number; data: DcAttendanceLine[] }

const rowKey = (l: DcAttendanceLine): string => l.employee.dcStaffId;
const photoPath = (punchId: string, side: 'in' | 'out'): string => `/api/attendance/dream-crafter/${punchId}/photo/${side}`;

export default function DcAttendanceTab() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('day');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const { data, loading, error, reload } = useApi<DayPayload>(`/attendance/dream-crafter${day ? `?date=${day}` : ''}`);
  const { user } = useSession();
  const mayFix = mayWork(user, 'dcHr');

  const shown = data?.date ?? day ?? '';
  const setDay = (d: string) => setParams(p => { const n = new URLSearchParams(p); n.set('day', d); return n; }, { replace: true });

  const saveTimes = async (line: DcAttendanceLine, dayKeyed: string, times: PunchTimes): Promise<void> => {
    await api.post('/attendance/dream-crafter', { ...times, date: dayKeyed, dcStaffId: line.employee.dcStaffId });
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last day we have. ${error}`} onRetry={reload} />}

      <DayAttendance<DcAttendanceLine>
        tableId="dc-attendance" lines={data?.data ?? []} isLoading={loading} shown={shown} today={data?.today} onDayChange={setDay} onChanged={reload}
        rowKey={rowKey} mayFix={mayFix} photoPath={photoPath} onSave={saveTimes} noSiteLabel="Location kept"
        intro="Everyone active and switched on, punched or not. A phone punch keeps where they were; Dream Crafter sites are not set up yet."
        locationNote=""
        empty={{ title: 'Nobody to list.', body: 'Attendance lists the Dream Crafter staff on Employee Master who are active and switched on. People clock in and out on their phone, with a selfie and their location.' }}
      />
    </div>
  );
}
