// The HostPlatform / owner-workbook mapping (functions/_lib/hostplatformImport.ts) on made-up rows. Pure: needs no server.
// Run: node scripts/api-checks/hostplatform-mapping.mjs
import * as M from '../../functions/_lib/hostplatformImport.ts';
let fails = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };

check('unit name: code and bed/bath', M.parseUnitName('C35-03 2B2B'), { code: 'C35-03', bedrooms: 2, bathrooms: 2 });
check('unit name: room suffix keeps its space', M.parseUnitName('B17-05(A) 1B1B'), { code: 'B17-05 (A)', bedrooms: 1, bathrooms: 1 });
check('unit name: half bath rounds up', M.parseUnitName('MK2-27-16 3B2.5B'), { code: 'MK2-27-16', bedrooms: 3, bathrooms: 3 });
check('building: company suffix dropped', M.buildingName('Skyline KL The Conts'), 'Skyline KL');
check('HostPlatform timestamp is Kuala Lumpur time', M.hpTimestamp('08-Oct-2026 05:45 PM'), '2026-10-08T09:45:00.000Z');
check('Excel serial date', M.toDate(46082), '2026-03-01');
check('Excel time', M.toTime(0.625), '15:00');
check('stay state', ['2026-10-01', '2026-10-08', '2026-10-09'].map(d => M.stayState(d, '2026-10-10', '2026-10-08')), ['checked_in', 'checked_in', 'confirmed']);
check('stay state: checked out on the day', M.stayState('2026-10-01', '2026-10-08', '2026-10-08'), 'checked_out');

const listing = M.mapListing([
  { Key: 'aaaaaaaaaaaaaaaaaaaaaa01', 'Unit Name': 'C35-03 2B2B', 'Property Name': 'Skyline KL The Conts', Street: 'Jalan X', city: 'KUALA LUMPUR', State: 'W.P Kuala Lumpur', ZipCode: '55200', 'Country Code': 'MY', Owner: '-', 'Parent Unit': '-', 'Weekday Price': '699.00', 'Weekend Price': '699.00', 'Internet (Operation Cost per month)': '104.94', 'Cleaning (Operation Cost per month)': '0.00' },
  { Key: 'aaaaaaaaaaaaaaaaaaaaaa02', 'Unit Name': '11-03 (B) 2B1B', 'Property Name': 'The Atrium The Conts', Owner: 'Jane Tan', 'Parent Unit': '11-03 (A) 2B1B', 'Weekday Price': '250' },
  { Key: 'nothex', 'Unit Name': 'X 1B1B', 'Property Name': 'Y' },
]);
check('listing: ids from the HostPlatform key', listing.units.map(u => u.id), ['hp-unit-aaaaaaaaaaaaaaaaaaaaaa01', 'hp-unit-aaaaaaaaaaaaaaaaaaaaaa02']);
check('listing: price to sen, bedrooms, parent', listing.units.map(u => [u.baseRate, u.bedrooms, u.bathrooms, u.parentName]), [[69900, 2, 2, null], [25000, 2, 1, '11-03 (A)']]);
check('listing: blank owner goes to the placeholder', listing.units.map(u => u.ownerName), [M.PLACEHOLDER_OWNER, 'Jane Tan']);
check('listing: only monthly costs, in sen', listing.unitExpenses.map(e => [e.category, e.amount]), [['internet', 10494]]);
check('listing: city case tidied', listing.properties[0].city, 'Kuala Lumpur');
check('listing: bad key refused', listing.errors.length, 1);

