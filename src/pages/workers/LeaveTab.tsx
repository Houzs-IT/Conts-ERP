import { useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { KeyFacts } from '../../components/KeyFacts';
import { PhoneCard } from '../../components/ListToolbar';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { date, todayMyt } from '../../lib/format';
import type { LeavesPayload, LeavePerson } from '../../../functions/api/leaves/index';
import type { LeaveView } from '../../../functions/_lib/leave';
import { LEAVE_TYPE_LABEL, type AllowanceType } from '../../../functions/_lib/leaveRules';
import { TableSkeleton } from '../../components/DataState';
// Loaded when shown: imported directly by both Pricing and HR it became a chunk every page's preload list names
// (scripts/checks/entry-bundle.mjs).
const HolidayList = lazy(() => import('../../components/HolidayList').then(m => ({ default: m.HolidayList })));

/* ------------------------------------------------------------------ *
 * HR > Workers > Leave: requests waiting for a decision, each person's
 * annual and medical balance, every request in the year, and the public
 * holiday list (HR phase 3). People apply on the portal's Me screen.
 * ------------------------------------------------------------------ */

type Request = LeaveView & { name: string };

const dayText = (d: string): string => date(`${d}T12:00:00+08:00`);
const span = (l: { startDate: string; endDate: string }): string => (l.startDate === l.endDate ? dayText(l.startDate) : `${dayText(l.startDate)} – ${dayText(l.endDate)}`);
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
const isAllowance = (t: string): t is AllowanceType => t === 'annual' || t === 'medical';

export default function LeaveTab() {
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('year'));
  const { data, loading, error, reload } = useApi<LeavesPayload>(`/leaves${Number.isInteger(asked) && asked > 2000 ? `?year=${asked}` : ''}`);
  const { user } = useSession();
  const mayDecide = mayWork(user, 'hr');
  const [deciding, setDeciding] = useState<{ leave: Request; decision: 'approve' | 'reject' } | null>(null);
  const [editingHolidays, setEditingHolidays] = useState(false);

  const year = data?.year ?? Number(todayMyt().slice(0, 4));
  const leaves = data?.leaves ?? [];
  const pending = leaves.filter(l => l.status === 'pending');
  const personOf = (employeeId: string): LeavePerson | undefined => data?.people.find(p => p.employee.id === employeeId);
  const setYear = (y: number) => setParams(p => { const n = new URLSearchParams(p); n.set('year', String(y)); return n; }, { replace: true });

  const balanceColumns = useMemo<Column<LeavePerson>[]>(() => [
    { key: 'name', label: 'Name', value: p => p.employee.name, hideable: false, width: 200, render: p => <span className="font-semibold">{p.employee.name}</span> },
    { key: 'joined', label: 'Joined', type: 'date', value: p => p.employee.joinDate, width: 120, render: p => p.employee.joinDate ? dayText(p.employee.joinDate) : <span className="text-muted-ink">Not set</span> },
    ...(['annual', 'medical'] as const).map(t => ({
      key: t, label: `${LEAVE_TYPE_LABEL[t]} left`, type: 'number' as const, width: 170,
      value: (p: LeavePerson) => p.balances.find(b => b.type === t)?.left ?? null,
      render: (p: LeavePerson) => {
        const b = p.balances.find(x => x.type === t);
        return b ? <span className={`tabular-nums ${b.left < 0 ? 'text-danger font-semibold' : ''}`}>{b.left} of {b.allowance}{b.pending ? <span className="text-muted-ink"> · {b.pending} waiting</span> : null}</span> : null;
      },
    })),
  ], []);

  const requestColumns = useMemo<Column<Request>[]>(() => [
    { key: 'name', label: 'Name', value: l => l.name, width: 180, render: l => <span className="font-semibold">{l.name}</span> },
    { key: 'type', label: 'Type', value: l => LEAVE_TYPE_LABEL[l.type], width: 110 },
    { key: 'start', label: 'From', type: 'date', value: l => l.startDate, width: 120, render: l => dayText(l.startDate) },
    { key: 'end', label: 'To', type: 'date', value: l => l.endDate, width: 120, render: l => dayText(l.endDate) },
    { key: 'days', label: 'Days', type: 'number', value: l => l.chargeable, width: 80 },
    { key: 'status', label: 'Status', type: 'status', entity: 'leave', value: l => l.status, width: 130 },
    { key: 'reason', label: 'Reason', value: l => l.reason, width: 220 },
    { key: 'decided', label: 'Decided by', value: l => l.decidedBy, width: 160, render: l => l.decidedBy ? <span title={l.decisionNote ?? undefined}>{l.decidedBy}</span> : '' },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 120, align: 'right',
      render: l => mayDecide && l.status === 'approved'
        ? <Button size="sm" variant="tertiary" onClick={() => setDeciding({ leave: l, decision: 'reject' })}>Withdraw</Button> : null },
  ], [mayDecide]);

  return (
    <>
      <p className="m-0 mb-4 text-copy text-muted-ink">{data ? `Leave ${year} · ${pending.length} waiting for a decision` : 'Loading leave…'}</p>
      {error && <StaleBanner message={`Showing the last leave we have. ${error}`} onRetry={reload} />}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Button size="sm" variant="secondary" icon={<Icon name="ChevronLeft" size="sm" />} onClick={() => setYear(year - 1)}>{year - 1}</Button>
        <span className="text-copy font-semibold tabular-nums px-2">{year}</span>
        <Button size="sm" variant="secondary" disabled={!data || year >= Number(data.today.slice(0, 4)) + 1} onClick={() => setYear(year + 1)}>{year + 1}</Button>
      </div>

      <div className="flex flex-col gap-5">
        <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)]">
          <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="text-heading font-bold tracking-[-0.005em]">Waiting for a decision <span className="text-meta text-muted-ink font-normal tabular-nums">{pending.length}</span></span>
            <span className="text-meta text-muted-ink">Approving takes the days from their balance. The person is told on their phone.</span>
          </div>
          {loading && !data && <p className="m-0 px-5 py-4 text-copy text-muted-ink">Loading…</p>}
          {data && pending.length === 0 && <p className="m-0 px-5 py-4 text-copy text-muted-ink">Nothing waiting.</p>}
          {pending.map(l => {
            const b = isAllowance(l.type) ? personOf(l.employeeId)?.balances.find(x => x.type === l.type) : undefined;
            return (
              <div key={l.id} className="px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap [border-top:1px_solid_var(--color-line-soft)] first-of-type:border-t-0">
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-copy font-semibold">{l.name} · {LEAVE_TYPE_LABEL[l.type]} leave · {days(l.chargeable)}</span>
                  <span className="text-meta text-muted-ink">{span(l)}{l.reason ? ` · ${l.reason}` : ''}</span>
                  {b && <span className={`text-meta ${b.left - l.chargeable < 0 ? 'text-danger' : 'text-muted-ink'}`}>Leaves {b.left - l.chargeable} of {b.allowance} {LEAVE_TYPE_LABEL[b.type].toLowerCase()} days if approved</span>}
                </span>
                {mayDecide && (
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setDeciding({ leave: l, decision: 'reject' })}>Reject</Button>
                    <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} onClick={() => setDeciding({ leave: l, decision: 'approve' })}>Approve</Button>
                  </span>
                )}
              </div>
            );
          })}
        </section>

        <DataTable<LeavePerson>
          id="leave.balances" columns={balanceColumns} rows={loading && !data ? null : data?.people ?? []} rowKey={p => p.employee.id ?? p.employee.cleanerId ?? p.employee.technicianId ?? p.employee.name}
          pageSize={0} noun={['person', 'people']} exportName={`leave-balances-${year}`}
          header={
            <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
              <span className="text-heading font-bold tracking-[-0.005em]">Balances {year}</span>
              <span className="text-meta text-muted-ink">By the Employment Act for their years of service, unless their employee record sets a number.</span>
            </div>
          }
          empty={{ title: 'No in-house staff yet.', body: 'Add an internal cleaner or an in-house technician first.' }}
          renderCard={p => {
            const annual = p.balances.find(b => b.type === 'annual');
            return (
              <PhoneCard title={p.employee.name}
                right={annual ? <span className={annual.left < 0 ? 'text-danger' : undefined}>{annual.left} / {annual.allowance}</span> : undefined}
                meta={p.balances.map(b => `${LEAVE_TYPE_LABEL[b.type]} ${b.left} of ${b.allowance} left`).join(' · ')} />
            );
          }}
        />

        <DataTable<Request>
          id="leave.requests" columns={requestColumns} rows={loading && !data ? null : leaves} rowKey={l => l.id}
          pageSize={0} noun={['request', 'requests']} exportName={`leave-requests-${year}`}
          header={
            <div className="pt-5 pb-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
              <span className="text-heading font-bold tracking-[-0.005em]">All requests {year}</span>
            </div>
          }
          empty={{ title: 'No leave this year.', body: 'Requests from the portal show here.' }}
          renderCard={l => (
            <PhoneCard title={l.name} right={days(l.chargeable)}
              meta={`${LEAVE_TYPE_LABEL[l.type]} · ${span(l)}`}
              badge={<StatusBadge entity="leave" value={l.status} size="sm" />} />
          )}
        />

        <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)]">
          <div className="pt-5 pb-3 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5">
              <span className="text-heading font-bold tracking-[-0.005em]">Public holidays</span>
              <span className="text-meta text-muted-ink">Not taken from anyone's leave. Payroll pays work on these days at the holiday rate.</span>
            </span>
            {mayDecide && data && <Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditingHolidays(true)}>Edit list</Button>}
          </div>
          <div className="px-5 py-3 flex flex-col">
            {data && data.holidays.filter(h => h.date.startsWith(`${year}-`)).length === 0 && <span className="text-copy text-muted-ink py-1">No public holidays set for {year}.</span>}
            {data?.holidays.filter(h => h.date.startsWith(`${year}-`)).map(h => (
              <span key={h.date} className="flex justify-between gap-3 py-1.5 text-copy"><span>{h.name}</span><span className="text-muted-ink tabular-nums">{dayText(h.date)}</span></span>
            ))}
          </div>
        </section>
      </div>

      {deciding && <DecideModal {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); reload(); }} />}
      {editingHolidays && data && <HolidaysModal onDone={() => { setEditingHolidays(false); reload(); }} />}
    </>
  );
}

