/** Owner statement close (chew, 11 Nov 2026; spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md):
 *  each month's owner statements are checked in steps and each step is locked unit by unit, only the units ticked.
 *  Income (part 1), deductions and O2 (part 2a): a locked figure never changes, and what comes later (a reservation
 *  changed, a cost or an owner adjustment added) goes to the next open month. Unlocking asks why. GP and final follow
 *  in part 3. */
import { useMemo } from 'react';
import { cx } from '../../lib/design-tokens';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { useConfirm } from '../../components/ConfirmDialog';
import { Segmented as Tabs } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { count, dateTime, monthLabel, plural, todayMyt, buildingName } from '../../lib/format';
import { useUrlState, MonthStepper, shiftMonth } from '../finance/listKit';

type Stage = 'income' | 'deductions' | 'o2';
interface CloseUnit {
  unitId: string; building: string; unit: string; ownerName: string; statementFinal: boolean;
  steps: Stage[];
  income: { reservations: number; nights: number; amount: number; toConfirm: number; warnings: string[] };
  deductions: { cleaning: number; utilities: number; additional: number; misc: number; total: number; checks: string[] };
  o2: { credits: number; charges: number; net: number; checks: string[] };
  locks: Record<Stage, { by: string; at: string } | null>;
}
interface Payload {
  month: string; today: string; lockProblem: string | null;
  may: { lockIncome: boolean; lockDeductions: boolean; lockO2: boolean; unlock: boolean };
  airbnbFiles: number;
  counts: Record<Stage, { locked: number; total: number }>;
  units: CloseUnit[];
}
type Show = 'open' | 'look' | 'locked' | 'all';

/** Each step: its number on the strip, how screens name it, and the power that locks it (chew gives each per person). */
const STEP: Record<Stage, { n: number; name: string; noun: string; power: 'lockIncome' | 'lockDeductions' | 'lockO2' }> = {
  income: { n: 1, name: 'Income', noun: 'income', power: 'lockIncome' },
  deductions: { n: 2, name: 'Deductions', noun: 'deductions', power: 'lockDeductions' },
  o2: { n: 3, name: 'O2', noun: 'O2', power: 'lockO2' },
};
const STAGES: Stage[] = ['income', 'deductions', 'o2'];
/** The one line under each step on the strip. */
const STEP_DETAIL: Record<Stage, string> = {
  income: "Each unit's income from its reservations",
  deductions: 'Utilities, cleaning and repairs',
  o2: "Owner adjustments after the operator's share",
};

/** The close as a horizontal stepper (prototype .uo-steps): number, name, state and one line for each step, the current
 *  one gold with its "n of N locked" and a slim bar. Step 4 (GP and final) is shown as not yet, it comes in part 3.
 *  Stacks one under another on a phone. */
