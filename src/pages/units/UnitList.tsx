import { useMemo } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { type Building, type Unit } from './shared';
import type { UnitReadiness } from '../../lib/types';
import { statusOf } from '../../lib/status';
import { PURPOSE_LABEL, USED_BY, CODES } from '../../lib/revenueModel';
import { CodeBadge } from './UnitExtras';

const USED_BY_LABEL = Object.fromEntries(USED_BY.map(u => [u.value, u.label]));

/** Every unit as one table (Units > List): the same records as the tree, for sorting, filtering, saved views
 *  and exporting the portfolio. Clicking a row opens the unit's record. */
export function UnitList({ units, buildings, readiness, loading, error, onRetry, onOpen }: {
  units: Unit[]; buildings: Building[]; readiness: Record<string, UnitReadiness>;
  loading: boolean; error: string | null; onRetry: () => void; onOpen: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(buildings.map(b => [b.id, b])), [buildings]);
  const code = (u: Unit) => units.find(x => x.id === u.parentUnitId)?.unitCode;
  const columns = useMemo<Column<Unit>[]>(() => [
    { key: 'unit', label: 'Unit', value: u => u.unitCode || u.listingName, hideable: false, width: 150,
      render: u => <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis block">{u.unitCode || '—'}</span>,
      sub: u => (u.parentUnitId ? `Part of ${code(u) ?? 'another unit'}` : u.listingName || null) },
    { key: 'listing', label: 'Listing name', value: u => u.listingName, hidden: true, width: 200 },
    { key: 'building', label: 'Building', value: u => byId.get(u.buildingId)?.name ?? '', width: 160,
      filter: { kind: 'select', options: buildings.map(b => ({ value: b.name, label: b.name })) } },
    // Staff sheet UNIT (17 Oct 2026): what the unit is for; only rental units are on the channels.
    { key: 'purpose', label: 'Purpose', value: u => PURPOSE_LABEL[u.purpose ?? 'rental'], width: 110,
      filter: { kind: 'select', options: Object.values(PURPOSE_LABEL).map(v => ({ value: v, label: v })) } },
    { key: 'usedBy', label: 'Used by', value: u => (u.usedBy ? USED_BY_LABEL[u.usedBy] ?? u.usedBy : null), hidden: true, width: 130,
      filter: { kind: 'select', options: USED_BY.map(x => ({ value: x.label, label: x.label })) } },
    { key: 'state', label: 'State', value: u => byId.get(u.buildingId)?.state ?? u.state, width: 130, filter: { kind: 'select' } },
    { key: 'city', label: 'City', value: u => byId.get(u.buildingId)?.city ?? '', hidden: true, width: 130 },
    { key: 'owner', label: 'Owner', type: 'person', value: u => u.ownerName, width: 170 },
    { key: 'package', label: 'Package', value: u => u.pkg, width: 110, filter: { kind: 'select' } },
    { key: 'code', label: 'Contract', value: u => u.contractCode ?? null, width: 96, render: u => <CodeBadge code={u.contractCode} size="sm" />,
      filter: { kind: 'select', options: CODES.map(c => ({ value: c.code, label: `${c.code} · ${c.label}` })) } },
    { key: 'terms', label: 'Terms', value: u => u.termsLabel ?? null, width: 150 },
    { key: 'term', label: 'Term', value: u => u.term, hidden: true, width: 110, filter: { kind: 'select' } },
    { key: 'bedrooms', label: 'Bedrooms', type: 'number', value: u => u.bedrooms ?? null, hidden: true, width: 90 },
    { key: 'bathrooms', label: 'Bathrooms', type: 'number', value: u => u.bathrooms ?? null, hidden: true, width: 90 },
    { key: 'beds', label: 'Beds', value: u => u.bedsLabel || null, hidden: true, width: 170 },
    { key: 'parking', label: 'Car park', value: u => u.parkingLabel || null, hidden: true, width: 200 },
    { key: 'rate', label: 'Nightly price', type: 'money', value: u => ((u.purpose ?? 'rental') === 'rental' ? u.baseRate ?? null : null), width: 110, title: 'The standard price of one night.' },
    { key: 'fee', label: 'Operator share %', type: 'number', value: u => u.contract?.feePct ?? null, hidden: true, width: 80 },
    { key: 'started', label: 'Contract start', type: 'date', value: u => u.contract?.startedOn || null, hidden: true },
    { key: 'renews', label: 'Renews', type: 'date', value: u => u.contract?.renewsOn || null, hidden: true },
    { key: 'readiness', label: 'Today', type: 'status', value: u => readiness[u.id] ?? null, width: 120,
      status: u => (readiness[u.id] ? statusOf('readiness', readiness[u.id]) : null) },
  ], [byId, buildings, readiness]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <DataTable<Unit> id="units" columns={columns} rows={units.length || !loading ? units : null} rowKey={u => u.id}
      loading={loading} error={error} onRetry={onRetry} onRowClick={u => onOpen(u.id)} defaultSort="building:asc"
      noun={['unit', 'units']} exportName="units" selectable pageSize={100}
      empty={{ title: 'No units yet.', body: 'Add a building, then add units to it from the tree.', icon: 'Building2' }} />
  );
}
