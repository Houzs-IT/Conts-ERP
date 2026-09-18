import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { rm } from '../lib/format';
import type { Tone } from '../lib/types';

type Condition = 'good' | 'fair' | 'replace_soon' | 'damaged';
const COND_LABEL: Record<Condition, string> = { good: 'Good', fair: 'Fair', replace_soon: 'Replace soon', damaged: 'Damaged' };
const COND_TONE: Record<Condition, Tone> = { good: 'success', fair: 'neutral', replace_soon: 'warning', damaged: 'critical' };

interface Item {
  id: string; unitNumber: string; propertyName: string; name: string; quantity: string;
  condition: Condition; suppliedInHouse: boolean; purchaseCost: number | null;
  installedOn: string | null; lastChecked: string | null;
}
interface Payload { data: Item[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'i1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Queen bed frame and mattress', quantity: '1 set', condition: 'good', suppliedInHouse: true, purchaseCost: 320000, installedOn: '2025-03-01', lastChecked: '2026-09-12' },
    { id: 'i2', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Three-seater fabric sofa', quantity: '1', condition: 'fair', suppliedInHouse: true, purchaseCost: 185000, installedOn: '2025-03-01', lastChecked: '2026-09-12' },
    { id: 'i3', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Blackout curtains', quantity: '3 windows', condition: 'replace_soon', suppliedInHouse: true, purchaseCost: 89000, installedOn: '2025-03-01', lastChecked: '2026-09-12' },
    { id: 'i4', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', name: 'Smart lock, Yale YDM4109', quantity: '1', condition: 'good', suppliedInHouse: true, purchaseCost: 145000, installedOn: '2025-03-01', lastChecked: '2026-09-12' },
    { id: 'i5', unitNumber: '#B-08-11', propertyName: 'Arcoris', name: 'Living room blind', quantity: '1', condition: 'damaged', suppliedInHouse: true, purchaseCost: 42000, installedOn: '2025-06-05', lastChecked: '2026-09-16' },
    { id: 'i6', unitNumber: '#B-08-11', propertyName: 'Arcoris', name: 'Kitchenware bundle', quantity: '1 set', condition: 'good', suppliedInHouse: true, purchaseCost: 68000, installedOn: '2025-06-05', lastChecked: '2026-09-10' },
    { id: 'i7', unitNumber: '#2207', propertyName: 'Tribeca', name: 'Dining table and 4 chairs', quantity: '1 set', condition: 'good', suppliedInHouse: true, purchaseCost: 240000, installedOn: '2024-11-05', lastChecked: '2026-09-08' },
  ],
};

const COLS = 'minmax(200px,1.9fr) minmax(140px,1.2fr) minmax(100px,0.9fr) minmax(140px,1.1fr) minmax(110px,0.9fr) minmax(100px,0.9fr)';

export default function InventoryPage() {
  const [onlyAttention, setOnlyAttention] = useState(false);
  const { data, loading, error, reload } = useApi<Payload>('/inventory', FALLBACK);
  const toast = useToast();

  const all = data?.data ?? [];
  const rows = onlyAttention ? all.filter(i => i.condition === 'replace_soon' || i.condition === 'damaged') : all;
  const attention = all.filter(i => i.condition === 'replace_soon' || i.condition === 'damaged').length;
  const invested = all.reduce((s, i) => s + (i.purchaseCost ?? 0), 0);

  async function setCondition(item: Item, condition: Condition) {
    try {
      await api.patch('/inventory', { id: item.id, condition });
      toast({ tone: 'success', title: 'Condition updated.', body: `${item.name} marked ${COND_LABEL[condition].toLowerCase()}.` });
      reload();
    } catch {
      toast({ tone: 'critical', title: 'Could not update.', body: 'Try again in a moment.' });
    }
  }

  return (
    <>
      <PageHeader title="Inventory" sub={`${all.length} items &middot; ${rm(invested, { cents: false })} fitted out in-house &middot; ${attention} need attention`} />

      {error && <StaleBanner message={`Showing the last register we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7 }}>
        {[false, true].map(v => (
          <button key={String(v)} onClick={() => setOnlyAttention(v)}
            style={{ height: 32, padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit',
              border: `1px solid ${onlyAttention === v ? color.black : color.border}`, background: onlyAttention === v ? color.black : '#FFFFFF', color: onlyAttention === v ? '#FFFFFF' : color.textMuted }}>
            {v ? 'Needs attention' : 'All items'}
          </button>
        ))}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Item</div><div>Unit</div><div>Quantity</div><div>Condition</div><div style={{ textAlign: 'right' }}>Cost</div><div>Last checked</div>
            </div>
            {loading && all.length === 0 ? <TableSkeleton rows={6} cols={6} /> : rows.map(i => (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5 }}>{i.name}</span>
                  {i.suppliedInHouse && <span style={{ fontSize: 11.5, color: color.textMuted }}>Supplied by The Conts{i.installedOn ? ` · installed ${i.installedOn}` : ''}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{i.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.propertyName}</span>
                </div>
                <span style={{ fontSize: 13 }}>{i.quantity}</span>
                <div>
                  <select value={i.condition} onChange={e => setCondition(i, e.target.value as Condition)}
                    aria-label={`Condition of ${i.name}`}
                    style={{ height: 30, padding: '0 8px', fontSize: 12, font: 'inherit', cursor: 'pointer',
                      borderRadius: radius.pill, border: 'none', appearance: 'none', textAlign: 'center',
                      background: COND_TONE[i.condition] === 'success' ? '#E9F5EF' : COND_TONE[i.condition] === 'warning' ? '#FFF4D8' : COND_TONE[i.condition] === 'critical' ? '#FCECEB' : '#F1F0ED',
                      color: COND_TONE[i.condition] === 'success' ? '#11694A' : COND_TONE[i.condition] === 'warning' ? '#8A5A12' : COND_TONE[i.condition] === 'critical' ? '#A8352F' : '#706D67' }}>
                    {(Object.keys(COND_LABEL) as Condition[]).map(c => <option key={c} value={c}>{COND_LABEL[c]}</option>)}
                  </select>
                </div>
                <span style={{ fontSize: 13, textAlign: 'right' }}>{i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '\u2014'}</span>
                <span style={{ fontSize: 12.5, color: color.textMuted }}>{i.lastChecked ?? '\u2014'}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
