import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { dateTime, relative } from '../lib/format';
import { cx } from '../lib/design-tokens';

// System Health, laid out like the Hookka /admin/health page so the two can be moved between systems:
// a status banner, a grid of stat cards fed by one live payload, then the audit feed with its range and
// "sensitive only" switches. `db`, `r2` and `counts` are the shared core; `checks` are this system's own.

type Status = 'ok' | 'warning' | 'critical' | 'off';
interface Check { key: string; label: string; value: string; status: Status; summary: string; detail?: string; link?: { label: string; path: string } }
interface LivePayload {
  ok: boolean; time: string;
  db: { ok: boolean; latency_ms: number; error?: string };
  r2: { bound: boolean; ok: boolean; latency_ms: number };
  counts: { users_active: number; users_invited: number; users_disabled: number; users_locked: number; audit_24h: number; audit_7d: number; sensitive_24h: number; last_event_at: string | null };
  checks: Check[];
  problems: { at: string; what: string; where: string | null; error: string | null }[];
}
interface AuditRow { id: number; created_at: string; actor_label: string; action: string; entity_type: string; entity_id: string }
interface AuditFeed { data: AuditRow[]; summary: { byAction: { action: string; n: number }[]; byResource: { resource: string; n: number }[] } }

type Range = '24h' | '7d' | '30d' | '90d';
const RANGES: Range[] = ['24h', '7d', '30d', '90d'];
// A warm database ping is well under a second; a pooled connection that went cold takes several.
const SLOW_MS = 2500, VERY_SLOW_MS = 6000;
const REFRESH_MS = 60_000;
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const words = (s: string) => s.replace(/[._]/g, ' ');

type CardTone = 'neutral' | 'accent' | 'warning' | 'error';
const BAR: Record<CardTone, string> = { neutral: 'var(--color-line)', accent: 'var(--color-gold)', warning: 'var(--color-warning-line)', error: 'var(--color-critical-line)' };
const INK: Record<CardTone, string> = { neutral: 'var(--color-ink)', accent: 'var(--color-gold-ink)', warning: 'var(--color-warning-fg)', error: 'var(--color-critical-fg)' };
const CHECK_TONE: Record<Status, CardTone> = { ok: 'neutral', warning: 'warning', critical: 'error', off: 'neutral' };
const CHECK_ICON: Record<string, string> = { email: 'Mail', channex: 'Plug', bookings: 'Bell', queue: 'RefreshCw', jobs: 'Timer', problems: 'Bug' };

function StatCard({ icon, label, value, sub, tone = 'neutral', title, onClick }: { icon: ReactNode; label: string; value: string | number; sub?: string; tone?: CardTone; title?: string; onClick?: () => void }) {
  return (
    <div title={title} onClick={onClick} className={cx('relative overflow-hidden rounded-card border border-solid border-line bg-card px-4 py-3', onClick && 'cursor-pointer hover:border-line-strong')}>
      <span aria-hidden className="absolute left-0 top-0 h-full w-[3px]" style={{ background: BAR[tone] }} />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-ink">
        <span style={{ color: tone === 'neutral' ? undefined : INK[tone] }} className="flex">{icon}</span><span>{label}</span>
      </div>
      <div className="mt-1.5 text-[22px] font-bold leading-none tracking-[-0.01em] [font-variant-numeric:tabular-nums]" style={{ color: INK[tone] }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-ink">{sub}</div>}
    </div>
  );
}

type BannerTone = 'green' | 'amber' | 'red' | 'loading';
const BANNER: Record<BannerTone, { border: string; bg: string; fg: string }> = {
  green: { border: 'var(--color-success-line)', bg: 'var(--color-success)', fg: 'var(--color-success-fg)' },
  amber: { border: 'var(--color-warning-line)', bg: 'var(--color-warning)', fg: 'var(--color-warning-fg)' },
  red: { border: 'var(--color-critical-line)', bg: 'var(--color-critical)', fg: 'var(--color-critical-fg)' },
  loading: { border: 'var(--color-line)', bg: 'var(--color-card)', fg: 'var(--color-muted-ink)' },
};
function HealthBanner({ tone, label, detail }: { tone: BannerTone; label: string; detail: string }) {
  const c = BANNER[tone];
  return (
    <div className="flex items-center gap-3 rounded-card border border-solid p-3" style={{ borderColor: c.border, background: c.bg, color: c.fg }}>
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: c.fg, animation: tone === 'loading' ? undefined : 'pulse-soft 2.4s ease-in-out infinite' }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{label}</div>
        {detail && <div className="mt-0.5 text-[11.5px] opacity-90">{detail}</div>}
      </div>
    </div>
  );
}

