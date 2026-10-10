import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { count, dateTime, relative } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { cx } from '../lib/design-tokens';

// System Health, laid out like the Hookka /admin/health page so the two can be moved between systems:
// a status banner, a grid of stat cards fed by one live payload, then the audit feed with its range and
// "sensitive only" switches. The audit feed is also the system's audit trail: a row opens to its before/after. `db`, `r2` and `counts` are the shared core; `checks` are this system's own.

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
type Detail = Record<string, unknown> | null;
interface AuditRow { id: number; created_at: string; actor_label: string; action: string; entity_type: string; entity_id: string; before: Detail; after: Detail }
interface AuditFeed { total: number; data: AuditRow[]; summary: { byAction: { action: string; n: number }[]; byResource: { resource: string; n: number }[] } }

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
      <div className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">
        <span style={{ color: tone === 'neutral' ? undefined : INK[tone] }} className="flex">{icon}</span><span>{label}</span>
      </div>
      <div className="mt-1.5 text-headline font-bold leading-none tracking-[-0.01em] [font-variant-numeric:tabular-nums]" style={{ color: INK[tone] }}>
        {typeof value === 'number' ? count(value) : value}
      </div>
      {sub && <div className="mt-1 text-caption text-muted-ink">{sub}</div>}
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
        <div className="text-copy font-semibold">{label}</div>
        {detail && <div className="mt-0.5 text-meta opacity-90">{detail}</div>}
      </div>
    </div>
  );
}

