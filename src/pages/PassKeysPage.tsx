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

const NO_BUILDING_LABEL = 'No building';

interface UnitPassKeys { unitId: string; unitNumber: string; unitName: string; itemCount: number }
interface BuildingPassKeys { buildingName: string; units: UnitPassKeys[]; unitCount: number; itemCount: number }

function groupByBuilding(credentials: Credential[]): BuildingPassKeys[] {
  const buildingsByName = new Map<string, { unitsById: Map<string, UnitPassKeys>; itemCount: number }>();
  for (const credential of credentials) {
    if (!credential.unitId) continue;
    const buildingName = credential.propertyName || NO_BUILDING_LABEL;
    const building = buildingsByName.get(buildingName) ?? { unitsById: new Map<string, UnitPassKeys>(), itemCount: 0 };
    buildingsByName.set(buildingName, building);
    building.itemCount += 1;
    const existing = building.unitsById.get(credential.unitId);
    if (existing) existing.itemCount += 1;
    else {
      const unitNumber = credential.unitNumber ?? '';
      building.unitsById.set(credential.unitId, { unitId: credential.unitId, unitNumber, unitName: `${credential.propertyName ?? ''} ${unitNumber}`.trim(), itemCount: 1 });
    }
  }
  return [...buildingsByName.entries()].map(([buildingName, building]) => ({
    buildingName,
    units: [...building.unitsById.values()],
    unitCount: building.unitsById.size,
    itemCount: building.itemCount,
  }));
}

function filterBuildings(buildings: BuildingPassKeys[], needle: string): BuildingPassKeys[] {
  if (!needle) return buildings;
  const matchingBuildings: BuildingPassKeys[] = [];
  for (const building of buildings) {
    const units = building.buildingName.toLowerCase().includes(needle)
      ? building.units
      : building.units.filter(unit => unit.unitNumber.toLowerCase().includes(needle) || unit.unitName.toLowerCase().includes(needle));
    if (units.length === 0) continue;
    matchingBuildings.push({ ...building, units, unitCount: units.length, itemCount: units.reduce((total, unit) => total + unit.itemCount, 0) });
  }
  return matchingBuildings;
}

function toggleInSet(setState: (update: (previous: Set<string>) => Set<string>) => void, key: string) {
  setState(previous => {
    const next = new Set(previous);
    if (!next.delete(key)) next.add(key);
    return next;
  });
}

function UnitPassKeyRow({ unit, isOpen, onToggle, onChanged }: { unit: UnitPassKeys; isOpen: boolean; onToggle: () => void; onChanged: () => void }) {
  const panelId = `pass-keys-unit-${unit.unitId}`;
  return (
    <div className="[border-top:1px_solid_var(--color-line-soft)]">
      <div className="flex flex-wrap items-center gap-x-3 pl-9 pr-4 max-md:pr-2">
        <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={panelId}
          className="flex flex-1 basis-48 min-w-0 min-h-11 items-center gap-2 py-3 pr-2 border-0 bg-transparent cursor-pointer text-left text-ink [font-family:inherit]">
          <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" />
          <span className="min-w-0 text-copy font-semibold [overflow-wrap:anywhere]">{unit.unitNumber || unit.unitName}</span>
          <span className="flex-none text-meta text-muted-ink">{plural(unit.itemCount, 'item')}</span>
        </button>
        <Link to={`/properties/units/${encodeURIComponent(unit.unitId)}?tab=access`}
          className="inline-flex items-center min-h-11 ml-6 md:ml-0 text-meta font-medium text-ink no-underline">Open unit</Link>
      </div>
      {isOpen && (
        <div id={panelId} className="pl-9">
          <AccessTab unitId={unit.unitId} unitLabel={unit.unitName} bare onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function BuildingPassKeyCard({ building, isOpen, openUnitIds, onToggleBuilding, onToggleUnit, onChanged }: {
  building: BuildingPassKeys;
  isOpen: boolean;
  openUnitIds: Set<string>;
  onToggleBuilding: (buildingName: string) => void;
  onToggleUnit: (unitId: string) => void;
  onChanged: () => void;
}) {
  // aria-controls is a space-separated id list, so the building name cannot go in as is.
  const panelId = `pass-keys-building-${building.buildingName.replace(/[^A-Za-z0-9]+/g, '-')}`;
  return (
    <Card>
      <button type="button" onClick={() => onToggleBuilding(building.buildingName)} aria-expanded={isOpen} aria-controls={panelId}
        className="flex w-full min-h-11 items-center gap-2 py-3 px-4 border-0 bg-transparent cursor-pointer text-left text-ink [font-family:inherit]">
        <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size="sm" />
        <span className="min-w-0 flex-1 text-copy font-semibold [overflow-wrap:anywhere]">{building.buildingName}</span>
        <span className="flex-none text-meta text-muted-ink">{plural(building.unitCount, 'unit')} · {plural(building.itemCount, 'item')}</span>
      </button>
      {isOpen && (
        <div id={panelId}>
          {building.units.map(unit => (
            <UnitPassKeyRow key={unit.unitId} unit={unit} isOpen={openUnitIds.has(unit.unitId)} onToggle={() => onToggleUnit(unit.unitId)} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Card>
  );
}

export default function PassKeysPage() {
  const { data, loading, error, reload } = useApi<{ data: Credential[] }>('/access-credentials');
  const url = useUrlState();
  const query = url.get('q');
  const [openBuildingNames, setOpenBuildingNames] = useState<Set<string>>(new Set());
  const [openUnitIds, setOpenUnitIds] = useState<Set<string>>(new Set());

  const buildings = useMemo(() => groupByBuilding(data?.data ?? []), [data]);
  const needle = query.trim().toLowerCase();
  const matchingBuildings = useMemo(() => filterBuildings(buildings, needle), [buildings, needle]);
  const unitCount = buildings.reduce((total, building) => total + building.unitCount, 0);
  const itemCount = buildings.reduce((total, building) => total + building.itemCount, 0);

  const sub = data ? `${plural(buildings.length, 'building')} · ${plural(unitCount, 'unit')} · ${plural(itemCount, 'access item')}. Codes are masked, and revealing one is recorded in History.` : 'Loading…';

  return (
    <>
      <PageHeader title="Pass key" sub={sub} />
      <SearchBox className="max-w-md" label="Search buildings and units" placeholder="Search building or unit" value={query} onChange={value => url.set({ q: value || null })} />
      {!data && loading && <Card><CardRowsSkeleton rows={6} /></Card>}
      {!data && !loading && error && <EmptyState kind="empty" icon="TriangleAlert" title="Could not load the pass keys." body={error} action={{ label: 'Try again', onClick: reload }} forceAction />}
      {data && buildings.length === 0 && <EmptyState icon="KeyRound" title="No access codes recorded on any unit yet." />}
      {data && buildings.length > 0 && matchingBuildings.length === 0 && (
        <EmptyState kind="filtered" title={`No building or unit matches "${query}".`} action={{ label: 'Clear search', onClick: () => url.set({ q: null }) }} />
      )}
      {matchingBuildings.length > 0 && (
        <div className="flex flex-col gap-3">
          {matchingBuildings.map(building => (
            <BuildingPassKeyCard key={building.buildingName} building={building}
              isOpen={needle !== '' || openBuildingNames.has(building.buildingName)} openUnitIds={openUnitIds}
              onToggleBuilding={buildingName => toggleInSet(setOpenBuildingNames, buildingName)}
              onToggleUnit={unitId => toggleInSet(setOpenUnitIds, unitId)} onChanged={reload} />
          ))}
        </div>
      )}
    </>
  );
}