const base = { 'Property Name': 'Skyline KL The Conts', 'Unit Name': 'C35-03 2B2B', 'Check In Date': '2026-09-01', 'Check Out Date': '2026-09-03', 'Number of pax': '4', Currency: 'MYR', 'Guest Name': 'A Guest', '[].Contact Number[]': 'N/A' };
const res = M.mapReservations([
  { ...base, 'Booking Type': 'Platform', 'Booking Source': 'airbnb', 'Booking Status': 'Confirm Booking', 'Confirmation Code': '1AAAA0001 (HMTESTAAAA)', 'Total Price': '217.22', 'Platform Fee': '40.44', 'Payment Received': '217.22' },
  { ...base, 'Booking Type': 'Platform', 'Booking Source': 'bookingcom', 'Booking Status': 'Cancelled by OTA', 'Confirmation Code': 'ABCDEF123 (1234567801)', 'Total Price': '324.22999999999996', 'Platform Fee': '72.4540032' },
  { ...base, 'Booking Type': 'Blocked', 'Booking Source': 'hostplatform', 'Booking Status': '-', 'Confirmation Code': 'BLK000001', Remarks: 'MO reno inspection', 'Guest Name': '' },
  { ...base, 'Booking Type': 'Blocked', 'Booking Source': 'hostplatform', 'Booking Status': '-', 'Confirmation Code': 'BLK000002', Remarks: 'owner stay', 'Guest Name': '' },
  { ...base, 'Booking Type': 'Free Stay', 'Booking Source': 'hostplatform', 'Booking Status': 'Confirm Booking', 'Confirmation Code': 'FREE00001' },
  { ...base, 'Booking Type': 'Walk In', 'Booking Source': 'hostplatform', 'Booking Status': 'Confirm Booking', 'Confirmation Code': 'WALK00001', 'Total Price': '300' },
  { ...base, 'Booking Type': 'Platform', 'Booking Source': 'airbnb', 'Confirmation Code': '1AAAA0001 (HMTESTAAAA)' },
  { ...base, 'Booking Type': 'Platform', 'Booking Source': 'airbnb', 'Confirmation Code': 'BADDATES1', 'Check Out Date': '2026-09-01' },
], '2026-10-08');
check('reservations: channels', res.reservations.map(r => r.channel), ['airbnb', 'booking_com', 'maintenance_block', 'owner_stay', 'owner_stay', 'direct']);
check('reservations: Airbnb gross = payout + fee', [res.reservations[0].gross, res.reservations[0].fee, res.reservations[0].collected], [25766, 4044, 21722]);
check('reservations: Booking.com gross = total, cancelled', [res.reservations[1].gross, res.reservations[1].fee, res.reservations[1].state], [32423, 7245, 'cancelled']);
check('reservations: external ref is the site code', res.reservations.slice(0, 3).map(r => r.externalRef), ['HMTESTAAAA', '1234567801', 'BLK000001']);
check('reservations: blocks have no guest, remarks kept', [res.reservations[2].guestId, res.reservations[2].notes], [null, 'Imported from HostPlatform (BLK000001) · MO reno inspection']);
check('reservations: past stay is checked out', res.reservations[0].state, 'checked_out');
check('reservations: duplicate code and bad dates refused', res.errors.map(e => e.row), [8, 9]);
check('reservations: one guest per name/phone/email', res.guests.length, 1);

const known = [
  { id: 'hp-unit-1', unitNumber: 'C13-13A', propertyId: 'p1', propertyName: 'Agile' },
  { id: 'hp-unit-2', unitNumber: '08-06', propertyId: 'p2', propertyName: 'Uno' },
  { id: 'hp-unit-3', unitNumber: '11-03 (A)', propertyId: 'p3', propertyName: 'The Atrium' },
  { id: 'hp-unit-4', unitNumber: '11-03 (B)', propertyId: 'p3', propertyName: 'The Atrium' },
  { id: 'hp-unit-5', unitNumber: 'A11-06', propertyId: 'p4', propertyName: 'Trion KL' },
  { id: 'hp-unit-6', unitNumber: 'A11-06', propertyId: 'p5', propertyName: 'Trofi 2' },
  { id: 'hp-unit-7', unitNumber: 'A26-03A', propertyId: 'p6', propertyName: 'Skyline KL' },
];
const m = id => M.matchWorkbookUnit(id, known)?.id ?? null;
check('workbook id: exact code', m('AGILE-C1313A'), 'hp-unit-1');
check('workbook id: leading zero dropped', m('UNO-806'), 'hp-unit-2');
check('workbook id: inner zero dropped', m('SKYLINE-A263A'), 'hp-unit-7');
check('workbook id: whole unit falls back to room A', m('THE ATRIUM-1103'), 'hp-unit-3');
check('workbook id: room B', m('THE ATRIUM-1103(B)'), 'hp-unit-4');
check('workbook id: same code, building decides', [m('TRION-A1106'), m('TROFI2-A1106')], ['hp-unit-5', 'hp-unit-6']);
check('workbook id: unknown', m('SUNWAY-A1'), null);
check('workbook building: new one named from the prefix', M.buildingForPrefix('SV2 TOWER C&D', []), { id: 'wb-prop-sv2-tower-c-d', name: 'SV2 Tower C&D', isNew: true });

