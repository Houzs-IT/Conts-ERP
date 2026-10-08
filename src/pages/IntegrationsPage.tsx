import { useState, type ReactNode } from 'react';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, Drawer } from '../components/Dialog';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import ChannexSyncPanel from '../components/ChannexSyncPanel';
import { api } from '../lib/api';
import { date, timeWithZone, masked } from '../lib/format';
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
type RowState = IntegrationState | 'manual' | 'not_connected';

const META: Record<RowState, { label: string; tone: Tone }> = {
  ...INTEGRATION,
  manual: { label: 'Manual', tone: 'neutral' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
};

const PROVIDER_LABEL: Record<string, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  agoda: 'Agoda',
  whatsapp: 'WhatsApp Business',
  email: 'Email (Resend)',
  bank: 'Bank transfers',
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
  /** Airbnb, Booking.com and Agoda: connected per unit through Channex; status comes from the real connections. */
  viaChannex?: boolean;
  unitsLinked: number;
  /** Null for a manual source. */
  syncInterval: string | null;
  /** Already masked. A raw value needs an audited reveal — not offered here. */
  credentialMasked: string | null;
  /** Server's plain-English state and next step, where it knows better than the generic line. */
  detail?: string | null;
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
  if (row.detail) return row.detail;
  const label = PROVIDER_LABEL[row.provider] ?? row.provider;
  switch (row.state) {
    case 'not_connected': return row.viaChannex ? `No unit is connected to ${label} yet. Connect one from the unit's Channels card (Properties, then Units).` : `${label} is not connected.`;
    case 'connected': return row.viaChannex
      ? 'Connected through Channex. Prices and open dates are sent as they change, and bookings arrive automatically.'
      : row.provider === 'email' || row.provider === 'whatsapp' ? `Set up. Messages go out as they are sent${row.lastSyncedAt ? `; the last one at ${timeWithZone(row.lastSyncedAt)}` : ''}.`
      : row.lastSyncedAt ? `Synced with ${label} · ${timeWithZone(row.lastSyncedAt)}` : `Synced with ${label}.`;
    case 'expired':   return `${label} connection expired. Reconnect to resume syncing.`;
    case 'degraded':  return row.viaChannex ? `Some updates to ${label} were refused.` : `${label} is syncing slowly. Some bookings may be delayed.`;
    case 'failed':    return row.lastSyncedAt ? `${label} sync failed at ${timeWithZone(row.lastSyncedAt)}.` : `${label} sync failed.`;
    case 'manual':    return 'Readings are entered by hand each month. No automatic sync.';
  }
}

function syncedLine(row: Row): string {
  if (row.state === 'manual') return row.provider === 'bank' ? 'Recorded by hand' : row.lastSyncedAt ? `Last reading ${date(row.lastSyncedAt)}` : 'Entered by hand';
  if (row.provider === 'email' || row.provider === 'whatsapp') return row.state === 'not_connected' ? 'Key not set' : row.lastSyncedAt ? `Last sent ${date(row.lastSyncedAt)}` : 'Nothing sent yet';
  if (row.state === 'not_connected') return 'Through Channex';
  if (row.viaChannex) return row.lastSyncedAt ? `Last update sent ${date(row.lastSyncedAt)} · ${timeWithZone(row.lastSyncedAt)}` : 'No updates sent yet';
  return row.lastSyncedAt ? `Last synced ${date(row.lastSyncedAt)} · ${timeWithZone(row.lastSyncedAt)}` : 'Never synced';
}

