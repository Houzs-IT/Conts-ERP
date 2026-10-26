import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { EmptyState, Skeleton } from '../components/States';
import { AttachmentLabel, MediaGallery, FileList, type MediaItem } from '../components/Attachments';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { runEach, skippedNote } from '../lib/bulk';
import { CATEGORY, FormRow, INPUT, TEXTAREA, ProblemPhotos, Segmented, hm, uploadTo, usePickedMedia } from '../components/ops/OpsUi';
import { statusOf } from '../lib/status';
import { usePortalText, usePortalDates, wordFor } from '../lib/portalI18n';

/* GET /api/field/repairs and /api/field/repairs/:id (functions/api/field/repairs*.ts). No amounts: the server never sends any. */
interface Repair {
  id: string; unitId: string; unitNumber: string; propertyName: string; buildingId: string; addressLine: string;
  title: string; detail: string | null; category: string; urgency: string; jobType?: string; dueOn?: string | null; state: string; source: string;
  reportedAt: string; reporter: string | null; assigneeName: string | null;
  startedAt: string | null; endedAt: string | null; resolvedAt: string | null; blocksUnit: boolean; waitingForOwner: boolean;
  beforeCount: number; afterCount: number; documentCount: number;
  windows: { id: string; startsAt: string; endsAt: string; note: string | null; guestStaying: boolean }[];
}
interface ListPayload { mine: Repair[]; open: Repair[]; mayPick: boolean }
interface FileDoc { id: string; kind: string; url: string; fileName: string; byteSize: number; uploadedAt: string; uploader: string | null }
interface Detail {
  job: Repair; mine: boolean; mayPick: boolean; media: (MediaItem & { stage: 'before' | 'after' })[]; files: FileDoc[];
  access: { id: string; label: string; instruction: string }[]; parking?: string | null; notes: { note: string; by: string; at: string; done: boolean }[];
}

/** The repair's step in the words of the Maintenance screen (status vocabulary "maintenance"). */
function progress(r: Repair): string {
  if (r.state === 'resolved') return 'done';
  if (r.waitingForOwner) return 'awaiting_owner';
  if (r.endedAt) return 'repair_finished';
  if (r.startedAt) return 'in_progress';
  return r.assigneeName ? 'assigned' : 'new';
}

/** A technician's phone: the repair jobs that are theirs, the open ones nobody has (pick one up), and a way to report a
 *  new problem. One column, 44px targets; a job opens full screen with its action pinned at the bottom. */
export default function FieldRepairsPage({ above, linkRepair, onLinked }: { above?: ReactNode; linkRepair?: string | null; onLinked?: () => void }) {
  const { data, loading, error, reload } = useApi<ListPayload>('/field/repairs');
  const [tab, setTab] = useState<'mine' | 'open'>('mine');
  const [open, setOpen] = useState<string | null>(null);
  // A notice tapped in the bell: open that repair (the sheet loads it by id and says so if it is not theirs).
  useEffect(() => { if (linkRepair) { setTab('mine'); setOpen(linkRepair); onLinked?.(); } }, [linkRepair]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reporting, setReporting] = useState(false);
  const toast = useToast();
  const t = usePortalText();
  const tr = t.repairs;
  const mine = data?.mine ?? [];
  const todo = mine.filter(r => r.state !== 'resolved' && !r.endedAt);
  const finished = mine.filter(r => r.state === 'resolved' || r.endedAt);
  const pool = data?.open ?? [];
  const rows = tab === 'mine' ? todo : pool;

  return (
    <>
      {above}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-title font-semibold">{tr.title}</h1>
          <div className="text-copy text-muted-ink">{data ? tr.summary(tr.jobs(todo.length), data.mayPick ? pool.length : null) : t.common.loading}</div>
        </div>
        {data?.mayPick && (
          <Segmented label={tr.which} className="[&>button]:h-11" value={tab} onChange={setTab} options={[
            { value: 'mine', label: <>{tr.mine} <span className="text-muted-ink tabular-nums">{todo.length}</span></> },
            { value: 'open', label: <>{tr.open} <span className="text-muted-ink tabular-nums">{pool.length}</span></> },
          ]} />
        )}
      </div>
      <Button size="touch" variant="secondary" icon={<Icon name="TriangleAlert" size="sm" />} onClick={() => setReporting(true)}>{tr.reportProblem}</Button>
      {error && <StaleBanner message={error} onRetry={reload} />}
      {loading && !data ? <><Skeleton height={120} /><Skeleton height={120} /></>
        : rows.length === 0 && (tab === 'open' || finished.length === 0)
          ? <EmptyState icon="Wrench" title={tab === 'open' ? tr.noOpen : tr.noMine}
            body={tab === 'open' ? tr.noOpenBody : data?.mayPick ? tr.noMineBodyPick : tr.noMineBody} />
          : (
            <div className="flex flex-col gap-2.5">
              {rows.map(r => <RepairCard key={r.id} r={r} offer={tab === 'open'} onOpen={() => setOpen(r.id)} />)}
              {tab === 'mine' && finished.length > 0 && (
                <>
                  <h2 className="m-0 mt-2 text-[16px] font-semibold">{tr.finished}</h2>
                  {finished.map(r => <RepairCard key={r.id} r={r} onOpen={() => setOpen(r.id)} />)}
                </>
              )}
            </div>
          )}
      {open && <RepairSheet id={open} onClose={() => setOpen(null)} onChanged={reload} onPicked={() => setTab('mine')} />}
      {reporting && <ReportSheet onClose={() => setReporting(false)}
        onDone={() => { setReporting(false); reload(); toast({ tone: 'success', title: tr.problemReported, body: t.jobs.officeHasIt }); }} />}
    </>
  );
}