function DecideModal({ leave, decision, onClose, onDone }: { leave: Request; decision: 'approve' | 'reject'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const withdrawing = decision === 'reject' && leave.status === 'approved';

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/leaves/${leave.id}/decide`, { decision, note });
      toast({ tone: 'success', title: decision === 'approve' ? 'Leave approved.' : withdrawing ? 'Approval withdrawn.' : 'Leave not approved.', body: `${leave.name} is told on their phone.` });
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure) setError(e.fields?.note);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={decision === 'approve' ? 'Approve leave?' : withdrawing ? 'Withdraw approved leave?' : 'Reject leave?'}
      eyebrow="Leave" size="sm" sub={leave.name} onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant={decision === 'approve' ? 'primary' : 'danger'} onClick={() => void send()} disabled={busy}>
          {busy ? 'Saving…' : decision === 'approve' ? 'Approve' : withdrawing ? 'Withdraw' : 'Reject'}
        </Button>
      </>}>
      <KeyFacts items={[['Type', LEAVE_TYPE_LABEL[leave.type]], ['Days', days(leave.chargeable)], ['When', span(leave)]]} cols={leave.startDate === leave.endDate ? 3 : 2} />
      <Field label={decision === 'approve' ? 'Note to them (optional)' : 'Why (they see this)'} value={note} onChange={e => setNote(e.target.value)}
        placeholder={decision === 'approve' ? 'Enjoy the break' : 'Too many people off that week'} error={error} />
    </Modal>
  );
}

/** The company's one public holiday list (shared with Pricing): leave balances leave out the ones marked Staff day off. */
function HolidaysModal({ onDone }: { onDone: () => void }) {
  return (
    <Modal title="Public holidays" eyebrow="Leave" size="lg" sub="One list for the whole company, kept here and on Pricing. Balances leave out the ones marked Staff day off." onClose={onDone}
      footer={<Button size="sm" variant="primary" onClick={onDone}>Done</Button>}>
      <Suspense fallback={<TableSkeleton rows={4} cols={3} />}><HolidayList compact /></Suspense>
    </Modal>
  );
}
