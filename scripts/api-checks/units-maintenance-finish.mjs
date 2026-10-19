// Owner requests of 11 Oct 2026, Units and Maintenance (U3, U4, M3, M6): the unit's Reservations tab by status and
// dates, its Jobs tab (every job, by dates), Financials for any month, and a maintenance job created with its catalog
// item, assignee and repair window in one request. Needs a local server (harness.mjs) on demo data.
import { call, check, done } from './harness.mjs';

const units = (await call('GET', '/api/units')).json.data;
const unit = units[0];
const uid = unit.id;

// U3: reservations by the owner's status words, and by dates.
let r = await call('GET', `/api/units/stays?unitId=${uid}`);
check('stays default to All with a count per status', r.status === 200 && r.json.when === 'all'
  && ['all', 'upcoming', 'arriving', 'hosting', 'checking_out', 'past', 'cancelled'].every(k => typeof r.json.counts[k] === 'number'), r.text.slice(0, 300));
const counts = r.json.counts;
check('the statuses add up to All', counts.upcoming + counts.arriving + counts.hosting + counts.checking_out + counts.past + counts.cancelled === counts.all, JSON.stringify(counts));
check('every row carries its status', r.json.rows.every(x => typeof x.phase === 'string'), r.text.slice(0, 200));
r = await call('GET', `/api/units/stays?unitId=${uid}&when=past`);
check('a status chip lists only that status', r.status === 200 && r.json.rows.every(x => x.phase === 'past') && r.json.total === counts.past, r.text.slice(0, 200));
r = await call('GET', `/api/units/stays?unitId=${uid}&from=2000-01-01&to=2000-01-31`);
check('a date range with no stays is empty', r.status === 200 && r.json.total === 0 && r.json.counts.all === 0, r.text.slice(0, 200));
r = await call('GET', `/api/units/stays?unitId=${uid}&from=2026-02-01&to=2026-01-01`);
check('a range ending before it starts is refused (422)', r.status === 422, r.text);
r = await call('GET', `/api/units/stays?unitId=${uid}&when=someday`);
check('an unknown status is refused (422)', r.status === 422, r.text);

// U3: every cleaning and maintenance job, with a date on each clean.
r = await call('GET', `/api/units/jobs?unitId=${uid}`);
check('jobs: both lists, a day and a status on each', r.status === 200 && Array.isArray(r.json.cleaning) && Array.isArray(r.json.maintenance)
  && r.json.cleaning.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.day) && t.status) && r.json.maintenance.every(m => m.status), r.text.slice(0, 300));
r = await call('GET', `/api/units/jobs?unitId=${uid}&from=2000-01-01&to=2000-01-02`);
check('jobs: a range with nothing is empty', r.status === 200 && r.json.cleaning.length === 0 && r.json.maintenance.length === 0, r.text.slice(0, 200));
r = await call('GET', `/api/units/jobs?unitId=${uid}`, undefined, 'finance_admin');
check('jobs: finance sees amounts', r.status === 200, r.text.slice(0, 100));

// U4: any month, every statement line.
r = await call('GET', `/api/units/financials?unitId=${uid}&month=2026-09`);
const labels = (r.json?.pnl ?? []).map(l => l.label);
check('financials for a past month', r.status === 200 && r.json.month === '2026-09' && r.json.closed === true, r.text.slice(0, 200));
check('the statement ends with the net payout', labels.at(-1) === 'Net Payout to Owner', labels.join(' | '));
if (labels.some(l => l.startsWith('Gross Income'))) {
  check('every deduction line is there, nil ones too', ['Cleaning fees', 'Utilities: electricity', 'Utilities: water', 'Utilities: Wi-Fi', 'Utilities: IndahWater', 'Maintenance repair and other fees', 'Other fees'].every(w => labels.includes(w)), labels.join(' | '));
  check('no line shows a negative zero', !JSON.stringify(r.json.pnl).includes('"amount":-0'), '');
}
r = await call('GET', `/api/units/financials?unitId=${uid}&month=2026-13`);
check('a bad month is refused (422)', r.status === 422, r.text);
r = await call('GET', `/api/units/financials?unitId=${uid}`, undefined, 'housekeeper');
check('a cleaner cannot read unit money (403)', r.status === 403, r.text);

// M3 + M6: catalog item, assignee and repair window at creation; the item changes later, or goes back to Other.
const tag = Date.now().toString().slice(-6);
r = await call('POST', '/api/maintenance/skus', { code: `FIN-${tag}`, name: `Replace tap ${tag}`, category: 'plumbing', unitLabel: 'job', defaultPrice: 12000 });
check('catalog item added', r.status === 201, r.text); const sku = r.json?.id;
r = await call('POST', '/api/maintenance/issues', { unitId: uid, title: 'Tap dripping', category: 'plumbing', skuId: sku, assigneeName: `Test Plumber ${tag}`,
  window: { startsAt: '2026-11-02T10:00', endsAt: '2026-11-02T13:00', note: 'Between guests' } });
check('job created with item, assignee and window', r.status === 201 && r.json.state === 'assigned' && Array.isArray(r.json.overlaps), r.text); const jid = r.json?.id;
let job = (await call('GET', `/api/maintenance/issues?unitId=${uid}`)).json.data.find(x => x.id === jid);
check('the job carries them', job && job.skuId === sku && job.vendorName === `Test Plumber ${tag}` && job.assigneeKind === 'contractor' && job.windows.length === 1 && job.quotedAmount === 12000, JSON.stringify(job).slice(0, 300));
r = await call('POST', '/api/maintenance/issues', { unitId: uid, title: 'x', category: 'other', window: { startsAt: '2026-11-02T13:00', endsAt: '2026-11-02T10:00' } });
check('a window ending before it starts is refused, nothing saved (422)', r.status === 422 && r.json?.error?.fields?.windowEndsAt, r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: uid, title: 'x', category: 'other', window: { startsAt: '2026-11-02T10:00', endsAt: '2026-11-02T12:00' } }, 'housekeeper');
check('a cleaner cannot plan a window (403)', r.status === 403, r.text);
r = await call('PATCH', `/api/maintenance/issues/${jid}`, { skuId: null });
check('item set back to Other', r.status === 200, r.text);
job = (await call('GET', `/api/maintenance/issues?unitId=${uid}`)).json.data.find(x => x.id === jid);
check('Other persisted', job.skuId === null, JSON.stringify(job).slice(0, 200));
r = await call('PATCH', `/api/maintenance/issues/${jid}`, { skuId: 'no-such-item' });
check('an unknown item is refused (404)', r.status === 404, r.text);

done();
