/** Design sample data. useApi shows it only in a dev build (src/lib/useApi.ts); production shows nothing rather than invented figures. */
import { BANKS, type Expense, type Unit, type PropertiesPayload, type UnitDetail } from './shared';

const ex = (id: string, category: string, amount: number, note = ''): Expense => ({ id, category, amount, note });

/** A blank or sample unit. Also used to build the new unit sent by Add unit / Add sub-unit. */
export const mkUnit = (id: string, buildingId: string, listingName: string, unitCode: string, state: string, address: string, owner: Partial<Unit>): Unit => ({
  id, buildingId, parentUnitId: owner.parentUnitId ?? null, listingName, unitCode, state, address,
  ownerName: owner.ownerName ?? '', ic: owner.ic ?? '', bankName: owner.bankName ?? BANKS[1], bankAccount: owner.bankAccount ?? '', accountHolder: owner.accountHolder ?? owner.ownerName ?? '',
  pkg: owner.pkg ?? 'Package C', term: owner.term ?? 'Long term', split: owner.split ?? 'Not set', splitValue: owner.splitValue ?? null, guaranteePeriod: owner.guaranteePeriod ?? 'month',
  bedrooms: owner.bedrooms, baseRate: owner.baseRate,
  expenses: owner.expenses ?? [ex('e1', 'Internet', 12900), ex('e2', 'Electricity', 18000), ex('e3', 'Water', 4500), ex('e4', 'Cleaning', 35000)],
  contract: owner.contract ?? { feePct: 25, startedOn: '2025-06-01', renewsOn: '2027-06-01', documents: [] },
});

export const PROPERTIES_FALLBACK: PropertiesPayload = {
  generatedAt: '',
  buildings: [
    { id: 'b1', name: 'Agile Bukit Bintang', city: 'Imbi, 55100 KL', state: 'Kuala Lumpur' },
    { id: 'b2', name: 'Arte Mont Kiara', city: 'Mont Kiara, 50480 KL', state: 'Kuala Lumpur' },
    { id: 'b3', name: 'Anggun Residences', city: 'Chow Kit, 50300 KL', state: 'Kuala Lumpur' },
    { id: 'b5', name: 'Skyline KLCC', city: 'Jalan Yap Kwan Seng, 50450 KL', state: 'Kuala Lumpur' },
    { id: 'b6', name: 'Continew', city: 'Cheras, 56000 KL', state: 'Selangor' },
  ],
  units: [
    mkUnit('u1', 'b1', 'Hikari Grove #400M>TRX #500M>Pavilion #105', 'AGILE-C1313A', 'Kuala Lumpur', 'C-13-13A, Lot 1160, Jalan Bukit Bintang', { ownerName: 'LIANG WOOI KEE', ic: '900101-14-0001', bankName: 'PBBB', bankAccount: '0000000009', accountHolder: 'LIANG WOOI KEE & TAN KA CHENG', pkg: 'Package C', split: 'GRR — guaranteed rent', splitValue: 320000, guaranteePeriod: 'month', bedrooms: 2, baseRate: 28400 }),
    mkUnit('u1a', 'b1', 'Agile Room A · en-suite', 'AGILE-C1313A-A', 'Kuala Lumpur', 'C-13-13A, Room A', { parentUnitId: 'u1', ownerName: 'LIANG WOOI KEE', ic: '900101-14-0002', bankName: 'PBBB', bankAccount: '0000000010', pkg: 'Package C', split: 'Profit share', splitValue: 70, bedrooms: 1, baseRate: 14000 }),
    mkUnit('u2', 'b1', 'Agile Skyline Suite', 'AGILE-C3713A', 'Kuala Lumpur', 'C-37-13A, Lot 1160, Jalan Bukit Bintang', { ownerName: 'WONG SIEW MING', ic: '900101-14-0003', bankName: 'MBBE', bankAccount: '0000000011', pkg: 'Package A', bedrooms: 1, baseRate: 22000 }),
    mkUnit('u3', 'b2', 'Arte KLCC View 2BR', 'ARTE-MK2-0916', 'Kuala Lumpur', 'MK2-09-16, Jalan Dutamas, Mont Kiara', { ownerName: 'Rajesh Kumar', ic: '900101-14-0004', bankName: 'CIBB', bankAccount: '0000000012', pkg: 'Package B', split: 'GRR — guaranteed rent', splitValue: 350000, bedrooms: 2, baseRate: 31000 }),
    mkUnit('u4', 'b2', 'Arte Garden Studio', 'ARTE-MK2-0915', 'Kuala Lumpur', 'MK2-09-15, Jalan Dutamas, Mont Kiara', { ownerName: 'Chong Wei Han', ic: '900101-14-0005', bankName: 'PBBB', bankAccount: '0000000013', bedrooms: 0, baseRate: 16000 }),
    mkUnit('u5', 'b3', 'Anggun City Loft', 'ANGG-2207', 'Kuala Lumpur', '#2207, Jalan Raja Bot, Chow Kit', { ownerName: 'Nur Aisyah', ic: '900101-14-0006', bankName: 'RHBB', bankAccount: '0000000014', bedrooms: 1, baseRate: 19000 }),
    mkUnit('u7', 'b5', 'Skyline KLCC High Floor', 'SKY-D2613', 'Kuala Lumpur', 'D-26-13, Jalan Yap Kwan Seng', { ownerName: 'Lim Chee Keong', ic: '900101-14-0007', bankName: 'PBBB', bankAccount: '0000000015', pkg: 'Package B', bedrooms: 2, baseRate: 34000 }),
    mkUnit('u10', 'b6', 'Continew Cheras 2BR', 'CONT-B2603A', 'Selangor', 'B-26-03A, Jalan Cheras', { ownerName: 'Lim Chun Teck', ic: '900101-14-0008', bankName: 'CIBB', bankAccount: '0000000016', bedrooms: 2, baseRate: 21000 }),
  ],
};

