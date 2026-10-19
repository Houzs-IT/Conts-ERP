import { call, check, done, cookieFor } from './harness.mjs';
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
// Two jobs block #2207: closing one keeps it off sale, a clean finished meanwhile does not sell it, closing the last one does.
const readinessOf = async (n) => (await call('GET', '/api/units')).json.data.find(u => u.unitNumber === n).readiness;
r = await call('POST', '/api/maintenance/issues', { unitId: '#2207', title: 'First job', blocksUnit: true }); const fid = r.json.id; check('first blocking job', r.status === 201 && await readinessOf('#2207') === 'maintenance', r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: '#2207', title: 'Second job', blocksUnit: true }); const sid = r.json.id;
r = await call('POST', `/api/maintenance/issues/${sid}/complete`, { finalAmount: 0 }); check('unit with another open blocker stays off sale', r.status === 200 && await readinessOf('#2207') === 'maintenance', r.text);
r = await call('POST', '/api/housekeeping/tasks', { unitId: '#2207', kind: 'turnover', title: 'Standard clean' }); const cid = r.json?.id; check('clean on a blocked unit', r.status === 201 && !!cid, r.text);
r = await call('POST', `/api/housekeeping/tasks/${cid}/start`, {}); check('clean started, unit still maintenance', r.status === 200 && await readinessOf('#2207') === 'maintenance', r.text);
{ const fd = new FormData(); fd.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'proof.png');
  await fetch(`${process.env.API_BASE ?? 'http://localhost:8788'}/api/tasks/${cid}/photos`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: fd }); }
r = await call('POST', `/api/tasks/${cid}/complete`, {}); check('clean finished, unit still maintenance', r.status === 200 && await readinessOf('#2207') === 'maintenance', r.text);
r = await call('POST', `/api/maintenance/issues/${fid}/complete`, { finalAmount: 0 }); check('last blocker closed: unit back on sale', r.status === 200 && await readinessOf('#2207') === 'ready', r.text);
r = await call('GET', '/api/finance/expenses'); check('expense raised', JSON.stringify(r.json).includes('Test leak'), r.text.slice(0, 200));
r = await call('PATCH', `/api/maintenance/issues/${id}`, { state: 'reopened' }); check('reopen', r.status === 200, r.text);
r = await call('POST', `/api/maintenance/issues/${id}/photos`, {}); check('photo upload with no file refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: '#2207', title: 'Field damage', blocksUnit: true, source: 'field_app' }, 'housekeeper'); check('field damage report', r.status === 201, r.text);
// field
r = await call('GET', '/api/field/tasks?date=today', undefined, 'housekeeper'); check('field tasks', r.status === 200 && Array.isArray(r.json.rows) && r.json.rows.every(x => x.unit && 'addressLine' in x && !JSON.stringify(x).match(/revenue|fee|payout/i)), r.text.slice(0, 300));
console.log('   field rows:', r.json.rows.length);
done();