/** Which recovery actions a state offers. Never tease one that cannot work (13.1). */
function actionsFor(state: RowState, row?: Row): { reconnect: boolean; retry: boolean } {
  // Only the booking sites have a sync to retry; email, WhatsApp, bank and utilities do not.
  if (row && !row.viaChannex) return { reconnect: false, retry: false };
  switch (state) {
    case 'connected': return { reconnect: false, retry: true };
    case 'degraded':  return { reconnect: false, retry: true };
    case 'failed':    return { reconnect: true, retry: true };
    case 'expired':   return { reconnect: true, retry: false };
    case 'manual':    return { reconnect: false, retry: false };
    case 'not_connected': return { reconnect: false, retry: false };
  }
}


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
    try {
      await api.post(`/integrations/${row.provider}/sync`, {});
      setEdits(e => ({ ...e, [row.id]: { ...e[row.id], lastSyncedAt: new Date().toISOString() } }));
      toast({ tone: 'success', title: `${label} sync started.`, body: 'Pulling new and changed reservations. Any expired channels are skipped and named.' });
    } catch (e) {
      toast({ tone: 'critical', title: `${label} did not sync.`, body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally {
      setSyncing(s => ({ ...s, [row.id]: false }));
    }
  }

  /** POST /api/integrations/:provider/connect — new key, resumes from last pull. */
  async function reconnect(row: Row) {
    const label = PROVIDER_LABEL[row.provider] ?? row.provider;
    setReconnectBusy(true);
    try {
      await api.post(`/integrations/${row.provider}/connect`, {});
      setReconnectId(null);
      reload();
      toast({ tone: 'success', title: `${label} reconnect requested.` });
    } catch (e) {
      toast({ tone: 'critical', title: `${label} was not reconnected.`, body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally {
      setReconnectBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Integrations" sub={`${rows.filter(r => r.state === 'connected' || r.state === 'degraded').length} connected · ${rows.filter(r => r.state === 'not_connected').length} not connected · ${problems} needing attention`}
        right={<Button size="sm" variant="secondary" icon={<Icon name="FileUp" size="sm" />} onClick={() => { window.location.hash = '#/system/integrations/hostplatform'; }}>Import from HostPlatform</Button>} />

      {error && <StaleBanner message={`Showing the last status we have. ${error}`} onRetry={reload} />}

      <ChannexSyncPanel />

      {loading && rows.length === 0 ? (
        <Card><TableSkeleton rows={6} cols={3} /></Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
          {rows.map(row => {
            const label = PROVIDER_LABEL[row.provider] ?? row.provider;
            const m = META[row.state];
            const act = actionsFor(row.state, row);
            return (
              <Card key={row.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="py-[18px] px-5 flex flex-col gap-3 flex-1">
                  <div className="flex items-center gap-3">
                    <Monogram label={label} />
                    <div className="flex flex-col gap-[3px] flex-1 min-w-0">
                      <span className="text-heading font-semibold">{label}</span>
                      <span className="text-meta text-muted-ink">{syncedLine(row)}</span>
                    </div>
                    <Badge tone={m.tone} label={m.label} />
                  </div>

                  <p className="m-0 text-copy leading-[1.5] text-[var(--color-ink-2)] [text-wrap:pretty]">{noteFor(row)}</p>

                  {row.lastError && (
                    <div className="text-meta text-[var(--color-critical-fg)]">{row.lastError}</div>
                  )}

                  <div className="mt-auto pt-1 text-meta text-muted-ink">
                    {row.viaChannex || row.provider === 'utilities'
                      ? `${row.unitsLinked} ${row.unitsLinked === 1 ? 'unit' : 'units'} linked${row.syncInterval ? ` · ${row.syncInterval}` : ''}`
                      : row.syncInterval ?? ''}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap py-[13px] px-5 [border-top:1px_solid_var(--color-line-soft)] bg-page">
                  {act.reconnect && (
                    <Button size="sm" variant="brand" icon={<Icon name="PlugZap" size="sm" />} onClick={() => setReconnectId(row.id)}>
                      Reconnect
                    </Button>
                  )}
                  {act.retry && (
                    <Button size="sm" variant="secondary" loading={!!syncing[row.id]} icon={<Icon name="RefreshCw" size="sm" />} onClick={() => retrySync(row)}>
                      {syncing[row.id] ? 'Syncing…' : row.viaChannex ? 'Check for bookings' : 'Retry sync'}
                    </Button>
                  )}
                  {row.viaChannex
                    ? <Button size="sm" variant="tertiary" icon={<Icon name="Building2" size="sm" />} onClick={() => { window.location.hash = '#/properties/units'; }}>Open units</Button>
                    : row.provider === 'utilities' && (
                      <Button size="sm" variant="tertiary" icon={<Icon name="SlidersHorizontal" size="sm" />} onClick={() => setManageId(row.id)}>
                        Manage
                      </Button>
                    )}
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
            ? `Last successful pull ${date(reconnectRow.lastSyncedAt)} · ${timeWithZone(reconnectRow.lastSyncedAt)}`
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
      className="w-[38px] h-[38px] flex-none grid place-items-center rounded-[6px] bg-muted border border-solid border-line text-heading font-semibold text-ink"
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
  const act = actionsFor(row.state, row);
  return (
    <>
      <div className="flex items-center gap-3 py-[18px] px-[22px] [border-bottom:1px_solid_var(--color-line)]">
        <Monogram label={label} />
        <div className="flex flex-col gap-[3px] flex-1 min-w-0">
          <span className="text-title font-semibold">{label}</span>
          <span className="text-meta text-muted-ink">{syncedLine(row)}</span>
        </div>
        <Badge tone={m.tone} label={m.label} />
        <button onClick={onClose} aria-label="Close" className="flex bg-transparent border-none p-1 cursor-pointer text-muted-ink">
          <Icon name="X" size="base" />
        </button>
      </div>

      <div className="py-5 px-[22px] flex flex-col gap-5 flex-1 overflow-y-auto">
        <Section label="Connection">
          <p className="m-0 text-copy leading-[1.5] text-[var(--color-ink-2)] [text-wrap:pretty]">{noteFor(row)}</p>
          {row.lastError && <div className="mt-2 text-meta text-[var(--color-critical-fg)]">{row.lastError}</div>}
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
              <div className="mt-[6px] text-meta text-muted-ink">
                Masked. Revealing a credential is audited and done from the secrets vault, not here.
              </div>
            </>
          ) : (
            <PanelValue>No credentials. This source has no API connection.</PanelValue>
          )}
        </Section>
      </div>

      <div className="flex items-center justify-end gap-[9px] flex-wrap py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page">
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
    <div className="flex flex-col gap-1.5">
      <span className="text-meta font-semibold text-muted-ink uppercase tracking-[0.04em]">{label}</span>
      {children}
    </div>
  );
}

function PanelValue({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span className={cx('text-copy text-ink', mono && 'font-mono')}>{children}</span>
  );
}
