import { useState, type FormEvent } from 'react';
import { CentreModal } from './booking/BookingDrawer';
import { Button } from './Button';
import { Select } from './Select';
import { useToast } from './Toast';
import { useCleaners } from '../lib/useCleaners';
import { api, notifyFailure } from '../lib/api';
import { plural } from '../lib/format';

/** One cleaner for many cleans: ticked cleaning tasks, or the open turnover cleans of ticked bookings
 *  (POST /api/tasks/bulk-assign). A clean that clashes with the cleaner's other work is skipped unless "anyway". */
export function BulkAssignCleaner({ taskIds, reservationIds, onClose, onDone }: {
  taskIds?: string[]; reservationIds?: string[]; onClose: () => void; onDone: () => void;
}) {
  const { cleaners } = useCleaners();
  const toast = useToast();
  const [cleanerId, setCleanerId] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = (taskIds?.length ?? 0) + (reservationIds?.length ?? 0);
  const what = reservationIds?.length ? plural(n, 'reservation') : plural(n, 'cleaning job');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cleanerId) return;
    setBusy(true);
    try {
      const r = await api.post<{ assigned: number; skipped: { id: string; reason: string }[]; cleaner: string }>('/tasks/bulk-assign', { taskIds, reservationIds, cleanerId, force });
      // The API's clash reason ends with a question meant for a single assign; here the checkbox is the answer.
      const reasons = [...new Set(r.skipped.map(s => s.reason.replace(/\s*Assign anyway\?$/, '').replace(/\.$/, '')))].slice(0, 2).join('; ');
      const overlapHint = r.skipped.some(s => /overlapping/.test(s.reason)) ? ' Tick "Assign even where it overlaps" to give them anyway.' : '';
      toast({
        tone: r.skipped.length ? 'warning' : 'success',
        title: r.assigned ? `${plural(r.assigned, 'cleaning job')} given to ${r.cleaner}.` : 'Nothing assigned.',
        body: r.skipped.length ? `${plural(r.skipped.length, 'cleaning job')} left alone: ${reasons}.${overlapHint}` : undefined,
      });
      onDone();
    } catch (err) { notifyFailure(err); }
    setBusy(false);
  }
  return (
    <CentreModal title="Assign a cleaner" sub={`${what} ticked.${reservationIds?.length ? ' Each reservation\'s open cleaning job goes to the cleaner.' : ''}`} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px]">
        <Select label="Cleaner" showLabel size="md" value={cleanerId} onChange={setCleanerId} placeholder="Pick a cleaner"
          options={cleaners.map(c => ({ value: c.id, label: c.name, hint: c.employmentType === 'outsourced' ? (c.vendorName ?? 'Outsourced') : `${c.busy} open today` }))} />
        <label className="flex items-start gap-2 text-copy cursor-pointer">
          <input type="checkbox" className="w-4 h-4 mt-[2px]" checked={force} onChange={e => setForce(e.target.checked)} />
          <span>Assign even where it overlaps the cleaner's other work</span>
        </label>
        <div className="flex justify-end gap-[9px]">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!cleanerId} disabledReason="Pick a cleaner.">Assign</Button>
        </div>
      </form>
    </CentreModal>
  );
}