const wu = M.mapWorkbookUnits([
  { 'Unit编号': 'AGILE-C1313A', '房东/业主': 'Owner One', IC: '700101-14-5555', '分成': '75/25', 'LONGTERM/PROFIT SHARING': 'PS', PACKAGE: 'B', 'BANK AC': 1234567890, '合约开始日期': 45658, '合约结束日期': 46752 },
  { 'Unit编号': 'UNO-806', 'LONGTERM/PROFIT SHARING': 'LT', PACKAGE: 'D', GRR: 2500, '合约开始日期': 45658 },
  { 'Unit编号': 'UNO-807', 'LONGTERM/PROFIT SHARING': 'PS', PACKAGE: 'D' },
], [{ UNIT: 'AGILE-C1313A', 'OWNER%': 0.7, 'MANAGE PAYOUT%': 0.25, 'AGENT%': 0.05 }], [{ Unit: 'UNO-807', '每月最低拿到（保底）': 3100, '合约开始': 45658 }]);
check('workbook unit: profit share from 分成 wins over the text split', [wu.units[0].split, wu.units[0].splitValue, wu.units[0].contract.feePct, wu.units[0].pkg], ['Profit share', 70, 30, 'Package B']);
check('workbook unit: long term + GRR', [wu.units[1].split, wu.units[1].splitValue, wu.units[1].contract.model, wu.units[1].contract.grrAmount, wu.units[1].term], ['GRR — guaranteed rent', 250000, 'grr', 250000, 'Long term']);
check('workbook unit: package D kept as a minimum on the contract', [wu.units[2].pkg, wu.units[2].packageD, wu.units[2].contract.grrAmount, wu.units[2].contract.model], [null, true, 310000, 'management']);
check('workbook unit: contract dates from serials', [wu.units[0].contract.startsOn, wu.units[0].contract.endsOn], ['2025-01-01', '2027-12-31']);

const ab = M.mapAirbnbEarnings([
  { '确认码': 'HMAAAAAAAA', 'Unit编号': 'AGILE-C1313A', '入住日期': 46082, '退房日期': 46084, '金额(Amount)': 438.05, '服务费(Service fee)': 88.06, '总收入(Gross earnings)': 526.11 },
  { '确认码': 'OWNER', 'Unit编号': 'AGILE-C1313A', '入住日期': 46082, '退房日期': 46084 },
  { '确认码': '1234567801', 'Unit编号': 'AGILE-C1313A', '入住日期': 46082, '退房日期': 46084, '金额(Amount)': 100 },
  { '确认码': 'HMBBBBBBBB', 'Unit编号': 'TRION-B5605', '入住日期': 46082, '退房日期': 46084, '金额(Amount)': 490 },
  { '确认码': 'HMBBBBBBBB', 'Unit编号': 'TRION-B5606', '入住日期': 46082, '退房日期': 46084, '金额(Amount)': 490 },
]);
check('earnings: money in sen', [ab.earnings[0].gross, ab.earnings[0].fee, ab.earnings[0].amount], [52611, 8806, 43805]);
check('earnings: owner line skipped, Booking.com number kept', [ab.skipped.length, ab.earnings[1].site], [1, 'booking_com']);
check('earnings: no gross -> amount + fee', ab.earnings[1].gross, 10000);
check('earnings: one code on two units gets the unit in its id', ab.earnings.slice(2).map(e => e.idSuffix), ['-trion-b5605', '-trion-b5606']);

const cl = M.mapCleaning([
  { Unit: 'AGILE-C1313A', '退房日期': 46082, '清洁类型': 'BC', '负责人': 'Cleaner A', '退房时间': 0.4583333 },
  { Unit: 'AGILE-C1313A', '退房日期': 46082, '清洁类型': 'BC' },
  { Unit: 'AGILE-C1313A', '退房日期': 46083, '清洁类型': 'DC', '费用方': 'TENANT' },
  { Unit: 'AGILE-C1313A', '退房日期': 46084 },
], [{ Unit: 'AGILE-C1313A', 'BC单价': 80, 'DC单价': 138 }]);
check('cleaning: kinds, prices, times', cl.cleanings.map(c => [c.kind, c.price, c.payer, c.dueTime]), [['turnover', 8000, null, '11:00'], ['deep_clean', 13800, 'TENANT', null]]);
check('cleaning: duplicate and untyped rows skipped', cl.skipped.length, 2);

const ex = M.mapWorkbookExpenses([
  { _sheet: '电费', _row: 2, 'Unit编号': 'AGILE-C1313A', JAN: 120.5, FEB: 0, MAR: null },
  { _sheet: '杂费扣款', _row: 3, 'Unit编号': 'AGILE-C1313A', '日期': 46082, '类型': 'Additional Deduction', '项目描述': 'Aircon gas', '金额(RM)': 150 },
  { _sheet: '杂费扣款', _row: 4, 'Unit编号': 'AGILE-C1313A', '日期': 46082, '类型': 'O2', '项目描述': 'Refund', '金额(RM)': -50 },
]);
check('expenses: utility month on the 1st, deterministic id', ex.expenses.map(e => [e.id, e.category, e.amount, e.incurredOn]),
  [['wb-exp-agile-c1313a-electricity-202601', 'electricity', 12050, '2026-01-01'], [ex.expenses[1].id, 'other', 15000, '2026-03-01']]);
