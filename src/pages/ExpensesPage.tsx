import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import type { Tone } from '../lib/types';

type Category = 'housekeeping' | 'maintenance' | 'utilities' | 'consumables' | 'furniture' | 'management_fee' | 'channel_fee' | 'other';

const CAT_LABEL: Record<Category, string> = {
  housekeeping: 'Housekeeping', maintenance: 'Maintenance', utilities: 'Utilities',
  consumables: 'Consumables', furniture: 'Furniture', management_fee: 'Management fee',
  channel_fee: 'Channel fee', other: 'Other',
};
const CAT_TONE: Record<Category, Tone> = {
  housekeeping: 'info', maintenance: 'warning', utilities: 'neutral',
  consumables: 'neutral', furniture: 'info', management_fee: 'neutral',
  channel_fee: 'neutral', other: 'neutral',
};

interface Expense {
  id: string; unitNumber: string; propertyName: string; category: Category;
  description: string; amount: number; incurredOn: string; reference: string | null; chargeTo: string;
}
interface Payload { data: Expense[]; total: number; generatedAt: string }

/** Renders until /api/expenses is seeded. Delete once the endpoint returns rows. */
const FALLBACK: Payload = {
  generatedAt: '', total: 476900,
  data: [
    { id: 'EXP-0931', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', category: 'housekeeping', description: 'Housekeeping, 11 turnovers', amount: 38500, incurredOn: '2026-08-31', reference: 'HK-2026-08-A1203', chargeTo: 'owner' },
    { id: 'EXP-0920', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', category: 'maintenance', description: 'Aircon quarterly service', amount: 7800, incurredOn: '2026-08-20', reference: 'INV-2026-0820', chargeTo: 'owner' },
    { id: 'EXP-0918', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', category: 'maintenance', description: 'Plumbing works, riser replacement', amount: 320000, incurredOn: '2026-09-14', reference: 'AQF-4417', chargeTo: 'owner' },
    { id: 'EXP-0915', unitNumber: '#B-08-11', propertyName: 'Arcoris', category: 'consumables', description: 'Coffee pods, toiletries, 3 months', amount: 24000, incurredOn: '2026-09-12', reference: 'PO-2026-0912', chargeTo: 'owner' },
    { id: 'EXP-0911', unitNumber: '#15-06', propertyName: 'Scarletz', category: 'utilities', description: 'TNB and Indah Water, August', amount: 18600, incurredOn: '2026-09-05', reference: 'TNB-0895512', chargeTo: 'owner' },
    { id: 'EXP-0908', unitNumber: '#2207', propertyName: 'Tribeca', category: 'furniture', description: 'Replacement dining chairs, 2', amount: 56000, incurredOn: '2026-09-02', reference: 'FRN-2026-114', chargeTo: 'owner' },
    { id: 'EXP-0902', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', category: 'maintenance', description: 'Sofa cover deep clean', amount: 12000, incurredOn: '2026-08-14', reference: 'HK-2026-08-SOFA', chargeTo: 'guest_deposit' },
  ],
};

const COLS = 'minmax(180px,1.6fr) minmax(140px,1.2fr) minmax(130px,1.1fr) minmax(110px,1fr) minmax(130px,1.1fr) minmax(110px,0.9fr)';
const CHARGE_LABEL: Record<string, string> = { owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty' };

export default function ExpensesPage() {
  const [cat, setCat] = useState<Category | 'all'>('all');
  const { data, loading, error, reload } = useApi<Payload>(
    cat === 'all' ? '/expenses' : `/expenses?category=${cat}`, FALLBACK);

  const rows = data?.data ?? [];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const cats = [...new Set(FALLBACK.data.map(r => r.category))];

  return (
    <>
      <PageHeader title="Expenses" sub={`${rows.length} entries · ${rm(total)} in this view`} />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {(['all', ...cats] as (Category | 'all')[]).map(c => {
          const on = c === cat;
          return (
            <button key={c} onClick={() => setCat(c)}
              style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {c === 'all' ? 'All categories' : CAT_LABEL[c]}
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 920 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Description</div><div>Unit</div><div>Category</div><div>Date</div><div>Reference</div><div style={{ textAlign: 'right' }}>Amount</div>
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={6} /> : rows.length === 0 ? (
              <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13 }}>No expenses match these filters.</span>
                <button onClick={() => setCat('all')} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear filters</button>
              </div>
            ) : rows.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5 }}>{r.description}</span>
                  {r.chargeTo !== 'owner' && <span style={{ fontSize: 11.5, color: color.textMuted }}>Charged to {CHARGE_LABEL[r.chargeTo] ?? r.chargeTo}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{r.unitNumber}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.propertyName}</span>
                </div>
                <div><Badge tone={CAT_TONE[r.category]} label={CAT_LABEL[r.category]} /></div>
                <div style={{ fontSize: 12.5 }}>{r.incurredOn}</div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reference ?? '\u2014'}</div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>{rm(r.amount)}</div>
              </div>
            ))}

            {rows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '13px 22px', background: color.page, fontSize: 13, fontWeight: 600 }}>
                <div style={{ gridColumn: '1 / 6' }}>Total</div>
                <div style={{ textAlign: 'right' }}>{rm(total)}</div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
