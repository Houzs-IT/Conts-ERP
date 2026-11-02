import { useState, type FormEvent } from 'react';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { todayMyt } from '../../lib/format';
import { CentreModal, ModalActions } from '../booking/BookingDrawer';
import { UnitPicker } from '../booking/UnitPicker';
import { Field } from '../Field';
import { DateField, NumberInput, MoneyInput } from '../inputs';
import { Select } from '../Select';
import { Button } from '../Button';
import Icon from '../Icon';
import { useToast } from '../Toast';
import { ConfirmDialog, type ConfirmSpec } from '../ConfirmDialog';
import { SampleMark } from '../DemoMode';

/** Sample reservations and reviews in Demo mode (functions/api/demo). Saved in the demo store only: a real record
 *  edited here gets a demo copy that Demo mode shows in its place, and the real record stays as it was. */

interface DemoUnit { id: string; unitNumber: string; unitCode?: string | null; propertyId: string; propertyName: string; purpose: string; sample?: boolean }
const useDemoUnits = () => useApi<{ units: DemoUnit[] }>('/demo').data?.units ?? [];
export const useDemoOn = () => !!useSession().user?.demo?.on;

const CHANNELS = [{ value: 'airbnb', label: 'Airbnb' }, { value: 'booking_com', label: 'Booking.com' }, { value: 'agoda', label: 'Agoda' }, { value: 'direct', label: 'Direct' }];
const STATES = [{ value: 'confirmed', label: 'Upcoming or staying' }, { value: 'checked_in', label: 'Checked in' }, { value: 'checked_out', label: 'Past' }, { value: 'cancelled', label: 'Cancelled' }];

export interface DemoReservationValues {
  unitId: string; guestName: string; channel: string; checkIn: string; checkOut: string; guestsCount: number | null; grossBookingValue: number | null; state: string; notes: string;
}
const fieldsOf = (e: unknown): Record<string, string> => (e instanceof ApiFailure && e.fields ? e.fields : {});

/** Add a sample reservation, or edit any reservation in Demo mode (`id` set). */
export function DemoReservationModal({ id, initial, onClose, onSaved }: {
  id?: string; initial?: Partial<DemoReservationValues>; onClose: () => void; onSaved: (id: string) => void;
}) {
  const units = useDemoUnits();
  const toast = useToast();
  const [v, setV] = useState<DemoReservationValues>({
    unitId: '', guestName: '', channel: 'airbnb', checkIn: todayMyt(1), checkOut: todayMyt(3), guestsCount: 2, grossBookingValue: null, state: 'confirmed', notes: '', ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DemoReservationValues>(k: K, value: DemoReservationValues[K]) => setV(o => ({ ...o, [k]: value }));
  const missing = !v.unitId ? 'Pick a unit.' : !v.guestName.trim() ? 'Enter the guest\'s name.' : !v.checkIn || !v.checkOut ? 'Pick the dates.'
    : v.checkOut <= v.checkIn ? 'Checkout must be after check-in.' : v.grossBookingValue == null ? 'Enter the guest total.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing) return;
    setBusy(true); setErrors({});
    try {
      const body = { ...v, guestName: v.guestName.trim(), notes: v.notes.trim() || null };
      const r = id ? await api.patch<{ id: string }>(`/demo/reservations/${encodeURIComponent(id)}`, body) : await api.post<{ id: string }>('/demo/reservations', body);
      toast({ tone: 'success', title: id ? 'Saved in Demo mode.' : 'Sample reservation added.', body: id && !id.startsWith('demo-') ? 'The real reservation is unchanged.' : undefined });
      onSaved(r.id);
    } catch (err) {
      setErrors(fieldsOf(err));
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(err, 'Try again in a moment.') });
    }
    setBusy(false);
  }

  return (
    <CentreModal title={id ? 'Edit in Demo mode' : 'Sample reservation'} onClose={() => { if (!busy) onClose(); }} maxWidth={520}
      sub={id && !id.startsWith('demo-') ? 'Saved as sample data. The real reservation, its owner and its channels see no change.' : 'Shows in Demo mode only. It never reaches an owner, a statement or a channel.'}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <UnitPicker units={units} value={v.unitId} onChange={x => set('unitId', x)} />
        {errors.unitId && <span className="text-meta text-critical -mt-2">{errors.unitId}</span>}
        <Field label="Guest name" placeholder="Jane Tan" value={v.guestName} onChange={e => set('guestName', e.target.value)} required error={errors.guestName} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Select label="Channel" showLabel size="md" value={v.channel} onChange={x => set('channel', x)} options={CHANNELS} />
          <Select label="Status" showLabel size="md" value={v.state} onChange={x => set('state', x)} options={STATES} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <DateField label="Check-in" value={v.checkIn} onChange={x => set('checkIn', x)} required error={errors.checkIn} />
          <DateField label="Checkout" value={v.checkOut} min={v.checkIn || undefined} onChange={x => set('checkOut', x)} required error={errors.checkOut} />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <NumberInput label="Guests" min={1} max={30} value={v.guestsCount} onChange={x => set('guestsCount', x)} required error={errors.guestsCount} />
          <MoneyInput label="Guest total for the stay (RM)" valueSen={v.grossBookingValue} onChangeSen={x => set('grossBookingValue', x)} error={errors.grossBookingValue} />
        </div>
        <Field label="Notes (optional)" value={v.notes} onChange={e => set('notes', e.target.value)} />
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!!missing} disabledReason={missing ?? undefined}>{id ? 'Save in Demo mode' : 'Add sample reservation'}</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

