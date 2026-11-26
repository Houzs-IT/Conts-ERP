import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';
import Icon from '../components/Icon';
import { EmptyState } from '../components/States';
import { CardRowsSkeleton } from '../components/Loading';
import { useApi } from '../lib/useApi';
import { plural } from '../lib/format';
import { useUrlState, SearchBox } from './finance/listKit';
import AccessTab, { type Credential } from './units/AccessTab';

interface UnitPassKeys { unitId: string; unitName: string; itemCount: number }

function groupByUnit(credentials: Credential[]): UnitPassKeys[] {
  const unitsById = new Map<string, UnitPassKeys>();
  for (const credential of credentials) {
    if (!credential.unitId) continue;
    const existing = unitsById.get(credential.unitId);
    if (existing) existing.itemCount += 1;
    else unitsById.set(credential.unitId, { unitId: credential.unitId, unitName: `${credential.propertyName ?? ''} ${credential.unitNumber ?? ''}`.trim(), itemCount: 1 });
  }
  return [...unitsById.values()];
}

function UnitPassKeyCard({ unit, isOpen, onToggle, onChanged }: { unit: UnitPassKeys; isOpen: boolean; onToggle: () => void; onChanged: () => void }) {
  const panelId = `pass-keys-${unit.unitId}`;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-3 pr-4 max-md:pr-2">
        <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={panelId}
          className="flex flex-1 basis-60 min-w-0 min-h-11 items-center gap-2 py-3 pl-4 pr-2 border-0 bg-transparent cursor-pointer text-left text-ink [font-family:inherit]">
          <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" />
          <span className="min-w-0 text-copy font-semibold [overflow-wrap:anywhere]">{unit.unitName}</span>
          <span className="flex-none text-meta text-muted-ink">{plural(unit.itemCount, 'item')}</span>
        </button>
        <Link to={`/properties/units/${encodeURIComponent(unit.unitId)}?tab=access`}
          className="inline-flex items-center min-h-11 ml-9 md:ml-0 text-meta font-medium text-ink no-underline">Open unit</Link>
      </div>
      {isOpen && (
        <div id={panelId} className="[border-top:1px_solid_var(--color-line-soft)]">
          <AccessTab unitId={unit.unitId} unitLabel={unit.unitName} bare onChanged={onChanged} />
        </div>
      )}
    </Card>
  );
}

export default function PassKeysPage() {
  const { data, loading, error, reload } = useApi<{ data: Credential[] }>('/access-credentials');
  const url = useUrlState();
  const query = url.get('q');
  const [openUnitIds, setOpenUnitIds] = useState<Set<string>>(new Set());

  const units = useMemo(() => groupByUnit(data?.data ?? []), [data]);
  const matchingUnits = useMemo(() => {
    const needle = query.toLowerCase();
    return needle ? units.filter(unit => unit.unitName.toLowerCase().includes(needle)) : units;
  }, [units, query]);
  const itemCount = units.reduce((total, unit) => total + unit.itemCount, 0);

  function toggleUnit(unitId: string) {
    setOpenUnitIds(previous => {
      const next = new Set(previous);
      if (!next.delete(unitId)) next.add(unitId);
      return next;
    });
  }

  const sub = data ? `${plural(units.length, 'unit')} · ${plural(itemCount, 'access item')}. Codes are masked, and revealing one is recorded in History.` : 'Loading…';

  return (
    <>
      <PageHeader title="Pass key" sub={sub} />
      <SearchBox className="max-w-md" label="Search units" placeholder="Search unit or building" value={query} onChange={value => url.set({ q: value || null })} />
      {!data && loading && <Card><CardRowsSkeleton rows={6} /></Card>}
      {!data && !loading && error && <EmptyState kind="empty" icon="TriangleAlert" title="Could not load the pass keys." body={error} action={{ label: 'Try again', onClick: reload }} forceAction />}
      {data && units.length === 0 && <EmptyState icon="KeyRound" title="No access codes recorded on any unit yet." />}
      {data && units.length > 0 && matchingUnits.length === 0 && (
        <EmptyState kind="filtered" title={`No unit matches "${query}".`} action={{ label: 'Clear search', onClick: () => url.set({ q: null }) }} />
      )}
      {matchingUnits.length > 0 && (
        <div className="flex flex-col gap-3">
          {matchingUnits.map(unit => (
            <UnitPassKeyCard key={unit.unitId} unit={unit} isOpen={openUnitIds.has(unit.unitId)} onToggle={() => toggleUnit(unit.unitId)} onChanged={reload} />
          ))}
        </div>
      )}
    </>
  );
}
