import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';

interface Credential {
  id: string; unitNumber: string; propertyName: string; kind: string; label: string;
  secret: string; instruction: string; rotatesAfterStay: boolean; updatedAt: string;
}
interface Payload { data: Credential[]; generatedAt: string }

const KIND_LABEL: Record<string, string> = {
  smart_lock: 'Smart lock', key_box: 'Key box', guard_desk: 'Guard desk', lift_card: 'Lift card',
};

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'a1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', kind: 'smart_lock', label: 'Main door', secret: '\u2022\u2022\u2022\u2022', instruction: 'Smart lock 4417#. Lobby via the guard \u2014 say The Conts.', rotatesAfterStay: true, updatedAt: '2026-09-13' },
    { id: 'a2', unitNumber: '#B-08-11', propertyName: 'Arcoris', kind: 'key_box', label: 'Key box B2', secret: '\u2022\u2022\u2022\u2022', instruction: 'Key box B2, code 2208. Lift card at the counter.', rotatesAfterStay: false, updatedAt: '2025-06-01' },
    { id: 'a3', unitNumber: '#15-06', propertyName: 'Scarletz', kind: 'smart_lock', label: 'Main door', secret: '\u2022\u2022\u2022\u2022', instruction: 'Smart lock 9021#. Parking at level B2.', rotatesAfterStay: true, updatedAt: '2026-09-14' },
    { id: 'a4', unitNumber: '#A-21-02', propertyName: 'The Establishment', kind: 'guard_desk', label: 'Site office key', secret: '', instruction: 'Collect the key from the site office before 14:00.', rotatesAfterStay: false, updatedAt: '2026-09-04' },
  ],
};

const COLS = 'minmax(150px,1.3fr) minmax(140px,1.2fr) minmax(130px,1.1fr) minmax(200px,1.9fr) minmax(110px,0.9fr)';

export default function AccessPage() {
  const { data, loading, error, reload } = useApi<Payload>('/access-credentials', FALLBACK);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const toast = useToast();

  const rows = data?.data ?? [];

  /** Revealing a credential is an audited action even though it is only a read —
   *  the endpoint writes access.reveal, and we say so rather than hiding it. */
  async function reveal(c: Credential) {
    try {
      const res = await api.get<Payload>(`/access-credentials?unitId=${c.unitNumber}&reveal=true`);
      const found = res.data.find(x => x.id === c.id);
      setRevealed(r => ({ ...r, [c.id]: found?.secret ?? c.secret }));
      toast.push({ tone: 'neutral', title: 'Access code revealed.', body: `Recorded against your account for ${c.propertyName} ${c.unitNumber}.` });
    } catch (e) {
      toast.push({
        tone: 'critical', title: 'Could not reveal the code.',
        body: e instanceof ApiFailure ? e.message : 'Try again in a moment.',
      });
    }
  }

  return (
    <>
      <PageHeader title="Access and keys" sub="Codes are masked by default. Revealing one is recorded in the audit trail." />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Unit</div><div>Type</div><div>Code</div><div>Instruction given to guests</div><div>Updated</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={4} cols={5} /> : rows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 56, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.propertyName}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{KIND_LABEL[r.kind] ?? r.kind}</span>
                  {r.rotatesAfterStay && <Badge tone="info" label="Rotates after each stay" />}
                </div>
                <div>
                  {!r.secret ? (
                    <span style={{ fontSize: 13, color: color.textMuted }}>Not applicable</span>
                  ) : revealed[r.id] ? (
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 13.5, fontWeight: 500 }}>{revealed[r.id]}</span>
                  ) : (
                    <button onClick={() => reveal(r)}
                      aria-label={`Reveal the access code for ${r.propertyName} ${r.unitNumber}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: '#FFFFFF', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>
                      <Icon name="Eye" size="sm" color={color.textMuted} />
                      <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{r.secret}</span>
                    </button>
                  )}
                </div>
                <span style={{ fontSize: 12.5, color: color.textMuted, textWrap: 'pretty' }}>{r.instruction}</span>
                <span style={{ fontSize: 12.5, color: color.textMuted }}>{r.updatedAt}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
