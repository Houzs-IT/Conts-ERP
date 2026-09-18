import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { rm } from '../lib/format';
import type { Tone, TaskState } from '../lib/types';

const STATE_TONE: Record<TaskState, Tone> = {
  open: 'neutral', assigned: 'info', in_progress: 'info', waiting: 'warning',
  resolved: 'success', overdue: 'critical', reopened: 'critical',
};
const STATE_LABEL: Record<TaskState, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting: 'Waiting',
  resolved: 'Resolved', overdue: 'Overdue', reopened: 'Reopened',
};
const CHARGE_LABEL: Record<string, string> = { owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty' };

interface Issue {
  id: string; unitNumber: string; propertyName: string; title: string; detail: string | null;
  state: TaskState; vendorName: string | null; quotedAmount: number | null; finalAmount: number | null;
  ownerApprovalRequired: boolean; blocksUnit: boolean; reportedAt: string; chargeTo: string;
}
interface Payload { data: Issue[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'MNT-0914', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', title: 'Plumbing works', detail: 'Riser replacement. Unit offline until 22 Sep.', state: 'in_progress', vendorName: 'AquaFix', quotedAmount: 320000, finalAmount: null, ownerApprovalRequired: false, blocksUnit: true, reportedAt: '14 Sep', chargeTo: 'owner' },
    { id: 'MNT-0912', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Curtain replacement quoted', detail: 'Blackout curtains, 3 windows. Awaiting owner approval.', state: 'waiting', vendorName: 'Kiara Interiors', quotedAmount: 89000, finalAmount: null, ownerApprovalRequired: true, blocksUnit: false, reportedAt: '12 Sep', chargeTo: 'owner' },
    { id: 'MNT-0916', unitNumber: '#B-08-11', propertyName: 'Arcoris', title: 'Broken blind, living room', detail: 'Guest reported on arrival. Inspect before next stay.', state: 'open', vendorName: null, quotedAmount: null, finalAmount: null, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '16 Sep', chargeTo: 'owner' },
    { id: 'MNT-0910', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Aircon service', detail: 'Quarterly service. Gas top-up not required.', state: 'resolved', vendorName: 'CoolCare', quotedAmount: null, finalAmount: 18000, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '10 Sep', chargeTo: 'owner' },
    { id: 'MNT-0828', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Water heater replaced', detail: 'Guest reported no hot water. Same-day replacement.', state: 'resolved', vendorName: 'In-house crew', quotedAmount: null, finalAmount: 64000, ownerApprovalRequired: false, blocksUnit: false, reportedAt: '28 Aug', chargeTo: 'warranty' },
  ],
};

const FILTERS = ['All', 'Needs approval', 'Blocking a unit', 'Open', 'Resolved'];

export default function MaintenancePage() {
  const [filter, setFilter] = useState('All');
  const { data, loading, error, reload } = useApi<Payload>('/maintenance/issues', FALLBACK);
  const [send, setSend] = useState<Issue | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const all = data?.data ?? [];
  const rows = all.filter(i =>
    filter === 'All' ? true
    : filter === 'Needs approval' ? i.ownerApprovalRequired
    : filter === 'Blocking a unit' ? i.blocksUnit
    : filter === 'Resolved' ? i.state === 'resolved'
    : i.state !== 'resolved');

  async function sendForApproval() {
    if (!send) return;
    setBusy(true);
    try {
      await api.post('/messages', { threadId: send.id, body: `Approval requested for ${send.title}` });
      toast({ tone: 'success', title: 'Sent for approval.', body: 'The owner was emailed and the request is on their portal.' });
      setSend(null);
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Could not send.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Maintenance" sub={`${all.filter(i => i.state !== 'resolved').length} open &middot; ${all.filter(i => i.ownerApprovalRequired).length} awaiting owner approval &middot; ${all.filter(i => i.blocksUnit).length} blocking a unit`} />

      {error && <StaleBanner message={`Showing the last issues we have. ${error}`} onRetry={reload} />}

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
        {loading && all.length === 0 ? <TableSkeleton rows={4} cols={3} /> : rows.length === 0 ? (
          <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13 }}>No maintenance issues match these filters.</span>
            <button onClick={() => setFilter('All')} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear filters</button>
          </div>
        ) : rows.map(i => (
          <div key={i.id} style={{ padding: '15px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 220, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{i.id}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{i.title}</span>
                  <Badge tone={STATE_TONE[i.state]} label={STATE_LABEL[i.state]} />
                  {i.blocksUnit && <Badge tone="critical" label="Blocks the unit" />}
                </div>
                <span style={{ fontSize: text.small, color: color.textMuted }}>
                  {i.propertyName} {i.unitNumber} &middot; reported {i.reportedAt}{i.vendorName ? ` · ${i.vendorName}` : ''}
                </span>
                <span style={{ fontSize: 13, textWrap: 'pretty' }}>{i.detail}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>
                  {i.finalAmount != null ? rm(i.finalAmount) : i.quotedAmount != null ? rm(i.quotedAmount) : '\u2014'}
                </span>
                <span style={{ fontSize: text.micro, color: color.textMuted }}>
                  {i.finalAmount != null ? 'Final' : i.quotedAmount != null ? 'Quoted' : 'Not quoted'} &middot; {CHARGE_LABEL[i.chargeTo] ?? i.chargeTo}
                </span>
              </div>
            </div>

            {i.ownerApprovalRequired && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: radius.control, background: color.goldTint, border: `1px solid ${color.gold200}` }}>
                <span style={{ fontSize: 12.5, color: color.goldInk, flex: 1, minWidth: 200 }}>
                  The owner must approve {rm(i.quotedAmount!)} before this is scheduled.
                </span>
                <button onClick={() => setSend(i)} style={{ height: 34, padding: '0 13px', borderRadius: radius.control, border: 'none', background: color.black, color: '#FFFFFF', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
                  Send for approval
                </button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Dialog
        busy={busy}
        onClose={() => setSend(null)}
        spec={!send ? null : {
          title: `Send ${rm(send.quotedAmount ?? 0)} to the owner for approval?`,
          body: 'They receive the quote, the reason and what happens if they decline. Work is not scheduled until they approve.',
          meta: `${send.propertyName} ${send.unitNumber} · ${send.vendorName ?? 'no vendor yet'}`,
          confirmLabel: 'Send', busyLabel: 'Sending\u2026', onConfirm: sendForApproval,
        }}
      />
    </>
  );
}