check('expenses: a negative line is not an expense', ex.skipped.length, 1);
check('chunkByKey keeps a code together', M.chunkByKey(['a', 'b', 'b', 'c'], x => x, 2).map(c => c.join('')), ['a', 'bb', 'c']);
check('pick keeps only listed columns', M.pick([{ a: 1, secret: 2, _row: 5 }], ['a']), [{ a: 1, _row: 5 }]);

// HostPlatform API (version 2) rows, shaped like the live API's answers.
const apiBase = { check_in_date: '2026-10-22', check_out_date: '2026-10-23', status: 'Confirmed', unit: 'C13-13A 2B1B', unit_id: 'i65p5u1', property: 'Agile The Conts', property_id: 'i65p5',
  guest_details: { number_of_pax: 4, first_name: 'A', last_name: 'Guest', contact_no: '', email: 'A@X.COM' },
  price_details: { currency: 'MYR', room: 217.22, cleaning_fee: 0, extra_guest_fee: 0, platform_fee: 40.44 },
  service_fees: { early_checkin_fee: 0, late_checkout_fee: 0, transport_fee: 0, breakfast_fee: 0, lunch_fee: 0, dinner_fee: 0, shuttle_fee: 0, other_fee: 0 } };
const apiPlan = M.mapApiReservations([
  { ...apiBase, code: '9L3VM5OSR', source: 'airbnb', source_id: 'HMCWQSHDFK' },
  { ...apiBase, code: '5429066259', source: 'bookingcom', source_id: '6295633172', status: 'Cancelled by OTA', price_details: { currency: 'MYR', room: 694.4, platform_fee: 167.6026944 } },
  { ...apiBase, code: 'PH6GK59W5', source: 'hostplatform', price_details: { currency: 'MYR', room: 0, cleaning_fee: 80, platform_fee: 0 }, remarks: 'walk-in friend' },
  { ...apiBase, code: 'BLK000003', source: 'hostplatform', guest_details: undefined, price_details: undefined, service_fees: undefined, remarks: 'Block units for maintenance', unit: 'B56-06(A) 1B1B', property: 'Trion KL (2) The Conts' },
  { ...apiBase, code: 'OWN000001', source: 'hostplatform', guest_details: null, remarks: 'owner stay' },
  { ...apiBase, code: '9L3VM5OSR', source: 'airbnb' },
  { ...apiBase, code: 'BADDATES2', source: 'airbnb', check_out_date: '2026-10-22' },
], '2026-10-27');
const byCode = Object.fromEntries(apiPlan.reservations.map(r => [r.code, r]));
check('api: ids and references match the CSV import', apiPlan.reservations.map(r => [r.id, r.externalRef]),
  [['hp-res-9L3VM5OSR', 'HMCWQSHDFK'], ['hp-res-5429066259', '6295633172'], ['hp-res-PH6GK59W5', 'PH6GK59W5'], ['hp-res-BLK000003', 'BLK000003'], ['hp-res-OWN000001', 'OWN000001']]);
check('api: channels (no guest = block, owner stay by remarks)', apiPlan.reservations.map(r => r.channel), ['airbnb', 'booking_com', 'direct', 'maintenance_block', 'owner_stay']);
check('api: Airbnb gross is payout plus fee (as stored by the CSV import)', [byCode['9L3VM5OSR'].gross, byCode['9L3VM5OSR'].fee, byCode['9L3VM5OSR'].collected], [25766, 4044, 0]);
check('api: other channels add no fee on top', [byCode['5429066259'].gross, byCode['5429066259'].fee, byCode.PH6GK59W5.gross], [69440, 16760, 8000]);
check('api: states', apiPlan.reservations.map(r => r.state), ['checked_out', 'cancelled', 'checked_out', 'checked_out', 'checked_out']);
check('api: building "(2)" and room suffix normalised', [byCode.BLK000003.building, byCode.BLK000003.unitNumber], ['Trion KL', 'B56-06 (A)']);
check('api: blocks have no guest, guests are lower-cased email', [byCode.BLK000003.guestId, apiPlan.guests.find(g => g.id === byCode['9L3VM5OSR'].guestId)?.email], [null, 'a@x.com']);
check('api: remarks kept for direct, not for OTA', [byCode.PH6GK59W5.notes, byCode['9L3VM5OSR'].notes], ['Imported from the HostPlatform API (PH6GK59W5) · walk-in friend', 'Imported from the HostPlatform API (9L3VM5OSR)']);
check('api: duplicate and bad dates refused', apiPlan.errors.map(e => e.row), ['9L3VM5OSR', 'BADDATES2']);

console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0);