function CloseSteps({ current, counts, onPick }: { current: Stage; counts: Payload['counts']; onPick: (s: Stage) => void }) {
  const state = (s: Stage) => {
    const c = counts[s];
    return c.total > 0 && c.locked >= c.total ? 'Done' : s === current || c.locked > 0 ? 'In progress' : 'Not yet';
  };
  const cell = 'relative flex gap-3 px-4 py-3.5 min-w-0 text-left [border-bottom:1px_solid_var(--color-line-soft)] md:border-b-0 md:[border-right:1px_solid_var(--color-line-soft)] last:border-0';
  const num = 'flex-none w-7 h-7 rounded-full grid place-items-center text-[13px] font-bold';
  return (
    <ol aria-label="Close steps" className="m-0 p-0 list-none grid grid-cols-1 md:grid-cols-4 bg-card border border-solid border-line-soft rounded-card shadow-[var(--shadow-card)] overflow-hidden">
      {STAGES.map(s => {
        const st = state(s), cur = s === current, c = counts[s];
        const pct = c.total ? Math.round((c.locked / c.total) * 100) : 0;
        return (
          <li key={s} className="contents">
            <button type="button" onClick={() => onPick(s)} aria-current={cur ? 'step' : undefined}
              className={cx(cell, 'border-0 font-[inherit] cursor-pointer bg-transparent', cur && 'bg-gold-tint [box-shadow:inset_0_-3px_0_var(--color-gold)]')}>
              <span className={cx(num, st === 'Done' ? 'bg-success text-white' : cur ? 'bg-gold text-black' : 'bg-muted text-ink-2')}>
                {st === 'Done' ? <Icon name="Check" size="sm" /> : STEP[s].n}
              </span>
              <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                <b className="text-copy text-ink">{STEP[s].name}</b>
                <span className={cx('text-meta font-semibold', cur ? 'text-gold-ink' : st === 'Done' ? 'text-success' : 'text-muted-ink')}>
                  {st} · {count(c.locked)} of {count(c.total)} locked
                </span>
                <span className="text-meta text-muted-ink truncate">{STEP_DETAIL[s]}</span>
                <span aria-hidden className="block h-1 rounded-full bg-muted mt-1.5 overflow-hidden">
                  <i className={cx('block h-1', st === 'Done' ? 'bg-success' : 'bg-gold')} style={{ width: `${pct}%` }} />
                </span>
              </span>
            </button>
          </li>
        );
      })}
      <li className={cx(cell, 'cursor-default')}>
        <span className={cx(num, 'bg-muted text-ink-2')}>4</span>
        <span className="flex flex-col gap-0.5 min-w-0 flex-1">
          <b className="text-copy text-ink">GP and final</b>
          <span className="text-meta font-semibold text-muted-ink">Not yet</span>
          <span className="text-meta text-muted-ink truncate">Comes in a later update</span>
        </span>
      </li>
    </ol>
  );
}

const needsLook = (u: CloseUnit, step: Stage) => step === 'income' ? u.income.toConfirm > 0 || u.income.warnings.length > 0
  : (step === 'deductions' ? u.deductions.checks : u.o2.checks).length > 0;
