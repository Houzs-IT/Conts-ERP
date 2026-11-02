import { api, notifyFailure } from '../../lib/api';
import { downloadTable, type ExportCell, type ExportColumn } from '../../lib/export';
import { PURPOSE_LABEL, USED_BY, codeName, packageOf } from '../../lib/revenueModel';
import { statusLabel } from '../../lib/status';
import type { UnitReadiness } from '../../lib/types';
import { layoutLabel, type Building, type Unit } from './shared';

const USED_BY_LABEL: Record<string, string> = Object.fromEntries(USED_BY.map(u => [u.value, u.label]));

const UNIT_EXPORT_COLUMNS: ExportColumn[] = [
  { label: 'Unit code', kind: 'text' }, { label: 'Part of unit', kind: 'text' },
  { label: 'Building', kind: 'text' }, { label: 'Full access card', kind: 'text' }, { label: 'City', kind: 'text' }, { label: 'State', kind: 'text' }, { label: 'Address', kind: 'text' },
  { label: 'Status', kind: 'text' }, { label: 'Purpose', kind: 'text' }, { label: 'Used by', kind: 'text' },
  { label: 'Type', kind: 'text' }, { label: 'Bedrooms', kind: 'number' }, { label: 'Bathrooms', kind: 'number' }, { label: 'Size (sqft)', kind: 'number' },
  { label: 'Beds', kind: 'text' },
  { label: 'Owner', kind: 'text' }, { label: 'Package', kind: 'text' }, { label: 'Contract code', kind: 'text' }, { label: 'Contract', kind: 'text' }, { label: 'Terms', kind: 'text' },
  { label: 'Operator share %', kind: 'number' }, { label: 'Contract start', kind: 'date' }, { label: 'Renews', kind: 'date' },
  { label: 'Nightly price', kind: 'money' },
  { label: 'Main Door Passcode', kind: 'text' }, { label: 'Mailbox Passcode 2', kind: 'text' }, { label: 'Mailbox Passcode', kind: 'text' }, { label: 'Mailbox No', kind: 'text' },
  { label: 'Wifi Username', kind: 'text' }, { label: 'Wifi Password', kind: 'text' }, { label: 'Parking', kind: 'text' },
  { label: 'electric account', kind: 'text' }, { label: 'wifi account', kind: 'text' }, { label: 'INDAH WATER', kind: 'text' },
];

/** What GET /api/units/export adds to a unit. Codes and account numbers are empty for roles that may not see them. */
export interface UnitExportExtras {
  mainDoorPasscode?: string | null; mailboxPasscode2?: string | null; mailboxPasscode?: string | null; mailboxNo?: string | null;
  wifiUsername?: string | null; wifiPassword?: string | null;
  electricAccount?: string | null; wifiAccount?: string | null; indahWater?: string | null;
}

/** Every unit with every field the Units page holds, as rows for downloadTable. Nightly price is empty for roles that do not see money. */
export function unitExportRows(units: Unit[], buildings: Building[], readiness: Record<string, UnitReadiness>, extras: Record<string, UnitExportExtras>): ExportCell[][] {
  const building = new Map(buildings.map(b => [b.id, b]));
  const code = new Map(units.map(u => [u.id, u.unitCode]));
  const seen = new Set<string>();
  return units.map(u => {
    const b = building.get(u.buildingId);
    const purpose = u.purpose ?? 'rental';
    const x = extras[u.id];
    return [
      u.unitCode, u.parentUnitId ? code.get(u.parentUnitId) ?? '' : '',
      b?.name, b?.fullAccessCard ? 'Yes' : 'No', b?.city, b?.state ?? u.state, u.address,
      readiness[u.id] ? statusLabel('readiness', readiness[u.id]) : '', PURPOSE_LABEL[purpose], u.usedBy ? USED_BY_LABEL[u.usedBy] ?? u.usedBy : '',
      layoutLabel(u.layoutType) ?? u.layoutType, u.bedrooms, u.bathrooms, u.sizeSqft,
      u.bedsLabel,
      u.ownerName, packageOf(u.contractCode), u.contractCode, u.contractCode ? codeName(u.contractCode) : '', u.termsLabel,
      u.contract?.feePct, u.contract?.startedOn, u.contract?.renewsOn,
      purpose === 'rental' ? u.baseRate : null,
      x?.mainDoorPasscode, x?.mailboxPasscode2, x?.mailboxPasscode, x?.mailboxNo,
      x?.wifiUsername, x?.wifiPassword, u.parkingLabel,
      x?.electricAccount, x?.wifiAccount, x?.indahWater,
    ];
  }).filter(row => {
    // A row identical to an earlier one in every column is a repeat; keep the first.
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function exportUnits(units: Unit[], buildings: Building[], readiness: Record<string, UnitReadiness>): Promise<void> {
  try {
    const { data } = await api.get<{ data: Record<string, UnitExportExtras> }>('/units/export');
    downloadTable('xlsx', 'units-all-details', 'Units', UNIT_EXPORT_COLUMNS, unitExportRows(units, buildings, readiness, data));
  } catch (e) { notifyFailure(e); } // no file rather than one with its codes silently empty
}
