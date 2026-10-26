import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { mayRun } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, todayMyt } from '../../lib/format';
import type { PayrollPayload } from '../../../functions/api/payroll/index';
import { Advances, AdvanceModal, monthName, shiftMonth } from './PayrollTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Advances: money paid out before payday, by month
 * (Hookka's Advances tab). The payslip of the same month takes it back.
 * ------------------------------------------------------------------ */

export default function AdvancesTab() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('month');
  const { data, error, reload } = useApi<PayrollPayload>(`/payroll${asked && /^\d{4}-\d{2}$/.test(asked) ? `?period=${asked}` : ''}`);
  const { user } = useSession();
  const full = mayRun(user, 'hr');
  const [adding, setAdding] = useState(false);
  const period = data?.period ?? todayMyt().slice(0, 7);
  const setMonth = (m: string) => setParams(p => { const n = new URLSearchParams(p); n.set('month', m); return n; }, { replace: true });
  const list = data?.advances ?? [];
  const total = list.reduce((n, a) => n + a.amountSen, 0);

  return (
    <>
      <p className="m-0 mb-4 text-copy text-muted-ink">
        {data ? `Advances ${monthName(period)} · ${rm(total)} to ${new Set(list.map(a => a.employeeId)).size} people · ${list.filter(a => a.status === 'settled').length} of ${list.length} taken back` : 'Loading advances…'}
      </p>
      {error && <StaleBanner message={`Showing the last advances we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <span className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Icon name="ChevronLeft" size="sm" />} onClick={() => setMonth(shiftMonth(period, -1))}>Previous</Button>
          <span className="text-copy font-semibold px-2">{monthName(period)}</span>
          <Button size="sm" variant="secondary" disabled={!data || period >= data.today.slice(0, 7)} onClick={() => setMonth(shiftMonth(period, 1))}>Next</Button>
        </span>
        {full && data && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add advance</Button>}
      </div>
      <Advances advances={list} full={full} onChange={reload} />
      {adding && data && <AdvanceModal lines={data.lines} period={period} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </>
  );
}
