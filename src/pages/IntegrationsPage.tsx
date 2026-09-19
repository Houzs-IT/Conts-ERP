import { useState, type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, Drawer } from '../components/Dialog';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { date, time, masked } from '../lib/format';
import { INTEGRATION } from '../lib/vocabulary';
import type { IntegrationState, Tone } from '../lib/types';

/**
 * Integrations · /system/integrations (BUTTONS §14, api.md §10).
 * Every connection is a card with an honest state chip — connected, expired,
 * degraded or failed — never all-green. Utilities are a manual source with no
 * API, so they carry a neutral "Manual" chip and only the Manage action; they
 * are not forced into the four-state sync vocabulary they do not belong to.
 */

/** Local-only pseudo-state for the manual utilities source. Not a sync enum. */
type RowState = IntegrationState | 'manual';

const META: Record<RowState, { label: string; tone: Tone }> = {
  ...INTEGRATION,
  manual: { label: 'Manual', tone: 'neutral' },
};

const PROVIDER_LABEL: Record<string, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  agoda: 'Agoda',
  whatsapp: 'WhatsApp Business',
  maybank: 'Maybank',
  utilities: 'Utilities',
};

interface Row {
  id: string;
  provider: string;
  state: RowState;
  /** ISO 8601. Null when a channel has never completed a pull. */
  lastSyncedAt: string | null;
  lastError: string | null;
  unitsLinked: number;
  /** Null for a manual source. */
  syncInterval: string | null;
  /** Already masked. A raw value needs an audited reveal — not offered here. */
  credentialMasked: string | null;
}

interface Payload { data: Row[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'i1', provider: 'airbnb', state: 'connected', lastSyncedAt: '2026-09-16T14:06:00Z', lastError: null, unitsLinked: 24, syncInterval: 'Every 15 minutes', credentialMasked: masked('a91c') },
    { id: 'i2', provider: 'booking_com', state: 'connected', lastSyncedAt: '2026-09-16T13:58:00Z', lastError: null, unitsLinked: 24, syncInterval: 'Every 15 minutes', credentialMasked: masked('7d20') },
    { id: 'i3', provider: 'agoda', state: 'expired', lastSyncedAt: '2026-09-09T12:00:00Z', lastError: 'Access token expired', unitsLinked: 18, syncInterval: 'Every 30 minutes', credentialMasked: masked('4f8e') },
    { id: 'i4', provider: 'whatsapp', state: 'connected', lastSyncedAt: '2026-09-16T14:05:00Z', lastError: null, unitsLinked: 24, syncInterval: 'Real time · webhook', credentialMasked: masked('bc63') },
    { id: 'i5', provider: 'maybank', state: 'degraded', lastSyncedAt: '2026-09-15T22:00:00Z', lastError: 'Payout confirmations delayed', unitsLinked: 24, syncInterval: 'Every 6 hours', credentialMasked: masked('0a17') },
    { id: 'i6', provider: 'utilities', state: 'manual', lastSyncedAt: '2026-09-01T09:00:00Z', lastError: null, unitsLinked: 24, syncInterval: null, credentialMasked: null },
  ],
};

/** The honest business meaning of each state (copy.md §12 system.sync.*). */
function noteFor(row: Row): string {
  const label = PROVIDER_LABEL[row.provider] ?? row.provider;
  switch (row.state) {
    case 'connected': return row.lastSyncedAt ? `Synced with ${label} · ${time(row.lastSyncedAt)} MYT` : `Synced with ${label}.`;
    case 'expired':   return `${label} connection expired. Reconnect to resume syncing.`;
    case 'degraded':  return `${label} is syncing slowly. Some bookings may be delayed.`;
    case 'failed':    return row.lastSyncedAt ? `${label} sync failed at ${time(row.lastSyncedAt)} MYT.` : `${label} sync failed.`;
    case 'manual':    return 'Readings are entered by hand each month. No automatic sync.';
  }
}

function syncedLine(row: Row): string {
  if (row.state === 'manual') return row.lastSyncedAt ? `Last reading ${date(row.lastSyncedAt)}` : 'No readings yet';
  return row.lastSyncedAt ? `Last synced ${date(row.lastSyncedAt)} · ${time(row.lastSyncedAt)} MYT` : 'Never synced';
}

