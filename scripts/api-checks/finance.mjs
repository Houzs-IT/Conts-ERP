import { call, check, done, receiptFor } from './harness.mjs';
let r = await call('GET', '/api/analytics?range=12m'); check('analytics 12m shape', r.status === 200 && r.json.points.length === 12 && r.json.deltas.revenue && r.json.deltas.occupancy.unit === 'points' && Array.isArray(r.json.channelMix) && r.json.units.every(u => 'rating' in u), r.text.slice(0, 300));
r = await call('GET', '/api/analytics?range=3m'); check('analytics 3m', r.status === 200 && r.json.points.length === 3, r.text.slice(0, 200));
r = await call('GET', '/api/analytics?range=ytd'); check('analytics ytd', r.status === 200 && r.json.points.length === 9, r.text.slice(0, 200));
r = await call('GET', '/api/analytics?range=9y'); check('analytics bad range 422', r.status === 422, r.text);
r = await call('GET', '/api/analytics?range=3m', undefined, 'housekeeper'); check('analytics field role 403', r.status === 403, r.text);
// expenses
r = await call('GET', '/api/finance/expenses'); check('expenses list has locked + sentPeriods', r.status === 200 && r.json.data.every(e => 'locked' in e && e.unitNumber) && Array.isArray(r.json.sentPeriods), r.text.slice(0, 250));
const before = r.json.data.length;
r = await call('POST', '/api/expenses', { unitId: '#B-08-11', propertyName: 'Arcoris', category: 'internet', amount: 12900, incurredOn: '2026-09-10', description: 'Internet Sep', reference: 'INV-1', receiptDocumentId: await receiptFor() }); check('expense create (unit number)', r.status === 201, r.text); const eid = r.json?.id;
r = await call('POST', '/api/expenses', { unitId: '#B-08-11', category: 'bogus', amount: 1, incurredOn: '2026-09-10' }); check('bad category 422', r.status === 422 && r.json.error.fields.category, r.text);
r = await call('POST', '/api/expenses', { unitId: '#B-08-11', category: 'water', amount: 12.5, incurredOn: '2026-09-10' }); check('non-integer amount 422', r.status === 422, r.text);
r = await call('POST', '/api/expenses', { unitId: '#B-08-11', category: 'water', amount: 4500, incurredOn: '2026-09-10' }, 'housekeeper'); check('field role 403', r.status === 403, r.text);
r = await call('PATCH', `/api/expenses/${eid}`, { amount: 13900, description: 'Internet Sep (corrected)' }); check('expense patch', r.status === 200, r.text);
r = await call('GET', '/api/expenses/report?period=2026-09'); check('expense report csv', r.status === 200 && r.text.includes('Filters applied') && r.text.includes('Internet Sep'), r.text.slice(0, 200));
// statements
r = await call('POST', '/api/statements/generate', { period: '2026-09' }); check('generate 2026-09', r.status === 202 && r.json.count >= 1, r.text);
const gen = r.json.count;
r = await call('GET', '/api/statements?period=all&pageSize=500'); const rows = r.json.data.filter(x => x.period === '2026-09'); check('statements have period', rows.length === gen && rows.every(x => x.state === 'provisional'), JSON.stringify(rows.slice(0, 1)));
const stm = rows[0];
r = await call('GET', `/api/statements/${stm.id}/pdf`); check('pdf by id (has fee line)', r.status === 200 && /management fee|to operator/i.test(r.text), r.text.slice(0, 150));
r = await call('POST', '/api/statements/send', { statementIds: [stm.id] }); check('send provisional refused (in failed)', r.status === 200 && r.json.sent === 0 && r.json.failed.length === 1, r.text);
r = await call('POST', '/api/statements/finalise', { statementIds: rows.map(x => x.id) }); check('finalise all', r.status === 200 && r.json.finalised === rows.length, r.text);
r = await call('POST', '/api/statements/finalise', { statementIds: [stm.id] }); check('finalise again refused', r.json.finalised === 0 && r.json.failed.length === 1, r.text);
r = await call('POST', '/api/statements/finalise', { statementIds: [stm.id] }, 'housekeeper'); check('finalise field role 403', r.status === 403, r.text);
r = await call('GET', '/api/finance/expenses?month=2026-09&pageSize=200'); check('expense now locked', r.json.data.find(e => e.id === eid)?.locked === true && r.json.sentPeriods.includes('2026-09'), '');
r = await call('POST', '/api/expenses', { unitId: '#B-08-11', category: 'water', amount: 4500, incurredOn: '2026-09-11' }); check('new expense in final period 409', r.status === 409 && r.json.error.code === 'PERIOD_LOCKED', r.text);
r = await call('PATCH', `/api/expenses/${eid}`, { amount: 1 }); check('edit locked expense 409', r.status === 409, r.text);
const net = rows.find(x => x.id === stm.id).netPayout;
r = await call('POST', '/api/statements/generate', { period: '2026-09' }); check('regenerate leaves finalised untouched', r.status === 202 && r.json.count === 0 && r.json.skipped >= 1, r.text);
r = await call('GET', '/api/statements?period=all&pageSize=500'); check('finalised numbers unchanged', r.json.data.find(x => x.id === stm.id).netPayout === net && r.json.data.find(x => x.id === stm.id).state === 'finalised', '');
r = await call('POST', '/api/statements/send', { statementIds: rows.map(x => x.id) }); check('send all finalised', r.status === 200 && r.json.sent === rows.length, r.text);
r = await call('GET', '/api/payouts'); const mine = r.json.data.filter(p => rows.some(x => x.id === p.statementId)); check('payout per sent statement (ref, label)', mine.length === rows.length && mine.every(p => p.ref && p.method === 'Bank transfer'), JSON.stringify(mine.slice(0, 1)));
console.log('   payout states:', mine.map(p => p.state).join(','));
const pend = mine.find(p => p.state === 'pending'), bad = mine.find(p => p.state === 'failed');
if (bad) check('no-bank owner shows as failed with reason', /bank details/i.test(bad.failureReason ?? ''), JSON.stringify(bad));
if (pend) { r = await call('PATCH', '/api/payouts', { id: pend.id, state: 'paid' }); check('mark paid', r.status === 200, r.text);
  r = await call('GET', '/api/statements?period=all&pageSize=500'); check('statement becomes paid', r.json.data.find(x => x.id === pend.statementId).state === 'paid', '');
  r = await call('PATCH', '/api/payouts', { id: pend.id, state: 'processing' }); check('paid payout cannot move back 409', r.status === 409, r.text); }
if (bad) { r = await call('PATCH', '/api/payouts', { id: bad.id, state: 'failed' }); check('fail needs a reason 422', r.status === 422, r.text); }
r = await call('POST', '/api/statements/generate', { period: '2026-09' }); check('sent period locked 409', r.status === 409, r.text);
done();
