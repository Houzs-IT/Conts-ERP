/** Owner statement close (chew, 11 Nov 2026; spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md):
 *  each month's owner statements are checked in stages and each stage is locked unit by unit, only the units ticked. Part 1
 *  is income: a locked month's income never changes, and a reservation changed later reaches the owner as an owner
 *  adjustment on the next open month. Unlocking asks why. Deductions, O2 and Final follow in parts 2 and 3. */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { StatRow, StatTile } from '../../components/Metric';
import { DataTable, type Column } from '../../components/DataTable';
import { useConfirm } from '../../components/ConfirmDialog';
import { Segmented as Tabs } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { count, dateTime, monthLabel, plural, todayMyt } from '../../lib/format';
import { useUrlState, MonthStepper, shiftMonth } from '../finance/listKit';

interface CloseUnit {
  unitId: string; building: string; unit: string; ownerName: string;
  reservations: number; nights: number; income: number; toConfirm: number; warnings: string[];
  incomeLock: { by: string; at: string } | null;
  statementFinal: boolean;
}
interface Payload {
  month: string; today: string; lockProblem: string | null;
  may: { lockIncome: boolean; unlock: boolean };
  airbnbFiles: number;
  counts: { income: { locked: number; total: number } };
  units: CloseUnit[];
}
type Show = 'open' | 'look' | 'locked' | 'all';

