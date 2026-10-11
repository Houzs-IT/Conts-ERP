import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useNow } from '../lib/useMedia';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import {
  TimeLeft, KIND_LABEL, MediaGrid, MediaDrop, uploadTo, Checklist, ReportDamageModal, Segmented, hm, dayLabel, mytDay, type ChecklistItem, type MediaItem,
} from '../components/ops/OpsUi';
import { StatusBadge } from '../components/StatusBadge';

/* GET /api/field/tasks (functions/api/field/tasks.ts) */
interface Job {
  id: string; unitId: string; kind: string; state: string; unit: { unitNumber: string; propertyName: string }; buildingId: string;
  addressLine: string; accessInstruction: string | null; work: string; startedAt: string | null; completedAt: string | null; readiness: string; done: boolean;
  photoCount: number; checklist: { done: number; total: number }; guestOut: boolean;
  previous: { guestName: string; checkOutTime: string; state: string } | null;
  next: { guestName: string; checkInTime: string; checkInAt: string } | null;
}
interface Detail { checklist: ChecklistItem[]; media: MediaItem[]; access: { id: string; label: string; instruction: string }[] }

/** The cleaner's phone: today's jobs grouped by building, each with the guest leaving and arriving, the time left,
 *  and the steps: guest left, start, checklist, photos and videos, complete. One column, 44px targets. */
export default function FieldTodayPage() {
  const now = useNow(30000);
  const [pick, setPick] = useState<'today' | 'tomorrow'>('today');
  const date = pick === 'today' ? mytDay(0) : mytDay(1);
  const { data, loading, error, reload } = useApi<{ rows: Job[] }>(`/field/tasks?date=${date}`);
  const [open, setOpen] = useState<string | null>(null);
  const jobs = data?.rows ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; jobs: Job[] }>();
    for (const j of jobs) { const g = m.get(j.buildingId) ?? { name: j.unit.propertyName, jobs: [] }; g.jobs.push(j); m.set(j.buildingId, g); }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [jobs]);
  const left = jobs.filter(j => !j.done).length;

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">My jobs</h1>
          <div className="text-copy text-muted-ink">{dayLabel(date)} · {data ? `${left} to do, ${jobs.length - left} done` : 'Loading'}</div>
        </div>
        <Segmented label="Day" value={pick} onChange={setPick} options={[{ value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }]} />
      </div>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={140} /><Skeleton height={140} /></>
        : jobs.length === 0 ? <EmptyState icon="Sparkles" title={`No jobs for you on ${dayLabel(date)}.`} body="New jobs appear here as soon as the office gives them to you." />
        : groups.map(([id, g]) => (
          <section key={id} className="flex flex-col gap-2">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-baseline gap-2">{g.name}<span className="text-meta text-muted-ink font-normal tabular-nums">{g.jobs.filter(j => j.done).length} of {g.jobs.length} done</span></h2>
            {g.jobs.map(j => <JobCard key={j.id} job={j} now={now} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} onChanged={reload} />)}
          </section>
        ))}
    </>
  );
}

