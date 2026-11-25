import { useCallback, useEffect, useState, type ReactNode } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Select } from '../components/Select';
import { StatRow, StatTile } from '../components/Metric';
import { Segmented } from '../components/Metric';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { dateTimeShort, plural } from '../lib/format';

type MyApp = { tokenId: string; app: string; connectedAt: string | null; lastUsedAt: string | null };
type Me = { allowed: boolean; isAdmin: boolean; pendingRequest: { id: string; createdAt: string | null } | null; connectorUrl: string; apps: MyApp[] };
type Person = { userId: string; name: string; position: string };
type Overview = {
  connectorUrl: string;
  stats: { connectedPeople: number; callsToday: number; refusedToday: number; waiting: number };
  requests: (Person & { id: string; reason: string; createdAt: string | null })[];
  connected: (Person & { tokenId: string; app: string; connectedAt: string | null; lastUsedAt: string | null })[];
  allowed: (Person & { approvedAt: string | null })[];
  calls: { id: string; userId: string; name: string; app: string; tool: string; target: string; status: number; ok: boolean; note: string; ms: number; at: string | null }[];
  staff: Person[];
};
type LeakRow = { path: string; outcome: 'opened' | 'refused' | 'error'; status: number; hidden: string[]; sensitive: string[] };

const when = (iso: string | null | undefined) => (iso ? dateTimeShort(iso) : '-');
const ROW = 'flex flex-wrap items-center justify-between gap-3 py-3 border-0 border-t border-solid border-line first:border-t-0';

