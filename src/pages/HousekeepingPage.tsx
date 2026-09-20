import { useState } from 'react';
import { color, radius, text, tone as T } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { Tone, UnitReadiness } from '../lib/types';

const SHIFTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};

interface Row {
  id: string; unitNumber: string; propertyName: string; title: string;
  readiness: UnitReadiness; dueAt: string | null; nextGuestAt: string | null;
  assigneeId: string | null; assigneeName: string | null;
}
interface Payload { rows: Row[]; date: string; generatedAt: string }

const FALLBACK: Payload = {
  date: '2026-09-16', generatedAt: '',
  rows: [
    { id: 'h1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Turnover, 2BR', readiness: 'cleaning', dueAt: '08:00', nextGuestAt: '15:00', assigneeId: 'u5', assigneeName: 'Nurul Huda' },
    { id: 'h2', unitNumber: '#B-08-11', propertyName: 'Arcoris', title: 'Turnover, studio', readiness: 'dirty', dueAt: '12:00', nextGuestAt: '16:00', assigneeId: 'u5', assigneeName: 'Nurul Huda' },
    { id: 'h3', unitNumber: '#15-06', propertyName: 'Scarletz', title: 'Deep clean', readiness: 'dirty', dueAt: '10:00', nextGuestAt: '18:00', assigneeId: 'u6', assigneeName: 'Faridah Ismail' },
    { id: 'h4', unitNumber: '#2207', propertyName: 'Tribeca', title: 'Light clean', readiness: 'ready', dueAt: '08:00', nextGuestAt: null, assigneeId: 'u9', assigneeName: 'Siti Rahmah' },
    { id: 'h5', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', title: 'Post-works clean', readiness: 'maintenance', dueAt: '16:00', nextGuestAt: null, assigneeId: 'u9', assigneeName: 'Siti Rahmah' },
    { id: 'h6', unitNumber: '#A-21-02', propertyName: 'The Establishment', title: 'Turnover, 2BR', readiness: 'dirty', dueAt: '14:00', nextGuestAt: '15:00', assigneeId: null, assigneeName: null },
  ],
};

/** Shift index a job starts in, from its due time. */
const slotOf = (due: string | null) => {
  if (!due) return 0;
  const i = SHIFTS.indexOf(due.slice(0, 5));
  return i >= 0 ? i : 0;
};

export default function HousekeepingPage() {
  const [day, setDay] = useState('2026-09-16');
  const { data, loading, error, reload } = useApi<Payload>(`/housekeeping/tasks?date=${day}`, FALLBACK);

  const rows = data?.rows ?? [];
  const unassigned = rows.filter(r => !r.assigneeId);
  const assigned = rows.filter(r => r.assigneeId);

  // Group by cleaner, then lay each job into its shift column.
  const crew = [...new Map(assigned.map(r => [r.assigneeId!, r.assigneeName!])).entries()]
    .map(([id, name]) => ({ id, name, jobs: assigned.filter(r => r.assigneeId === id) }));

  return (
    <>
      <PageHeader title="Housekeeping" sub={`${rows.length} jobs across ${crew.length} cleaners · ${unassigned.length} unassigned`} />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      {unassigned.length > 0 && (
        <Card>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name="TriangleAlert" size="sm" color={T.warning.fg} />
            <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Needs a cleaner</span>
          </div>
          {unassigned.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}`, flexWrap: 'wrap', borderLeft: `3px solid ${T.critical.line}` }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 180 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{u.propertyName} {u.unitNumber}</span>
                <span style={{ fontSize: text.small, color: color.textMuted }}>
                  {u.title}{u.nextGuestAt ? ` · next guest ${u.nextGuestAt}` : ''}
                </span>
              </div>
              <Badge tone={READY_TONE[u.readiness]} label={u.readiness[0].toUpperCase() + u.readiness.slice(1)} />
              <a href="#/operations/today" style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 12.5, fontWeight: 500, textDecoration: 'none' }}>
                Assign cleaner
              </a>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: `1px solid ${color.border}` }}>
          <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Roster</span>
          <div style={{ display: 'flex', border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
            {[['2026-09-15', 'Tue 15'], ['2026-09-16', 'Wed 16'], ['2026-09-17', 'Thu 17']].map(([v, label]) => (
              <button key={v} onClick={() => setDay(v)}
                style={{ padding: '7px 12px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', border: 'none', font: 'inherit',
                  background: v === day ? color.black : '#FFFFFF', color: v === day ? '#FFFFFF' : color.textMuted }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && rows.length === 0 ? <TableSkeleton rows={3} cols={6} /> : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 240 + SHIFTS.length * 120 }}>
              <div style={{ display: 'flex', background: color.muted, borderBottom: `1px solid ${color.border}` }}>
                <div style={{ width: 240, boxSizing: 'border-box', flex: 'none', padding: '10px 16px', borderRight: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Cleaner</div>
                {SHIFTS.map(s => (
                  <div key={s} style={{ flex: 1, boxSizing: 'border-box', minWidth: 110, padding: '10px 8px', textAlign: 'center', borderLeft: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>{s}</div>
                ))}
              </div>

              {crew.map(c => {
                const lane: (Row | null)[] = Array(SHIFTS.length).fill(null);
                c.jobs.forEach(j => {
                  const at = slotOf(j.dueAt);
                  for (let i = at; i < Math.min(at + 2, SHIFTS.length); i++) lane[i] = j;
                });
                return (
                  <div key={c.id} style={{ display: 'flex', minHeight: 64, borderBottom: `1px solid ${color.borderMuted}` }}>
                    <div style={{ width: 240, boxSizing: 'border-box', flex: 'none', padding: '10px 16px', borderRight: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                        {c.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</span>
                        <span style={{ fontSize: 11.5, color: color.textMuted }}>{c.jobs.length} jobs</span>
                      </div>
                    </div>
                    {lane.map((j, i) => {
                      const first = j && (i === 0 || lane[i - 1] !== j);
                      const tone = j ? READY_TONE[j.readiness] : 'neutral';
                      return (
                        <div key={i} style={{
                          position: 'relative', flex: 1, boxSizing: 'border-box', minWidth: 110,
                          borderLeft: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', padding: '8px 6px',
                          background: j ? T[tone].bg : 'transparent',
                          boxShadow: first ? `inset 3px 0 0 ${T[tone].line}` : undefined,
                        }}>
                          {first && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, paddingLeft: 6 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, color: T[tone].fg, whiteSpace: 'nowrap' }}>{j!.unitNumber}</span>
                              <span style={{ fontSize: text.micro, color: T[tone].fg, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j!.title}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