const unitName = (u: CloseUnit) => `${buildingName(u.building)} ${u.unit}`;
/** The engine's warnings are sentences; the chip shows the first clause. */
const short = (w: string) => w.split(/[:(]/)[0].replace(/\.$/, '').trim();

export default function OwnerReportClosePage() {
  const url = useUrlState();
  const navigate = useNavigate();
  // Last month is the latest that has ended, so the latest that can be locked.
  const lastMonth = shiftMonth(todayMyt().slice(0, 7), -1);
  const month = /^\d{4}-\d{2}$/.test(url.get('month')) ? url.get('month') : lastMonth;
  const step = STAGES.find(s => s === url.get('step')) ?? 'income';
  const show = (['open', 'look', 'locked', 'all'] as Show[]).find(s => s === url.get('show')) ?? 'open';
  const { data, loading, error, reload } = useApi<Payload>(`/owner-close?month=${month}`);
  const toast = useToast();
  const [confirmUi, ask] = useConfirm();
  const label = monthLabel(month, { long: true });
  const { name, noun, power } = STEP[step];

  const units = useMemo(() => (data?.units ?? []).filter(u => u.steps.includes(step)), [data, step]);
  const tally = useMemo(() => ({
    open: units.filter(u => !u.locks[step]).length,
    look: units.filter(u => !u.locks[step] && needsLook(u, step)).length,
    locked: units.filter(u => !!u.locks[step]).length,
    all: units.length,
  }), [units, step]);
  const rows = useMemo(() => units.filter(u => (show === 'all' ? true : show === 'locked' ? !!u.locks[step]
    : show === 'look' ? !u.locks[step] && needsLook(u, step) : !u.locks[step])), [units, show, step]);
  const mayLock = !!data?.may[power] && !data?.lockProblem;

  /** What a lock means for each step, said in the confirm dialog. */
  const after: Record<Stage, string> = {
    income: `After this, a change to their ${label} income goes to the next open month as an owner adjustment.`,
    deductions: `After this, a new cost for their ${label} goes on the next open statement, and a change to a locked cost goes there as an owner adjustment.`,
    o2: `After this, a new owner adjustment for their ${label} is dated into the next open month, and their ${label} owner adjustments can't be held, released, settled or deleted.`,
  };

  async function lock(selected: CloseUnit[], clear: () => void) {
    const look = selected.filter(u => needsLook(u, step));
    const yes = await ask({
      title: `Lock ${label} ${noun} for ${plural(selected.length, 'unit')}?`,
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
      meta: after[step],
      confirmLabel: `Lock ${plural(selected.length, 'unit')}`,
    });
    if (yes === null) return;
    try {
      const r = await api.post<{ locked: string[]; already: string[]; notLockable: string[]; final: string[] }>('/owner-close/lock', { month, stage: step, unitIds: selected.map(u => u.unitId) });
      const skipped = [
        r.already.length ? `${plural(r.already.length, 'unit')} ${r.already.length === 1 ? 'was' : 'were'} already locked.` : '',
        r.final.length ? `${plural(r.final.length, 'unit')} not locked: the ${label} statement is already final.` : '',
        r.notLockable.length ? `${plural(r.notLockable.length, 'unit')} not locked: ${step === 'income' ? 'a fixed rent or master lease has no income to lock' : 'a fixed rent or master lease is not on this step yet'}.` : '',
      ].filter(Boolean).join(' ');
      toast({ tone: r.locked.length ? 'success' : 'warning', title: r.locked.length ? `${name} locked for ${plural(r.locked.length, 'unit')}.` : 'No unit was locked.', body: skipped || undefined });
      clear();
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  async function unlock(u: CloseUnit) {
    const what: Record<Stage, string> = {
      income: `The month goes back to today's reservations. A difference already moved to a later month comes back, unless that month is final.`,
      deductions: `The month goes back to today's costs. A difference already moved to a later month comes back, unless that month is final.`,
      o2: `The month's statement takes today's owner adjustments again.`,
    };
    const reason = await ask({
      title: `Unlock ${label} ${noun} for ${unitName(u)}?`,
      body: what[step],
      reason: { label: 'Why are you unlocking?', placeholder: step === 'income' ? 'Airbnb corrected a reservation' : step === 'deductions' ? 'The water bill was keyed wrong' : 'An owner adjustment was missed', maxLength: 500 },
      confirmLabel: 'Unlock', danger: true,
    });
    if (reason === null) return;
    try {
      const r = await api.post<{ regenerate?: string[] }>('/owner-close/unlock', { month, stage: step, unitId: u.unitId, reason });
      const again = (r.regenerate ?? []).map(m => monthLabel(m, { long: true }));
      const follows: Record<Stage, string> = {
        income: `Its ${label} income follows today's reservations again.`,
        deductions: `Its ${label} deductions follow today's costs again.`,
        o2: `Its ${label} statement takes today's owner adjustments again when it is generated.`,
      };
      toast({ tone: 'success', title: `${unitName(u)} unlocked.`,
        body: again.length ? `${follows[step]} Generate the ${again.join(' and ')} statement again before marking it final.` : follows[step] });
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  const unitColumn: Column<CloseUnit> = { key: 'unit', label: 'Unit', value: unitName, sub: u => u.ownerName, phone: 'title', hideable: false, width: 200 };
  const checkColumn: Column<CloseUnit> = {
    key: 'check', label: 'Check', width: 240, sortable: false, value: u => (needsLook(u, step) ? 'Needs a look' : step === 'income' ? 'All confirmed' : 'OK'),
    render: u => (
      <span className="flex flex-wrap gap-1">
        {step === 'income' && u.income.toConfirm > 0 && <StatusBadge tone="warning" label={`${plural(u.income.toConfirm, 'reservation')} to confirm`} />}
        {step === 'income' && u.income.warnings.map(w => <span key={w} title={w}><StatusBadge tone="warning" label={short(w)} /></span>)}
        {step !== 'income' && (step === 'deductions' ? u.deductions.checks : u.o2.checks).map(c => <StatusBadge key={c} tone="warning" label={c} />)}
        {!needsLook(u, step) && <StatusBadge tone="success" label={step === 'income' ? 'All confirmed' : 'OK'} />}
      </span>
    ),
  };
  const statusColumn: Column<CloseUnit> = {
    key: 'status', label: 'Status', width: 290, value: u => (u.locks[step] ? 'Locked' : 'Not locked'),
    render: u => {
      const l = u.locks[step];
      return l ? (
        <span className="flex items-center gap-2">
          <span className="inline-flex text-muted-ink"><Icon name="Lock" size="sm" /></span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span>Locked</span>
            <span className="text-meta text-muted-ink">{l.by} · {dateTime(l.at)}</span>
          </span>
          {data?.may.unlock && <Button size="sm" variant="ghost" className="ml-auto" onClick={e => { e.stopPropagation(); void unlock(u); }}>Unlock</Button>}
        </span>
      ) : u.statementFinal ? (
        <span className="text-muted-ink" title={`Its owner's ${label} statement is already final, so its ${noun} can no longer be locked.`}>Statement final</span>
      ) : <span className="text-muted-ink">Not locked</span>;
    },
  };
  const figures: Record<Stage, Column<CloseUnit>[]> = {
    income: [
      { key: 'reservations', label: 'Reservations', type: 'number', value: u => u.income.reservations, width: 110 },
      { key: 'nights', label: 'Nights', type: 'number', value: u => u.income.nights, width: 80 },
      { key: 'income', label: 'Income', type: 'money', value: u => u.income.amount, width: 120, phone: 'right' },
    ],
    deductions: [
      { key: 'cleaning', label: 'Cleaning', type: 'money', value: u => u.deductions.cleaning, width: 110 },
      { key: 'utilities', label: 'Utilities', type: 'money', value: u => u.deductions.utilities, width: 110 },
      { key: 'additional', label: 'Additional', type: 'money', value: u => u.deductions.additional, width: 110 },
      { key: 'misc', label: 'Misc', type: 'money', value: u => u.deductions.misc, width: 100 },
      { key: 'total', label: 'Total', type: 'money', value: u => u.deductions.total, width: 120, phone: 'right' },
    ],
    o2: [
      { key: 'credits', label: 'Credits', type: 'money', value: u => u.o2.credits, width: 110 },
      { key: 'charges', label: 'Charges', type: 'money', value: u => u.o2.charges, width: 110 },
      { key: 'net', label: 'Net O2', type: 'money', value: u => u.o2.net, width: 120, phone: 'right' },
    ],
  };
  const columns: Column<CloseUnit>[] = [unitColumn, ...figures[step], checkColumn, statusColumn];

  return (
    <>
      <PageHeader title="Owner statement close"
        sub="Check each month's owner statements in steps and lock what is checked, unit by unit. A locked figure never changes; what comes later goes to the next open month."
        actions={<MonthStepper label={monthLabel(month)} nextDisabled={month >= lastMonth} onStep={by => url.set({ month: shiftMonth(month, by), show: null })} />} />
      <div className="flex flex-col gap-4">
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={6} /> : data ? (
          <>
            <CloseSteps current={step} counts={data.counts} onPick={s => url.set({ step: s === 'income' ? null : s, show: null })} />
            {data.lockProblem && <p className="m-0 text-meta text-muted-ink">{data.lockProblem} This month can be looked at but not locked.</p>}
            {step === 'income' && !data.lockProblem && data.airbnbFiles === 0 && (
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
            <DataTable id={`owner-close.${step}`} urlPrefix="c" columns={columns} rows={rows} rowKey={u => u.unitId}
              selectable={mayLock ? u => !u.locks[step] && !u.statementFinal : false} selectionKey={`${month}|${step}|${show}`}
              bulkActions={(selected, clear) => (
                <Button size="sm" variant="primary" icon={<Icon name="Lock" size="sm" />} onClick={() => void lock(selected, clear)}>
                  Lock {noun} ({count(selected.length)})
                </Button>
              )}
              exportName={`owner-statement-close-${step}-${month}`} noun={['unit', 'units']}
              empty={{ title: show === 'locked' ? `No unit's ${label} ${noun} is locked yet.` : show === 'look' ? 'Nothing needs a look.' : `Every unit's ${label} ${noun} is locked.` }} />
          </>
        ) : null}
      </div>
      {confirmUi}
    </>
  );
}