export interface DemoReviewValues { unitId: string; channel: string; rating: number | null; comment: string; reply: string; reviewedAt: string }

/** Add a sample review, or edit any review in Demo mode (`id` set). */
export function DemoReviewModal({ id, initial, onClose, onSaved }: {
  id?: string; initial?: Partial<DemoReviewValues>; onClose: () => void; onSaved: () => void;
}) {
  const units = useDemoUnits();
  const toast = useToast();
  const [v, setV] = useState<DemoReviewValues>({ unitId: '', channel: 'airbnb', rating: 5, comment: '', reply: '', reviewedAt: todayMyt(), ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DemoReviewValues>(k: K, value: DemoReviewValues[K]) => setV(o => ({ ...o, [k]: value }));
  const missing = !v.unitId ? 'Pick a unit.' : v.rating == null ? 'Give a rating.' : !v.reviewedAt ? 'Pick the review date.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing) return;
    setBusy(true); setErrors({});
    try {
      const body = { ...v, comment: v.comment.trim() || null, reply: v.reply.trim() || null };
      if (id) await api.patch(`/demo/reviews/${encodeURIComponent(id)}`, body); else await api.post('/demo/reviews', body);
      toast({ tone: 'success', title: id ? 'Saved in Demo mode.' : 'Sample review added.', body: id && !id.startsWith('demo-') ? 'The real review is unchanged.' : undefined });
      onSaved();
    } catch (err) {
      setErrors(fieldsOf(err));
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(err, 'Try again in a moment.') });
    }
    setBusy(false);
  }

  return (
    <CentreModal title={id ? 'Edit review in Demo mode' : 'Sample review'} onClose={() => { if (!busy) onClose(); }} maxWidth={520}
      sub={id && !id.startsWith('demo-') ? 'Saved as sample data. The real review and its channel see no change.' : 'Shows in Demo mode only. It is never sent to a channel.'}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <UnitPicker units={units} value={v.unitId} onChange={x => set('unitId', x)} />
        {errors.unitId && <span className="text-meta text-critical -mt-2">{errors.unitId}</span>}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Select label="Channel" showLabel size="md" value={v.channel} onChange={x => set('channel', x)} options={CHANNELS} />
          <NumberInput label="Rating (1 to 5)" min={1} max={5} value={v.rating} onChange={x => set('rating', x)} required error={errors.rating} />
          <DateField label="Review date" value={v.reviewedAt} onChange={x => set('reviewedAt', x)} required error={errors.reviewedAt} />
        </div>
        <Field label="What the guest wrote (optional)" value={v.comment} onChange={e => set('comment', e.target.value)} />
        <Field label="Host reply (optional)" value={v.reply} onChange={e => set('reply', e.target.value)} />
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!!missing} disabledReason={missing ?? undefined}>{id ? 'Save in Demo mode' : 'Add sample review'}</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}

