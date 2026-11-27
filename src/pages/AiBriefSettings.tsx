import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { Switch } from '../components/Switch';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { dateTimeShort, plural } from '../lib/format';

/**
 * System > AI Connector > "Morning brief & urgent alerts by email" (AI Connector round 4d, owner 26 Nov 2026). Each
 * person opts in for themselves (off by default): the brief's time (Malaysia time, on the half hour), weekdays or every
 * day, and urgent alerts. The alert rules are shown read-only; they live in one place on the server
 * (functions/_lib/mcpProactive.ts PROACTIVE_CONFIG). Everything is built AS the person, so an email only ever shows what
 * their own ERP access allows. Preview builds the brief here without sending it; "Send me a test brief" emails it to
 * the person's own address, at most once per 10 minutes.
 */

type Sub = { briefEnabled: boolean; briefTime: string; briefDays: 'weekdays' | 'daily'; alertsEnabled: boolean };
type Sent = { at: string; kind: string; items: number; status: string; note: string };
type Settings = { allowed: boolean; email: string; saved: boolean; subscription: Sub; thresholds: { label: string; value: string }[]; schedule: string; recent: Sent[] };

const TIMES = Array.from({ length: 33 }, (_, i) => {
  const m = 6 * 60 + i * 30; // 06:00 ... 22:00
  const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`;
  return { value: t, label: t };
});
const DAYS = [{ value: 'weekdays', label: 'Weekdays (Mon to Fri)' }, { value: 'daily', label: 'Every day' }];
const KIND: Record<string, string> = { brief: 'Morning brief', brief_test: 'Test brief', alert: 'Urgent alert', unsubscribe: 'Unsubscribed by the email link' };
const ROW = 'flex flex-wrap items-center justify-between gap-3 py-3 border-0 border-t border-solid border-line';

export function AiBriefSettings() {
  const toast = useToast();
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Sub | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'preview' | 'test'>('');
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.get<Settings>('/ai-connector/brief')); setError(null); }
    catch (e) { setError(errorMessage(e, 'The email settings could not load.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <section className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 text-copy text-muted-ink">Morning brief: {error}</section>;
  if (!data || !data.allowed) return null;

  const sub = draft ?? data.subscription;
  const dirty = !!draft && (['briefEnabled', 'briefTime', 'briefDays', 'alertsEnabled'] as const).some(k => draft[k] !== data.subscription[k]);
  const set = (patch: Partial<Sub>) => setDraft({ ...sub, ...patch });
  const act = async (what: 'save' | 'preview' | 'test', fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e) { toast({ tone: 'critical', title: what === 'save' ? 'Not saved' : what === 'test' ? 'Not sent' : 'No preview', body: errorMessage(e) }); }
    finally { setBusy(''); }
  };
  const noEmail = !data.email;

  return (
    <section className="rounded-card border border-solid border-line bg-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-col gap-1 min-w-0">
        <h2 className="m-0 text-[15px] font-semibold">Morning brief &amp; urgent alerts by email</h2>
        <p className="m-0 text-meta text-muted-ink">
          {noEmail ? 'Your account has no email address, so nothing can be sent. Ask management to add one.'
            : <>Sent to <b className="text-ink">{data.email}</b>. Built as you, so it shows only what your own ERP access allows. Every email has an unsubscribe link.</>}
        </p>
      </div>

      <div className={ROW}>
        <div className="min-w-0 flex-1 basis-[280px]">
          <div className="text-copy font-medium text-ink">Morning brief</div>
          <div className="text-meta text-muted-ink">What needs you today: your jobs, approvals, orders, maintenance and Mail Center, with counts and the first 5 linked. On Mondays it also lists the data gaps to fill.</div>
        </div>
        <Switch label="Morning brief" checked={sub.briefEnabled} disabled={!!busy || noEmail} onChange={v => set({ briefEnabled: v })} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Time (Malaysia)" showLabel value={sub.briefTime} options={TIMES} disabled={!!busy} onChange={v => set({ briefTime: v })} />
        <Select label="Days" showLabel value={sub.briefDays} options={DAYS} disabled={!!busy} onChange={v => set({ briefDays: v === 'daily' ? 'daily' : 'weekdays' })} />
      </div>

      <div className={ROW}>
        <div className="min-w-0 flex-1 basis-[280px]">
          <div className="text-copy font-medium text-ink">Urgent alerts</div>
          <div className="text-meta text-muted-ink">An email when something you can see becomes urgent. Each alert is sent to you once.</div>
        </div>
        <Switch label="Urgent alerts" checked={sub.alertsEnabled} disabled={!!busy || noEmail} onChange={v => set({ alertsEnabled: v })} />
      </div>

      <div className="overflow-x-auto rounded-control border border-solid border-line">
        <table className="w-full border-collapse text-meta">
          <caption className="bg-page px-3 py-2 text-left font-semibold text-muted-ink">Alert rules (the same for everyone, read-only)</caption>
          <tbody>
            {data.thresholds.map(t => (
              <tr key={t.label} className="border-0 border-t border-solid border-line">
                <th scope="row" className="w-[38%] px-3 py-2 text-left align-top font-medium text-ink">{t.label}</th>
                <td className="px-3 py-2 align-top text-muted-ink">{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-meta text-muted-ink">{data.schedule}</p>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={busy === 'save'} disabled={!!busy || !dirty} disabledReason={busy ? 'Working' : 'Nothing changed'}
          onClick={() => void act('save', async () => { await api.put('/ai-connector/brief', sub); setDraft(null); await load(); toast({ tone: 'success', title: 'Email settings saved' }); })}>Save</Button>
        <Button size="sm" loading={busy === 'preview'} disabled={!!busy} disabledReason="Working"
          onClick={() => void act('preview', async () => { const r = await api.get<{ html: string }>('/ai-connector/brief/preview', { gaps: '1' }); setPreview(r.html); })}>Preview my brief</Button>
        <Button size="sm" loading={busy === 'test'} disabled={!!busy || noEmail} disabledReason={noEmail ? 'Your account has no email address' : 'Working'}
          onClick={() => void act('test', async () => { const r = await api.post<{ sentTo: string; items: number }>('/ai-connector/brief/test', {}); await load(); toast({ tone: 'success', title: 'Test brief sent', body: `To ${r.sentTo}, ${plural(r.items, 'item')}.` }); })}>Send me a test brief</Button>
      </div>

      {preview !== null && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta font-semibold text-muted-ink">Preview (not sent)</span>
            <Button size="sm" variant="tertiary" onClick={() => setPreview(null)}>Close preview</Button>
          </div>
          <iframe title="Morning brief preview" sandbox="" srcDoc={preview} className="h-[520px] w-full rounded-control border border-solid border-line bg-page" />
        </div>
      )}

      {data.recent.length > 0 && (
        <div className="border-0 border-t border-solid border-line pt-3">
          <div className="mb-1 text-meta font-semibold text-muted-ink">Your recent emails</div>
          <ul className="m-0 pl-5 flex flex-col gap-1 text-meta text-muted-ink">
            {data.recent.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                {dateTimeShort(r.at)} · {KIND[r.kind] ?? r.kind}{r.kind === 'unsubscribe' ? '' : ` · ${r.status === 'failed' ? `not sent${r.note ? ` (${r.note})` : ''}` : plural(r.items, 'item')}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
