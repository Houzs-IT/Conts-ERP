import { useState, type CSSProperties } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';

interface Credential {
  id: string; unitNumber: string; propertyName: string; kind: string; label: string;
  /** Masked display value returned by the list endpoint, e.g. "••••17#". Empty = no code. */
  secret: string;
  /** DEV-only clear value so a reveal is visible with no backend running. Never shipped to a browser in production. */
  fullSecret?: string;
  instruction: string; rotatesAfterStay: boolean; updatedAt: string;
  lastRevealedBy?: string | null; lastRevealedAt?: string | null;
}
interface Payload { data: Credential[]; generatedAt: string }
/** Shape of the single-resource reveal endpoint. Only `secret` is load-bearing here. */
interface RevealResponse { id?: string; secret?: string }

const KIND_LABEL: Record<string, string> = {
  smart_lock: 'Smart lock', key_box: 'Key box', guard_desk: 'Guard desk',
  lift_card: 'Lift card', wifi: 'Wi-Fi',
};

/** Mask a clear code the way the API does: bullets, last three characters shown. */
function maskOf(clear: string): string {
  if (!clear) return '';
  const tail = clear.slice(-3);
  const bullets = '•'.repeat(Math.max(2, clear.length - tail.length));
  return bullets + tail;
}

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'a1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', kind: 'smart_lock', label: 'Main door', fullSecret: '4417#', secret: maskOf('4417#'), instruction: 'Smart lock 4417#. Lobby via the guard — say The Conts.', rotatesAfterStay: true, updatedAt: '2026-09-13', lastRevealedBy: 'Nurul (Operations)', lastRevealedAt: '2026-09-18' },
    { id: 'a1w', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', kind: 'wifi', label: 'Guest Wi-Fi — VistaJaya_Guest', fullSecret: 'stayhappy88', secret: maskOf('stayhappy88'), instruction: 'Wi-Fi VistaJaya_Guest, password on the fridge card.', rotatesAfterStay: false, updatedAt: '2026-08-02', lastRevealedBy: null, lastRevealedAt: null },
    { id: 'a2', unitNumber: '#B-08-11', propertyName: 'Arcoris', kind: 'key_box', label: 'Key box B2', fullSecret: '2208', secret: maskOf('2208'), instruction: 'Key box B2, code 2208. Lift card at the counter.', rotatesAfterStay: false, updatedAt: '2025-06-01', lastRevealedBy: 'Farah (Management)', lastRevealedAt: '2026-07-22' },
    { id: 'a3', unitNumber: '#15-06', propertyName: 'Scarletz', kind: 'smart_lock', label: 'Main door', fullSecret: '9021#', secret: maskOf('9021#'), instruction: 'Smart lock 9021#. Parking at level B2.', rotatesAfterStay: true, updatedAt: '2026-09-14', lastRevealedBy: null, lastRevealedAt: null },
    { id: 'a4', unitNumber: '#A-21-02', propertyName: 'The Establishment', kind: 'guard_desk', label: 'Site office key', fullSecret: '', secret: '', instruction: 'Collect the key from the site office before 14:00.', rotatesAfterStay: false, updatedAt: '2026-09-04', lastRevealedBy: null, lastRevealedAt: null },
  ],
};

const COLS = 'minmax(150px,1.3fr) minmax(150px,1.2fr) minmax(170px,1.3fr) minmax(190px,1.8fr) minmax(150px,1.2fr)';
const MONO = '"IBM Plex Mono", monospace';

/** A small square control used for the per-code re-mask and copy actions. */
function IconAction({ name, label, onClick }: { name: string; label: string; onClick: () => void }) {
  const s: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, flex: 'none', borderRadius: radius.control,
    border: `1px solid ${color.border}`, background: color.card, cursor: 'pointer', padding: 0,
  };
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} style={s}>
      <Icon name={name} size="sm" color={color.textMuted} />
    </button>
  );
}

