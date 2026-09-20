import { useState } from 'react';
import { color, radius, text, tone as T } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { Tone, TaskState } from '../lib/types';

const STATE_TONE: Record<TaskState, Tone> = {
  open: 'neutral', assigned: 'info', in_progress: 'info', waiting: 'warning',
  resolved: 'success', overdue: 'critical', reopened: 'critical',
};
const KIND_LABEL: Record<string, string> = {
  turnover: 'Turnover', deep_clean: 'Deep clean', light_clean: 'Light clean',
  inspection: 'Inspection', maintenance: 'Maintenance', delivery: 'Delivery', other: 'Other',
};

interface Task {
  id: string; title: string; unitNumber: string; propertyName: string; kind: string;
  state: TaskState; assigneeName: string; dueAt: string | null;
  requiresPhoto: boolean; photoCount: number;
}
interface Payload { data: Task[]; total: number }

const FALLBACK: Payload = {
  total: 6,
  data: [
    { id: 'TSK-1042', title: 'Full turnover, 2BR', unitNumber: '#A-21-02', propertyName: 'The Establishment', kind: 'turnover', state: 'overdue', assigneeName: '', dueAt: '16 Sep 14:54', requiresPhoto: true, photoCount: 0 },
    { id: 'TSK-1041', title: 'Deep clean, 1BR', unitNumber: '#15-06', propertyName: 'Scarletz', kind: 'deep_clean', state: 'assigned', assigneeName: 'Faridah Ismail', dueAt: '16 Sep 18:00', requiresPhoto: true, photoCount: 0 },
    { id: 'TSK-1040', title: 'Full turnover, studio', unitNumber: '#B-08-11', propertyName: 'Arcoris', kind: 'turnover', state: 'in_progress', assigneeName: 'Nurul Huda', dueAt: '16 Sep 16:00', requiresPhoto: true, photoCount: 1 },
    { id: 'TSK-1039', title: 'Quality inspection', unitNumber: '#2207', propertyName: 'Tribeca', kind: 'inspection', state: 'assigned', assigneeName: 'Chan Wei Wen', dueAt: '16 Sep 17:30', requiresPhoto: true, photoCount: 0 },
    { id: 'TSK-1038', title: 'Full turnover, 2BR', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', kind: 'turnover', state: 'in_progress', assigneeName: 'Nurul Huda', dueAt: '16 Sep 15:00', requiresPhoto: true, photoCount: 2 },
    { id: 'TSK-1035', title: 'Owner report photos', unitNumber: '#A-09-07', propertyName: 'Vista Jaya One', kind: 'other', state: 'resolved', assigneeName: 'Chan Wei Wen', dueAt: '15 Sep 16:30', requiresPhoto: false, photoCount: 6 },
  ],
};

const COLS = 'minmax(210px,1.8fr) minmax(150px,1.3fr) minmax(120px,1fr) minmax(140px,1.2fr) minmax(130px,1.1fr) minmax(120px,1fr)';
const FILTERS: (TaskState | 'all')[] = ['all', 'overdue', 'assigned', 'in_progress', 'resolved'];
const FILTER_LABEL: Record<string, string> = { all: 'All tasks', overdue: 'Overdue', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved' };

export default function TasksPage() {
  const [filter, setFilter] = useState<TaskState | 'all'>('all');
  const { data, loading, error, reload } = useApi<Payload>(
    filter === 'all' ? '/tasks' : `/tasks?state=${filter}`, FALLBACK);

  const all = data?.data ?? [];
  const rows = filter === 'all' ? all : all.filter(t => t.state === filter);

  /** A task that needs evidence and has none is the thing worth flagging. */
  const evidence = (t: Task) =>
    t.requiresPhoto && t.photoCount === 0
      ? { label: '0 of 1 required', warn: true }
      : { label: t.photoCount > 0 ? `${t.photoCount} attached` : 'None needed', warn: false };

  return (
    <>
      <PageHeader title="Tasks" sub={`${all.filter(t => t.state !== 'resolved').length} open · every task carries its photo requirement`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map(fl => {
          const on = fl === filter;
          return (
            <button key={fl} onClick={() => setFilter(fl)}
              style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {FILTER_LABEL[fl]}
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Task</div><div>Unit</div><div>Kind</div><div>Assignee</div><div>Due</div><div>Evidence</div>
            </div>
            {loading && all.length === 0 ? <TableSkeleton rows={6} cols={6} /> : rows.map(t => {
              const ev = evidence(t);
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 54, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${T[STATE_TONE[t.state]].line}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</span>
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{t.id}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{t.unitNumber}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.propertyName}</span>
                  </div>
                  <div><Badge tone={STATE_TONE[t.state]} label={KIND_LABEL[t.kind] ?? t.kind} /></div>
                  <div style={{ fontSize: 13, color: t.assigneeName ? color.ink : color.textMuted }}>{t.assigneeName || 'Unassigned'}</div>
                  <div style={{ fontSize: 12.5 }}>{t.dueAt ?? '\u2014'}</div>
                  <div style={{ fontSize: 12, color: ev.warn ? T.warning.fg : color.textMuted }}>{ev.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </>
  );
}