function RepairCard({ r, offer, onOpen }: { r: Repair; offer?: boolean; onOpen: () => void }) {
  const t = usePortalText();
  const tr = t.repairs;
  const { short, stamp } = usePortalDates();
  const next = r.windows.find(w => Date.parse(w.endsAt) > Date.now());
  return (
    <button type="button" onClick={onOpen}
      className={cx('w-full text-left bg-card rounded-card border border-solid p-4 flex flex-col gap-1.5 cursor-pointer min-h-[44px]', r.urgency === 'urgent' && r.state !== 'resolved' ? 'border-danger-line' : 'border-line')}>
      <span className="flex items-center gap-2">
        <b className="text-heading flex-1 min-w-0 truncate">{r.unitNumber}<span className="text-copy text-muted-ink font-normal"> · {r.propertyName}</span></b>
        {r.urgency === 'urgent' && r.state !== 'resolved' && <StatusBadge tone="critical">{tr.urgent}</StatusBadge>}
        {r.jobType === 'pass_key' && r.state !== 'resolved' && <StatusBadge tone="info">{tr.passKey}</StatusBadge>}
      </span>
      <span className="text-copy text-ink [overflow-wrap:anywhere]">{r.title}</span>
      <span className="text-meta text-muted-ink">{wordFor(t.category, r.category)} · {tr.reported(stamp(r.reportedAt))}{r.beforeCount ? ` · ${tr.photos(r.beforeCount)}` : ''}</span>
      {r.dueOn && r.state !== 'resolved' && r.jobType !== 'urgent' && <span className="text-meta text-ink">{tr.due(short(r.dueOn))}</span>}
      {next && <span className="text-meta text-ink flex items-center gap-1.5"><Icon name="CalendarClock" size="sm" />{tr.goIn(stamp(next.startsAt), hm(next.endsAt))}</span>}
      <span className="flex gap-1.5 flex-wrap pt-0.5">
        {offer ? <StatusBadge tone="gold">{tr.openToPick}</StatusBadge> : <StatusBadge tone={statusOf('maintenance', progress(r)).tone} label={wordFor(t.repairStatus, progress(r))} dot />}
      </span>
    </button>
  );
}

/* ---------- one job, full screen ---------- */