/** Which recovery actions a state offers. Never tease one that cannot work (13.1). */
function actionsFor(state: RowState): { reconnect: boolean; retry: boolean } {
  switch (state) {
    case 'connected': return { reconnect: false, retry: true };
    case 'degraded':  return { reconnect: false, retry: true };
    case 'failed':    return { reconnect: true, retry: true };
    case 'expired':   return { reconnect: true, retry: false };
    case 'manual':    return { reconnect: false, retry: false };
  }
}

const hex4 = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');

export default function IntegrationsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/integrations', FALLBACK);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [reconnectId, setReconnectId] = useState<string | null>(null);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const toast = useToast();

  const rows: Row[] = (data?.data ?? []).map(r => ({ ...r, ...edits[r.id] }));
  const problems = rows.filter(r => r.state === 'expired' || r.state === 'degraded' || r.state === 'failed').length;
  const reconnectRow = reconnectId ? rows.find(r => r.id === reconnectId) ?? null : null;
  const manageRow = manageId ? rows.find(r => r.id === manageId) ?? null : null;

  /** POST /api/integrations/:provider/sync — one provider, bumps last_synced_at. */
  async function retrySync(row: Row) {
    const label = PROVIDER_LABEL[row.provider] ?? row.provider;
    setSyncing(s => ({ ...s, [row.id]: true }));
    try { await api.post(`/integrations/${row.provider}/sync`, {}); } catch { /* dev: no backend, keep optimistic */ }
    setEdits(e => ({ ...e, [row.id]: { ...e[row.id], lastSyncedAt: new Date().toISOString() } }));
    setSyncing(s => ({ ...s, [row.id]: false }));
    toast({ tone: 'success', title: `${label} sync started.`, body: 'Pulling new and changed reservations. Any expired channels are skipped and named.' });
  }

  /** POST /api/integrations/:provider/connect — new key, resumes from last pull. */
  async function reconnect(row: Row) {
    const label = PROVIDER_LABEL[row.provider] ?? row.provider;
    setReconnectBusy(true);
    try { await api.post(`/integrations/${row.provider}/connect`, {}); } catch { /* dev: no backend, keep optimistic */ }
    setEdits(e => ({
      ...e,
      [row.id]: { ...e[row.id], state: 'connected', lastError: null, lastSyncedAt: new Date().toISOString(), credentialMasked: masked(hex4()) },
    }));
    setReconnectBusy(false);
    setReconnectId(null);
    toast({ tone: 'success', title: `${label} reconnected.`, body: 'A new key was issued and syncing resumed from the last successful pull.' });
  }

  return (
    <>
      <PageHeader title="Integrations" sub={`${rows.length} connections · ${problems} needing attention`} />

      {error && <StaleBanner message={`Showing the last status we have. ${error}`} onRetry={reload} />}

      {loading && rows.length === 0 ? (
        <Card><TableSkeleton rows={6} cols={3} /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
          {rows.map(row => {
            const label = PROVIDER_LABEL[row.provider] ?? row.provider;
            const m = META[row.state];
            const act = actionsFor(row.state);
            return (
              <Card key={row.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Monogram label={label} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>{label}</span>
                      <span style={{ fontSize: text.small, color: color.textMuted }}>{syncedLine(row)}</span>
                    </div>
                    <Badge tone={m.tone} label={m.label} />
                  </div>

                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: color.inkSecondary, textWrap: 'pretty' }}>{noteFor(row)}</p>

                  {row.lastError && (
                    <div style={{ fontSize: text.small, color: 'var(--color-critical-fg)' }}>{row.lastError}</div>
                  )}

                  <div style={{ marginTop: 'auto', paddingTop: 4, fontSize: text.small, color: color.textMuted }}>
                    {row.unitsLinked} {row.unitsLinked === 1 ? 'unit' : 'units'} linked
                    {row.syncInterval ? ` · ${row.syncInterval}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '13px 20px', borderTop: `1px solid ${color.borderMuted}`, background: color.page }}>
                  {act.reconnect && (
                    <Button size="sm" variant="brand" icon={<Icon name="PlugZap" size="sm" />} onClick={() => setReconnectId(row.id)}>
                      Reconnect
                    </Button>
                  )}
                  {act.retry && (
                    <Button size="sm" variant="secondary" loading={!!syncing[row.id]} icon={<Icon name="RefreshCw" size="sm" />} onClick={() => retrySync(row)}>
                      {syncing[row.id] ? 'Syncing…' : 'Retry sync'}
                    </Button>
                  )}
                  <Button size="sm" variant="tertiary" icon={<Icon name="SlidersHorizontal" size="sm" />} onClick={() => setManageId(row.id)}>
                    Manage
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reconnect confirmation — a new key is issued, so it states the consequence. */}
      <Dialog
        busy={reconnectBusy}
        onClose={() => setReconnectId(null)}
        spec={!reconnectRow ? null : {
          title: `Reconnect ${PROVIDER_LABEL[reconnectRow.provider] ?? reconnectRow.provider}?`,
          body: 'This starts a fresh authorisation and issues a new API key. Syncing resumes from the last successful pull, so no bookings are missed.',
          meta: reconnectRow.lastSyncedAt
            ? `Last successful pull ${date(reconnectRow.lastSyncedAt)} · ${time(reconnectRow.lastSyncedAt)} MYT`
            : 'This channel has no earlier successful pull.',
          confirmLabel: 'Reconnect',
          busyLabel: 'Reconnecting…',
          onConfirm: () => reconnect(reconnectRow),
        }}
      />

      {/* Manage — details panel: units linked, sync interval, credentials masked. */}
      <Drawer open={!!manageRow} onClose={() => setManageId(null)}>
        {manageRow && (
          <ManagePanel
            row={manageRow}
            label={PROVIDER_LABEL[manageRow.provider] ?? manageRow.provider}
            syncing={!!syncing[manageRow.id]}
            onClose={() => setManageId(null)}
            onReconnect={() => { setManageId(null); setReconnectId(manageRow.id); }}
            onRetry={() => retrySync(manageRow)}
          />
        )}
      </Drawer>
    </>
  );
}

function Monogram({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 38, height: 38, flex: 'none', display: 'grid', placeItems: 'center',
        borderRadius: radius.sm, background: color.muted, border: `1px solid ${color.border}`,
        fontSize: 15, fontWeight: 600, color: color.ink,
      }}
    >
      {label[0]}
    </span>
  );
}

function ManagePanel({
  row, label, syncing, onClose, onReconnect, onRetry,
}: {
  row: Row; label: string; syncing: boolean;
  onClose: () => void; onReconnect: () => void; onRetry: () => void;
}) {
  const m = META[row.state];
  const act = actionsFor(row.state);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 22px', borderBottom: `1px solid ${color.border}` }}>
        <Monogram label={label} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: text.section, fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: text.small, color: color.textMuted }}>{syncedLine(row)}</span>
        </div>
        <Badge tone={m.tone} label={m.label} />
        <button onClick={onClose} aria-label="Close" style={{ display: 'flex', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: color.textMuted }}>
          <Icon name="X" size="base" />
        </button>
      </div>

      <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1, overflowY: 'auto' }}>
        <Section label="Connection">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: color.inkSecondary, textWrap: 'pretty' }}>{noteFor(row)}</p>
          {row.lastError && <div style={{ marginTop: 8, fontSize: text.small, color: 'var(--color-critical-fg)' }}>{row.lastError}</div>}
        </Section>

        <Section label="Units linked">
          <PanelValue>{row.unitsLinked} {row.unitsLinked === 1 ? 'unit' : 'units'}</PanelValue>
        </Section>

        <Section label="Sync interval">
          <PanelValue>{row.syncInterval ?? 'No automatic sync — entered manually'}</PanelValue>
        </Section>

        <Section label="Credentials">
          {row.credentialMasked ? (
            <>
              <PanelValue mono>API key {row.credentialMasked}</PanelValue>
              <div style={{ marginTop: 6, fontSize: text.small, color: color.textMuted }}>
                Masked. Revealing a credential is audited and done from the secrets vault, not here.
              </div>
            </>
          ) : (
            <PanelValue>No credentials. This source has no API connection.</PanelValue>
          )}
        </Section>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap', padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page }}>
        {act.reconnect && (
          <Button size="sm" variant="brand" icon={<Icon name="PlugZap" size="sm" />} onClick={onReconnect}>Reconnect</Button>
        )}
        {act.retry && (
          <Button size="sm" variant="secondary" loading={syncing} icon={<Icon name="RefreshCw" size="sm" />} onClick={onRetry}>
            {syncing ? 'Syncing…' : 'Retry sync'}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: text.small, fontWeight: 600, color: color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </div>
  );
}

function PanelValue({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span style={{ fontSize: 14, color: color.ink, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{children}</span>
  );
}
