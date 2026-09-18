import { color, radius, text, tone as T } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import type { Tone, TaskState } from '../lib/types';

const STATE_TONE: Record<TaskState, Tone> = {
  open: 'neutral', assigned: 'info', in_progress: 'info', waiting: 'warning',
  resolved: 'success', overdue: 'critical', reopened: 'critical',
};
const STATE_LABEL: Record<TaskState, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting: 'Waiting',
  resolved: 'Resolved', overdue: 'Overdue', reopened: 'Reopened',
};

interface Check { item: string; ok: boolean | null; note?: string }
interface Inspection {
  id: string; unitNumber: string; propertyName: string; inspector: string | null;
  state: TaskState; passed: boolean | null; checklist: Check[]; notes: string | null; inspectedAt: string | null;
}
interface Payload { data: Inspection[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'INS-0416', unitNumber: '#2207', propertyName: 'Tribeca', inspector: 'Chan Wei Wen', state: 'assigned', passed: null, inspectedAt: null, notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: null },
      { item: 'Bathroom sealed and dry', ok: null },
      { item: 'Consumables restocked', ok: null },
      { item: 'Aircon cooling within 10 minutes', ok: null },
      { item: 'Wifi reachable at 20 Mbps', ok: null },
    ] },
    { id: 'INS-0415', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', inspector: 'Chan Wei Wen', state: 'resolved', passed: true, inspectedAt: '15 Sep 16:10', notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: true },
      { item: 'Bathroom sealed and dry', ok: true },
      { item: 'Consumables restocked', ok: true },
      { item: 'Aircon cooling within 10 minutes', ok: true },
      { item: 'Wifi reachable at 20 Mbps', ok: true },
    ] },
    { id: 'INS-0414', unitNumber: '#15-06', propertyName: 'Scarletz', inspector: 'Aina Zulkifli', state: 'reopened', passed: false, inspectedAt: '14 Sep 11:40', notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: true },
      { item: 'Bathroom sealed and dry', ok: false, note: 'Silicone lifting behind the basin. Raised as MNT-0913.' },
      { item: 'Consumables restocked', ok: true },
      { item: 'Aircon cooling within 10 minutes', ok: false, note: 'Reached 26\u00b0C only. Service booked.' },
      { item: 'Wifi reachable at 20 Mbps', ok: true },
    ] },
  ],
};

export default function InspectionsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/inspections', FALLBACK);
  const toast = useToast();
  const rows = data?.data ?? [];

  async function start(r: Inspection) {
    try {
      await api.post('/inspections', { unitId: r.id });
      toast({ tone: 'success', title: 'Inspection started.', body: `Checklist opened for ${r.propertyName} ${r.unitNumber}.` });
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Could not start.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
    }
  }

  return (
    <>
      <PageHeader title="Inspections" sub="A unit is released for check-in only after a pass. Every failed item needs a note." />

      {error && <StaleBanner message={`Showing the last inspections we have. ${error}`} onRetry={reload} />}

      {loading && rows.length === 0 ? <Card><TableSkeleton rows={5} cols={2} /></Card> : rows.map(r => {
        const done = r.checklist.filter(c => c.ok !== null).length;
        return (
          <Card key={r.id}>
            <div style={{ padding: '15px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{r.id}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{r.propertyName} {r.unitNumber}</span>
                  <Badge tone={STATE_TONE[r.state]} label={STATE_LABEL[r.state]} />
                  {r.passed === false && <Badge tone="critical" label="Not released" />}
                </div>
                <span style={{ fontSize: text.small, color: color.textMuted }}>
                  {r.inspector ?? 'Unassigned'}{r.inspectedAt ? ` · ${r.inspectedAt}` : ''} &middot; {done} of {r.checklist.length} checked
                </span>
              </div>
              {r.passed === null && (
                <button onClick={() => start(r)} style={{ height: 34, padding: '0 13px', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 12.5, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
                  Start inspection
                </button>
              )}
            </div>
            {r.checklist.map(c => (
              <div key={c.item} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <span style={{ width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: radius.xs, display: 'grid', placeItems: 'center',
                  border: `1px solid ${c.ok === null ? color.border : c.ok ? T.success.line : T.critical.line}`,
                  background: c.ok === null ? '#FFFFFF' : c.ok ? T.success.line : T.critical.line, color: '#FFFFFF' }}>
                  {c.ok !== null && <Icon name={c.ok ? 'Check' : 'X'} size="sm" />}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: c.ok === false ? T.critical.fg : color.ink }}>{c.item}</span>
                  {c.note && <span style={{ fontSize: 12, color: T.critical.fg, textWrap: 'pretty' }}>{c.note}</span>}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
    </>
  );
}
