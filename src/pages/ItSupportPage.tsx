import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { FileDropRow } from '../components/Attachments';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { refreshItUnread } from '../lib/itSupport';
import { statusLabel } from '../lib/status';
import { dateTime, relative } from '../lib/format';

/**
 * IT Support: report a problem with the system to IT, follow it, reply, and confirm the fix. Every desk role has it
 * and sees only its own requests (the server reads who is asking from the session; functions/_lib/itHub.ts).
 *
 * One screen, three views, chosen by the address so a link can open any of them:
 *   the list (default), ?new=1 the form (&from=<address> fills in the page the problem is on), ?request=CONTS-0001.
 *
 * A request that could not be loaded is shown as that. "Nothing sent yet" is drawn only when the server answered so.
 */
interface RequestRow {
  code: string; type: string; priority: string; status: string; title: string;
  created_at: string; updated_at: string; assignee_name: string | null; unread: boolean;
}
interface FileRef { id: number; event_id: number; filename: string; mime: string; size: number }
interface Step {
  id: number; kind: 'created' | 'comment' | 'status' | 'assign' | 'priority' | 'type';
  author_kind: 'reporter' | 'developer' | 'system'; author_name: string;
  body: string | null; from_value: string | null; to_value: string | null; created_at: string; attachments: FileRef[];
}
interface Detail {
  ticket: { code: string; type: string; priority: string; status: string; title: string; description: string; page_url: string | null; assignee_name: string | null; created_at: string; updated_at: string };
  events: Step[];
}

const KINDS = [{ value: 'bug', label: 'Something is not working' }, { value: 'development', label: 'Ask for a change' }];
const URGENCY = [
  { value: 'urgent', label: 'Urgent: work has stopped' }, { value: 'high', label: 'High' },
  { value: 'medium', label: 'Normal' }, { value: 'low', label: 'Low' },
];
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/*,video/mp4,video/quicktime,application/pdf';
const TEXTAREA = 'w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y';

/** IT Support answered that it is not set up here, as opposed to failing. */
const notConnected = (e: unknown) => e instanceof ApiFailure && e.code === 'NOT_CONFIGURED';

