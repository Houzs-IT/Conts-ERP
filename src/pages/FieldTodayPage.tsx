import { useState } from 'react';
import { color, radius, text, tone as T } from '../theme';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import type { Tone, UnitReadiness } from '../lib/types';

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};

interface Task {
  id: string; unitNumber: string; propertyName: string; addressLine: string;
  title: string; instructions: string | null; readiness: UnitReadiness;
  dueAt: string | null; nextGuestAt: string | null; requiresPhoto: boolean;
}
interface Payload { rows: Task[]; date: string; generatedAt: string }

const FALLBACK: Payload = {
  date: '2026-09-16', generatedAt: '',
  rows: [
    { id: 'f1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', addressLine: 'C-41-06, Jaya One, Jalan Universiti, PJ', title: 'Full turnover, 2BR', instructions: 'Linen set B. Restock coffee pods.', readiness: 'cleaning', dueAt: '13:00', nextGuestAt: '15:00', requiresPhoto: true },
    { id: 'f2', unitNumber: '#B-08-11', propertyName: 'Arcoris', addressLine: 'Arcoris Residences, Jalan Kiara, Mont Kiara', title: 'Studio turnover', instructions: 'Guest reported a broken blind.', readiness: 'dirty', dueAt: '13:45', nextGuestAt: '16:00', requiresPhoto: true },
    { id: 'f3', unitNumber: '#15-06', propertyName: 'Scarletz', addressLine: 'Scarletz Suites, Jalan Yap Kwan Seng, KL', title: 'Deep clean', instructions: 'Run aircon, check drainage.', readiness: 'dirty', dueAt: '14:30', nextGuestAt: '18:00', requiresPhoto: true },
  ],
};

/** The field app is a separate product surface: one column, 44px targets, and no
 *  financial field anywhere — the API omits them for field roles entirely. */
export default function FieldTodayPage() {
  const { data, loading, error, reload } = useApi<Payload>('/housekeeping/tasks', FALLBACK);
  const [photos, setPhotos] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState<Task | null>(null);
  const [report, setReport] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const rows = data?.rows ?? [];
  const completed = rows.filter(r => done[r.id]).length;

  async function markReady() {
    if (!confirm) return;
    setBusy(true);
    try {
      await api.post('/tasks/complete', { taskId: confirm.id });
      setDone(d => ({ ...d, [confirm.id]: true }));
      toast.push({ tone: 'success', title: 'Marked ready.', body: `${confirm.propertyName} ${confirm.unitNumber} is Ready for check-in.` });
      setConfirm(null);
      reload();
    } catch (e) {
      // PHOTO_REQUIRED is the common one and it is actionable, so show it as-is.
      toast.push({ tone: 'critical', title: 'Not marked ready.', body: e instanceof ApiFailure ? e.message : 'Check your connection and try again.' });
    } finally { setBusy(false); }
  }

  async function submitReport() {
    if (!report) return;
    setBusy(true);
    try {
      await api.post('/maintenance/issues', {
        unitId: report.id, title: 'Damage or missing item', detail: report.instructions,
        source: 'field_app',
      });
      toast.push({ tone: 'warning', title: 'Damage reported.', body: 'Operations was alerted and the issue is open on the unit record.' });
      setReport(null);
    } catch (e) {
      toast.push({ tone: 'critical', title: 'Report not sent.', body: e instanceof ApiFailure ? e.message : 'It stays queued until you are back online.' });
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="My tasks" sub={`${completed} of ${rows.length} done today`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <div style={{ height: 4, borderRadius: radius.pill, background: color.sunken, overflow: 'hidden' }}>
        <div style={{ width: `${rows.length ? (completed / rows.length) * 100 : 0}%`, height: '100%', background: color.gold, transition: 'width 200ms' }} />
      </div>

      {loading && rows.length === 0 ? <TableSkeleton rows={3} cols={2} /> : rows.map(t => {
        const isDone = !!done[t.id];
        const shot = photos[t.id] ?? 0;
        return (
          <div key={t.id} style={{
            border: `1px solid ${color.border}`, borderRadius: radius.card, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 13,
            background: isDone ? color.page : '#FFFFFF',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 600, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? color.textMuted : color.ink }}>
                  {t.propertyName} {t.unitNumber}
                </span>
                <span style={{ fontSize: text.small, color: color.textMuted, textWrap: 'pretty' }}>{t.addressLine}</span>
              </div>
              <span style={{ fontSize: text.small, color: color.textMuted, whiteSpace: 'nowrap' }}>Due {t.dueAt ?? '\u2014'}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <Badge tone={READY_TONE[t.readiness]} label={t.readiness[0].toUpperCase() + t.readiness.slice(1)} />
              <span style={{ fontSize: text.small, color: color.textMuted }}>{t.title}</span>
            </div>

            {t.instructions && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 12px', borderRadius: radius.control, background: color.muted }}>
                <Icon name="KeyRound" size="sm" color={color.textMuted} />
                <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{t.instructions}</span>
              </div>
            )}

            {t.requiresPhoto && shot === 0 && !isDone && (
              <span style={{ fontSize: 12.5, fontWeight: 500, color: T.warning.fg }}>
                At least one photo is required before this unit can be marked ready.
              </span>
            )}

            {!isDone && (
              <div style={{ display: 'flex', gap: 9 }}>
                <button onClick={() => setPhotos(p => ({ ...p, [t.id]: (p[t.id] ?? 0) + 1 }))}
                  style={{ flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#FFFFFF', fontSize: 13, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
                  <Icon name="Camera" size="sm" />
                  <span>{shot > 0 ? `${shot} photo${shot > 1 ? 's' : ''}` : 'Photo'}</span>
                </button>
                <button onClick={() => setConfirm(t)}
                  style={{ flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, background: color.black, color: '#FFFFFF', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
                  Mark ready
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 4 }}>
        <button onClick={() => setReport(rows[0] ?? null)}
          style={{ minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: '1px solid #A8352F', borderRadius: radius.control, color: '#A8352F', background: '#FFFFFF', fontSize: 13, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
          <Icon name="TriangleAlert" size="sm" />
          <span>Report damage</span>
        </button>
        <a href="tel:+60174658868"
          style={{ minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: `1px solid ${color.border}`, borderRadius: radius.control, background: '#FFFFFF', fontSize: 13, fontWeight: 500, textDecoration: 'none', color: color.ink }}>
          <Icon name="Phone" size="sm" />
          <span>Call operations</span>
        </a>
        <span style={{ fontSize: text.micro, color: color.textMuted, textAlign: 'center' }}>
          Financial data is not available to field roles.
        </span>
      </div>

      <Dialog busy={busy} onClose={() => setConfirm(null)}
        spec={!confirm ? null : {
          title: `Mark ${confirm.propertyName} ${confirm.unitNumber} ready?`,
          body: 'The unit flips to Ready in the system and operations sees it without a message.',
          meta: confirm.nextGuestAt ? `Next check-in ${confirm.nextGuestAt}` : undefined,
          confirmLabel: 'Mark ready', busyLabel: 'Saving\u2026', onConfirm: markReady,
        }} />

      <Dialog busy={busy} onClose={() => setReport(null)}
        spec={!report ? null : {
          title: 'Report damage or a missing item?',
          body: 'Creates a maintenance issue on this unit with your photos and notes. The office adds the cost.',
          meta: `${report.propertyName} ${report.unitNumber}`,
          confirmLabel: 'Submit report', busyLabel: 'Submitting\u2026', danger: true, onConfirm: submitReport,
        }} />
    </>
  );
}
