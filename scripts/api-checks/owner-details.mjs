// Owner details (owner page card): edit name, legal name, phone, email, notes, address and alternate contact, read
// them back, see each change in the History, and check field roles are refused.
//   node scripts/api-checks/owner-details.mjs            migration 0110 applied: address saved and read back
//   EXPECT_NO_ADDRESS=1 node scripts/api-checks/...       0110 not applied: address keys ignored, the rest still saves
import { call, check, done } from './harness.mjs';

const noAddress = !!process.env.EXPECT_NO_ADDRESS;
const list = await call('GET', '/api/owners');
check('owners list', list.status === 200 && Array.isArray(list.json?.data), list.text.slice(0, 200));
check(`detailsReady is ${!noAddress}`, list.json?.detailsReady === !noAddress, String(list.json?.detailsReady));
const target = list.json.data.find(o => o.units.length) ?? list.json.data[0];
const id = target.id;
const tag = Date.now().toString().slice(-6);
const before = { displayName: target.displayName, email: target.email, phone: target.phone };

const edit = {
  displayName: `Detail Owner ${tag}`, legalName: `Detail Owner Sdn Bhd ${tag}`, phone: '+60 12-345 6789', email: `detail${tag}@example.com`,
  notes: 'Prefers WhatsApp.\nAway in December.',
  address: '  A-12-3, Vista Jaya  \n\n Jalan 1/2 ', postcode: '46200', city: 'Petaling Jaya', stateOrRegion: 'Selangor', country: 'Malaysia',
  alternateContact: 'Tan Mei', alternateContactRelation: 'wife', alternateContactPhone: '+65 9123 4567',
};
let r = await call('PATCH', `/api/owners/${id}`, edit);
check('save details', r.status === 200 && r.json?.changed === true, r.text);
check(noAddress ? 'address keys ignored without 0110' : 'nothing ignored with 0110',
  noAddress ? (r.json?.ignored ?? []).includes('address') && r.json.ignored.includes('alternateContactPhone') : !r.json?.ignored, JSON.stringify(r.json));

r = await call('GET', `/api/owners?id=${id}`);
const o = r.json?.data?.[0];
check('read back name, legal name, phone, email, notes',
  o?.displayName === edit.displayName && o.legalName === edit.legalName && o.phone === edit.phone && o.email === edit.email && o.notes === edit.notes, JSON.stringify(o)?.slice(0, 400));
if (noAddress) check('no address without 0110', o?.address === null && o?.altContact === null, JSON.stringify(o?.address));
else {
  check('address read back, lines trimmed and blank line dropped',
    o?.address?.lines === 'A-12-3, Vista Jaya\nJalan 1/2' && o.address.postcode === '46200' && o.address.city === 'Petaling Jaya' && o.address.state === 'Selangor' && o.address.country === 'Malaysia', JSON.stringify(o?.address));
  check('alternate contact read back', o?.altContact?.name === 'Tan Mei' && o.altContact.relation === 'wife' && o.altContact.phone === '+65 9123 4567', JSON.stringify(o?.altContact));
}

r = await call('GET', `/api/audit?entityTable=owners&entityId=${id}`);
const last = (r.json?.data ?? []).find(e => e.action === 'owner.update');
check('History has the change field by field', r.status === 200 && last && last.before?.displayName === before.displayName && last.after?.displayName === edit.displayName
  && last.after?.legalName === edit.legalName && last.after?.phone === edit.phone && (noAddress || last.after?.city === 'Petaling Jaya'), r.text.slice(0, 500));

r = await call('PATCH', `/api/owners/${id}`, edit);
check('same values again: nothing changed', r.status === 200 && r.json?.changed === false, r.text);

for (const [body, key] of [[{ email: 'not-an-email' }, 'email'], [{ phone: '12' }, 'phone'], [{ displayName: '  ' }, 'displayName'], [{ postcode: 'x'.repeat(20) }, 'postcode']]) {
  if (noAddress && key === 'postcode') continue;
  r = await call('PATCH', `/api/owners/${id}`, body);
  check(`bad ${key} refused 422`, r.status === 422 && r.json?.error?.fields?.[key] !== undefined || (r.status === 422 && JSON.stringify(r.json).includes(key)), r.text);
}
const other = list.json.data.find(x => x.id !== id);
await call('PATCH', `/api/owners/${other.id}`, { email: `other${tag}@example.com` });
r = await call('PATCH', `/api/owners/${id}`, { email: `OTHER${tag}@example.com` });
check('email another owner uses refused', r.status === 422, r.text);

for (const role of ['housekeeper']) {
  r = await call('PATCH', `/api/owners/${id}`, { phone: '+60 11-1111 1111' }, role);
  check(`${role} cannot edit owner details (403)`, r.status === 403, r.text);
}
r = await call('GET', `/api/owners?id=${id}`, undefined, 'housekeeper');
check('housekeeper cannot read owner records (403)', r.status === 403, r.text);
r = await call('GET', `/api/owners?id=${id}`);
check('refused edits left the phone alone', r.json?.data?.[0]?.phone === edit.phone, JSON.stringify(r.json?.data?.[0]?.phone));

// Unit page owner block: contact for management, not for a housekeeper.
const unitId = target.units[0]?.unitId;
if (unitId) {
  r = await call('GET', `/api/units/detail?unitId=${unitId}`);
  const ow = r.json?.unit?.owner;
  check('unit page shows owner phone/email', ow?.phone === edit.phone && ow?.email === edit.email && (noAddress ? ow.address === null : ow.address?.city === 'Petaling Jaya'), JSON.stringify(ow));
  r = await call('GET', `/api/units/detail?unitId=${unitId}`, undefined, 'housekeeper');
  const hk = r.json?.unit?.owner;
  check('unit page hides owner contact from a housekeeper', r.status !== 200 || (!hk?.phone && !hk?.email && !hk?.address), JSON.stringify(hk));
}

// Put the shown fields back so other checks see the seed values.
await call('PATCH', `/api/owners/${id}`, { displayName: before.displayName, email: before.email ?? '', phone: before.phone ?? '' });
await call('PATCH', `/api/owners/${other.id}`, { email: other.email ?? '' });
done();
