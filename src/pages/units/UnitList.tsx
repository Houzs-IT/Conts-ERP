import { useMemo } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { type Building, type Unit } from './shared';
import type { UnitReadiness } from '../../lib/types';
import { statusOf } from '../../lib/status';

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
    { key: 'state', label: 'State', value: u => byId.get(u.buildingId)?.state ?? u.state, width: 130, filter: { kind: 'select' } },
    { key: 'city', label: 'City', value: u => byId.get(u.buildingId)?.city ?? '', hidden: true, width: 130 },
    { key: 'owner', label: 'Owner', type: 'person', value: u => u.ownerName, width: 170 },
    { key: 'package', label: 'Package', value: u => u.pkg, width: 110, filter: { kind: 'select' } },
    { key: 'terms', label: 'Terms', value: u => u.termsLabel ?? null, width: 150 },
    { key: 'term', label: 'Term', value: u => u.term, hidden: true, width: 110, filter: { kind: 'select' } },
    { key: 'bedrooms', label: 'Bedrooms', type: 'number', value: u => u.bedrooms ?? null, hidden: true, width: 90 },
    { key: 'rate', label: 'Base rate', type: 'money', value: u => u.baseRate ?? null, width: 110, title: 'The standard web price of a night.' },
    { key: 'fee', label: 'Fee %', type: 'number', value: u => u.contract?.feePct ?? null, hidden: true, width: 80 },
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