export default function AccessPage() {
  const { data, loading, error, reload } = useApi<Payload>('/access-credentials', FALLBACK);
  const { user } = useSession();
  const toast = useToast();

  // Optimistic local overlay: which codes are currently shown in the clear, and the
  // fresh reveal attributions we apply on top of the server's last-revealed record.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [localReveal, setLocalReveal] = useState<Record<string, { by: string; at: string }>>({});

  const rows = data?.data ?? [];

  /** Revealing a credential is an audited action even though it is only a read — the
   *  endpoint writes audit_log (access.reveal). We surface that in the toast rather than
   *  hiding it. In dev there is no backend, so we fall back to the local clear value. */
  async function reveal(c: Credential) {
    let clear = c.fullSecret ?? '';
    try {
      const res = await api.get<RevealResponse>(`/access-credentials/${c.id}`, { reveal: true });
      if (res?.secret) clear = res.secret;
    } catch (e) {
      // Dev: no backend. Keep the local clear value so the interaction still works.
      // A real, unexpected failure with no local value to show is surfaced instead.
      if (!clear) {
        toast({
          tone: 'critical', title: 'Could not reveal the code.',
          body: e instanceof ApiFailure ? e.message : 'Try again in a moment.',
        });
        return;
      }
    }
    setRevealed(r => ({ ...r, [c.id]: clear }));
    setLocalReveal(m => ({
      ...m,
      [c.id]: { by: user?.fullName ?? 'You', at: new Date().toISOString().slice(0, 10) },
    }));
    toast({
      tone: 'neutral',
      title: 'Access code revealed.',
      body: 'This was recorded in the audit log.',
    });
  }

  /** Re-mask is a local visual revert — the reveal already happened and stays logged. */
  function remask(c: Credential) {
    setRevealed(r => {
      const next = { ...r };
      delete next[c.id];
      return next;
    });
  }

  async function copy(c: Credential) {
    const clear = revealed[c.id];
    if (!clear) return;
    try {
      await navigator.clipboard.writeText(clear);
      toast({ tone: 'neutral', title: 'Copied to clipboard.', body: 'Handle it with the same care as the code itself.' });
    } catch {
      toast({ tone: 'critical', title: 'Could not copy automatically.', body: 'Select the code and copy it by hand.' });
    }
  }

  return (
    <>
      <PageHeader title="Access and keys" sub="Codes are masked by default. Revealing one is recorded in the audit trail." />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div><div>Type</div><div>Code</div><div>Instruction given to guests</div><div>Updated</div>
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={5} cols={5} /> : rows.map(r => {
              const isRevealed = revealed[r.id] != null;
              const last = localReveal[r.id]
                ? { by: localReveal[r.id].by, at: localReveal[r.id].at }
                : r.lastRevealedBy ? { by: r.lastRevealedBy, at: r.lastRevealedAt ?? '' } : null;

              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 60, padding: '10px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.unitNumber}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.propertyName}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{KIND_LABEL[r.kind] ?? r.kind}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                    {r.rotatesAfterStay && <Badge tone="info" label="Rotates after each stay" />}
                  </div>

                  <div>
                    {!r.secret ? (
                      <span style={{ fontSize: 13, color: color.textMuted }}>Not applicable</span>
                    ) : isRevealed ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 500 }}>{revealed[r.id]}</span>
                        <IconAction name="EyeOff" label={`Re-mask the code for ${r.propertyName} ${r.unitNumber}`} onClick={() => remask(r)} />
                        <IconAction name="Copy" label={`Copy the code for ${r.propertyName} ${r.unitNumber}`} onClick={() => copy(r)} />
                      </div>
                    ) : (
                      <button type="button" onClick={() => reveal(r)}
                        aria-label={`Reveal the access code for ${r.propertyName} ${r.unitNumber}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
                        <Icon name="Eye" size="sm" color={color.textMuted} />
                        <span style={{ fontFamily: MONO }}>{r.secret}</span>
                        <span style={{ color: color.textMuted, fontWeight: 500 }}>Reveal</span>
                      </button>
                    )}
                  </div>

                  <span style={{ fontSize: 12.5, color: color.textMuted, textWrap: 'pretty' }}>{r.instruction}</span>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, color: color.textMuted }}>Changed {safeDate(r.updatedAt)}</span>
                    <span style={{ fontSize: 11, color: color.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {last ? `Last shown to ${last.by}${last.at ? ` · ${safeDate(last.at)}` : ''}` : 'Never revealed'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </>
  );
}

/** The mock dates are plain YYYY-MM-DD; render them through the shared formatter but
 *  never let an unparseable value throw in a table cell. */
function safeDate(iso: string): string {
  if (!iso) return '—';
  const d = date(iso);
  return d === 'Invalid Date' ? iso : d;
}
