import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Select } from '../components/Select';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { Segmented } from '../components/Metric';
import { FileDropRow } from '../components/Attachments';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { pageBeforeItSupport, refreshItUnread } from '../lib/itSupport';
import { statusLabel } from '../lib/status';
import { dateTime, relative } from '../lib/format';

/**
 * IT Support: report a problem with the system to IT, follow it, reply, and confirm the fix. Every desk role has it
 * and sees only its own requests (the server reads who is asking from the session; functions/_lib/itHub.ts).
 *
 * One screen, three views, chosen by the address so a link can open any of them:
 *   the list (?tab=active|resolved, All when absent), ?new=1 the form (&from=<address> fills in the page the problem
 *   is on), ?request=CONTS-0001.
 * Laid out and worded like Hookka's and Houzs Century's IT Support, so every system's works the same way.
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
const kindLabel = (k: string) => KINDS.find(x => x.value === k)?.label ?? k;
const URGENCY = [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }];
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/*,video/mp4,video/quicktime,application/pdf,.zip';
/* ACCEPT only filters the file browser; a dropped or pasted file is checked here. */
const accepted = (f: File) => f.type.startsWith('image/') || ['application/pdf', 'video/mp4', 'video/quicktime'].includes(f.type)
  || f.name.toLowerCase().endsWith('.zip');
const TEXTAREA = 'w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y';

/** IT Support answered that it is not set up here, as opposed to failing. */
const notConnected = (e: unknown) => e instanceof ApiFailure && e.code === 'NOT_CONFIGURED';

function Files({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [refused, setRefused] = useState<string | null>(null);
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  useEffect(() => {
    if (viewing === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewing(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewing]);
  const add = useCallback((list: File[]) => {
    const next = [...files, ...list];
    const odd = next.find(f => !accepted(f));
    if (odd) { setRefused(`${odd.name} is not a picture, PDF, MP4, MOV or ZIP.`); return; }
    const big = next.find(f => f.size > MAX_BYTES);
    if (big) { setRefused(`${big.name} is larger than 10 MB.`); return; }
    if (next.length > MAX_FILES) { setRefused(`Attach at most ${MAX_FILES} files.`); return; }
    setRefused(null); onChange(next);
  }, [files, onChange]);

  // Made in the effect, not a memo, so StrictMode's second mount never holds revoked addresses.
  useEffect(() => {
    const made = files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null));
    setUrls(made);
    return () => made.forEach(u => u && URL.revokeObjectURL(u));
  }, [files]);

  // A screenshot pasted anywhere on the screen (Ctrl+V) is attached. Pasted text is left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
      if (!pasted.length) return;
      e.preventDefault();
      // Every clipboard screenshot arrives as "image.png"; give each its own name.
      const stamp = Date.now();
      add(pasted.map((f, i) => new File([f], `screenshot-${stamp}-${i + 1}.${f.type.split('/')[1] || 'png'}`, { type: f.type })));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [add]);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {files.length < MAX_FILES && (
        <FileDropRow tall label="Drop files here, click to browse, or paste a screenshot"
          hint={`Up to ${MAX_FILES} files, 10 MB each: pictures, PDF, MP4, MOV or ZIP.`}
          accept={ACCEPT} multiple onPick={l => add(Array.from(l))} />
      )}
      {refused && <span className="text-meta text-danger" role="alert">{refused}</span>}
      {files.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-3">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative w-20 h-20">
              {urls[i] ? (
                <button type="button" onClick={() => setViewing(i)} title={f.name} aria-label={`Preview ${f.name}`}
                  className="block w-full h-full p-0 overflow-hidden rounded-control border border-solid border-line bg-card cursor-zoom-in hover:border-gold">
                  <img src={urls[i]!} alt={f.name} className="w-full h-full object-cover" />
                </button>
              ) : (
                <div title={f.name} className="w-full h-full flex flex-col items-center justify-center gap-1 rounded-control border border-solid border-line bg-page text-muted-ink">
                  <Icon name={f.type.startsWith('video/') ? 'Film' : 'FileText'} />
                  <span className="max-w-full truncate px-1 text-[10px] font-semibold">{f.name.includes('.') ? f.name.split('.').pop()!.toUpperCase() : 'FILE'}</span>
                </div>
              )}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => { setRefused(null); onChange(files.filter((_, j) => j !== i)); }}
                className="absolute -right-2 -top-2 w-6 h-6 grid place-items-center rounded-full border-0 bg-ink text-white cursor-pointer hover:bg-danger">
                <Icon name="X" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing !== null && urls[viewing] && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={files[viewing]?.name}>
          <button type="button" aria-label="Close preview" onClick={() => setViewing(null)} className="absolute inset-0 border-0 bg-black/70 cursor-zoom-out" />
          <img src={urls[viewing]!} alt={files[viewing]?.name} className="relative max-h-[85vh] max-w-[90vw] rounded-control bg-card object-contain" />
        </div>
      )}
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
    form.set('occurred_at', new Date().toISOString());
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
      <form onSubmit={send} noValidate className="flex flex-col gap-4 p-6 sm:p-8">
        <Field label={<>What is the problem? <span className="text-danger">*</span></>} required value={title} maxLength={200} onChange={e => setTitle(e.target.value)}
          placeholder="e.g. The calendar does not show a new reservation" error={error && !title.trim() ? error : undefined} />
        <div className="flex flex-col gap-[7px]">
          <label htmlFor="it-details" className="text-meta font-medium text-muted-ink">Details</label>
          <textarea id="it-details" value={description} maxLength={10000} rows={5} onChange={e => setDescription(e.target.value)}
            aria-describedby="it-details-help" className={TEXTAREA} />
          <span id="it-details-help" className="text-meta text-muted-ink">What you did, what you expected, and what happened instead.</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind of request" showLabel size="md" value={kind} onChange={setKind} options={KINDS} />
          <Select label="How urgent?" showLabel size="md" value={urgency} onChange={setUrgency} options={URGENCY} />
        </div>
        <div className="flex flex-col gap-[7px]">
          <span className="text-meta font-medium text-muted-ink">Screenshots</span>
          <Files files={files} onChange={setFiles} />
        </div>
        {error && title.trim() && <div className="text-copy text-danger" role="alert">{error}</div>}
        <div className="flex gap-3 pt-2">
          <Button type="submit" variant="primary" loading={busy}>Send</Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} disabledReason="Sending">Cancel</Button>
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
  // IT's reply appears while the person keeps the request open.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 30_000);
    return () => window.clearInterval(t);
  }, [reload]);

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
            <span className="text-meta text-muted-ink">{kindLabel(t.type)} · {t.assignee_name ? `Handled by ${t.assignee_name}` : 'Not picked up yet'}</span>
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