const needsLook = (u: CloseUnit) => u.toConfirm > 0 || u.warnings.length > 0;
const unitName = (u: CloseUnit) => `${u.building} ${u.unit}`;
/** The engine's warnings are sentences; the chip shows the first clause. */
const short = (w: string) => w.split(/[:(]/)[0].replace(/\.$/, '').trim();

export default function OwnerReportClosePage() {
  const url = useUrlState();
  const navigate = useNavigate();
  // Last month is the latest that has ended, so the latest that can be locked.
  const lastMonth = shiftMonth(todayMyt().slice(0, 7), -1);
  const month = /^\d{4}-\d{2}$/.test(url.get('month')) ? url.get('month') : lastMonth;
  const show = (['open', 'look', 'locked', 'all'] as Show[]).find(s => s === url.get('show')) ?? 'open';
  const { data, loading, error, reload } = useApi<Payload>(`/owner-close?month=${month}`);
  const toast = useToast();
  const [confirmUi, ask] = useConfirm();
  const label = monthLabel(month, { long: true });

  const units = useMemo(() => data?.units ?? [], [data]);
  const tally = useMemo(() => ({
    open: units.filter(u => !u.incomeLock).length,
    look: units.filter(u => !u.incomeLock && needsLook(u)).length,
    locked: units.filter(u => !!u.incomeLock).length,
    all: units.length,
  }), [units]);
  const rows = useMemo(() => units.filter(u => (show === 'all' ? true : show === 'locked' ? !!u.incomeLock
    : show === 'look' ? !u.incomeLock && needsLook(u) : !u.incomeLock)), [units, show]);
  const mayLock = !!data?.may.lockIncome && !data?.lockProblem;

  async function lock(selected: CloseUnit[], clear: () => void) {
    const look = selected.filter(needsLook);
    const yes = await ask({
      title: `Lock ${label} income for ${plural(selected.length, 'unit')}?`,
      body: (
        <div className="flex flex-col gap-2">
          <p className="m-0">{selected.slice(0, 12).map(unitName).join(', ')}{selected.length > 12 ? ` and ${count(selected.length - 12)} more` : ''}.</p>
          {look.length > 0 && (
            <p className="m-0 text-warning">
              {look.length === 1 ? 'This one still has' : `${count(look.length)} of them still have`} something to look at: {look.slice(0, 6).map(unitName).join(', ')}{look.length > 6 ? '…' : ''}.
            </p>
          )}
        </div>
      ),
      meta: `After this, a change to their ${label} income goes to the next open month as an owner adjustment.`,
      confirmLabel: `Lock ${plural(selected.length, 'unit')}`,
    });
    if (yes === null) return;
    try {
      const r = await api.post<{ locked: string[]; already: string[]; notLockable: string[]; final: string[] }>('/owner-close/lock', { month, stage: 'income', unitIds: selected.map(u => u.unitId) });
      const skipped = [
        r.already.length ? `${plural(r.already.length, 'unit')} ${r.already.length === 1 ? 'was' : 'were'} already locked.` : '',
        r.final.length ? `${plural(r.final.length, 'unit')} not locked: the ${label} statement is already final.` : '',
        r.notLockable.length ? `${plural(r.notLockable.length, 'unit')} not locked: a fixed rent or master lease has no income to lock.` : '',
      ].filter(Boolean).join(' ');
      toast({ tone: r.locked.length ? 'success' : 'warning', title: r.locked.length ? `Income locked for ${plural(r.locked.length, 'unit')}.` : 'No unit was locked.', body: skipped || undefined });
      clear();
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  async function unlock(u: CloseUnit) {
    const reason = await ask({
      title: `Unlock ${label} income for ${unitName(u)}?`,
      body: `The month goes back to today's reservations. A difference already moved to a later month comes back, unless that month is final.`,
      reason: { label: 'Why are you unlocking?', placeholder: 'Airbnb corrected a reservation', maxLength: 500 },
      confirmLabel: 'Unlock', danger: true,
    });
    if (reason === null) return;
    try {
      const r = await api.post<{ regenerate?: string[] }>('/owner-close/unlock', { month, stage: 'income', unitId: u.unitId, reason });
      const again = (r.regenerate ?? []).map(m => monthLabel(m, { long: true }));
      toast({ tone: 'success', title: `${unitName(u)} unlocked.`,
        body: again.length ? `Its ${label} income follows today's reservations again. Generate the ${again.join(' and ')} statement again before marking it final.`
          : `Its ${label} income follows today's reservations again.` });
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  const columns: Column<CloseUnit>[] = [
    { key: 'unit', label: 'Unit', value: unitName, sub: u => u.ownerName, phone: 'title', hideable: false, width: 200 },
    { key: 'reservations', label: 'Reservations', type: 'number', value: u => u.reservations, width: 110 },
    { key: 'nights', label: 'Nights', type: 'number', value: u => u.nights, width: 80 },
    { key: 'income', label: 'Income', type: 'money', value: u => u.income, width: 120, phone: 'right' },
    {
      key: 'check', label: 'Check', width: 230, sortable: false, value: u => (needsLook(u) ? 'Needs a look' : 'All confirmed'),
      render: u => (
        <span className="flex flex-wrap gap-1">
          {u.toConfirm > 0 && <StatusBadge tone="warning" label={`${plural(u.toConfirm, 'reservation')} to confirm`} />}
          {u.warnings.map(w => <span key={w} title={w}><StatusBadge tone="warning" label={short(w)} /></span>)}
          {!needsLook(u) && <StatusBadge tone="success" label="All confirmed" />}
        </span>
      ),
    },
    {
      key: 'status', label: 'Status', width: 290, value: u => (u.incomeLock ? 'Locked' : 'Not locked'),
      render: u => (u.incomeLock ? (
        <span className="flex items-center gap-2">
          <span className="inline-flex text-muted-ink"><Icon name="Lock" size="sm" /></span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span>Locked</span>
            <span className="text-meta text-muted-ink">{u.incomeLock.by} · {dateTime(u.incomeLock.at)}</span>
          </span>
          {data?.may.unlock && <Button size="sm" variant="ghost" className="ml-auto" onClick={e => { e.stopPropagation(); void unlock(u); }}>Unlock</Button>}
        </span>
      ) : u.statementFinal ? (
        <span className="text-muted-ink" title={`Its owner's ${label} statement is already final, so its income can no longer be locked.`}>Statement final</span>
      ) : <span className="text-muted-ink">Not locked</span>),
    },
  ];

  const step = (n: number, name: string, value: string | undefined, hint: string, active = false) => (
    <StatTile label={`Step ${n} · ${name}`} value={value} hint={hint} active={active} />
  );

  return (
    <>
      <PageHeader title="Owner statement close"
        sub="Check each month's owner statements in steps and lock what is checked, unit by unit. A locked figure never changes; a change that comes later goes to the next open month."
        actions={<MonthStepper label={monthLabel(month)} nextDisabled={month >= lastMonth} onStep={by => url.set({ month: shiftMonth(month, by), show: null })} />} />
      <div className="flex flex-col gap-4">
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={6} /> : data ? (
          <>
            <StatRow cols={4}>
              {step(1, 'Income', `${count(data.counts.income.locked)} of ${count(data.counts.income.total)}`, 'units locked', true)}
              {step(2, 'Deductions', 'Next', 'Comes in the next update')}
              {step(3, 'O2', 'Next', 'Comes in the next update')}
              {step(4, 'GP and final', 'Later', 'After deductions and O2')}
            </StatRow>
            {data.lockProblem && <p className="m-0 text-meta text-muted-ink">{data.lockProblem} This month can be looked at but not locked.</p>}
            {!data.lockProblem && data.airbnbFiles === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border border-line border-l-[3px] border-l-info bg-info-bg px-3 py-2 text-copy">
                <span>No Airbnb file uploaded for {label} yet. Upload it on Airbnb reconciliation to check the reservations before locking.</span>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/finance/airbnb-reconciliation?month=${month}`)}>Airbnb reconciliation</Button>
              </div>
            )}
            <Tabs<Show> label="Which units" value={show} onChange={v => url.set({ show: v === 'open' ? null : v })} className="self-start"
              options={[
                { value: 'open', label: `Not locked (${count(tally.open)})` },
                { value: 'look', label: `Needs a look (${count(tally.look)})` },
                { value: 'locked', label: `Locked (${count(tally.locked)})` },
                { value: 'all', label: `All (${count(tally.all)})` },
              ]} />
            <DataTable id="owner-close.income" urlPrefix="c" columns={columns} rows={rows} rowKey={u => u.unitId}
              selectable={mayLock ? u => !u.incomeLock && !u.statementFinal : false} selectionKey={`${month}|${show}`}
              bulkActions={(selected, clear) => (
                <Button size="sm" variant="primary" icon={<Icon name="Lock" size="sm" />} onClick={() => void lock(selected, clear)}>
                  Lock income ({count(selected.length)})
                </Button>
              )}
              exportName={`owner-report-close-income-${month}`} noun={['unit', 'units']}
              empty={{ title: show === 'locked' ? `No unit's ${label} income is locked yet.` : show === 'look' ? 'Nothing needs a look.' : `Every unit's ${label} income is locked.` }} />
          </>
        ) : null}
      </div>
      {confirmUi}
    </>
  );
}
