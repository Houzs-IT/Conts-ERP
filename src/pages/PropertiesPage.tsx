import { useState } from 'react';
import { color, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import type { Tone, UnitReadiness } from '../lib/types';

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};

interface Unit {
  id: string; unitNumber: string; propertyId: string; propertyName: string;
  city: string; state: string; ownerId: string; ownerName: string;
  readiness: UnitReadiness; bedrooms: number; bathrooms: number; maxGuests: number;
  baseRate?: number; isListed: boolean;
}
interface Payload { data: Unit[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'u1', unitNumber: '#A-12-03', propertyId: 'p1', propertyName: 'Vista Jaya One', city: 'Petaling Jaya', state: 'Selangor', ownerId: 'o1', ownerName: 'Lim Chee Keong', readiness: 'occupied', bedrooms: 2, bathrooms: 2, maxGuests: 4, baseRate: 28400, isListed: true },
    { id: 'u2', unitNumber: '#B-08-11', propertyId: 'p2', propertyName: 'Arcoris Mont Kiara', city: 'Mont Kiara', state: 'Kuala Lumpur', ownerId: 'o2', ownerName: 'Wong Mei Ling', readiness: 'cleaning', bedrooms: 0, bathrooms: 1, maxGuests: 2, baseRate: 23100, isListed: true },
    { id: 'u3', unitNumber: '#2207', propertyId: 'p3', propertyName: 'Tribeca', city: 'Bukit Bintang', state: 'Kuala Lumpur', ownerId: 'o3', ownerName: 'Rajesh Kumar', readiness: 'ready', bedrooms: 1, bathrooms: 1, maxGuests: 3, baseRate: 31800, isListed: true },
    { id: 'u4', unitNumber: '#15-06', propertyId: 'p4', propertyName: 'Scarletz', city: 'KLCC', state: 'Kuala Lumpur', ownerId: 'o4', ownerName: 'Chong Wei Han', readiness: 'dirty', bedrooms: 1, bathrooms: 1, maxGuests: 2, baseRate: 26500, isListed: true },
    { id: 'u5', unitNumber: '#A-21-02', propertyId: 'p5', propertyName: 'The Establishment', city: 'Kuchai Lama', state: 'Kuala Lumpur', ownerId: 'o5', ownerName: 'Nur Aisyah', readiness: 'dirty', bedrooms: 2, bathrooms: 2, maxGuests: 4, baseRate: 24200, isListed: true },
    { id: 'u6', unitNumber: '#C-31-14', propertyId: 'p6', propertyName: 'Sentral Suites', city: 'KL Sentral', state: 'Kuala Lumpur', ownerId: 'o6', ownerName: 'Tan Boon Huat', readiness: 'maintenance', bedrooms: 0, bathrooms: 1, maxGuests: 2, baseRate: 22800, isListed: true },
  ],
};

const READY_LABEL = (r: string) => r[0].toUpperCase() + r.slice(1);
const beds = (n: number) => n === 0 ? 'Studio' : `${n} bed`;

/** state → building → unit, the layering the business actually thinks in. */
export default function PropertiesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/units', FALLBACK);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const units = data?.data ?? [];
  const byState = units.reduce<Record<string, Record<string, Unit[]>>>((acc, u) => {
    (acc[u.state] ??= {})[u.propertyName] ??= [];
    acc[u.state][u.propertyName].push(u);
    return acc;
  }, {});
  const buildings = new Set(units.map(u => u.propertyName)).size;

  return (
    <>
      <PageHeader title="Properties" sub={`${units.length} units &middot; ${buildings} buildings &middot; ${Object.keys(byState).length} states`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? <Card><TableSkeleton rows={6} cols={5} /></Card> : (
        <Card>
          {Object.entries(byState).map(([state, group]) => (
            <div key={state}>
              <div style={{ padding: '11px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, letterSpacing: '0.1em', color: color.textMuted }}>
                {state.toUpperCase()}
              </div>
              {Object.entries(group).map(([building, list]) => {
                const open = !collapsed[building];
                return (
                  <div key={building}>
                    <button onClick={() => setCollapsed(c => ({ ...c, [building]: open }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '13px 22px', borderBottom: `1px solid ${color.borderMuted}`, background: '#FFFFFF', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                      <span style={{ display: 'flex', transition: 'transform 180ms', transform: `rotate(${open ? 90 : 0}deg)`, color: color.textMuted }}>
                        <Icon name="ChevronRight" size="sm" />
                      </span>
                      <span style={{ fontSize: text.cardTitle, fontWeight: 600, flex: 1 }}>{building}</span>
                      <span style={{ fontSize: text.small, color: color.textMuted }}>{list[0].city} &middot; {list.length} units</span>
                    </button>
                    {open && list.map(u => (
                      <a key={u.id} href={`#/properties/units/${encodeURIComponent(u.id)}`}
                        style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,1.1fr) minmax(110px,0.9fr) minmax(150px,1.3fr) minmax(110px,1fr) minmax(90px,0.8fr)', gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px 9px 54px', borderBottom: `1px solid ${color.borderMuted}`, textDecoration: 'none', color: 'inherit' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{u.unitNumber}</span>
                          <span style={{ fontSize: 11.5, color: color.textMuted }}>{beds(u.bedrooms)} &middot; sleeps {u.maxGuests}</span>
                        </div>
                        <div><Badge tone={READY_TONE[u.readiness]} label={READY_LABEL(u.readiness)} /></div>
                        <span style={{ fontSize: 12.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.ownerName}</span>
                        <span style={{ fontSize: 13, textAlign: 'right' }}>
                          {u.baseRate != null ? rm(u.baseRate, { cents: false }) : '\u2014'}
                        </span>
                        <div>{!u.isListed && <Badge tone="neutral" label="Not listed" />}</div>
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