function Files({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [refused, setRefused] = useState<string | null>(null);
  function add(list: FileList) {
    const next = [...files, ...Array.from(list)];
    const big = next.find(f => f.size > MAX_BYTES);
    if (big) { setRefused(`${big.name} is larger than 10 MB.`); return; }
    if (next.length > MAX_FILES) { setRefused(`Attach at most ${MAX_FILES} files.`); return; }
    setRefused(null); onChange(next);
  }
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-copy min-w-0">
          <Icon name="Paperclip" size="sm" />
          <span className="truncate">{f.name}</span>
          <Button type="button" size="sm" variant="tertiary" onClick={() => onChange(files.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      {files.length < MAX_FILES && (
        <FileDropRow label="Add a screenshot or file" hint="Pictures, MP4 or MOV video, or PDF. Up to 5 files, 10 MB each."
          accept={ACCEPT} multiple onPick={add} />
      )}
      {refused && <span className="text-meta text-danger" role="alert">{refused}</span>}
    </div>
  );
}

function NewRequest({ from, onSent, onCancel }: { from: string; onSent: (code: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('bug');
  const [urgency, setUrgency] = useState('medium');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Say in a few words what the problem is.'); return; }
    setError(null); setBusy(true);
    const form = new FormData();
    form.set('title', title.trim());
    form.set('description', description.trim());
    form.set('type', kind);
    form.set('priority', urgency);
    if (from) form.set('page_url', from);
    files.forEach(f => form.append('files', f, f.name));
    try {
      const r = await api.post<{ code: string }>('/it-support/tickets', form);
      toast({ tone: 'success', title: `Sent to IT as ${r.code}.`, body: 'Their reply will appear here.' });
      onSent(r.code);
    } catch (err) {
      setError(errorMessage(err, 'That was not sent. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={send} className="flex flex-col gap-4 px-5 py-5">
        <Field label="What is the problem?" value={title} maxLength={200} onChange={e => setTitle(e.target.value)}
          placeholder="The calendar does not show a new reservation" error={error && !title.trim() ? error : undefined} />
        <div className="flex flex-col gap-[7px]">
          <label htmlFor="it-details" className="text-meta font-medium text-muted-ink">Details</label>
          <textarea id="it-details" value={description} maxLength={10000} rows={6} onChange={e => setDescription(e.target.value)}
            placeholder="What you did, what you expected, and what happened instead." className={TEXTAREA} />
        </div>
        <div className="flex gap-3 flex-wrap">
          <Select label="Kind of request" showLabel size="md" value={kind} onChange={setKind} options={KINDS} />
          <Select label="How urgent" showLabel size="md" value={urgency} onChange={setUrgency} options={URGENCY} />
        </div>
        <div className="flex flex-col gap-[7px]">
          <span className="text-meta font-medium text-muted-ink">Screenshots</span>
          <Files files={files} onChange={setFiles} />
        </div>
        {error && title.trim() && <div className="text-copy text-danger" role="alert">{error}</div>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} disabledReason="Sending">Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Send to IT</Button>
        </div>
      </form>
    </Card>
  );
}

function stepLine(s: Step): string {
  if (s.kind === 'created') return 'sent this request';
  if (s.kind === 'status') return `changed it to ${statusLabel('it_request', s.to_value ?? '')}`;
  if (s.kind === 'assign') return s.to_value ? `gave it to ${s.to_value}` : 'took it off the person handling it';
  return 'replied';
}

function OneRequest({ code }: { code: string }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Detail>(`/it-support/tickets/${encodeURIComponent(code)}`);
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<'' | 'reply' | 'confirm'>('');
  const [failed, setFailed] = useState<string | null>(null);

  // Opening a request marks it read at IT's end, so the menu's count has just changed.
  useEffect(() => { if (data) refreshItUnread(); }, [data]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim() && files.length === 0) { setFailed('Write a reply or attach a file.'); return; }
    setFailed(null); setBusy('reply');
    const form = new FormData();
    if (reply.trim()) form.set('body', reply.trim());
    files.forEach(f => form.append('files', f, f.name));
    try {
      await api.post(`/it-support/tickets/${encodeURIComponent(code)}/replies`, form);
      setReply(''); setFiles([]);
      reload();
    } catch (err) {
      setFailed(errorMessage(err, 'Your reply was not sent. Try again in a moment.'));
    } finally {
      setBusy('');
    }
  }
  async function confirmFixed() {
    setFailed(null); setBusy('confirm');
    try {
      await api.post(`/it-support/tickets/${encodeURIComponent(code)}/confirm`);
      toast({ tone: 'success', title: `${code} is closed.`, body: 'Thank you for confirming.' });
      reload();
    } catch (err) {
      setFailed(errorMessage(err, 'That was not saved. Try again in a moment.'));
    } finally {
      setBusy('');
    }
  }

  if (!data) {
    if (loading) return <Card><TableSkeleton rows={4} cols={2} /></Card>;
    return <EmptyState icon="LifeBuoy" title="This IT request could not be opened" body={error ?? 'Try again in a moment.'} action={{ label: 'Try again', onClick: reload }} forceAction />;
  }
  const t = data.ticket;
  const closed = t.status === 'closed' || t.status === 'rejected';
  return (
    <>
      {error && <StaleBanner message={`Showing what was last loaded. ${error}`} onRetry={reload} />}
      <Card>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-copy font-semibold tabular-nums">{t.code}</span>
            <StatusBadge entity="it_request" value={t.status} />
            <StatusBadge entity="it_urgency" value={t.priority} size="sm" dot={false} />
            <span className="text-meta text-muted-ink">{t.assignee_name ? `Handled by ${t.assignee_name}` : 'Not picked up yet'}</span>
          </div>
          <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{t.title}</h2>
          {t.description && <p className="m-0 text-copy leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]">{t.description}</p>}
          {t.status === 'resolved' && (
            <div className="flex items-center gap-3 flex-wrap bg-success-bg rounded-control px-3 py-2.5">
              <span className="text-copy flex-1 min-w-[220px]">IT has marked this as done. If it is fixed, confirm to close it. If not, reply below and it goes back to IT.</span>
              <Button size="sm" variant="primary" loading={busy === 'confirm'} onClick={confirmFixed}>Yes, it is fixed</Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 px-5 py-4">
          {data.events.map(s => (
            <div key={s.id} className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-copy font-semibold">{s.author_kind === 'reporter' ? 'You' : s.author_name}</span>
                <span className="text-copy text-muted-ink">{stepLine(s)}</span>
                <span className="text-meta text-muted-ink" title={dateTime(s.created_at)}>{relative(s.created_at)}</span>
              </div>
              {s.body && (
                <p className={`m-0 text-copy leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-control px-3 py-2.5 ${s.author_kind === 'reporter' ? 'bg-muted' : 'bg-info-bg'}`}>{s.body}</p>
              )}
              {s.attachments.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {s.attachments.map(a => (
                    <a key={a.id} href={`/api/it-support/attachments/${a.id}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-meta text-ink border border-solid border-line rounded-control px-2 py-1 no-underline hover:bg-muted">
                      <Icon name="Paperclip" size="sm" /> {a.filename}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        {closed ? (
          <div className="px-5 py-4 text-copy text-muted-ink">This request is closed. If the problem is back, report it again.</div>
        ) : (
          <form onSubmit={send} className="flex flex-col gap-3 px-5 py-4">
            <textarea value={reply} maxLength={10000} rows={3} onChange={e => setReply(e.target.value)}
              aria-label="Reply to IT" placeholder="Reply to IT" className={TEXTAREA} />
            <Files files={files} onChange={setFiles} />
            {failed && <div className="text-copy text-danger" role="alert">{failed}</div>}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={busy === 'reply'}>Send reply</Button>
            </div>
          </form>
        )}
        {closed && failed && <div className="px-5 pb-4 text-copy text-danger" role="alert">{failed}</div>}
      </Card>
    </>
  );
}

function List({ onOpen, onNew }: { onOpen: (code: string) => void; onNew: () => void }) {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ tickets: RequestRow[] }>('/it-support/tickets')
      .then(r => { setRows(r.tickets); setError(null); setOff(null); })
      .catch(e => { if (notConnected(e)) setOff(errorMessage(e)); else setError(errorMessage(e, 'Your IT requests could not load. Try again in a moment.')); });
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (off) return <EmptyState icon="LifeBuoy" title="IT Support is not connected yet" body={off} />;
  if (!rows) {
    if (error) return <EmptyState icon="LifeBuoy" title="Your IT requests could not load" body={error} action={{ label: 'Try again', onClick: load }} forceAction />;
    return <Card><TableSkeleton rows={4} cols={3} /></Card>;
  }
  if (rows.length === 0) {
    return <EmptyState icon="LifeBuoy" title="Nothing sent to IT yet"
      body="When something in the system is not working, or you need a change, report it here. IT replies on this screen."
      action={{ label: 'Report a problem', onClick: onNew }} forceAction />;
  }
  return (
    <>
      {error && <StaleBanner message={`Showing what was last loaded. ${error}`} onRetry={load} />}
      <Card>
        {rows.map(r => (
          <button key={r.code} type="button" onClick={() => onOpen(r.code)}
            className="w-full flex items-center gap-3 flex-wrap text-left bg-transparent border-0 border-b border-solid border-line last:border-b-0 px-5 py-3.5 cursor-pointer [font-family:inherit] text-ink hover:bg-muted">
            <span className="text-meta text-muted-ink tabular-nums w-[92px] flex-none">{r.code}</span>
            <span className={`text-copy flex-1 min-w-[200px] [overflow-wrap:anywhere] ${r.unread ? 'font-semibold' : ''}`}>{r.title}</span>
            {r.unread && <StatusBadge tone="accent" label="New reply" size="sm" />}
            <StatusBadge entity="it_request" value={r.status} size="sm" />
            <span className="text-meta text-muted-ink w-[150px] flex-none">{r.assignee_name ?? 'Not picked up yet'}</span>
            <span className="text-meta text-muted-ink w-[110px] flex-none text-right" title={dateTime(r.updated_at)}>{relative(r.updated_at)}</span>
          </button>
        ))}
      </Card>
    </>
  );
}

export default function ItSupportPage() {
  const [params, setParams] = useSearchParams();
  const code = params.get('request') ?? '';
  const isNew = params.get('new') === '1';
  const [sent, setSent] = useState(0);
  const go = (next: Record<string, string>) => setParams(next);

  if (isNew) {
    return (
      <>
        <PageHeader title="Report a problem" sub="Goes straight to IT. Their reply appears on this screen." back={{ label: 'IT Support', onClick: () => go({}) }} />
        <NewRequest from={params.get('from') ?? ''} onCancel={() => go({})} onSent={c => { setSent(n => n + 1); go({ request: c }); }} />
      </>
    );
  }
  if (code) {
    return (
      <>
        <PageHeader title="IT request" back={{ label: 'IT Support', onClick: () => go({}) }} />
        <OneRequest key={code} code={code} />
      </>
    );
  }
  return (
    <>
      <PageHeader title="IT Support" sub="Report a problem with the system or ask for a change, and follow what IT is doing about it."
        primary={<Button variant="primary" onClick={() => go({ new: '1' })}>Report a problem</Button>} />
      <List key={sent} onOpen={c => go({ request: c })} onNew={() => go({ new: '1' })} />
    </>
  );
}