function Section({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
          {sub && <p className="m-0 text-meta text-muted-ink">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="m-0 text-copy text-muted-ink">{children}</p>;

function ConnectorUrl({ url }: { url: string }) {
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="flex-1 min-w-0 break-all rounded-control border border-solid border-line bg-page px-3 py-2 text-[13px] text-ink">{url}</code>
      <Button size="sm" live onClick={() => navigator.clipboard?.writeText(url).then(
        () => toast({ tone: 'success', title: 'Connector address copied' }),
        () => toast({ tone: 'warning', title: 'Could not copy', body: 'Select the address and copy it yourself.' }),
      )}>Copy</Button>
    </div>
  );
}

const STEPS: Record<'claude' | 'chatgpt', string[]> = {
  claude: [
    'Open Claude: Settings > Connectors > Add custom connector.',
    'Name: The Conts ERP. URL: the connector address above.',
    'Press Connect. Sign in to the ERP if asked, then press Allow.',
    'Ask in a new chat, for example "How many check-ins do we have tomorrow?"',
  ],
  chatgpt: [
    'Open ChatGPT: Settings > Apps & Connectors > Advanced settings, and turn on Developer mode.',
    'Create a connector: name The Conts ERP, URL the connector address above, authentication OAuth.',
    'Sign in to the ERP when asked, then press Allow.',
    'In a new chat, choose The Conts ERP connector and ask your question.',
  ],
};

function HowTo({ url }: { url: string }) {
  const [tab, setTab] = useState<'claude' | 'chatgpt'>('claude');
  return (
    <Section title="How to connect" sub="Works with Claude and ChatGPT, and any AI app that supports remote MCP connectors.">
      <Segmented label="AI app" value={tab} onChange={setTab} options={[{ key: 'claude', label: 'Claude' }, { key: 'chatgpt', label: 'ChatGPT' }]} />
      <ol className="m-0 pl-5 flex flex-col gap-1.5 text-copy text-muted-ink">{STEPS[tab].map(s => <li key={s}>{s}</li>)}</ol>
      <ConnectorUrl url={url} />
    </Section>
  );
}

function LeakCheck({ people }: { people: Person[] }) {
  const [who, setWho] = useState('');
  const [rows, setRows] = useState<LeakRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true); setError(null); setRows([]); setProgress(null);
    try {
      let offset = 0;
      const all: LeakRow[] = [];
      // One page of 20 per request, so progress shows and no single request runs the whole sweep.
      for (let guard = 0; guard < 100; guard++) {
        const d = await api.post<{ total: number; next: number; done: boolean; rows: LeakRow[] }>('/ai-connector/admin/leak-check', { userId: who, offset });
        all.push(...d.rows);
        setRows([...all]);
        setProgress({ done: d.next, total: d.total });
        if (d.done) break;
        offset = d.next;
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const opened = rows.filter(r => r.outcome === 'opened');
  const refused = rows.filter(r => r.outcome === 'refused').length;
  const errors = rows.filter(r => r.outcome === 'error').length;
  const withSensitive = opened.filter(r => r.sensitive.length > 0);

  return (
    <Section title="Leak check" sub="Reads every list as one approved staff account, exactly as their AI app would. Shows field names only, never values.">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Account to check as" value={who} onChange={setWho} className="w-full sm:w-[280px]"
          placeholder={people.length ? 'Choose an approved staff account' : 'No staff account is allowed yet'}
          options={people.map(p => ({ value: p.userId, label: p.position ? `${p.name} · ${p.position}` : p.name }))} />
        <Button variant="primary" size="sm" onClick={() => void run()} loading={running} disabled={!who || running}
          disabledReason={running ? 'Checking' : 'Choose an account first'}>{running ? 'Checking…' : 'Run check'}</Button>
      </div>
      {error && <p role="alert" className="m-0 text-copy text-danger">{error}</p>}
      {progress && (
        <StatRow cols={4}>
          <StatTile label="Checked" value={`${progress.done} / ${progress.total}`} />
          <StatTile label="Opened" value={String(opened.length)} hint="this person can read" />
          <StatTile label="Refused" value={String(refused)} hint="no access (as it should be)" />
          <StatTile label="Money or people fields" value={String(withSensitive.length)} tone={withSensitive.length ? 'critical' : undefined} hint="lists showing cost, salary, IC, bank…" />
        </StatRow>
      )}
      {errors > 0 && <p className="m-0 text-meta text-muted-ink">{plural(errors, 'list')} answered with an error, usually because it needs a filter. That is not a leak.</p>}
      {opened.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-copy">
            <thead><tr className="text-left text-meta text-muted-ink"><th className="py-2 pr-3 font-semibold">Address this person can open</th><th className="py-2 font-semibold">Money or people fields in the reply</th></tr></thead>
            <tbody>
              {opened.map(r => (
                <tr key={r.path} className="border-0 border-t border-solid border-line align-top">
                  <td className="py-2 pr-3 font-mono text-[12px] break-all">{r.path}</td>
                  <td className={r.sensitive.length ? 'py-2 font-semibold text-danger' : 'py-2 text-muted-ink'}>{r.sensitive.join(', ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function AdminView({ ov, reload }: { ov: Overview; reload: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: done }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not saved', body: errorMessage(e) }); }
    finally { setBusy(null); }
  };
  const blocked = busy !== null;

  return (
    <>
      <StatRow cols={4}>
        <StatTile label="Waiting for you" value={String(ov.stats.waiting)} tone={ov.stats.waiting ? 'warning' : undefined} />
        <StatTile label="People connected" value={String(ov.stats.connectedPeople)} />
        <StatTile label="Lookups (24 h)" value={String(ov.stats.callsToday)} />
        <StatTile label="Refused (24 h)" value={String(ov.stats.refusedToday)} />
      </StatRow>

      <Section title="Waiting for approval" sub="Staff who pressed Request access.">
        {ov.requests.length === 0 ? <Empty>No one is waiting.</Empty> : (
          <div>
            {ov.requests.map(r => (
              <div key={r.id} className={ROW}>
                <div className="min-w-0">
                  <div className="text-copy font-medium text-ink">{r.name}</div>
                  <div className="text-meta text-muted-ink">{[r.position, `asked ${when(r.createdAt)}`, r.reason].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" disabled={blocked} disabledReason="Saving"
                    onClick={() => void act(r.id, () => api.post(`/ai-connector/admin/requests/${encodeURIComponent(r.id)}`, { decision: 'approve' }), `AI Connector turned on for ${r.name}`)}>Approve</Button>
                  <Button size="sm" disabled={blocked} disabledReason="Saving"
                    onClick={() => void act(r.id, () => api.post(`/ai-connector/admin/requests/${encodeURIComponent(r.id)}`, { decision: 'reject' }), `Request from ${r.name} rejected`)}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 pt-3 border-0 border-t border-solid border-line">
          <Select label="Turn on for someone" showLabel value={pick} onChange={setPick} className="w-full sm:w-[280px]"
            placeholder={ov.staff.length ? 'Choose a staff member' : 'Everyone is already allowed'}
            options={ov.staff.map(p => ({ value: p.userId, label: p.position ? `${p.name} · ${p.position}` : p.name }))} />
          <Button size="sm" disabled={!pick || blocked} disabledReason={pick ? 'Saving' : 'Choose a staff member first'}
            onClick={() => void act('grant', async () => { await api.post('/ai-connector/admin/access', { userId: pick }); setPick(''); }, 'AI Connector turned on')}>Turn on</Button>
        </div>
      </Section>

      <Section title="Connected people" sub="Every AI app connected right now. Disconnect stops it at once; the person can connect again while they are allowed.">
        {ov.connected.length === 0 ? <Empty>No one is connected yet.</Empty> : (
          <div>
            {ov.connected.map(r => (
              <div key={r.tokenId} className={ROW}>
                <div className="min-w-0">
                  <div className="text-copy font-medium text-ink">{r.name} <span className="text-muted-ink font-normal">· {r.app}</span></div>
                  <div className="text-meta text-muted-ink">{[r.position, `connected ${when(r.connectedAt)}`, `last used ${when(r.lastUsedAt)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <ConfirmButton disabled={blocked} disabledReason="Saving"
                  confirm={{ title: `Disconnect ${r.app} for ${r.name}?`, body: 'It stops reading the ERP at once. They can connect again while the AI Connector is on for them.', confirmLabel: 'Disconnect' }}
                  onConfirm={() => act(r.tokenId, () => api.post('/ai-connector/admin/revoke', { tokenId: r.tokenId }), `${r.app} disconnected for ${r.name}`)}>Disconnect</ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Allowed to connect" sub="Management is always allowed. Remove takes access away and disconnects every AI app the person connected.">
        {ov.allowed.length === 0 ? <Empty>Only management so far.</Empty> : (
          <div>
            {ov.allowed.map(p => (
              <div key={p.userId} className={ROW}>
                <div className="min-w-0">
                  <div className="text-copy font-medium text-ink">{p.name}</div>
                  <div className="text-meta text-muted-ink">{[p.position, `allowed ${when(p.approvedAt)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <ConfirmButton disabled={blocked} disabledReason="Saving"
                  confirm={{ title: `Remove ${p.name} from the AI Connector?`, body: 'Every AI app they connected stops at once, and they cannot connect again until someone turns it back on.', confirmLabel: 'Remove' }}
                  onConfirm={() => act(`rm${p.userId}`, () => api.del(`/ai-connector/admin/access/${encodeURIComponent(p.userId)}`), `${p.name} removed`)}>Remove</ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </Section>

      <LeakCheck people={ov.allowed} />

      <Section title="Recent lookups" sub="The last 100 things an AI app read, newest first.">
        {ov.calls.length === 0 ? <Empty>Nothing yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-copy">
              <thead><tr className="text-left text-meta text-muted-ink">
                <th className="py-2 pr-3 font-semibold">When</th><th className="py-2 pr-3 font-semibold">Who</th><th className="py-2 pr-3 font-semibold">What</th><th className="py-2 font-semibold">Result</th>
              </tr></thead>
              <tbody>
                {ov.calls.map(k => (
                  <tr key={k.id} className="border-0 border-t border-solid border-line align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-ink tabular-nums">{when(k.at)}</td>
                    <td className="py-2 pr-3">{k.name} <span className="text-muted-ink">· {k.app}</span></td>
                    <td className="py-2 pr-3 font-mono text-[12px] break-all">{k.tool}{k.target ? ` ${k.target}` : ''}</td>
                    <td className={k.ok ? 'py-2 text-success' : 'py-2 text-danger'}>{k.ok ? 'OK' : k.note || 'Refused'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

/**
 * System > AI Connector (owner, 25 Nov 2026). Everyone at a desk: connect their own Claude or ChatGPT (read-only, their
 * own access), ask for access, see and stop their connections. Management: approve people, see who is connected and
 * what was looked up, disconnect anyone, and run the leak check. Every rule is the server's (functions/api/ai-connector).
 */
export default function AiConnectorPage() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await api.get<Me>('/ai-connector/me');
        if (!live) return;
        setMe(m); setError(null);
        if (m.isAdmin) { const o = await api.get<Overview>('/ai-connector/admin/overview'); if (live) setOv(o); }
      } catch (e) {
        if (live) setError(errorMessage(e, 'The AI Connector could not load. Check your connection and try again.'));
      }
    })();
    return () => { live = false; };
  }, [tick]);

  const request = async () => {
    setRequesting(true);
    try { await api.post('/ai-connector/me/request', {}); toast({ tone: 'success', title: 'Request sent', body: 'Management has been told.' }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not sent', body: errorMessage(e) }); }
    finally { setRequesting(false); }
  };

  const disconnectOwn = async (a: MyApp) => {
    try { await api.post('/ai-connector/me/revoke', { tokenId: a.tokenId }); toast({ tone: 'success', title: `${a.app} disconnected` }); reload(); }
    catch (e) { toast({ tone: 'critical', title: 'Not disconnected', body: errorMessage(e) }); }
  };

  return (
    <div className="flex flex-col gap-5 max-w-[1080px]">
      <PageHeader title="AI Connector" sub="Ask Claude or ChatGPT about the ERP. Read only, and only what your own login can see."
        actions={<Button live onClick={reload}>Refresh</Button>} />

      {error && <div role="alert" className="rounded-control border border-solid border-danger-line bg-danger-bg text-danger text-copy p-3">{error}</div>}
      {!me && !error && <p className="m-0 text-copy text-muted-ink">Loading…</p>}

      {me && (
        <Section title="Your connector address" sub={me.allowed ? 'Paste it into your AI app (steps below).' : 'The AI Connector is not turned on for you yet.'}>
          {me.allowed ? <ConnectorUrl url={me.connectorUrl} />
            : me.pendingRequest ? <Empty>Request sent {when(me.pendingRequest.createdAt)}. You can connect once management approves it.</Empty>
            : <div><Button variant="primary" size="sm" onClick={() => void request()} loading={requesting} disabled={requesting} disabledReason="Sending">Request access</Button></div>}
        </Section>
      )}

      {me?.isAdmin && ov && <AdminView ov={ov} reload={reload} />}

      {me && me.apps.length > 0 && (
        <Section title="My connected apps">
          <div>
            {me.apps.map(a => (
              <div key={a.tokenId} className={ROW}>
                <div className="min-w-0">
                  <div className="text-copy font-medium text-ink">{a.app}</div>
                  <div className="text-meta text-muted-ink">connected {when(a.connectedAt)} · last used {when(a.lastUsedAt)}</div>
                </div>
                <ConfirmButton confirm={{ title: `Disconnect ${a.app}?`, body: 'It stops reading the ERP at once. You can connect it again later.', confirmLabel: 'Disconnect' }}
                  onConfirm={() => disconnectOwn(a)}>Disconnect</ConfirmButton>
              </div>
            ))}
          </div>
        </Section>
      )}

      {me?.allowed && <HowTo url={me.connectorUrl} />}
    </div>
  );
}