function Breakdown({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <div className="rounded-card border border-solid border-line-soft p-3">
      <div className="mb-2 text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">{title}</div>
      <div className="flex flex-col gap-1.5">
        {items.map(i => (
          <div key={i.label} className="flex items-center gap-2 text-meta">
            <span className="w-[42%] truncate" title={i.label}>{i.label}</span>
            <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><span className="block h-full rounded-full bg-gold" style={{ width: `${(i.count / max) * 100}%` }} /></span>
            <span className="w-8 text-right [font-variant-numeric:tabular-nums] text-muted-ink">{i.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What an audit entry changed: each field's value before and after. */
function AuditDiff({ before, after }: { before: Detail; after: Detail }) {
  if (!before && !after) return <div className="py-2 text-meta text-muted-ink">No before/after detail was recorded for this entry.</div>;
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  const show = (v: unknown) => (v === undefined ? '—' : v === null ? 'empty' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="my-1 border border-solid border-line rounded-card overflow-hidden bg-card">
      {keys.map((k, i) => {
        const b = before?.[k], a = after?.[k];
        const changed = before && after && show(b) !== show(a);
        return (
          <div key={k} className={cx('grid grid-cols-[minmax(110px,160px)_1fr] gap-3 py-2 px-3', i < keys.length - 1 && '[border-bottom:1px_solid_var(--color-line-soft)]')}>
            <span className="text-meta font-medium text-muted-ink">{words(k)}</span>
            <span className="text-meta font-mono break-all">
              {before && after ? (changed ? <>{show(b)} <span className="text-muted-ink">→</span> {show(a)}</> : show(a)) : show(a ?? b)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const panel = 'rounded-card border border-solid border-line bg-card p-5';
const panelTitle = 'text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink';

export default function SystemHealthPage() {
  const [range, setRange] = useState<Range>('7d');
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [limit, setLimit] = useState(100);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const live = useApi<LivePayload>('/system/health');
  const feed = useApi<AuditFeed>(`/system/health/audit-feed?range=${range}${sensitiveOnly ? '&sensitive=1' : ''}&limit=${limit}`);
  const navigate = useNavigate();
  const reloadLive = live.reload, reloadFeed = feed.reload;
  useEffect(() => { const t = setInterval(reloadLive, REFRESH_MS); return () => clearInterval(t); }, [reloadLive]);

  const d = live.data;
  const banner = useMemo<{ tone: BannerTone; label: string; detail: string }>(() => {
    if (!d) return live.error ? { tone: 'red', label: 'The health check itself could not run', detail: live.error } : { tone: 'loading', label: 'Checking…', detail: '' };
    const detail = `DB ${fmtMs(d.db.latency_ms)} · Storage ${d.r2.bound ? fmtMs(d.r2.latency_ms) : '—'} · ${count(d.counts.users_active)} active users`;
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
  const open = rows.find(r => r.id === openRow) ?? null;
  const attention = d?.checks.filter(c => c.detail && (c.status === 'warning' || c.status === 'critical' || c.status === 'off')) ?? [];

  return (
    <>
      <PageHeader title="System health"
        sub={d ? `Checked ${relative(d.time).replace(/^Just now$/, 'just now')} · this version published ${dateTime(__BUILD_ID__)}` : 'Live state of the database, storage, integrations and recent changes.'}
        actions={<Button size="sm" variant="secondary" icon={<Icon name="RefreshCw" size="sm" />} loading={live.loading && !!d} onClick={() => { reloadLive(); reloadFeed(); }}>Refresh</Button>} />

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
              sub={`${count(d.counts.users_invited)} invited · ${count(d.counts.users_disabled)} disabled${d.counts.users_locked ? ` · ${count(d.counts.users_locked)} locked` : ''}`}
              tone={d.counts.users_locked ? 'warning' : 'neutral'} onClick={() => navigate('/system/users')} />
            <StatCard icon={<Icon name="ClipboardCheck" size="sm" />} label="Audit events 24h" value={d.counts.audit_24h} sub={`${count(d.counts.audit_7d)} in 7d · ${count(d.counts.sensitive_24h)} sensitive today`} />
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
                  <div key={c.key} className="flex items-start gap-3 text-copy flex-wrap">
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
            <div className="text-headline font-bold leading-none tracking-[-0.01em]">
              {fmtMs(d.db.latency_ms)}
              <span className="ml-2 text-meta font-normal text-muted-ink">this check{d.counts.last_event_at ? ` · last change ${relative(d.counts.last_event_at)}` : ''}</span>
            </div>
            <p className="mt-3 mb-0 text-meta leading-relaxed text-muted-ink">
              Normally well under a second. Over about {SLOW_MS / 1000} seconds usually means the system was idle and is waking up,
              which is why the first screen after a quiet period can pause for a moment.
            </p>
          </div>

          <DataTable<Problem> id="health.problems" urlPrefix="prob." noViews pageSize={0} maxHeight="none"
            columns={PROBLEM_COLUMNS} rows={d.problems} rowKey={p => `${p.at}|${p.what}|${p.where ?? ''}`} noun={['problem', 'problems']}
            exportName="problems-7d"
            header={<div className={cx(panelTitle, 'flex items-center gap-2 pt-4 px-[22px] max-md:px-4 pb-1')}><Icon name="Bug" size="sm" /> Problems in the last 7 days</div>}
            empty={{ title: 'Nothing has failed.', body: 'Failed messages, syncs and jobs from the last 7 days show here.', icon: 'CircleCheck' }} />
        </>
      )}

      <DataTable<AuditRow> id="health.audit" urlPrefix="audit." columns={AUDIT_COLUMNS}
        rows={feed.data ? rows : null} rowKey={r => String(r.id)} loading={feed.loading} error={feed.error} onRetry={reloadFeed}
        onRowClick={r => setOpenRow(openRow === r.id ? null : r.id)} rowTone={r => (r.id === openRow ? 'gold' : null)}
        noun={['event', 'events']} exportName={`audit-${range}${sensitiveOnly ? '-sensitive' : ''}`} selectionKey={`${range}|${sensitiveOnly}`}
        filtered={sensitiveOnly} onClearFilters={() => { setSensitiveOnly(false); setLimit(100); }}
        empty={{ title: `No events in the last ${range}.`, icon: 'ClipboardCheck' }}
        header={
          <div className="pt-4 px-[22px] max-md:px-4 pb-3 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className={panelTitle}>Audit feed: recent changes</div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setSensitiveOnly(v => !v); setLimit(100); }} title="Only accounts and passwords, settings, payouts, deletions and failures"
                  className={cx('inline-flex h-7 items-center gap-1.5 rounded-control border border-solid px-2.5 text-caption font-semibold cursor-pointer [font-family:inherit]',
                    sensitiveOnly ? 'border-[var(--color-warning-line)] bg-[var(--color-warning)] text-[var(--color-warning-fg)]' : 'border-line bg-card text-muted-ink')}>
                  <Icon name="ShieldAlert" size="sm" /> Sensitive only
                </button>
                <div className="inline-flex rounded-control border border-solid border-line bg-card p-0.5">
                  {RANGES.map(r => (
                    <button key={r} type="button" onClick={() => { setRange(r); setLimit(100); }}
                      className={cx('h-6 rounded-[4px] border-none px-2 text-caption font-semibold cursor-pointer [font-family:inherit]', range === r ? 'bg-ink text-white' : 'bg-transparent text-muted-ink')}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {(feed.data?.summary.byAction.length ?? 0) > 0 && (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                <Breakdown title="By action" items={feed.data!.summary.byAction.map(a => ({ label: words(a.action), count: a.n }))} />
                <Breakdown title="By resource" items={feed.data!.summary.byResource.map(a => ({ label: words(a.resource), count: a.n }))} />
              </div>
            )}
          </div>
        }
        above={open && (
          <div className="px-[22px] max-md:px-4 py-3 bg-page [border-bottom:1px_solid_var(--color-line-soft)]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-meta text-muted-ink">
                <span className="font-semibold text-ink">{open.actor_label} · {words(open.action)}</span> · {dateTime(open.created_at)} · record {String(open.entity_id).length > 12 ? String(open.entity_id).slice(0, 6).toUpperCase() : open.entity_id}
              </span>
              <Button size="sm" variant="tertiary" icon={<Icon name="X" size="sm" />} onClick={() => setOpenRow(null)}>Close</Button>
            </div>
            <AuditDiff before={open.before} after={open.after} />
          </div>
        )}
        footer={rows.length > 0 && (
          <div className="py-3 px-[22px] max-md:px-4 flex flex-wrap items-center justify-between gap-3 text-meta text-muted-ink [border-top:1px_solid_var(--color-line-soft)]">
            <span>{count(rows.length)} of {count(feed.data?.total ?? rows.length)} in the last {range} loaded. Click a row to see what changed.</span>
            {rows.length < (feed.data?.total ?? 0) && limit < 1000 && <Button size="sm" variant="secondary" loading={feed.loading} onClick={() => setLimit(l => Math.min(1000, l + 200))}>Show more</Button>}
          </div>
        )} />
    </>
  );
}

type Problem = LivePayload['problems'][number];
const PROBLEM_COLUMNS: Column<Problem>[] = [
  { key: 'at', label: 'When', type: 'datetime', value: p => p.at, width: 150 },
  { key: 'what', label: 'What happened', value: p => p.what, hideable: false, width: 220 },
  { key: 'where', label: 'Unit', value: p => p.where, width: 140 },
  { key: 'error', label: 'Reason given', value: p => p.error, width: 260,
    render: p => <span className="block text-muted-ink whitespace-normal [overflow-wrap:anywhere]">{p.error ?? '—'}</span> },
];

const AUDIT_COLUMNS: Column<AuditRow>[] = [
  { key: 'when', label: 'When', type: 'datetime', value: r => r.created_at, width: 150,
    render: r => <span className="whitespace-nowrap" title={dateTime(r.created_at)}>{relative(r.created_at)}</span> },
  { key: 'who', label: 'Who', type: 'person', value: r => r.actor_label, width: 170 },
  { key: 'action', label: 'Action', value: r => words(r.action), width: 200 },
  { key: 'resource', label: 'Resource', value: r => words(r.entity_type), width: 150,
    render: r => <span className="text-muted-ink">{words(r.entity_type)}</span> },
  { key: 'record', label: 'Record', type: 'ref', value: r => String(r.entity_id), hidden: true, width: 150 },
];
