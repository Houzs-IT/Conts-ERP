import { useState } from 'react';
import { color, radius, text, tone as T } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import type { Tone, UnitReadiness } from '../lib/types';

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};
const READY_LABEL = (r: string) => r[0].toUpperCase() + r.slice(1);

interface Row {
  id: string; unitNumber: string; propertyName: string; title: string; instructions: string | null;
  readiness: UnitReadiness; nextGuestAt: string | null; dueAt: string | null;
  assigneeId: string | null; assigneeName: string | null;
  sla: { label: string; tone: Tone };
}
interface Payload { rows: Row[]; date: string; generatedAt: string }

const FALLBACK: Payload = {
  date: '2026-09-16', generatedAt: '',
  rows: [
    { id: 't1', unitNumber: '#A-21-02', propertyName: 'The Establishment', title: 'Turnover, 2BR', instructions: 'Linen set A. No cleaner assigned.', readiness: 'dirty', nextGuestAt: '15:00', dueAt: '14:54', assigneeId: null, assigneeName: null, sla: { label: 'Overdue 12 min', tone: 'critical' } },
    { id: 't2', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', title: 'Plumbing works', instructions: 'Vendor on site.', readiness: 'maintenance', nextGuestAt: null, dueAt: null, assigneeId: 'v1', assigneeName: 'AquaFix', sla: { label: 'Escalated', tone: 'critical' } },
    { id: 't3', unitNumber: '#15-06', propertyName: 'Scarletz KLCC', title: 'Deep clean', instructions: 'Vacant 4 nights.', readiness: 'dirty', nextGuestAt: '18:00', dueAt: '16:30', assigneeId: 'u6', assigneeName: 'Faridah Ismail', sla: { label: 'Due in 1 h 20 m', tone: 'warning' } },
    { id: 't4', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara', title: 'Turnover, studio', instructions: 'Early check-in requested.', readiness: 'cleaning', nextGuestAt: '16:00', dueAt: '15:30', assigneeId: 'u5', assigneeName: 'Nurul Huda', sla: { label: 'Due in 2 h', tone: 'warning' } },
    { id: 't5', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Turnover, 2BR', instructions: 'Late check-out to 13:00.', readiness: 'cleaning', nextGuestAt: '15:00', dueAt: '14:30', assigneeId: 'u5', assigneeName: 'Nurul Huda', sla: { label: 'On track', tone: 'success' } },
  ],
};

const CREW = [
  { id: 'u5', name: 'Nurul Huda' },
  { id: 'u6', name: 'Faridah Ismail' },
  { id: 'u9', name: 'Siti Rahmah' },
];

const FILTERS = ['All work', 'Check-in risk', 'Unassigned'];
const COLS = 'minmax(210px,1.8fr) minmax(150px,1.3fr) minmax(100px,1fr) minmax(90px,0.8fr) minmax(120px,1fr) minmax(150px,1.2fr)';

export default function OperationsTodayPage() {
  const [filter, setFilter] = useState('All work');
  const { data, loading, error, reload } = useApi<Payload>('/housekeeping/tasks', FALLBACK);
  const [assign, setAssign] = useState<{ row: Row; cleanerId: string; force: boolean; warning?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const all = data?.rows ?? [];
  const rows = filter === 'Check-in risk' ? all.filter(r => r.sla.tone === 'critical')
    : filter === 'Unassigned' ? all.filter(r => !r.assigneeId) : all;

  async function doAssign() {
    if (!assign) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; assigneeName: string }>('/housekeeping/assign', {
        taskId: assign.row.id, assigneeId: assign.cleanerId, force: assign.force,
      });
      toast({ tone: 'success', title: 'Cleaner assigned.', body: `${res.assigneeName} has been notified.` });
      setAssign(null);
      reload();
    } catch (e) {
      // 409 ASSIGNEE_BUSY is a warning, not a refusal — confirm and retry with force.
      if (e instanceof ApiFailure && e.code === 'ASSIGNEE_BUSY') {
        setAssign(a => a && { ...a, force: true, warning: e.message });
      } else {
        toast({ tone: 'critical', title: 'Could not assign.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
        setAssign(null);
      }
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Today" sub={`Wed 16 Sep &middot; ${rows.length} items need action`} />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map(fl => {
          const on = fl === filter;
          return (
            <button key={fl} onClick={() => setFilter(fl)}
              style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {fl}
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div><div>Work</div><div>Readiness</div><div>Next</div><div>SLA</div><div>Assignee</div>
            </div>

            {loading && all.length === 0 ? <TableSkeleton rows={5} cols={6} /> : rows.length === 0 ? (
              <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13 }}>No work matches these filters.</span>
                <button onClick={() => setFilter('All work')} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear filters</button>
              </div>
            ) : rows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '10px 22px', borderBottom: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${T[r.sla.tone].line}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>{r.propertyName}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{r.title}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.instructions}</span>
                </div>
                <div><Badge tone={READY_TONE[r.readiness]} label={READY_LABEL(r.readiness)} /></div>
                <div style={{ fontSize: 13 }}>{r.nextGuestAt ?? '\u2014'}</div>
                <div><Badge tone={r.sla.tone} label={r.sla.label} /></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: r.assigneeName ? color.ink : color.textMuted }}>{r.assigneeName ?? 'Unassigned'}</span>
                  <button onClick={() => setAssign({ row: r, cleanerId: CREW[0].id, force: false })}
                    style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.ink, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
                    {r.assigneeId ? 'Reassign' : 'Assign cleaner'} &rarr;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Dialog
        busy={busy}
        onClose={() => setAssign(null)}
        spec={!assign ? null : {
          title: `Assign a cleaner to ${assign.row.propertyName} ${assign.row.unitNumber}?`,
          body: assign.warning
            ?? 'They are notified immediately. The unit stays in its current state until they mark it ready with a photo.',
          meta: assign.row.nextGuestAt ? `Next guest arrives ${assign.row.nextGuestAt}` : undefined,
          confirmLabel: assign.force ? 'Assign anyway' : 'Assign cleaner',
          busyLabel: 'Assigning\u2026',
          danger: assign.force,
          onConfirm: doAssign,
        }}
      />
    </>
  );
}