export const DETAIL_FALLBACK: UnitDetail = {
  generatedAt: '',
  unit: {
    id: 'u1', unitNumber: 'AGILE-C1313A', propertyName: 'Agile Bukit Bintang',
    addressLine: 'Lot 1160, Jalan Bukit Bintang', city: 'Imbi', state: 'Kuala Lumpur', postcode: '55100',
    readiness: 'occupied', bedrooms: 2, bathrooms: 2, maxGuests: 4, sizeSqft: 850,
    isListed: true, fittedOutAt: '2025-03-01',
    channels: ['airbnb', 'booking_com', 'direct'],
    owner: { id: 'o1', name: 'LIANG WOOI KEE', email: 'liang@example.com' },
    contract: { managementFeePct: 25, startsOn: '2025-06-01', renewsOn: '2027-06-01' },
    baseRate: 28400,
  },
  performance: { period: '2026-09', occupancy: 94.1, occupiedNights: 28, adr: 28400, revpar: 26700, rating: 4.92, reviewCount: 11, revenue: 812000, gross: 926000 },
  pnl: [
    { label: 'Gross Income', amount: 926000, type: 'gross' },
    { label: '25% To Operator', amount: -231500, type: 'fee' },
    { label: 'Basic Cleaning Fee', amount: -38500, type: 'expense' },
    { label: 'Maintenance', amount: -7800, type: 'expense' },
    { label: 'Net Payout to Owner', amount: 648200, type: 'net' },
  ],
  stays: [
    { id: 's1', guestName: 'Nadia Abdullah', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-13', checkOut: '2026-09-16', guestsCount: 2, externalRef: 'ABNB-7741QK', grossBookingValue: 85200 },
    { id: 's2', guestName: 'Aaron Lee', channel: 'direct', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-20', guestsCount: 2, externalRef: 'TC-2026-0916', grossBookingValue: 113600 },
    { id: 's3', guestName: 'Priya Sundaram', channel: 'booking_com', state: 'pending', checkIn: '2026-09-24', checkOut: '2026-10-01', guestsCount: 2, externalRef: 'BDC-5512087', grossBookingValue: 198800 },
  ],
  tasks: [
    { id: 't1', title: 'Full cleaning, 2BR', kind: 'turnover', state: 'in_progress', dueAt: '2026-09-16T14:30', completedAt: null, assigneeName: 'Nurul Huda' },
    { id: 't2', title: 'Owner statement photos', kind: 'other', state: 'resolved', dueAt: '2026-09-15T16:30', completedAt: '2026-09-15T16:12', assigneeName: 'Chan Wei Wen' },
  ],
  maintenance: [
    { id: 'MNT-0912', title: 'Curtain replacement quoted', detail: 'Blackout curtains, 3 windows.', state: 'waiting', vendorName: 'Kiara Interiors', ownerApprovalRequired: true, blocksUnit: false, chargeTo: 'owner', reportedAt: '2026-09-12', resolvedAt: null, quotedAmount: 89000 },
    { id: 'MNT-0910', title: 'Aircon service', detail: 'Quarterly service.', state: 'resolved', vendorName: 'CoolCare', ownerApprovalRequired: false, blocksUnit: false, chargeTo: 'owner', reportedAt: '2026-09-10', resolvedAt: '2026-09-12', finalAmount: 18000 },
  ],
  inventory: [
    { id: 'i1', name: 'Queen bed frame and mattress', quantity: '1 set', condition: 'good', suppliedInHouse: true, installedOn: '2025-03-01', lastChecked: '2026-09-12', purchaseCost: 320000 },
    { id: 'i3', name: 'Blackout curtains', quantity: '3 windows', condition: 'replace_soon', suppliedInHouse: true, installedOn: '2025-03-01', lastChecked: '2026-09-12', purchaseCost: 89000 },
  ],
  documents: [
    { id: 'd2', name: 'Management agreement.pdf', kind: 'contract', sizeLabel: 'PDF · 240 KB', updatedAt: '2025-06-01' },
    { id: 'd1', name: 'August owner statement.pdf', kind: 'statement', sizeLabel: 'PDF · 118 KB', updatedAt: '2026-09-01' },
    { id: 'd3', name: 'Move-in inspection report.pdf', kind: 'inspection', sizeLabel: 'PDF · 1.2 MB', updatedAt: '2025-03-01' },
  ],
  activity: [
    { actorLabel: 'Aina Zulkifli', action: 'unit.readiness_change', source: 'web', occurredAt: '2026-09-16T14:14' },
    { actorLabel: 'Nurul Huda', action: 'task.complete', source: 'field_app', occurredAt: '2026-09-16T13:50' },
  ],
};
