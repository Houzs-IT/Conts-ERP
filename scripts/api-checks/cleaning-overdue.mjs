// Overdue cleaning jobs (lead's QC, 18 Oct 2026): the board keeps them apart from the day's own jobs, and management closes
// them in bulk (housekeeping/overdue.ts): Mark done (charged like a finished clean, no photo asked) or Cancel job (reason,
// audited, never charged). Cleaners and other staff may not.
// Needs a local server on demo data (node scripts/dev-pglite.mjs + wrangler pages dev; see harness.mjs).
//
// Run: API_BASE=http://localhost:8910 node scripts/api-checks/cleaning-overdue.mjs
import { call, check, done } from './harness.mjs';

const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const today = day(0);

const units = (await call('GET', '/api/units?pageSize=50')).json;
const unitIds = (units?.data ?? units?.rows ?? []).map(u => u.id);
check('demo units', unitIds.length >= 3, JSON.stringify(units).slice(0, 200));

const job = async (unitId, date, kind = 'turnover') => {
  const r = await call('POST', '/api/housekeeping/tasks', { unitId, date, kind });
  check(`job made on ${date}`, r.status === 201, r.text);
  return r.json?.id;
};
const doneA = await job(unitIds[0], day(-3));
const doneB = await job(unitIds[1], day(-6), 'deep_clean');
const cancelC = await job(unitIds[2], day(-4));
const cancelD = await job(unitIds[0], day(-8));
const started = await job(unitIds[2], day(-2));
const todays = await job(unitIds[0], today);
check('a cleaner starts one overdue job', (await call('POST', `/api/housekeeping/tasks/${started}/start`, {})).status === 200);

// The board: earlier days' open jobs are carried over (the screen puts them in Overdue), today's are not.
const board = (await call('GET', `/api/housekeeping/board?date=${today}`)).json;
const row = (id) => board?.rows?.find(r => r.id === id);
check('overdue jobs are on today\'s board, carried over', [doneA, doneB, cancelC, cancelD, started].every(id => row(id)?.carriedOver === true));
check('today\'s own job is not carried over', row(todays) && row(todays).carriedOver === false);

// Permissions: only management roles; never the field app.
for (const role of ['housekeeper', 'technician']) {
  const r = await call('POST', '/api/housekeeping/overdue', { action: 'done', taskIds: [doneA] }, role);
  check(`${role} may not close jobs in bulk`, r.status === 403, `${r.status} ${r.text}`);
}
check('the refused tries changed nothing', (await call('GET', `/api/housekeeping/tasks/${doneA}`)).json?.state !== 'resolved');
check('cancel needs a reason', (await call('POST', '/api/housekeeping/overdue', { action: 'cancel', taskIds: [cancelC] })).status === 422);
check('an unknown action is refused', (await call('POST', '/api/housekeeping/overdue', { action: 'delete', taskIds: [cancelC] })).status === 422);

// Mark done: the caller, now, note "closed in bulk", no photo; charged by the finished-clean rule; today's job left alone.
const before = (await call('GET', `/api/housekeeping/tasks/${doneA}`)).json?.cost;
const md = await call('POST', '/api/housekeeping/overdue', { action: 'done', taskIds: [doneA, doneB, todays] }, 'operations_manager');
check('operations manager marks two overdue jobs done', md.status === 200 && md.json?.closed === 2, md.text);
check('today\'s job is skipped as not overdue', md.json?.skipped?.length === 1 && md.json.skipped[0].id === todays && /not overdue/.test(md.json.skipped[0].reason), JSON.stringify(md.json?.skipped));
const a = (await call('GET', `/api/housekeeping/tasks/${doneA}`)).json;
check('done, by the person who closed it, just now', a?.state === 'resolved' && a.completedBy === 'Aina Zulkifli' && Date.now() - Date.parse(a.completedAt) < 120e3, JSON.stringify({ s: a?.state, by: a?.completedBy, at: a?.completedAt }));
const why = md.json?.notCharged?.find(n => n.id === doneA);
check('charged to the unit like a finished clean (or the reason it was not)', before?.amount > 0 ? a?.cost?.charged === true || !!why?.reason : a?.cost?.charged === false, JSON.stringify({ before, after: a?.cost, why }));
check('the answer counts the charges', md.json?.charged + (md.json?.notCharged?.length ?? 0) === 2, md.text);
const hist = (await call('GET', `/api/audit?entityTable=tasks&entityId=${doneA}`)).json?.data ?? [];
check('audited with the note "closed in bulk"', hist.some(h => h.action === 'task.complete' && h.after?.note === 'closed in bulk' && h.after?.bulk === true), JSON.stringify(hist.map(h => h.action)));
const again = await call('POST', '/api/housekeeping/overdue', { action: 'done', taskIds: [doneA] });
check('a second close does nothing (already done, no second charge)', again.json?.closed === 0 && again.json?.charged === 0, again.text);

// Cancel: reason, audited, removed, never charged; a job a cleaner started is kept.
const cc = await call('POST', '/api/housekeeping/overdue', { action: 'cancel', taskIds: [cancelC, cancelD, started], reason: 'Stale import, stay ended days ago' }, 'management');
check('management cancels two overdue jobs', cc.status === 200 && cc.json?.closed === 2, cc.text);
check('the started job is kept, with why', cc.json?.skipped?.some(s => s.id === started && /started/.test(s.reason)), JSON.stringify(cc.json?.skipped));
check('cancelled jobs are gone', (await call('GET', `/api/housekeeping/tasks/${cancelC}`)).status === 404 && (await call('GET', `/api/housekeeping/tasks/${cancelD}`)).status === 404);
check('the started job is still open', (await call('GET', `/api/housekeeping/tasks/${started}`)).json?.state === 'in_progress');
const ch = (await call('GET', `/api/audit?entityTable=tasks&entityId=${cancelC}`)).json?.data ?? [];
check('cancel audited with its reason and what the job was', ch.some(h => h.action === 'task.cancel' && h.after?.reason === 'Stale import, stay ended days ago' && h.before?.day === day(-4)), JSON.stringify(ch));
const charges = (await call('GET', '/api/audit?entityTable=expenses&pageSize=200')).json?.data ?? [];
check('nothing is charged for a cancelled job', !charges.some(h => h.action === 'expense.create' && [cancelC, cancelD].includes(h.after?.taskId)));
check('cancel is charged nothing in the answer', cc.json?.charged === 0 && cc.json?.chargedAmount === 0, cc.text);

const after = (await call('GET', `/api/housekeeping/board?date=${today}`)).json;
check('the board no longer shows the closed jobs', ![doneA, doneB, cancelC, cancelD].some(id => after?.rows?.some(r => r.id === id)));

// Tidy up the two left open, so a rerun starts clean.
await call('POST', '/api/housekeeping/overdue', { action: 'done', taskIds: [started] });
await call('POST', `/api/tasks/${todays}/complete`, { photoIds: [] });
done();