/* The list's three tabs. Done-please-confirm sits with Resolved: IT's part is over and the request waits only on
   the person's "Yes, it is fixed". */
type Tab = 'all' | 'active' | 'resolved';
const TABS: { key: Tab; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'resolved', label: 'Resolved' }];
const RESOLVED = new Set(['resolved', 'closed', 'rejected']);
const inTab = (status: string, tab: Tab) => tab === 'all' || (tab === 'resolved') === RESOLVED.has(status);
const isTab = (s: string | null): s is Tab => s === 'all' || s === 'active' || s === 'resolved';
const URGENCY_RANK = ['urgent', 'high', 'medium', 'low'];

function List({ tab, onTab, onOpen, onNew }: { tab: Tab; onTab: (t: Tab) => void; onOpen: (code: string) => void; onNew: () => void }) {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  // Counts come from every request, never from what the search box left.
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, (rows ?? []).filter(r => inTab(r.status, t.key)).length])) as Record<Tab, number>, [rows]);
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter(r => inTab(r.status, tab) && (!q
    || [r.code, r.title, r.assignee_name ?? '', statusLabel('it_request', r.status), statusLabel('it_urgency', r.priority)].some(v => v.toLowerCase().includes(q)))), [rows, tab, q]);

  const columns = useMemo<Column<RequestRow>[]>(() => [
    { key: 'code', label: 'Request', type: 'ref', value: r => r.code, hideable: false, phone: 'meta' },
    {
      key: 'title', label: 'Problem', value: r => r.title, phone: 'title',
      render: r => (
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className={`[overflow-wrap:anywhere] ${r.unread ? 'font-semibold' : ''}`}>{r.title}</span>
          {r.unread && <StatusBadge tone="accent" label="New reply" size="sm" />}
        </span>
      ),
    },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, entity: 'it_request', phone: 'badge' },
    {
      // Sorted most urgent first, not by the word.
      key: 'priority', label: 'Urgency', type: 'number', align: 'left', value: r => URGENCY_RANK.indexOf(r.priority), filter: false, phone: 'meta',
      render: r => <span className="inline-flex"><StatusBadge entity="it_urgency" value={r.priority} size="sm" dot={false} /></span>, exportValue: r => statusLabel('it_urgency', r.priority),
    },
    { key: 'assignee', label: 'Handled by', value: r => r.assignee_name ?? 'Not picked up yet', phone: 'meta' },
    {
      // A phone card shows two dates; this one says which it is.
      key: 'created', label: 'Submitted', type: 'datetime', value: r => r.created_at, phone: 'meta',
      render: r => <><span className="md:hidden">Submitted </span>{dateTime(r.created_at)}</>,
    },
    { key: 'updated', label: 'Last update', type: 'datetime', value: r => r.updated_at, phone: 'right' },
  ], []);

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
      <DataTable<RequestRow>
        id="it-support.my-requests" columns={columns} rows={shown} rowKey={r => r.code}
        pageSize={0} onRowClick={r => onOpen(r.code)} noun={['request', 'requests']} exportName="it-requests"
        toolbar={<>
          <Segmented label="Which requests" options={TABS.map(t => ({ key: t.key, label: t.label, count: counts[t.key] }))} value={tab} onChange={onTab} />
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search my requests" aria-label="Search my requests"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
          </div>
        </>}
        filtered={!!q || tab !== 'all'} onClearFilters={() => { setSearch(''); onTab('all'); }}
        empty={{ title: tab === 'active' ? 'Nothing is with IT right now.' : tab === 'resolved' ? 'No resolved requests yet.' : 'No requests match.' }} />
    </>
  );
}

export default function ItSupportPage() {
  const [params, setParams] = useSearchParams();
  const code = params.get('request') ?? '';
  const isNew = params.get('new') === '1';
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'all';
  const [sent, setSent] = useState(0);
  const go = (next: Record<string, string>) => setParams(next);

  if (isNew) {
    return (
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-4">
        <PageHeader title="Report a problem" sub="Goes straight to IT. Their reply appears on this screen." back={{ label: 'IT Support', onClick: () => go({}) }} />
        <NewRequest from={params.get('from') ?? pageBeforeItSupport()} onCancel={() => go({})} onSent={c => { setSent(n => n + 1); go({ request: c }); }} />
      </div>
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
      <List key={sent} tab={tab} onTab={t => go(t === 'all' ? {} : { tab: t })} onOpen={c => go({ request: c })} onNew={() => go({ new: '1' })} />
    </>
  );
}