function JobCard({ job: j, now, open, onToggle, onChanged }: { job: Job; now: number; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [damage, setDamage] = useState(false);
  const detail = useApi<Detail>(open ? `/housekeeping/tasks/${j.id}` : null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const items = checklist ?? detail.data?.checklist ?? null;
  const files = detail.data?.media.length ?? j.photoCount;
  const isClean = ['turnover', 'deep_clean', 'light_clean'].includes(j.kind);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok }); onChanged(); detail.reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Check your signal and try again.') }); }
    finally { setBusy(null); }
  }
  const status = j.done ? <StatusBadge tone="success">Done</StatusBadge> : j.state === 'in_progress' ? <StatusBadge tone="info">Cleaning</StatusBadge>
    : j.guestOut ? <StatusBadge tone="gold">Guest out, ready to clean</StatusBadge> : j.previous ? <StatusBadge tone="neutral">Guest still in</StatusBadge> : <StatusBadge tone="warning">To do</StatusBadge>;

  return (
    <article className={cx('bg-card rounded-card border border-solid overflow-hidden', open ? 'border-gold' : 'border-line')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-4 flex flex-col gap-2 cursor-pointer">
        <div className="flex items-center gap-2">
          <b className="text-heading flex-1">{j.unit.unitNumber}<span className="text-copy text-muted-ink font-normal"> · {isClean ? `${KIND_LABEL[j.kind] ?? j.kind} clean` : j.work}</span></b>
          {status}
        </div>
        <div className="grid grid-cols-2 gap-2 text-copy">
          <div className="rounded-control bg-muted px-2.5 py-2"><span className="block text-meta text-muted-ink">Leaving</span>{j.previous ? <><b>{j.previous.checkOutTime}</b> {j.previous.guestName}</> : <span className="text-muted-ink">No departing guest</span>}</div>
          <div className="rounded-control bg-gold-tint px-2.5 py-2"><span className="block text-meta text-muted-ink">Arriving</span>{j.next ? <><b>{j.next.checkInTime}</b> {j.next.guestName}</> : <span className="text-muted-ink">No check-in</span>}</div>
        </div>
        {j.next && !j.done && <div className="text-copy">Time left <TimeLeft at={j.next.checkInAt} now={now} /></div>}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4 [border-top:1px_solid_var(--color-line-soft)] pt-3">
          {(detail.data?.access.length ? detail.data.access : j.accessInstruction ? [{ id: 'a', label: 'Access', instruction: j.accessInstruction }] : []).map(a => (
            <div key={a.id} className="rounded-control bg-muted p-2.5 text-copy"><b>{a.label}</b><div className="text-muted-ink">{a.instruction}</div></div>
          ))}
          {j.addressLine && <div className="text-meta text-muted-ink">{j.addressLine}</div>}

          {!j.done && (
            <div className="grid grid-cols-2 gap-2">
              {j.previous && !j.guestOut && <Button size="touch" variant="secondary" loading={busy === 'left'} onClick={() => void act('left', () => api.post('/housekeeping/guest-left', { taskId: j.id }), 'Guest out. Ready to clean.')}>Guest left</Button>}
              {j.state !== 'in_progress' && <Button size="touch" variant="secondary" loading={busy === 'start'} onClick={() => void act('start', () => api.post(`/housekeeping/tasks/${j.id}/start`, {}), 'Started.')}>Start</Button>}
            </div>
          )}

          {isClean && (
            <section className="flex flex-col gap-1">
              <h3 className="m-0 text-copy font-semibold">Checklist {items && <span className="text-muted-ink font-normal">{items.filter(c => c.done).length} of {items.length}</span>}</h3>
              {items ? <Checklist taskId={j.id} items={items} readOnly={j.done} onChange={setChecklist} /> : <Skeleton height={120} />}
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-copy font-semibold">Proof of work <span className="text-muted-ink font-normal">{files} {files === 1 ? 'file' : 'files'}{!j.done && ', at least 1 to complete'}</span></h3>
            {detail.data && <MediaGrid items={detail.data.media} cols={3} />}
            {!j.done && <MediaDrop upload={uploadTo(`/tasks/${j.id}/photos`)} onDone={() => { detail.reload(); onChanged(); }} label="Take or add photos and videos" />}
          </section>

          <Button size="touch" variant="secondary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setDamage(true)}>Report damage</Button>
          {!j.done && (
            <Button size="touch" variant="primary" loading={busy === 'done'} disabled={files === 0} disabledReason="Add at least one photo or video first."
              onClick={() => void act('done', () => api.post(`/tasks/${j.id}/complete`, { photoIds: [] }), `${j.unit.unitNumber} done. Thank you.`)}>
              Mark complete
            </Button>
          )}
          {j.done && <span className="text-copy text-success">Finished{j.completedAt ? ` at ${hm(j.completedAt)}` : ''}{j.startedAt ? ` (started ${hm(j.startedAt)})` : ''}.</span>}
        </div>
      )}
      {damage && <ReportDamageModal unitId={j.unitId} unitLabel={`${j.unit.propertyName} ${j.unit.unitNumber}`} taskId={j.id} onClose={() => setDamage(false)}
        onDone={() => { setDamage(false); toast({ tone: 'success', title: 'Damage reported.', body: 'The office has it as a maintenance job.' }); }} />}
    </article>
  );
}
