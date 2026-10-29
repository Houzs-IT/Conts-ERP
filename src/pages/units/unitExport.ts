import { downloadTable, type ExportCell, type ExportColumn } from '../../lib/export';
import { PURPOSE_LABEL, USED_BY, codeName, packageOf } from '../../lib/revenueModel';
import { statusLabel } from '../../lib/status';
import type { UnitReadiness } from '../../lib/types';
import { layoutLabel, type Building, type Unit } from './shared';

const USED_BY_LABEL: Record<string, string> = Object.fromEntries(USED_BY.map(u => [u.value, u.label]));

const UNIT_EXPORT_COLUMNS: ExportColumn[] = [
  { label: 'Unit code', kind: 'text' }, { label: 'Listing name', kind: 'text' }, { label: 'Part of unit', kind: 'text' },
  { label: 'Building', kind: 'text' }, { label: 'Full access card', kind: 'text' }, { label: 'City', kind: 'text' }, { label: 'State', kind: 'text' }, { label: 'Address', kind: 'text' },
  { label: 'Status', kind: 'text' }, { label: 'Purpose', kind: 'text' }, { label: 'Used by', kind: 'text' },
  { label: 'Type', kind: 'text' }, { label: 'Bedrooms', kind: 'number' }, { label: 'Bathrooms', kind: 'number' }, { label: 'Size (sqft)', kind: 'number' },
  { label: 'Beds', kind: 'text' }, { label: 'Car park', kind: 'text' },
  { label: 'Owner', kind: 'text' }, { label: 'Package', kind: 'text' }, { label: 'Contract code', kind: 'text' }, { label: 'Contract', kind: 'text' }, { label: 'Terms', kind: 'text' },
  { label: 'Operator share %', kind: 'number' }, { label: 'Contract start', kind: 'date' }, { label: 'Renews', kind: 'date' },
  { label: 'Nightly price', kind: 'money' },
];

/** Every unit with every field the Units page holds, as rows for downloadTable. Nightly price is empty for roles that do not see money. */
export function unitExportRows(units: Unit[], buildings: Building[], readiness: Record<string, UnitReadiness>): ExportCell[][] {
  const building = new Map(buildings.map(b => [b.id, b]));
  const code = new Map(units.map(u => [u.id, u.unitCode]));
  const seen = new Set<string>();
  return units.map(u => {
    const b = building.get(u.buildingId);
    const purpose = u.purpose ?? 'rental';
    return [
      u.unitCode, u.listingName, u.parentUnitId ? code.get(u.parentUnitId) ?? '' : '',
      b?.name, b?.fullAccessCard ? 'Yes' : 'No', b?.city, b?.state ?? u.state, u.address,
      readiness[u.id] ? statusLabel('readiness', readiness[u.id]) : '', PURPOSE_LABEL[purpose], u.usedBy ? USED_BY_LABEL[u.usedBy] ?? u.usedBy : '',
      layoutLabel(u.layoutType) ?? u.layoutType, u.bedrooms, u.bathrooms, u.sizeSqft,
      u.bedsLabel, u.parkingLabel,
      u.ownerName, packageOf(u.contractCode), u.contractCode, u.contractCode ? codeName(u.contractCode) : '', u.termsLabel,
      u.contract?.feePct, u.contract?.startedOn, u.contract?.renewsOn,
      purpose === 'rental' ? u.baseRate : null,
    ];
  }).filter(row => {
    // A row identical to an earlier one in every column is a repeat; keep the first.
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exportUnits(units: Unit[], buildings: Building[], readiness: Record<string, UnitReadiness>): void {
  downloadTable('xlsx', 'units-all-details', 'Units', UNIT_EXPORT_COLUMNS, unitExportRows(units, buildings, readiness));
}
