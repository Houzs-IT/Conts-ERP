import { call, check, done } from './harness.mjs';
const U1 = '55555555-5555-4555-8555-000000000001';
// pricing
let r = await call('GET', '/api/pricing/rules'); check('pricing rules shape', r.status === 200 && r.json.units.every(u => 'costFloor' in u && u.rates.length === 3 && u.rates.every(x => 'upliftSen' in x && x.sync)) && r.json.units.every(u => 'weekendRate' in u), r.text.slice(0, 300));
r = await call('PUT', '/api/rates', { unitId: U1, baseRate: 30000 }); check('set base rate', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: U1, baseRate: 0 }); check('zero base rate 422', r.status === 422, r.text);
r = await call('PUT', '/api/rates', { unitId: U1, costFloor: 12000 }); check('set cost floor', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: U1, channel: 'airbnb', uplift: 4000 }); check('set uplift', r.status === 200, r.text);
r = await call('PUT', '/api/rates', { unitId: U1, channel: 'direct', uplift: 4000 }); check('uplift on direct 422', r.status === 422, r.text);
r = await call('GET', '/api/pricing/rules'); const pu = r.json.units.find(u => u.unitId === U1); check('pricing persisted', pu.baseRate === 30000 && pu.costFloor === 12000 && pu.rates.find(x => x.channel === 'airbnb').upliftSen === 4000, JSON.stringify(pu));
r = await call('POST', '/api/rates/bulk', { unitIds: [U1], channels: ['direct', 'airbnb'], from: '2026-12-04', to: '2026-12-06', baseRate: 30000, uplifts: { airbnb: 4000 } }); check('pricing push (held, not sent; Airbnb skipped, not connected)', r.status === 200 && r.json.written === 3 && r.json.skipped?.airbnb === 1, r.text);
r = await call('GET', '/api/reservations/calendar?from=2026-12-04&to=2026-12-07'); check('weekend uplift applied (Fri 4 Dec airbnb = (30000+4000)*1.22)', r.json.rates[`${U1}:airbnb:2026-12-04`] === Math.round(34000 * 1.22) && r.json.rates[`${U1}:web:2026-12-06`] === 30000, JSON.stringify(r.json.rates));
r = await call('PUT', '/api/rates', { unitId: U1, baseRate: 1 }, 'housekeeper'); check('field role cannot price 403', r.status === 403, r.text);
// reviews
r = await call('GET', '/api/reviews'); check('reviews shape', r.status === 200 && r.json.data.every(x => 'reply' in x && 'repliedAt' in x && x.guestName), r.text.slice(0, 250));
const rv = r.json.data.find(x => x.reply === null) ?? r.json.data[0];
r = await call('POST', `/api/reviews/${rv.id}/reply`, { body: '' }); check('empty reply 422', r.status === 422, r.text);
r = await call('POST', `/api/reviews/${rv.id}/reply`, { body: 'Thank you for staying with us.' }); check('reply saved', r.status === 200, r.text);
r = await call('GET', '/api/reviews'); check('reply persisted', r.json.data.find(x => x.id === rv.id).reply === 'Thank you for staying with us.' && r.json.data.find(x => x.id === rv.id).repliedAt, '');
r = await call('POST', '/api/reviews/nope/reply', { body: 'x' }); check('reply unknown review 404', r.status === 404, r.text);
r = await call('POST', `/api/reviews/${rv.id}/reply`, { body: 'x' }, 'finance_admin'); check('finance cannot reply 403', r.status === 403, r.text);
// inbox
r = await call('GET', '/api/messages/threads'); check('threads with messages', r.status === 200 && r.json.threads.length > 0 && r.json.threads.every(t => Array.isArray(t.messages) && 'preview' in t), r.text.slice(0, 250));
const th = r.json.threads[0];
r = await call('PATCH', `/api/messages/threads/${th.id}`, { isRead: true }); check('mark read', r.status === 200, r.text);
r = await call('POST', '/api/messages', { threadId: th.id, body: 'Hello from the test' }); check('reply in thread', r.status === 201 && r.json.delivery, r.text);
r = await call('GET', '/api/messages/threads'); check('sent message appears (outbound)', r.json.threads.find(t => t.id === th.id).messages.at(-1).body === 'Hello from the test' && r.json.threads.find(t => t.id === th.id).messages.at(-1).direction === 'outbound', '');
r = await call('POST', '/api/messages', { threadId: th.id, body: '' }); check('empty message 422', r.status === 422, r.text);
r = await call('POST', '/api/messages', { threadId: 'nope', body: 'x' }); check('unknown thread 404', r.status === 404, r.text);
const res = (await call('GET', '/api/reservations')).json.data.find(x => x.channel === 'direct' || true);
r = await call('POST', '/api/messages', { reservationId: res.id, body: 'By reservation' }); check('message by reservation creates/finds thread', r.status === 201, r.text);
r = await call('POST', '/api/messages', { reservationId: res.id, kind: 'access_details' }); check('access details message', r.status === 201 || r.status === 404, r.text);
r = await call('GET', '/api/messages/threads', undefined, 'housekeeper'); check('field role 403 on inbox', r.status === 403, r.text);
// automations
r = await call('GET', '/api/automations'); check('automations catalog', r.status === 200 && r.json.data.length === 30 && r.json.data.every(x => x.group && x.preview && x.channels.length) && r.json.quietHours.from, r.text.slice(0, 200));
const ar = r.json.data[0];
r = await call('PATCH', '/api/automations', { id: ar.id, isActive: !ar.isActive }); check('toggle rule', r.status === 200, r.text);
r = await call('GET', '/api/automations'); check('toggle persisted', r.json.data.find(x => x.id === ar.id).isActive === !ar.isActive, '');
r = await call('PATCH', '/api/automations', { id: 'nope', isActive: true }); check('unknown rule 422', r.status === 422, r.text);
r = await call('PATCH', '/api/automations', { id: ar.id, isActive: true }, 'finance_admin'); check('finance cannot toggle 403', r.status === 403, r.text);
// users
const tag = Date.now().toString().slice(-6);
r = await call('GET', '/api/users'); check('users list has managerId + phone', r.status === 200 && r.json.data.every(u => 'managerId' in u && 'phone' in u), r.text.slice(0, 200));
const mgr = r.json.data.find(u => u.role === 'operations_manager');
r = await call('POST', '/api/users', { fullName: 'New Staff', email: `staff${tag}@example.com`, role: 'operations_staff', managerId: mgr.id }); check('invite user (no password in response)', r.status === 201 && r.json.delivery && !/password/i.test(r.text), r.text); const uid = r.json?.id;
r = await call('POST', '/api/users', { fullName: 'Dup', email: `staff${tag}@example.com`, role: 'operations_staff' }); check('duplicate email 409', r.status === 409, r.text);
r = await call('POST', '/api/users', { fullName: 'Own', email: `own${tag}@example.com`, role: 'owner' }); check('cannot invite owner here 422', r.status === 422, r.text);
r = await call('POST', '/api/users', { fullName: 'X', email: `x${tag}@example.com`, role: 'operations_staff' }, 'operations_manager'); check('ops manager cannot invite 403', r.status === 403, r.text);
r = await call('PATCH', `/api/users/${uid}`, { role: 'finance_admin', managerId: null }); check('change role + clear manager', r.status === 200, r.text);
r = await call('PATCH', `/api/users/${uid}`, { managerId: uid }); check('cannot report to self 422', r.status === 422, r.text);
r = await call('PATCH', '/api/users/11111111-1111-4111-8111-000000000002', { isActive: false }); check('cannot deactivate yourself', r.status === 422, r.text);
// Demote the account this suite invited, not the shared management test account (which the rest of the run, and later runs, sign in as).
r = await call('PATCH', `/api/users/${uid}`, { role: 'management' }); check('promote invited user to management', r.status === 200, r.text);
r = await call('PATCH', `/api/users/${uid}`, { role: 'operations_staff' }); check('demotion allowed only while another active management account exists', r.status === 200, r.text);
r = await call('PUT', '/api/users/org-chart', { managers: [{ id: uid, managerId: mgr.id }] }); check('org chart save', r.status === 200 && r.json.changed === 1, r.text);
r = await call('PUT', '/api/users/org-chart', { managers: [{ id: uid, managerId: mgr.id }, { id: mgr.id, managerId: uid }] }); check('org chart loop refused 422', r.status === 422, r.text);
r = await call('GET', '/api/users'); check('org chart persisted', r.json.data.find(u => u.id === uid).managerId === mgr.id, '');
// settings
r = await call('GET', '/api/settings'); check('settings by section with defaults', r.status === 200 && r.json.company.legalName && r.json.operations.checkIn && r.json.statements === undefined && typeof r.json.locale.managementFeePct === 'number' && r.json.security.lockoutAttempts, r.text.slice(0, 300));
r = await call('PUT', '/api/settings', { company: { legalName: 'The Conts Sdn Bhd (test)', supportEmail: 'help@theconts.com' } }); check('save company', r.status === 200, r.text);
r = await call('PUT', '/api/settings', { company: { supportEmail: 'not-an-email' } }); check('bad email 422', r.status === 422 && r.json.error.fields['company.supportEmail'], r.text);
r = await call('PUT', '/api/settings', { locale: { managementFeePct: 150 } }); check('fee over 100 422', r.status === 422, r.text);
r = await call('PUT', '/api/settings', { operations: { checkIn: '25:00' } }); check('bad time 422', r.status === 422, r.text);
r = await call('PUT', '/api/settings', { nonsense: { a: 1 } }); check('unknown section 422', r.status === 422, r.text);
r = await call('PUT', '/api/settings', { operations: { linenSets: 3 } }); check('removed setting refused 422', r.status === 422, r.text);
r = await call('PUT', '/api/settings', { operations: { checkIn: '14:00' } }); check('save operations', r.status === 200, r.text);
r = await call('GET', '/api/settings'); check('settings persisted', r.json.company.legalName === 'The Conts Sdn Bhd (test)' && r.json.operations.checkIn === '14:00', JSON.stringify(r.json.operations));
r = await call('PUT', '/api/settings', { company: { legalName: 'x' } }, 'operations_manager'); check('ops manager cannot change settings 403', r.status === 403, r.text);
done();