function RepairSheet({ id, onClose, onChanged, onPicked }: { id: string; onClose: () => void; onChanged: () => void; onPicked: () => void }) {
  const toast = useToast();
  const t = usePortalText();
  const tr = t.repairs;
  const { short, stamp } = usePortalDates();
  const d = useApi<Detail>(`/field/repairs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<'before' | 'after'>('before');
  const [fileKind, setFileKind] = useState('claim');
  const [note, setNote] = useState('');
  const [doneNote, setDoneNote] = useState('');
  const j = d.data?.job;
  const mine = !!d.data?.mine;
  const closed = j?.state === 'resolved';
  const working = mine && !closed;

  // Once the repair has started, the photos being taken are of the finished work.
  const started = !!j?.startedAt;
  useEffect(() => { if (started) setStage('after'); }, [started]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const refresh = () => { d.reload(); onChanged(); };
  async function act(key: string, fn: () => Promise<unknown>, ok: string, body?: string) {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok, body }); refresh(); return true; }
    catch (e) { toast({ tone: 'critical', title: t.jobs.notSaved, body: errorMessage(e, t.jobs.checkSignal) }); refresh(); return false; }
    finally { setBusy(null); }
  }
  async function uploadFiles(list: FileList) {
    setBusy('files');
    const res = await runEach(Array.from(list), f => uploadTo(`/maintenance/issues/${id}/documents`, { kind: fileKind })(f), f => f.name);
    setBusy(null);
    toast({ tone: res.ok === 0 ? 'critical' : res.failed.length ? 'warning' : 'success', title: res.ok ? tr.filesAdded(res.ok) : tr.nothingAdded, body: skippedNote(res.failed) || undefined });
    refresh();
  }

  const media = d.data?.media ?? [];
  const counts = { before: media.filter(m => m.stage === 'before').length, after: media.filter(m => m.stage === 'after').length };
  const windows = j?.windows ?? [];

  let footer: ReactNode = null;
  if (j && d.data?.mayPick) {
    footer = <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Hand" size="sm" />} loading={busy === 'pick'}
      onClick={() => void act('pick', () => api.post(`/field/repairs/${id}/pick`, {}), tr.picked, tr.pickedBody).then(ok => { if (ok) onPicked(); })}>{tr.pickUp}</Button>;
  } else if (j && working && j.waitingForOwner) {
    footer = <p className="m-0 text-copy text-warning text-center">{tr.waitingOwner}</p>;
  } else if (j && working && !j.startedAt) {
    footer = <Button size="touch" variant="primary" className="w-full" icon={<Icon name="Play" size="sm" />} loading={busy === 'start'}
      onClick={() => void act('start', () => api.post(`/maintenance/issues/${id}/start`, {}), tr.started, tr.startedBody)}>{tr.start}</Button>;
  } else if (j && working && !j.endedAt) {
    footer = (
      <div className="flex flex-col gap-2">
        <input className={cx(INPUT, 'h-11')} value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder={tr.whatYouDid} aria-label={tr.whatYouDidLabel} maxLength={1000} />
        <Button size="touch" variant="primary" className="w-full" icon={<Icon name="CircleCheck" size="sm" />} loading={busy === 'end'}
          disabled={counts.after === 0} disabledReason={tr.needAfter}
          onClick={() => void act('end', () => api.post(`/maintenance/issues/${id}/end`, { note: doneNote.trim() || undefined }), tr.markedDone, tr.markedDoneBody)}>{tr.markDone}</Button>
        {counts.after === 0 && <span className="text-meta text-muted-ink text-center">{tr.needAfterHint}</span>}
      </div>
    );
  } else if (j && working && j.endedAt) {
    footer = <p className="m-0 text-copy text-success text-center">{tr.doneAt(hm(j.endedAt), short(j.endedAt.slice(0, 10)))}</p>;
  } else if (j && closed) {
    footer = <p className="m-0 text-copy text-muted-ink text-center">{tr.closed(j.resolvedAt ? short(j.resolvedAt.slice(0, 10)) : null)}</p>;
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={j ? `${j.unitNumber} ${j.title}` : tr.job} data-repair-sheet
      className="fixed inset-0 z-[55] bg-page flex flex-col">
      <header className="flex-none bg-card [border-bottom:1px_solid_var(--color-line)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={onClose} aria-label={tr.back} className="w-11 h-11 grid place-items-center rounded-control cursor-pointer text-ink hover:bg-muted">
          <Icon name="ChevronLeft" size="nav" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-heading font-semibold truncate">{j ? `${j.unitNumber} · ${j.propertyName}` : tr.job}</div>
          {j && <div className="text-meta text-muted-ink truncate">{j.title}</div>}
        </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto px-4 py-4 flex flex-col gap-4 text-copy">
          {d.error && <StaleBanner message={d.error} onRetry={d.reload} />}
          {!j ? <><Skeleton height={120} /><Skeleton height={160} /></> : (
            <>
              <div className="flex gap-1.5 flex-wrap">
                {j.urgency === 'urgent' && !closed && <StatusBadge tone="critical">{tr.urgent}</StatusBadge>}
                {j.jobType === 'pass_key' && !closed && <StatusBadge tone="info">{tr.passKey}</StatusBadge>}
                {j.dueOn && !closed && j.jobType !== 'urgent' && <StatusBadge tone="neutral">{tr.due(short(j.dueOn))}</StatusBadge>}
                <StatusBadge tone="neutral">{wordFor(t.category, j.category)}</StatusBadge>
                {d.data!.mayPick ? <StatusBadge tone="gold">{tr.openToPick}</StatusBadge> : <StatusBadge tone={statusOf('maintenance', progress(j)).tone} label={wordFor(t.repairStatus, progress(j))} dot />}
                {j.blocksUnit && <StatusBadge tone="critical">{tr.unitBlocked}</StatusBadge>}
              </div>

              <section className="flex flex-col gap-1">
                <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{j.title}</h2>
                {j.detail && <p className="m-0 text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{j.detail}</p>}
                <span className="text-meta text-muted-ink">{tr.reportedBy(`${j.reporter ?? wordFor(tr.source, j.source)}${j.reporter && j.source !== 'staff' ? ` (${wordFor(tr.source, j.source)})` : ''}`, stamp(j.reportedAt))}</span>
              </section>

              <InfoRow icon="MapPin" label={tr.where}>
                <b>{j.propertyName} {j.unitNumber}</b>
                {j.addressLine && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.addressLine)}`} target="_blank" rel="noopener noreferrer"
                  className="min-h-11 flex items-center gap-2 text-ink"><span className="flex-1 min-w-0 underline underline-offset-2">{j.addressLine}</span><span className="text-meta text-muted-ink">{tr.openMap}</span></a>}
              </InfoRow>
              {mine ? (
                d.data!.access.length ? d.data!.access.map(a => (
                  <InfoRow key={a.id} icon="KeyRound" label={a.label}><span className="whitespace-pre-wrap">{a.instruction}</span></InfoRow>
                )) : <InfoRow icon="KeyRound" label={tr.gettingIn}><span className="text-muted-ink">{tr.noAccess}</span></InfoRow>
              ) : d.data!.mayPick && <InfoRow icon="KeyRound" label={tr.gettingIn}><span className="text-muted-ink">{tr.shownOnPick}</span></InfoRow>}
              {mine && d.data!.parking && <InfoRow icon="Car" label={t.jobs.carPark}>{d.data!.parking}</InfoRow>}
              <InfoRow icon="CalendarClock" label={tr.whenGoIn}>
                {windows.length ? windows.map(w => (
                  <span key={w.id} className={cx('block', Date.parse(w.endsAt) < Date.now() && 'text-muted-ink')}>
                    <b className="tabular-nums">{tr.span(stamp(w.startsAt), w.startsAt.slice(0, 10) === w.endsAt.slice(0, 10) ? hm(w.endsAt) : stamp(w.endsAt))}</b>
                    {w.note && <span className="text-muted-ink"> · {w.note}</span>}
                    {Date.parse(w.endsAt) < Date.now() && <span className="text-muted-ink"> {tr.over}</span>}
                    {w.guestStaying && <span className="block text-meta text-warning">{tr.guestStaying}</span>}
                  </span>
                )) : <span className="text-muted-ink">{tr.noTime}</span>}
              </InfoRow>

              <section className="flex flex-col gap-2.5">
                <AttachmentLabel title={tr.media} count={media.length} hint={working && j.startedAt && counts.after === 0 ? tr.atLeastAfter : undefined} />
                <Segmented label={tr.beforeOrAfter} className="[&>button]:h-11" value={stage} onChange={setStage} options={[
                  { value: 'before', label: <>{tr.before} <span className="text-muted-ink tabular-nums">{counts.before}</span></> },
                  { value: 'after', label: <>{tr.after} <span className="text-muted-ink tabular-nums">{counts.after}</span></> },
                ]} />
                <MediaGallery key={stage} items={media.filter(m => m.stage === stage)} upload={working ? uploadTo(`/maintenance/issues/${id}/photos`, { kind: stage }) : undefined}
                  onDone={refresh} addLabel={stage === 'before' ? tr.addBefore : tr.addAfter}
                  emptyText={stage === 'before' ? tr.noBefore : tr.noAfter} />
              </section>

              {(working || d.data!.files.length > 0) && (
                <section className="flex flex-col gap-2">
                  <AttachmentLabel title={tr.claims} count={d.data!.files.length} />
                  {working && <span className="text-meta text-muted-ink">{tr.claimsHint}</span>}
                  {working && (
                    <FormRow label={tr.fileKindLabel}>
                      <select className={cx(INPUT, 'h-11')} value={fileKind} onChange={e => setFileKind(e.target.value)}>
                        {['claim', 'receipt', 'invoice', 'pod'].map(k => <option key={k} value={k}>{wordFor(tr.fileKind, k)}</option>)}
                      </select>
                    </FormRow>
                  )}
                  <FileList files={d.data!.files.map(f => ({ id: f.id, name: f.fileName, href: f.url, size: f.byteSize, label: `${f.kind in tr.fileKind ? wordFor(tr.fileKind, f.kind) : tr.fileKind.other} · ${short(f.uploadedAt.slice(0, 10))}` }))}
                    add={working ? { label: tr.addFile, hint: tr.addFileHint, accept: 'image/*,application/pdf', multiple: true, busy: busy === 'files', onPick: fl => void uploadFiles(fl) } : undefined} />
                </section>
              )}

              {(mine || d.data!.notes.length > 0) && (
                <section className="flex flex-col gap-2">
                  <AttachmentLabel title={tr.notes} count={d.data!.notes.length} />
                  {d.data!.notes.map((n, k) => (
                    <div key={k} className="rounded-control bg-muted px-3 py-2">
                      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{n.note}</span>
                      <span className="block text-meta text-muted-ink">{n.by} · {stamp(n.at)}{n.done ? ` · ${tr.whenFinishing}` : ''}</span>
                    </div>
                  ))}
                  {working && (
                    <div className="flex flex-col gap-2">
                      <textarea className={TEXTAREA} value={note} onChange={e => setNote(e.target.value)} placeholder={tr.notePh} aria-label={tr.newNote} maxLength={1000} />
                      <Button size="touch" variant="secondary" disabled={!note.trim()} disabledReason={tr.writeFirst} loading={busy === 'note'}
                        onClick={() => void act('note', () => api.post(`/field/repairs/${id}/note`, { note: note.trim() }), tr.noteAdded).then(ok => { if (ok) setNote(''); })}>{tr.addNote}</Button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {footer && (
        <footer className="flex-none bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="max-w-[560px] mx-auto">{footer}</div>
        </footer>
      )}
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-control bg-card border border-solid border-line px-3 py-2.5">
      <span className="text-muted-ink pt-0.5"><Icon name={icon} size="sm" /></span>
      <div className="flex-1 min-w-0 [overflow-wrap:anywhere]"><span className="block text-meta text-muted-ink">{label}</span>{children}</div>
    </div>
  );
}

/* ---------- report a new problem ---------- */

interface UnitName { id: string; unitNumber: string; propertyName: string }

/** The office's "Add maintenance job" form on the phone: building, unit, the problem, its category and urgency, and
 *  photos of it. It lands on the Maintenance screen as an open job. */
function ReportSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const units = useApi<{ data: UnitName[] }>('/field/units');
  const toast = useToast();
  const t = usePortalText();
  const tf = t.repairs.form;
  const picked = usePickedMedia();
  const [f, setF] = useState({ building: '', unitId: '', title: '', category: '', urgency: 'normal', detail: '' });
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ unitId?: string; title?: string; category?: string; form?: string }>({});
  const all = units.data?.data ?? [];
  const buildings = useMemo(() => [...new Set(all.map(u => u.propertyName))], [all]);
  const inBuilding = all.filter(u => u.propertyName === f.building);
  useEffect(() => { if (buildings.length === 1 && !f.building) setF(x => ({ ...x, building: buildings[0] })); }, [buildings, f.building]);

  async function save() {
    const bad = { unitId: f.unitId ? undefined : tf.errUnit, title: f.title.trim() ? undefined : tf.errTitle, category: f.category ? undefined : tf.errKind };
    if (bad.unitId || bad.title || bad.category) { setError(bad); return; }
    setBusy(true); setError({});
    let id: string;
    try {
      id = (await api.post<{ id: string }>('/maintenance/issues', { unitId: f.unitId, title: f.title.trim(), detail: f.detail.trim() || undefined, category: f.category, urgency: f.urgency })).id;
    } catch (e) {
      const fields = e instanceof ApiFailure ? e.fields ?? {} : {};
      setError({ unitId: fields.unitId ?? fields.unitNumber, title: fields.title, category: fields.category, form: fields.title || fields.category ? undefined : errorMessage(e, tf.notSent) });
      setBusy(false); return;
    }
    if (picked.files.length) {
      setSending(true);
      const failed = await picked.send(id);
      if (failed.length) toast({ tone: 'warning', title: tf.someNotAdded, body: tf.notAdded(failed.join(', ')) });
    }
    onDone();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={tf.title} className="fixed inset-0 z-[55] bg-page flex flex-col">
      <header className="flex-none bg-card [border-bottom:1px_solid_var(--color-line)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={onClose} disabled={busy} aria-label={tf.cancel} className="w-11 h-11 grid place-items-center rounded-control cursor-pointer text-ink hover:bg-muted">
          <Icon name="X" size="nav" />
        </button>
        <div className="flex-1 min-w-0 text-heading font-semibold">{tf.title}</div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto px-4 py-4 flex flex-col gap-3.5">
          {units.error && <StaleBanner message={units.error} onRetry={units.reload} />}
          <FormRow label={tf.building}>
            <select className={cx(INPUT, 'h-11')} value={f.building} onChange={e => setF(x => ({ ...x, building: e.target.value, unitId: '' }))}>
              <option value="" disabled>{units.loading ? t.common.loading : tf.pickBuilding}</option>
              {buildings.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </FormRow>
          <FormRow label={tf.unit} error={error.unitId}>
            <select className={cx(INPUT, 'h-11')} value={f.unitId} disabled={!f.building} onChange={e => { setF(x => ({ ...x, unitId: e.target.value })); setError(x => ({ ...x, unitId: undefined })); }}>
              <option value="" disabled>{f.building ? tf.pickUnit : tf.pickBuildingFirst}</option>
              {inBuilding.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
            </select>
          </FormRow>
          <FormRow label={tf.what} error={error.title}>
            <input className={cx(INPUT, 'h-11')} value={f.title} onChange={e => { setF(x => ({ ...x, title: e.target.value })); setError(x => ({ ...x, title: undefined })); }} placeholder={tf.whatPh} maxLength={160} />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label={tf.kind} error={error.category}>
              <select className={cx(INPUT, 'h-11')} value={f.category} onChange={e => { setF(x => ({ ...x, category: e.target.value })); setError(x => ({ ...x, category: undefined })); }}>
                <option value="" disabled>{tf.pickOne}</option>
                {Object.keys(CATEGORY).map(v => <option key={v} value={v}>{wordFor(t.category, v)}</option>)}
              </select>
            </FormRow>
            <FormRow label={tf.urgency}>
              <select className={cx(INPUT, 'h-11')} value={f.urgency} onChange={e => setF(x => ({ ...x, urgency: e.target.value }))}>
                <option value="normal">{tf.normal}</option><option value="urgent">{tf.urgent}</option>
              </select>
            </FormRow>
          </div>
          <FormRow label={tf.details}>
            <textarea className={TEXTAREA} value={f.detail} onChange={e => setF(x => ({ ...x, detail: e.target.value }))} placeholder={tf.detailsPh} maxLength={2000} />
          </FormRow>
          <ProblemPhotos picked={picked} sending={sending} />
          {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
        </div>
      </div>
      <footer className="flex-none bg-card [border-top:1px_solid_var(--color-line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="max-w-[560px] mx-auto"><Button size="touch" variant="primary" className="w-full" loading={busy} onClick={() => void save()}>{tf.send}</Button></div>
      </footer>
    </div>
  );
}