/** Asks, then removes a sample record or undoes a real record's Demo mode changes. Calls onDone afterwards. */
export function useDemoRemove(kind: 'reservations' | 'reviews', onDone: () => void) {
  const toast = useToast();
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (id: string, sample: 'demo' | 'shadow') => setSpec({
    title: sample === 'demo' ? `Remove this sample ${kind === 'reviews' ? 'review' : 'reservation'}?` : 'Undo the Demo mode changes?',
    body: sample === 'demo' ? 'It goes from Demo mode. Nothing real is affected.' : 'Demo mode shows the real record again, as it is.',
    confirmLabel: sample === 'demo' ? 'Remove sample' : 'Undo changes', busyLabel: 'Removing…', danger: sample === 'demo',
    onConfirm: async () => {
      setBusy(true);
      try { await api.del(`/demo/${kind}/${encodeURIComponent(id)}`); setSpec(null); onDone(); }
      catch (e) { toast({ tone: 'critical', title: 'Not removed.', body: errorMessage(e, 'Try again in a moment.') }); }
      setBusy(false);
    },
  });
  return { ask, dialog: <ConfirmDialog spec={spec} busy={busy} onClose={() => setSpec(null)} /> };
}

/** The reservation drawer's Demo mode strip: what this record is in Demo mode, and its Demo mode actions. */
export function DemoReservationBar({ id, sample, values, onChanged, onRemoved }: {
  id: string; sample?: 'demo' | 'shadow'; values: Partial<DemoReservationValues>; onChanged: () => void; onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const remove = useDemoRemove('reservations', onRemoved);
  return (
    <div className="mx-[18px] mt-3 rounded-card border border-solid border-info-line bg-info-bg px-3 py-2.5 flex flex-col gap-2">
      <span className="flex items-center gap-2 flex-wrap text-meta text-ink">
        <Icon name="FlaskConical" size="sm" />
        {sample ? <SampleMark kind={sample} /> : <span className="font-semibold">Real reservation</span>}
        <span className="text-muted-ink">{sample === 'demo' ? 'Sample data, in Demo mode only.' : 'Changes here save as sample data; the real reservation stays as it is.'}</span>
      </span>
      <span className="flex gap-2 flex-wrap">
        <Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>{sample === 'demo' ? 'Edit sample' : 'Edit in Demo mode'}</Button>
        {sample && <Button size="sm" variant="tertiary" onClick={() => remove.ask(id, sample)}>{sample === 'demo' ? 'Remove sample' : 'Undo Demo mode changes'}</Button>}
      </span>
      {editing && <DemoReservationModal id={id} initial={values} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />}
      {remove.dialog}
    </div>
  );
}

/** A review's Demo mode actions: edit it as sample data (a real review gets a demo copy), remove a sample, or undo. */
export function DemoReviewActions({ review, onChanged }: {
  review: { id: string; sample?: 'demo' | 'shadow'; unitId: string | null; channel: string; rating: number; comment: string | null; reply: string | null; reviewedAt: string };
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const remove = useDemoRemove('reviews', onChanged);
  const r = review;
  return (
    <span className="flex gap-2 flex-wrap">
      <Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>{r.sample === 'demo' ? 'Edit sample' : 'Edit in Demo mode'}</Button>
      {r.sample && <Button size="sm" variant="tertiary" onClick={() => remove.ask(r.id, r.sample!)}>{r.sample === 'demo' ? 'Remove sample' : 'Undo Demo mode changes'}</Button>}
      {editing && (
        <DemoReviewModal id={r.id} initial={{ unitId: r.unitId ?? '', channel: r.channel, rating: Math.round(r.rating), comment: r.comment ?? '', reply: r.reply ?? '', reviewedAt: r.reviewedAt }}
          onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
      )}
      {remove.dialog}
    </span>
  );
}
