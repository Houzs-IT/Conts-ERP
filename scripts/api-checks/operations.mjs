import { call, check, done } from './harness.mjs';
const NURUL = '11111111-1111-4111-8111-000000000005';
let r = await call('GET', '/api/operations/today'); check('operations/today', r.status === 200 && Array.isArray(r.json.rows) && r.json.rows.every(x => x.sla && typeof x.riskRank === 'number' && 'unitNumber' in x), r.text.slice(0, 300));
console.log('   rows:', r.json.rows.length, r.json.rows.map(x => `${x.kind}:${x.unitNumber}:${x.sla.label}`).join(' | '));
r = await call('GET', '/api/housekeeping/crew'); check('crew', r.status === 200 && r.json.data.some(c => c.id === NURUL), r.text);
r = await call('GET', '/api/housekeeping/crew?scope=all'); check('crew all', r.json.data.length >= 1, r.text);
r = await call('GET', '/api/housekeeping/tasks?date=2026-09-10..2026-09-30'); check('housekeeping tasks', r.status === 200 && r.json.rows.every(x => 'sourceRef' in x && 'linenSet' in x && 'sequence' in x && 'photoCount' in x), r.text.slice(0, 300));
const hk = r.json.rows; console.log('   hk rows:', hk.length, hk.map(x => `${x.id}:${x.state}:${x.scheduledFor}-${x.dueAt}`).join(' | '));
r = await call('GET', '/api/tasks'); check('tasks list', r.status === 200 && r.json.data.every(x => x.sla && 'unitId' in x && 'sequence' in x && 'riskRank' in x), r.text.slice(0, 300));
const open = r.json.data.find(x => x.state === 'open' && ['turnover','deep_clean','light_clean'].includes(x.kind) && x.dueAt);
console.log('   open task:', open && open.id);
if (open) {
  r = await call('POST', `/api/housekeeping/tasks/${open.id}/assign`, { assigneeId: NURUL, force: true }); check('assign', r.status === 200, r.text);
  r = await call('POST', `/api/housekeeping/tasks/${open.id}/assign`, { assigneeId: 'nope' }); check('assign unknown 404', r.status === 404, r.text);
  r = await call('PATCH', `/api/housekeeping/tasks/${open.id}`, { scheduledFor: '09:00', dueAt: '11:00' }); check('reschedule', r.status === 200, r.text);
  r = await call('PATCH', `/api/housekeeping/tasks/${open.id}`, { scheduledFor: '11:00', dueAt: '09:00' }); check('reschedule bad 422', r.status === 422, r.text);
  r = await call('POST', `/api/housekeeping/tasks/${open.id}/start`, {}, 'housekeeper'); check('start as the assigned cleaner', r.status === 200, r.text);
  r = await call('POST', `/api/tasks/${open.id}/photos`, {}, 'housekeeper'); check('photo upload with no file refused (422)', r.status === 422, r.text);
  r = await call('POST', `/api/tasks/${open.id}/complete`, { photoIds: [] }, 'housekeeper'); check('complete without a photo refused (PHOTO_REQUIRED)', r.status === 422 && r.json?.error?.code === 'PHOTO_REQUIRED', r.text);
  r = await call('GET', '/api/tasks'); check('task stays open after the refusal', r.json.data.find(x => x.id === open.id)?.state !== 'resolved', '');
}
r = await call('PUT', '/api/housekeeping/rules', { rule: 'building' }); check('rule set', r.status === 200, r.text);
r = await call('PUT', '/api/housekeeping/rules', { rule: 'bogus' }); check('rule bad 422', r.status === 422, r.text);
r = await call('POST', '/api/housekeeping/auto-assign', { rule: 'building' }); check('auto-assign', r.status === 200 && typeof r.json.assigned === 'number', r.text);
r = await call('GET', '/api/tasks', undefined, 'housekeeper'); check('housekeeper sees only own tasks', r.status === 200 && r.json.data.every(x => x.assigneeId === NURUL), r.text.slice(0, 200));
r = await call('POST', '/api/housekeeping/auto-assign', {}, 'housekeeper'); check('housekeeper cannot auto-assign 403', r.status === 403, r.text);
done();
