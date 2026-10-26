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
import { statusOf } from '../lib/status';
import { PORTAL_LANGS, LANG_LABEL, setPortalLang, usePortalLang, usePortalText, usePortalDates } from '../lib/portalI18n';
import type { LeaveView } from '../../functions/_lib/leave';
import {
  LEAVE_TYPES, calendarDays, type Balance, type LeaveType, type PublicHoliday,
} from '../../functions/_lib/leaveRules';

/* ------------------------------------------------------------------ *
 * Portal > Me: the portal's language, leave balances, applying for
 * leave, and the person's own requests (HR phases 3 and 4b, ported from
 * Hookka's worker "Me" screen). The office decides on HR > Leave; the
 * bell says when it has.
 * ------------------------------------------------------------------ */

interface MePayload {
  name: string; employeeId: string | null; year: number; today: string;
  balances: Balance[]; leaves: LeaveView[]; holidays: PublicHoliday[];
}

const isType = (v: string): v is LeaveType => LEAVE_TYPES.some(t => t === v);

/** "26 Oct 2026" or "26 – 28 Oct 2026" style, in the portal's language. */
function useSpan(): (l: { startDate: string; endDate: string }) => string {
  const { day } = usePortalDates();
  return l => (l.startDate === l.endDate ? day(l.startDate) : `${day(l.startDate)} – ${day(l.endDate)}`);
}

export default function FieldMePage() {
  const { data, loading, error, reload } = useApi<MePayload>('/field/leave');
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const [applying, setApplying] = useState(false);
  const t = usePortalText();
  const lang = usePortalLang();
  const { day } = usePortalDates();
  const span = useSpan();

  async function cancel(l: LeaveView) {
    if (await ask({ title: t.me.cancelTitle, body: t.me.cancelBody(t.leaveType[l.type], span(l)), confirmLabel: t.me.cancelRequest, cancelLabel: t.me.keep, danger: true }) === null) return;
    try {
      await api.post(`/field/leave/${l.id}/cancel`, {});
      toast({ tone: 'success', title: t.me.cancelled, body: span(l) });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  const upcoming = (data?.holidays ?? []).filter(h => h.date >= (data?.today ?? ''));
  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-title font-semibold">{t.me.title}</h1>
        <div className="text-copy text-muted-ink">{data ? `${data.name}${data.employeeId ? ` · ${data.employeeId}` : ''}` : t.common.loading}</div>
      </div>

      {/* Hookka's language switch: each language named in its own script. Kept on this phone. */}
      <section className="flex flex-col gap-2" aria-label={t.me.language}>
        <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-center gap-2"><Icon name="Languages" size="sm" />{t.me.language}</h2>
        <div className="grid grid-cols-2 gap-2">
          {PORTAL_LANGS.map(l => (
            <Button key={l} size="touch" variant={l === lang ? 'primary' : 'secondary'} aria-pressed={l === lang} lang={l} onClick={() => setPortalLang(l)}>
              {LANG_LABEL[l]}
            </Button>
          ))}
        </div>
      </section>

      {error && <StaleBanner message={error} onRetry={reload} />}

      {data && (
        <section className="grid grid-cols-2 gap-3">
          {data.balances.map(b => (
            <div key={b.type} className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col gap-0.5">
              <span className="text-meta text-muted-ink">{t.me.leaveYear(t.leaveType[b.type], data.year)}</span>
              <span className={`text-[22px] leading-tight font-bold tabular-nums ${b.left < 0 ? 'text-danger' : ''}`}>{t.me.left(b.left)}</span>
              <span className="text-meta text-muted-ink tabular-nums">{t.me.usedOf(b.used, b.allowance, b.pending)}</span>
            </div>
          ))}
        </section>
      )}

      {data && !applying && (
        <Button size="touch" variant="primary" className="w-full" icon={<Icon name="CalendarPlus" size="sm" />} onClick={() => setApplying(true)}>{t.me.apply}</Button>
      )}
      {data && applying && <ApplyForm today={data.today} onClose={() => setApplying(false)} onDone={() => { setApplying(false); reload(); }} />}

      {data && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{t.me.myRequests}</h2>
          {data.leaves.length === 0 && <span className="text-copy text-muted-ink">{t.me.noRequests}</span>}
          {data.leaves.map(l => (
            <div key={l.id} className="bg-card rounded-card border border-solid border-line px-4 py-3 flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-copy font-semibold">{t.leaveType[l.type]} · {t.common.days(l.chargeable)}</span>
                <StatusBadge tone={statusOf('leave', l.status).tone} label={t.leaveStatus[l.status]} size="sm" dot />
              </span>
              <span className="text-meta text-muted-ink">{span(l)}{l.chargeable < l.days ? ` ${t.me.holidayNotCounted(t.common.days(l.days - l.chargeable))}` : ''}</span>
              {l.decisionNote && <span className="text-meta">{t.me.officeNote(l.decisionNote)}</span>}
              {l.status === 'pending' && (
                <span><Button size="sm" variant="tertiary" onClick={() => void cancel(l)}>{t.me.cancelRequest}</Button></span>
              )}
            </div>
          ))}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{t.me.holidays}</h2>
          <div className="bg-card rounded-card border border-solid border-line px-4 py-2 flex flex-col">
            {upcoming.map(h => (
              <span key={h.date} className="flex justify-between gap-3 py-1.5 text-copy"><span>{h.name}</span><span className="text-muted-ink tabular-nums">{day(h.date)}</span></span>
            ))}
          </div>
        </section>
      )}
      {loading && !data && <span className="text-copy text-muted-ink">{t.common.loading}</span>}
    </div>
  );
}

function ApplyForm({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const t = usePortalText();
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
      toast({ tone: 'success', title: t.me.sent, body: t.me.sentBody });
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <section className="bg-card rounded-card border border-solid border-line px-4 py-4 flex flex-col gap-3">
      <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{t.me.apply}</h2>
      <Select label={t.me.type} showLabel size="md" value={type} onChange={v => isType(v) && setType(v)}
        options={LEAVE_TYPES.map(lt => ({ value: lt, label: t.leaveType[lt] }))} />
      <DateField label={t.me.firstDay} value={startDate} onChange={v => { setStart(v); if (v > endDate) setEnd(v); }} required error={errors.startDate} />
      <DateField label={t.me.lastDay} value={endDate} min={startDate} onChange={setEnd} required error={errors.endDate} />
      <Field label={t.me.reason} value={reason} onChange={e => setReason(e.target.value)} placeholder={type === 'medical' ? t.me.reasonMedical : t.me.reasonOther} error={errors.reason} />
      {n > 0 && <span className="text-meta text-muted-ink">{t.me.daysNote(t.common.days(n))}</span>}
      <div className="grid grid-cols-2 gap-2">
        <Button size="touch" variant="secondary" onClick={onClose} disabled={busy}>{t.common.back}</Button>
        <Button size="touch" variant="primary" loading={busy} disabled={!n} onClick={() => void send()}>{t.common.send}</Button>
      </div>
    </section>
  );
}
