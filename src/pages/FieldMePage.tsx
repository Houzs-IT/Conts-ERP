import { useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { StaleBanner } from '../components/DataState';
import { Select } from '../components/Select';
import { Field } from '../components/Field';
import { DateField } from '../components/inputs';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../lib/api';
import { date } from '../lib/format';
import type { LeaveView } from '../../functions/_lib/leave';
import {
  LEAVE_TYPES, LEAVE_TYPE_LABEL, calendarDays, type Balance, type LeaveType, type PublicHoliday,
} from '../../functions/_lib/leaveRules';

/* ------------------------------------------------------------------ *
 * Portal > Me: leave balances, applying for leave, and the person's own
 * requests (HR phase 3, ported from Hookka's worker "Me" screen). The
 * office decides on Workers > Leave; the bell says when it has.
 * ------------------------------------------------------------------ */

interface MePayload {
  name: string; employeeId: string | null; year: number; today: string;
  balances: Balance[]; leaves: LeaveView[]; holidays: PublicHoliday[];
}

const isType = (v: string): v is LeaveType => LEAVE_TYPES.some(t => t === v);
const dayText = (d: string): string => date(`${d}T12:00:00+08:00`);
const span = (l: { startDate: string; endDate: string }): string => (l.startDate === l.endDate ? dayText(l.startDate) : `${dayText(l.startDate)} – ${dayText(l.endDate)}`);
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

export default function FieldMePage() {
  const { data, loading, error, reload } = useApi<MePayload>('/field/leave');
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const [applying, setApplying] = useState(false);

  async function cancel(l: LeaveView) {
    if (await ask({ title: 'Cancel this request?', body: `${LEAVE_TYPE_LABEL[l.type]} leave, ${span(l)}.`, confirmLabel: 'Cancel request', danger: true }) === null) return;
    try {
      await api.post(`/field/leave/${l.id}/cancel`, {});
      toast({ tone: 'success', title: 'Request cancelled.', body: span(l) });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  const upcoming = (data?.holidays ?? []).filter(h => h.date >= (data?.today ?? ''));
  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-title font-semibold">Me</h1>
        <div className="text-copy text-muted-ink">{data ? `${data.name}${data.employeeId ? ` · ${data.employeeId}` : ''}` : 'Loading…'}</div>
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}

      {data && (
        <section className="grid grid-cols-2 gap-3">
          {data.balances.map(b => (
            <div key={b.type} className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col gap-0.5">
              <span className="text-meta text-muted-ink">{LEAVE_TYPE_LABEL[b.type]} leave {data.year}</span>
              <span className={`text-[22px] leading-tight font-bold tabular-nums ${b.left < 0 ? 'text-danger' : ''}`}>{b.left} left</span>
              <span className="text-meta text-muted-ink tabular-nums">{b.used} of {b.allowance} used{b.pending ? ` · ${b.pending} waiting` : ''}</span>
            </div>
          ))}
        </section>
      )}

      {data && !applying && (
        <Button size="touch" variant="primary" className="w-full" icon={<Icon name="CalendarPlus" size="sm" />} onClick={() => setApplying(true)}>Apply for leave</Button>
      )}
      {data && applying && <ApplyForm today={data.today} onClose={() => setApplying(false)} onDone={() => { setApplying(false); reload(); }} />}

      {data && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">My requests</h2>
          {data.leaves.length === 0 && <span className="text-copy text-muted-ink">No leave asked for this year.</span>}
          {data.leaves.map(l => (
            <div key={l.id} className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-copy font-semibold">{LEAVE_TYPE_LABEL[l.type]} · {days(l.chargeable)}</span>
                <StatusBadge entity="leave" value={l.status} size="sm" />
              </span>
              <span className="text-meta text-muted-ink">{span(l)}{l.chargeable < l.days ? ` (${days(l.days - l.chargeable)} public holiday not counted)` : ''}</span>
              {l.decisionNote && <span className="text-meta">Office: {l.decisionNote}</span>}
              {l.status === 'pending' && (
                <span><Button size="sm" variant="tertiary" onClick={() => void cancel(l)}>Cancel request</Button></span>
              )}
            </div>
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Public holidays</h2>
          <div className="bg-card rounded-card border border-solid border-line px-4 py-2 flex flex-col">
            {upcoming.map(h => (
              <span key={h.date} className="flex justify-between gap-3 py-1.5 text-copy"><span>{h.name}</span><span className="text-muted-ink tabular-nums">{dayText(h.date)}</span></span>
            ))}
          </div>
        </section>
      )}
      {loading && !data && <span className="text-copy text-muted-ink">Loading…</span>}
    </div>
  );
}

function ApplyForm({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<LeaveType>('annual');
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const n = startDate && endDate && endDate >= startDate ? calendarDays(startDate, endDate) : 0;

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api.post('/field/leave', { type, startDate, endDate, reason });
      toast({ tone: 'success', title: 'Leave request sent.', body: 'The office will decide. You get a notice when they do.' });
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-3">
      <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Apply for leave</h2>
      <Select label="Type" showLabel size="md" value={type} onChange={v => isType(v) && setType(v)}
        options={LEAVE_TYPES.map(t => ({ value: t, label: LEAVE_TYPE_LABEL[t] }))} />
      <DateField label="First day" value={startDate} onChange={v => { setStart(v); if (v > endDate) setEnd(v); }} required error={errors.startDate} />
      <DateField label="Last day" value={endDate} min={startDate} onChange={setEnd} required error={errors.endDate} />
      <Field label="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} placeholder={type === 'medical' ? 'Bring your MC to the office' : 'Family wedding'} error={errors.reason} />
      {n > 0 && <span className="text-meta text-muted-ink">{days(n)}, weekends included. Public holidays are not taken from your leave.</span>}
      <div className="grid grid-cols-2 gap-2">
        <Button size="touch" variant="secondary" onClick={onClose} disabled={busy}>Back</Button>
        <Button size="touch" variant="primary" loading={busy} disabled={!n} onClick={() => void send()}>Send</Button>
      </div>
    </section>
  );
}
