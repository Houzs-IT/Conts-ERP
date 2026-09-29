import { call, check, done } from './harness.mjs';
const NURUL = '11111111-1111-4111-8111-000000000005';
let r = await call('GET', '/api/maintenance/issues'); check('maint list', r.status === 200 && r.json.data.every(x => 'assigneeName' in x && 'photoCount' in x && 'unitId' in x), r.text.slice(0, 250));
// create by unit NUMBER + property (what the screen sends)
r = await call('POST', '/api/maintenance/issues', { unitId: '#A-12-03', propertyName: 'Vista Jaya One', title: 'Test leak', detail: 'x', blocksUnit: false, quotedAmount: 50000, chargeTo: 'owner' }); check('create by unit number', r.status === 201, r.text); const id = r.json?.id;
r = await call('POST', '/api/maintenance/issues', { unitId: 'NOPE', title: 'x' }); check('unknown unit 404', r.status === 404, r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: '#2207', title: '' }); check('empty title 422', r.status === 422, r.text);
r = await call('PATCH', `/api/maintenance/issues/${id}`, { assigneeId: 'AquaFix' }); check('assign vendor', r.status === 200, r.text);
r = await call('POST', `/api/maintenance/issues/${id}/request-approval`, {}); check('request approval', r.status === 200, r.text);
r = await call('POST', `/api/maintenance/issues/${id}/complete`, { finalAmount: 48000 }); check('complete blocked until approved 409', r.status === 409 && r.json.error.code === 'APPROVAL_PENDING', r.text);
r = await call('POST', `/api/maintenance/issues/${id}/approve`, { approved: true, quotedAmount: 99 }); check('approve wrong quote 409', r.status === 409, r.text);
r = await call('POST', `/api/maintenance/issues/${id}/approve`, { approved: true, quotedAmount: 50000 }); check('approve', r.status === 200, r.text);
r = await call('POST', '/api/blocks', { unitId: '#A-12-03', propertyName: 'Vista Jaya One', reason: 'maintenance', issueId: id }); check('block by issue (no dates)', r.status === 201, r.text);
r = await call('GET', '/api/units'); check('unit now maintenance', r.json.data.find(u => u.unitNumber === '#A-12-03').readiness === 'maintenance', '');
r = await call('POST', `/api/maintenance/issues/${id}/complete`, { finalAmount: 48000 }); check('complete', r.status === 200, r.text);
r = await call('GET', '/api/units'); check('unit back on sale (ready)', r.json.data.find(u => u.unitNumber === '#A-12-03').readiness === 'ready', '');
r = await call('POST', '/api/maintenance/issues', { unitId: '#2207', title: 'Second job', blocksUnit: true }); const sid = r.json.id; await call('POST', `/api/maintenance/issues/${sid}/complete`, { finalAmount: 0 }); r = await call('GET', '/api/units'); check('unit with another open blocker stays off sale', r.json.data.find(u => u.unitNumber === '#2207').readiness === 'maintenance', '');
r = await call('GET', '/api/finance/expenses'); check('expense raised', JSON.stringify(r.json).includes('Test leak'), r.text.slice(0, 200));
r = await call('PATCH', `/api/maintenance/issues/${id}`, { state: 'reopened' }); check('reopen', r.status === 200, r.text);
r = await call('POST', `/api/maintenance/issues/${id}/photos`, {}); check('photo upload with no file refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: '#2207', title: 'Field damage', blocksUnit: true, source: 'field_app' }, 'housekeeper'); check('field damage report', r.status === 201, r.text);
// inspections
r = await call('GET', '/api/inspections'); check('inspections list has ref + required', r.status === 200 && r.json.data.every(x => x.ref && x.checklist.every(c => typeof c.required === 'boolean')), r.text.slice(0, 250));
r = await call('POST', '/api/inspections', { unitId: '#A-12-03', propertyName: 'Vista Jaya One' }); check('inspection create', r.status === 201, r.text); const iid = r.json?.id;
r = await call('POST', '/api/inspections', { unitNumber: '#A-12-03', propertyName: 'Vista Jaya One' }); check('second create returns the same (no duplicate)', r.json?.existing === true && r.json.id === iid, r.text);
r = await call('POST', `/api/inspections/${iid}/start`, {}); check('start', r.status === 200, r.text);
r = await call('POST', `/api/inspections/${iid}/complete`, { result: 'pass' }); check('pass refused while unchecked 422', r.status === 422, r.text);
const mine = (await call('GET', '/api/inspections')).json.data.find(x => x.id === iid);
for (const item of mine.checklist.filter(c => c.required).map(c => c.item)) { r = await call('POST', `/api/inspections/${iid}/items`, { item, result: true }); if (r.status !== 200) check('item ' + item, false, r.text); }
r = await call('POST', `/api/inspections/${iid}/complete`, { result: 'pass', checklist: [] }); check('pass', r.status === 200 && r.json.passed === true, r.text);
r = await call('GET', '/api/units'); check('unit ready after pass', r.json.data.find(u => u.unitNumber === '#A-12-03').readiness === 'ready', '');
r = await call('POST', '/api/inspections', { unitId: '#B-08-11' }); const i2 = r.json.id; const cl2 = (await call('GET', '/api/inspections')).json.data.find(x => x.id === i2).checklist;
r = await call('POST', `/api/inspections/${i2}/items`, { item: cl2[0].item, result: false, note: 'silicone', linkedIssue: id }); check('fail item with link', r.status === 200, r.text);
r = await call('POST', `/api/inspections/${i2}/complete`, { result: 'fail' }); check('fail', r.status === 200 && r.json.passed === false, r.text);
r = await call('GET', '/api/inspections'); check('linkedIssue shown as MNT ref', JSON.stringify(r.json).includes('"linkedIssue":"MNT-'), '');
// field
r = await call('GET', '/api/field/tasks?date=today', undefined, 'housekeeper'); check('field tasks', r.status === 200 && Array.isArray(r.json.rows) && r.json.rows.every(x => x.unit && 'addressLine' in x && !JSON.stringify(x).match(/revenue|fee|payout/i)), r.text.slice(0, 300));
console.log('   field rows:', r.json.rows.length);
done();