function Breakdown({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <div className="rounded-card border border-solid border-line-soft p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-ink">{title}</div>
      <div className="flex flex-col gap-1.5">
        {items.map(i => (
          <div key={i.label} className="flex items-center gap-2 text-[12px]">
            <span className="w-[42%] truncate" title={i.label}>{i.label}</span>
            <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><span className="block h-full rounded-full bg-gold" style={{ width: `${(i.count / max) * 100}%` }} /></span>
            <span className="w-8 text-right [font-variant-numeric:tabular-nums] text-muted-ink">{i.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const panel = 'rounded-card border border-solid border-line bg-card px-5 py-5';
const panelTitle = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-ink';

export default function SystemHealthPage() {
  const [range, setRange] = useState<Range>('7d');
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const live = useApi<LivePayload>('/system/health');
  const feed = useApi<AuditFeed>(`/system/health/audit-feed?range=${range}${sensitiveOnly ? '&sensitive=1' : ''}`);
  const navigate = useNavigate();
  const reloadLive = live.reload, reloadFeed = feed.reload;
  useEffect(() => { const t = setInterval(reloadLive, REFRESH_MS); return () => clearInterval(t); }, [reloadLive]);

  const d = live.data;
  const banner = useMemo<{ tone: BannerTone; label: string; detail: string }>(() => {
    if (!d) return live.error ? { tone: 'red', label: 'The health check itself could not run', detail: live.error } : { tone: 'loading', label: 'Checking…', detail: '' };
    const detail = `DB ${fmtMs(d.db.latency_ms)} · Storage ${d.r2.bound ? fmtMs(d.r2.latency_ms) : '—'} · ${d.counts.users_active} active users`;
    if (!d.db.ok) return { tone: 'red', label: 'Database unreachable', detail: d.db.error || detail };
    if (d.db.latency_ms >= VERY_SLOW_MS) return { tone: 'red', label: `Database very slow (${fmtMs(d.db.latency_ms)})`, detail };
    const down = [d.r2.bound && !d.r2.ok ? 'File storage' : '', ...d.checks.filter(c => c.status === 'critical').map(c => c.label)].filter(Boolean);
    if (down.length) return { tone: 'red', label: `${down.join(' + ')} not working`, detail: d.checks.find(c => c.status === 'critical')?.detail ?? detail };
    const warn = d.checks.filter(c => c.status === 'warning').map(c => c.label);
    if (d.db.latency_ms >= SLOW_MS) return { tone: 'amber', label: 'Investigate: database connection warming up', detail };
    if (warn.length) return { tone: 'amber', label: `Needs attention: ${warn.join(', ')}`, detail };
    return { tone: 'green', label: 'All systems normal', detail };
  }, [d, live.error]);

  const rows = feed.data?.data ?? [];
  const attention = d?.checks.filter(c => c.detail && (c.status === 'warning' || c.status === 'critical' || c.status === 'off')) ?? [];

  return (
    <>
      <PageHeader title="System Health"
        sub={d ? `Checked ${relative(d.time)} · this version published ${dateTime(__BUILD_ID__)}` : 'Live state of the database, storage, integrations and recent changes.'}
        right={<Button size="sm" variant="secondary" icon={<Icon name="RefreshCw" size="sm" />} loading={live.loading && !!d} onClick={() => { reloadLive(); reloadFeed(); }}>Refresh</Button>} />

      <HealthBanner tone={banner.tone} label={banner.label} detail={banner.detail} />

      {live.loading && !d && <div className={panel}><TableSkeleton rows={4} cols={4} /></div>}

      {d && (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
            <StatCard icon={<Icon name="Database" size="sm" />} label="DB latency" value={fmtMs(d.db.latency_ms)} sub={d.db.ok ? 'Live request-path ping' : 'Ping failed'}
              tone={!d.db.ok || d.db.latency_ms >= VERY_SLOW_MS ? 'error' : d.db.latency_ms >= SLOW_MS ? 'warning' : 'accent'} />
            <StatCard icon={<Icon name="HardDrive" size="sm" />} label="File storage" value={d.r2.bound ? fmtMs(d.r2.latency_ms) : '—'} sub={d.r2.bound ? (d.r2.ok ? 'Reachable' : 'Unreachable') : 'Not connected'}
              tone={d.r2.bound && !d.r2.ok ? 'error' : 'neutral'} />
            <StatCard icon={<Icon name="Users" size="sm" />} label="Active users" value={d.counts.users_active}
              sub={`${d.counts.users_invited} invited · ${d.counts.users_disabled} disabled${d.counts.users_locked ? ` · ${d.counts.users_locked} locked` : ''}`}
              tone={d.counts.users_locked ? 'warning' : 'neutral'} onClick={() => navigate('/system/users')} />
            <StatCard icon={<Icon name="ClipboardCheck" size="sm" />} label="Audit events 24h" value={d.counts.audit_24h} sub={`${d.counts.audit_7d} in 7d · ${d.counts.sensitive_24h} sensitive today`} />
            {d.checks.map(c => (
              <StatCard key={c.key} icon={<Icon name={CHECK_ICON[c.key] ?? 'Activity'} size="sm" />} label={c.label} value={c.value} sub={c.summary}
                tone={CHECK_TONE[c.status]} title={c.detail} onClick={c.link ? () => navigate(c.link!.path) : undefined} />
            ))}
          </div>

          {attention.length > 0 && (
            <div className={panel}>
              <div className={cx(panelTitle, 'mb-3')}>What needs attention</div>
              <div className="flex flex-col gap-2.5">
                {attention.map(c => (
                  <div key={c.key} className="flex items-start gap-3 text-[13px] flex-wrap">
                    <span className="w-[170px] flex-none font-semibold" style={{ color: INK[CHECK_TONE[c.status]] }}>{c.label}</span>
                    <span className="flex-1 min-w-[240px] text-ink-2">{c.detail}</span>
                    {c.link && <Button size="sm" variant="tertiary" onClick={() => navigate(c.link!.path)}>{c.link.label}</Button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={panel}>
            <div className={cx(panelTitle, 'mb-2 flex items-center gap-2')}><Icon name="Gauge" size="sm" color="var(--color-gold-ink)" /> Database / connection</div>
            <div className="text-[26px] font-bold leading-none tracking-[-0.01em]">
              {fmtMs(d.db.latency_ms)}
              <span className="ml-2 text-[12px] font-normal text-muted-ink">this check{d.counts.last_event_at ? ` · last change ${relative(d.counts.last_event_at)}` : ''}</span>
            </div>
            <p className="mt-3 mb-0 text-[12px] leading-relaxed text-muted-ink">
              A warm ping is well under a second. Anything over about {SLOW_MS / 1000} seconds means the pooled database connection went cold and is
              re-establishing, which is what makes a screen hang for a moment after a quiet period.
            </p>
          </div>

          <div className={panel}>
            <div className={cx(panelTitle, 'mb-3 flex items-center gap-2')}><Icon name="Bug" size="sm" /> Problems in the last 7 days</div>
            {d.problems.length === 0
              ? <div className="py-3 text-center text-[12.5px] text-muted-ink">Nothing has failed.</div>
              : (
                <table className="w-full border-collapse text-[12.5px]">
                  <thead><tr className="text-left text-[11px] text-muted-ink">{['When', 'What happened', 'Unit', 'Reason given'].map(h => <th key={h} className="font-medium py-2 pr-4 [border-bottom:1px_solid_var(--color-line-soft)]">{h}</th>)}</tr></thead>
                  <tbody>
                    {d.problems.map((p, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-2 pr-4 whitespace-nowrap [border-bottom:1px_solid_var(--color-line-soft)]">{dateTime(p.at)}</td>
                        <td className="py-2 pr-4 [border-bottom:1px_solid_var(--color-line-soft)]">{p.what}</td>
                        <td className="py-2 pr-4 [border-bottom:1px_solid_var(--color-line-soft)]">{p.where ?? '—'}</td>
                        <td className="py-2 text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">{p.error ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}

      <div className={panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className={panelTitle}>Audit feed: recent changes</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSensitiveOnly(v => !v)} title="Only accounts and passwords, settings, payouts, deletions and failures"
              className={cx('inline-flex h-7 items-center gap-1.5 rounded-control border border-solid px-2.5 text-[11px] font-semibold cursor-pointer [font-family:inherit]',
                sensitiveOnly ? 'border-[var(--color-warning-line)] bg-[var(--color-warning)] text-[var(--color-warning-fg)]' : 'border-line bg-card text-muted-ink')}>
              <Icon name="ShieldAlert" size="sm" /> Sensitive only
            </button>
            <div className="inline-flex rounded-control border border-solid border-line bg-card p-0.5">
              {RANGES.map(r => (
                <button key={r} type="button" onClick={() => setRange(r)}
                  className={cx('h-6 rounded-[4px] border-none px-2 text-[11px] font-semibold cursor-pointer [font-family:inherit]', range === r ? 'bg-ink text-white' : 'bg-transparent text-muted-ink')}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(feed.data?.summary.byAction.length ?? 0) > 0 && (
          <div className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            <Breakdown title="By action" items={feed.data!.summary.byAction.map(a => ({ label: words(a.action), count: a.n }))} />
            <Breakdown title="By resource" items={feed.data!.summary.byResource.map(a => ({ label: words(a.resource), count: a.n }))} />
          </div>
        )}
        {feed.loading && rows.length === 0 ? <TableSkeleton rows={4} cols={4} />
          : feed.error && rows.length === 0 ? <div className="py-6 text-center text-[12.5px] text-[var(--color-critical-fg)]">{feed.error}</div>
          : rows.length === 0 ? <div className="py-6 text-center text-[12.5px] text-muted-ink">No {sensitiveOnly ? 'sensitive ' : ''}events in the last {range}.</div>
          : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead><tr className="text-left text-[11px] text-muted-ink">{['When', 'Who', 'Action', 'Resource'].map(h => <th key={h} className="sticky top-0 bg-card font-medium py-2 pr-4 [border-bottom:1px_solid_var(--color-line-soft)]">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4 whitespace-nowrap [border-bottom:1px_solid_var(--color-line-soft)]" title={dateTime(r.created_at)}>{relative(r.created_at)}</td>
                      <td className="py-2 pr-4 [border-bottom:1px_solid_var(--color-line-soft)]">{r.actor_label}</td>
                      <td className="py-2 pr-4 [border-bottom:1px_solid_var(--color-line-soft)]">{words(r.action)}</td>
                      <td className="py-2 text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">{words(r.entity_type)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </>
  );
}
