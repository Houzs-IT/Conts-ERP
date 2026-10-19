// Maker-checker approvals (switched off, the default, and on), numbered guest documents and owner statements from booking payments, end to end against a
// running local app and its database (local only: never staging or production).
//
//   BIGDATA_PORT=55434 node scripts/api-checks/hostplatform-import.mjs ../_hostplatform-data --serve      (database)
//   WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://postgres:local@127.0.0.1:55434/postgres npx wrangler pages dev dist --port 8794
//   APP_URL=http://localhost:8794 DB_URL=postgres://postgres@127.0.0.1:55434/postgres node scripts/api-checks/approvals-documents.mjs
//
// Signs in for real (POST /api/auth/login) as dev@local.test (management, DEV_PASSWORD, default LocalTest1) and as two
// local test users it creates: a finance admin and a second management user (kept switched off except where a test
// needs two management users). It changes local data (requests, refunds, documents) and leaves them as a record.
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto as wc } from 'node:crypto';
import postgres from 'postgres';

const APP = process.env.APP_URL ?? 'http://localhost:8794';
const DB_URL = process.env.DB_URL ?? 'postgres://postgres@127.0.0.1:55434/postgres';
const PASSWORD = process.env.DEV_PASSWORD ?? 'LocalTest1';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP) || !/@(127\.0\.0\.1|localhost):/.test(DB_URL)) { console.error('Local only.'); process.exit(2); }

let fails = 0, passes = 0;
const check = (name, ok, extra = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + String(extra).slice(0, 400)}`); };

// PGlite serves one connection at a time: open, query, close, so the app is never kept waiting.
async function db(fn) {
  const sql = postgres(DB_URL, { max: 1, prepare: false, fetch_types: false, connection: { search_path: 'pos' } });
  try { return await fn(sql); } finally { await sql.end({ timeout: 0 }); }
}
const q = (text, ...args) => db(sql => sql.unsafe(text, args));

async function hash(pw) {
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const salt = wc.getRandomValues(new Uint8Array(16));
  const key = await wc.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await wc.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

async function login(email) {
  const r = await fetch(`${APP}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const c = r.headers.get('set-cookie') ?? '';
  const m = /tc_session=[^;]+/.exec(c);
  if (!m) throw new Error(`login failed for ${email}: ${r.status} ${await r.text()}`);
  return m[0];
}
function as(cookie) {
  return async (method, path, body) => {
    const r = await fetch(APP + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t, type: r.headers.get('content-type') ?? '' };
  };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */
const now = new Date().toISOString();
const pw = await hash(PASSWORD);
await q(`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, is_active, created_at, updated_at)
  VALUES ('chk-finance', 'finance.check@local.test', 'Check Finance', $1, 'finance_admin', 0, 1, $2, $2),
         ('chk-mgmt2', 'mgmt2.check@local.test', 'Check Manager Two', $1, 'management', 0, 0, $2, $2)
  ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, is_active = CASE WHEN users.id = 'chk-finance' THEN 1 ELSE 0 END`, pw, now);
const others = await q(`SELECT id FROM users WHERE role = 'management' AND is_active = 1 AND id <> 'dev-admin'`);
if (others.length) { console.error(`Other active management users exist (${others.length}); the self-approval checks need dev-admin to be the only one.`); process.exit(2); }
const mgmt = as(await login('dev@local.test'));
const fin = as(await login('finance.check@local.test'));
await q(`UPDATE users SET is_active = 1 WHERE id = 'chk-mgmt2'`);
const mgmt2 = as(await login('mgmt2.check@local.test'));
await q(`UPDATE users SET is_active = 0 WHERE id = 'chk-mgmt2'`);
await q(`DELETE FROM settings WHERE key IN ('approvals.expenseThreshold','approvals.financeAdminLimit')`); // defaults: RM 500 and RM 2,000

const setApprovals = on => on
  ? q(`INSERT INTO settings (key, value, updated_at) VALUES ('approvals.enabled', 'true', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, now)
  : q(`DELETE FROM settings WHERE key = 'approvals.enabled'`);
const requestCount = async () => Number((await q(`SELECT COUNT(*)::int n FROM approval_requests`))[0].n);
const auditFor = (table, id, action, actor) => q(`SELECT after_state FROM audit_log WHERE entity_table = $1 AND entity_id = $2 AND action = $3 AND actor_id = $4 ORDER BY occurred_at DESC LIMIT 1`, table, id, action, actor);

console.log('\n== Approvals switched off (the default) ==');
await setApprovals(false);
const today = now.slice(0, 10);
const req0 = await requestCount();
let r = await mgmt('GET', '/api/settings');
check('Settings reports approvals off when never saved', r.json?.approvals?.enabled === false, JSON.stringify(r.json?.approvals));
r = await mgmt('GET', '/api/nav/badges');
check('the menu is told approvals are off, with no approvals count', r.json?.approvalsOn === false && r.json?.approvals === 0 && !r.json?.alerts?.some(a => a.key === 'approvals'), r.text.slice(0, 300));

// A refund is recorded at once by the person who did it, without a reason, audited.
const [offOta] = await q(`SELECT id FROM reservations WHERE channel = 'airbnb' AND state = 'checked_out' ORDER BY check_in DESC LIMIT 1 OFFSET 1`);
const offPays = Number((await q(`SELECT COUNT(*)::int n FROM booking_payments WHERE reservation_id = $1`, offOta.id))[0].n);
r = await fin('POST', `/api/reservations/${offOta.id}/payments`, { amount: 4200, receivedOn: today, kind: 'refund', method: 'Bank transfer' });
const offRefund = (await q(`SELECT kind, amount, created_by FROM booking_payments WHERE id = $1`, r.json?.id ?? ''))[0];
check('off: a refund is recorded at once (201) by the finance admin who entered it', r.status === 201 && offRefund?.kind === 'refund' && Number(offRefund.amount) === 4200 && offRefund.created_by === 'chk-finance'
  && Number((await q(`SELECT COUNT(*)::int n FROM booking_payments WHERE reservation_id = $1`, offOta.id))[0].n) === offPays + 1, r.text);
const refundAudit = await auditFor('reservations', offOta.id, 'reservation.payment', 'chk-finance');
check('off: the refund is audited under that person, with no approval reference', refundAudit[0] && String(refundAudit[0].after_state).includes(r.json.id) && !String(refundAudit[0].after_state).includes('approvalId'), JSON.stringify(refundAudit));

// An owner charge is open at once.
const [offOwner] = await q(`SELECT o.id FROM owners o JOIN units u ON u.owner_id = o.id GROUP BY o.id ORDER BY o.id LIMIT 1`);
r = await mgmt('POST', `/api/owners/${offOwner.id}/adjustments`, { kind: 'charge', amount: 11000, description: 'Check off: lost key', occurredOn: today });
const offAdj = (await q(`SELECT amount, state, created_by FROM owner_adjustments WHERE id = $1`, r.json?.id ?? ''))[0];
check('off: an owner charge is added at once (201), open, -RM 110.00', r.status === 201 && Number(offAdj?.amount) === -11000 && offAdj?.state === 'open' && offAdj?.created_by === 'dev-admin', r.text);
check('off: the charge is audited under the person who added it', (await auditFor('owner_adjustments', r.json?.id, 'owner_adjustment.create', 'dev-admin')).length === 1);

// An owner-paid bill needs its receipt (src/lib/receipts.ts): a receipt document for each expense below.
const rcpt = async () => (await q(`INSERT INTO documents (id, kind, file_name, mime_type, byte_size, storage_key, uploaded_by, captured_at, created_at)
  VALUES (gen_random_uuid()::text, 'receipt', 'check.pdf', 'application/pdf', 10, 'check/receipt.pdf', 'dev-admin', $1, $1) RETURNING id`, new Date().toISOString()))[0].id;
// An expense above the (unused) threshold is recorded at once, and so is raising one.
const [offUnit] = await q(`SELECT u.id FROM units u WHERE NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND s.state IN ('finalised','sent','paid') AND s.period_end >= $1) ORDER BY u.id LIMIT 1`, today);
r = await fin('POST', '/api/expenses', { unitId: offUnit.id, category: 'maintenance', amount: 80000, incurredOn: today, description: 'Check off: water heater', receiptDocumentId: await rcpt() });
check('off: an RM 800 expense is recorded at once (201)', r.status === 201 && r.json?.id, r.text);
const offExp = r.json?.id;
check('off: the expense is audited under the finance admin', (await auditFor('expenses', offExp, 'expense.create', 'chk-finance')).length === 1);
r = await fin('PATCH', `/api/expenses/${offExp}`, { amount: 95000 });
check('off: raising it to RM 950 applies at once (200)', r.status === 200 && Number((await q(`SELECT amount FROM expenses WHERE id = $1`, offExp))[0].amount) === 95000, r.text);

// A payout run moves the payouts at once.
const offSnap = await q(`SELECT id, state, paid_at FROM payouts WHERE bank_last4 IS NOT NULL`);
let offPend = await q(`SELECT id FROM payouts WHERE state = 'pending' AND bank_last4 IS NOT NULL ORDER BY id LIMIT 2`);
if (offPend.length < 2) {
  await q(`UPDATE payouts SET state = 'pending', paid_at = NULL WHERE id IN (SELECT id FROM payouts WHERE bank_last4 IS NOT NULL ORDER BY id LIMIT 2)`);
  offPend = await q(`SELECT id FROM payouts WHERE state = 'pending' AND bank_last4 IS NOT NULL ORDER BY id LIMIT 2`);
}
const offIds = offPend.map(p => p.id);
r = await fin('POST', '/api/payouts/run', { payoutIds: offIds });
const offStates = (await q(`SELECT state FROM payouts WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))`, JSON.stringify(offIds))).map(x => x.state);
check('off: a payout run starts at once (200): both payouts in processing', r.status === 200 && r.json?.started === 2 && /^RUN-/.test(r.json?.run ?? '') && offStates.every(s => s === 'processing'), r.text);
const runAudit = await auditFor('payouts', offIds[0], 'payout.run', 'chk-finance');
check('off: each move is audited under the finance admin with the run reference', runAudit[0] && String(runAudit[0].after_state).includes(r.json?.run), JSON.stringify(runAudit));
r = await fin('POST', '/api/payouts/run', { payoutIds: offIds });
check('off: running the same payouts again is refused (409)', r.status === 409, r.text);
await q(`UPDATE payouts p SET state = x.state, paid_at = x.paid_at FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, state text, paid_at text) WHERE p.id = x.id`,
  JSON.stringify(offSnap.filter(p => offIds.includes(p.id))));

// Writing off a held debt settles it at once (put back afterwards, so the on-mode check below has one to use).
const [offHeld] = await q(`SELECT id, owner_id FROM owner_adjustments WHERE state = 'held' AND statement_id IS NULL ORDER BY id LIMIT 1`);
if (offHeld) {
  r = await fin('PATCH', `/api/owners/${offHeld.owner_id}/adjustments/${offHeld.id}`, { action: 'settle', note: 'Check off: waived' });
  check('off: writing off a held debt settles it at once (200)', r.status === 200 && r.json?.state === 'settled' && (await q(`SELECT state FROM owner_adjustments WHERE id = $1`, offHeld.id))[0].state === 'settled', r.text);
  check('off: the write-off is audited under the finance admin', (await auditFor('owner_adjustments', offHeld.id, 'owner_adjustment.settle', 'chk-finance')).length === 1);
  await q(`UPDATE owner_adjustments SET state = 'held', settled_note = NULL WHERE id = $1`, offHeld.id);
} else console.log('skip off write-off: no held debt in this database');

check('off: no approval request was written by any of these', await requestCount() === req0, `${req0} -> ${await requestCount()}`);

console.log('\n== Approvals switched on ==');
await setApprovals(true);
r = await mgmt('GET', '/api/nav/badges');
check('on: the menu is told approvals are on', r.json?.approvalsOn === true, r.text.slice(0, 200));

// 1. A refund is staged, not recorded.
const [ota] = await q(`SELECT id, external_ref FROM reservations WHERE channel = 'airbnb' AND state = 'checked_out' ORDER BY check_in DESC LIMIT 1`);
const payCount = async id => Number((await q(`SELECT COUNT(*)::int n FROM booking_payments WHERE reservation_id = $1`, id))[0].n);
const before = await payCount(ota.id);
r = await fin('POST', `/api/reservations/${ota.id}/payments`, { amount: 5000, receivedOn: now.slice(0, 10), kind: 'refund', method: 'Bank transfer' });
check('a refund without a reason is refused (422)', r.status === 422 && r.json?.error?.fields?.reason, r.text);
r = await fin('POST', `/api/reservations/${ota.id}/payments`, { amount: 5000, receivedOn: now.slice(0, 10), kind: 'refund', method: 'Bank transfer', reason: 'Guest complained about the air-con; partial refund agreed' });
const refundReq = r.json?.pendingApproval;
check('a refund is staged for approval (202), nothing recorded', r.status === 202 && refundReq?.kind === 'guest_refund' && await payCount(ota.id) === before, r.text);

// 2. The requester cannot approve it.
r = await fin('POST', `/api/approvals/${refundReq.id}`, { decision: 'approve' });
check('the person who asked cannot approve their own request (403)', r.status === 403, r.text);
r = await fin('GET', '/api/approvals?view=pending');
const seen = r.json?.data?.find(a => a.id === refundReq.id);
check('the requester sees it waiting, with Withdraw but not Approve', seen && !seen.can.approve && seen.can.cancel, JSON.stringify(seen?.can));
r = await mgmt('GET', `/api/approvals?entity=reservations&entityId=${encodeURIComponent(ota.id)}`);
check('the booking banner lists it for management with Approve', r.json?.data?.some(a => a.id === refundReq.id && a.can.approve), r.text);
r = await mgmt('GET', `/api/reservations/${ota.id}`);
check('the booking drawer carries the pending request in its first response', r.json?.approvals?.some(a => a.id === refundReq.id), r.text.slice(0, 200));
r = await mgmt('GET', '/api/nav/badges');
check('the menu counts it for the approver', Number(r.json?.approvals) >= 1, r.text.slice(0, 300));

// 3. A second person approves: the refund is recorded in the same step, audited.
r = await mgmt('POST', `/api/approvals/${refundReq.id}`, { decision: 'approve', note: 'Checked with the guest thread' });
check('management approves (200) and it is carried out', r.status === 200 && r.json?.status === 'approved' && r.json?.result?.paymentId, r.text);
const refundRow = (await q(`SELECT kind, amount, created_by FROM booking_payments WHERE id = $1`, r.json?.result?.paymentId))[0];
check('the refund row exists, attributed to the requester', refundRow?.kind === 'refund' && Number(refundRow.amount) === 5000 && refundRow.created_by === 'chk-finance', JSON.stringify(refundRow));
const audits = await q(`SELECT action FROM audit_log WHERE (entity_table = 'approval_requests' AND entity_id = $1) OR (entity_table = 'reservations' AND entity_id = $2 AND after_state LIKE $3)`, refundReq.id, ota.id, `%${refundReq.id}%`);
check('audit has the request, the approval and the refund', ['approval.request', 'approval.approve', 'reservation.payment'].every(a => audits.some(x => x.action === a)), JSON.stringify(audits));
r = await mgmt('POST', `/api/approvals/${refundReq.id}`, { decision: 'approve' });
check('approving twice is refused (409) and nothing is recorded twice', r.status === 409 && await payCount(ota.id) === before + 1, r.text);

// 4. Reject needs a note and changes nothing.
r = await fin('POST', `/api/reservations/${ota.id}/payments`, { amount: 2500, receivedOn: now.slice(0, 10), kind: 'refund', reason: 'Late check-out not given' });
const rej = r.json.pendingApproval;
r = await mgmt('POST', `/api/approvals/${rej.id}`, { decision: 'reject' });
check('reject without a note is refused (422)', r.status === 422, r.text);
r = await mgmt('POST', `/api/approvals/${rej.id}`, { decision: 'reject', note: 'Guest left late; no refund due' });
check('reject with a note: rejected, no refund recorded', r.status === 200 && r.json.status === 'rejected' && await payCount(ota.id) === before + 1, r.text);

// 5. Owner credit or charge: staged, and a finance admin may approve below the limit.
const [owner] = await q(`SELECT o.id FROM owners o JOIN units u ON u.owner_id = o.id GROUP BY o.id ORDER BY o.id LIMIT 1`);
const adjCount = async () => Number((await q(`SELECT COUNT(*)::int n FROM owner_adjustments WHERE owner_id = $1`, owner.id))[0].n);
const adj0 = await adjCount();
r = await mgmt('POST', `/api/owners/${owner.id}/adjustments`, { kind: 'charge', amount: 15000, description: 'Check: key replacement', occurredOn: now.slice(0, 10) });
const adjReq = r.json?.pendingApproval;
check('an owner charge is staged (202), no adjustment yet', r.status === 202 && adjReq?.kind === 'owner_adjustment' && await adjCount() === adj0, r.text);
r = await fin('POST', `/api/approvals/${adjReq.id}`, { decision: 'approve' });
const adjRow = (await q(`SELECT amount, state, created_by FROM owner_adjustments WHERE id = $1`, r.json?.result?.adjustmentId))[0];
check('a finance admin approves RM 150.00 (below RM 2,000): an open charge of -RM 150.00 by the requester', r.status === 200 && Number(adjRow?.amount) === -15000 && adjRow?.state === 'open' && adjRow?.created_by === 'dev-admin', r.text + JSON.stringify(adjRow));

// 6. Above the finance admin limit only management may decide.
r = await fin('POST', `/api/owners/${owner.id}/adjustments`, { kind: 'credit', amount: 350000, description: 'Check: large credit', occurredOn: now.slice(0, 10) });
const big = r.json.pendingApproval;
await q(`UPDATE users SET is_active = 1 WHERE id = 'chk-mgmt2'`);
r = await fin('GET', '/api/approvals?view=pending');
check('RM 3,500 asked by finance: finance cannot approve it', r.json?.data?.find(a => a.id === big.id)?.can.approve === false, r.text.slice(0, 300));
r = await mgmt2('POST', `/api/approvals/${big.id}`, { decision: 'cancel' });
check('someone else from management may withdraw it', r.status === 200 && r.json.status === 'cancelled', r.text);
r = await mgmt2('POST', `/api/approvals/${big.id}`, { decision: 'approve' });
check('a withdrawn request cannot be approved (409)', r.status === 409, r.text);
check('nothing was credited', await adjCount() === adj0 + 1);

// 7. Self-approval: refused while two management users are active; allowed with a note when there is one.
r = await mgmt('POST', `/api/owners/${owner.id}/adjustments`, { kind: 'credit', amount: 12000, description: 'Check: water overpaid', occurredOn: now.slice(0, 10) });
const self = r.json.pendingApproval;
check('with two management users the request is not self-approvable', self.selfApproval === false, r.text);
r = await mgmt('POST', `/api/approvals/${self.id}`, { decision: 'approve', note: 'try' });
check('management cannot approve their own request while another management user exists (403)', r.status === 403, r.text);
await q(`UPDATE users SET is_active = 0 WHERE id = 'chk-mgmt2'`);
r = await mgmt('POST', `/api/approvals/${self.id}`, { decision: 'approve' });
check('the only management user must write why to approve their own (422)', r.status === 422, r.text);
r = await mgmt('POST', `/api/approvals/${self.id}`, { decision: 'approve', note: 'Only manager on duty; receipt from Indah Water attached' });
check('...and with a note it is approved, recorded as self-approved', r.status === 200 && r.json.selfApproved === true, r.text);
const selfAudit = await q(`SELECT 1 FROM audit_log WHERE entity_table = 'approval_requests' AND entity_id = $1 AND action = 'approval.self_approved'`, self.id);
check('audited as approval.self_approved', selfAudit.length === 1);
r = await fin('POST', `/api/owners/${owner.id}/adjustments`, { kind: 'credit', amount: 1000, description: 'Check: finance self', occurredOn: now.slice(0, 10) });
const finSelf = r.json.pendingApproval;
r = await fin('POST', `/api/approvals/${finSelf.id}`, { decision: 'approve', note: 'I am alone' });
check('a finance admin never approves their own request, even alone (403)', r.status === 403, r.text);
await mgmt('POST', `/api/approvals/${finSelf.id}`, { decision: 'reject', note: 'Check clean-up' });

// 8. Expenses: at or below the threshold recorded at once; above it staged.
const [unit] = await q(`SELECT u.id FROM units u WHERE NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND s.state IN ('finalised','sent','paid') AND s.period_end >= $1) ORDER BY u.id LIMIT 1`, now.slice(0, 10));
r = await fin('POST', '/api/expenses', { unitId: unit.id, category: 'maintenance', amount: 50000, incurredOn: now.slice(0, 10), description: 'Check: tap washer', chargeTo: 'owner', receiptDocumentId: await rcpt() });
check('an expense of exactly RM 500 is recorded at once (201)', r.status === 201 && r.json?.id, r.text);
const smallId = r.json?.id;
r = await fin('POST', '/api/expenses', { unitId: unit.id, category: 'maintenance', amount: 80000, incurredOn: now.slice(0, 10), description: 'Check: water heater', receiptDocumentId: await rcpt() });
const exp = r.json?.pendingApproval;
check('an expense of RM 800 is staged (202)', r.status === 202 && exp?.kind === 'expense', r.text);
r = await mgmt('POST', `/api/approvals/${exp.id}`, { decision: 'approve' });
const expRow = (await q(`SELECT amount, created_by FROM expenses WHERE id = $1`, r.json?.result?.expenseId))[0];
check('approved: the RM 800 expense exists, by the requester', Number(expRow?.amount) === 80000 && expRow?.created_by === 'chk-finance', r.text);
r = await fin('PATCH', `/api/expenses/${smallId}`, { amount: 90000 });
check('raising an expense above the threshold is staged (202), amount unchanged', r.status === 202 && Number((await q(`SELECT amount FROM expenses WHERE id = $1`, smallId))[0].amount) === 50000, r.text);
await mgmt('POST', `/api/approvals/${r.json.pendingApproval.id}`, { decision: 'approve' });
check('...and applied when approved', Number((await q(`SELECT amount FROM expenses WHERE id = $1`, smallId))[0].amount) === 90000);
await q(`INSERT INTO settings (key, value, updated_at) VALUES ('approvals.expenseThreshold', '100000', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, now);
r = await fin('POST', '/api/expenses', { unitId: unit.id, category: 'maintenance', amount: 80000, incurredOn: now.slice(0, 10), description: 'Check: threshold from Settings', receiptDocumentId: await rcpt() });
check('the threshold is read from Settings (RM 1,000 now: RM 800 recorded at once)', r.status === 201, r.text);
await q(`DELETE FROM settings WHERE key = 'approvals.expenseThreshold'`);

// 9. Payout run: staged; payouts move only on approval; one payout cannot be in two waiting runs.
for (const a of (await mgmt('GET', '/api/approvals?view=pending&kind=payout_run&pageSize=200')).json?.data ?? []) {
  await mgmt('POST', `/api/approvals/${a.id}`, { decision: 'cancel', note: 'Left by an earlier check run' });
}
const snapshot = await q(`SELECT id, state, paid_at FROM payouts WHERE bank_last4 IS NOT NULL`);
let pend = await q(`SELECT id FROM payouts WHERE state = 'pending' AND bank_last4 IS NOT NULL ORDER BY id LIMIT 2`);
if (pend.length < 2) {
  await q(`UPDATE payouts SET state = 'pending', paid_at = NULL WHERE id IN (SELECT id FROM payouts WHERE bank_last4 IS NOT NULL ORDER BY id LIMIT 2)`);
  pend = await q(`SELECT id FROM payouts WHERE state = 'pending' AND bank_last4 IS NOT NULL ORDER BY id LIMIT 2`);
}
const ids = pend.map(p => p.id);
r = await fin('POST', '/api/payouts/run', { payoutIds: ids, reason: 'Check run' });
const run = r.json?.pendingApproval;
const states = async () => (await q(`SELECT state FROM payouts WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))`, JSON.stringify(ids))).map(x => x.state);
check('a payout run is staged (202); the payouts stay pending', r.status === 202 && run?.kind === 'payout_run' && (await states()).every(s => s === 'pending'), r.text);
r = await fin('POST', '/api/payouts/run', { payoutIds: ids });
check('the same payouts cannot join a second waiting run', r.status === 409, r.text);
r = await mgmt('POST', `/api/approvals/${run.id}`, { decision: 'approve' });
check('approved: both payouts move to processing in one step', r.status === 200 && r.json.result?.started === 2 && (await states()).every(s => s === 'processing'), r.text);
// An approval whose action is no longer possible changes nothing and stays waiting.
await q(`UPDATE payouts SET state = 'pending' WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))`, JSON.stringify(ids));
r = await fin('POST', '/api/payouts/run', { payoutIds: ids });
const stale = r.json.pendingApproval;
await q(`UPDATE payouts SET state = 'paid' WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))`, JSON.stringify(ids));
r = await mgmt('POST', `/api/approvals/${stale.id}`, { decision: 'approve' });
const staleRow = (await q(`SELECT status FROM approval_requests WHERE id = $1`, stale.id))[0];
check('approving a run whose payouts were paid meanwhile is refused (409) and the request stays waiting', r.status === 409 && staleRow.status === 'pending', r.text);
await mgmt('POST', `/api/approvals/${stale.id}`, { decision: 'reject', note: 'Paid already' });
// Put the payouts back as they were before this check.
const back = snapshot.filter(p => ids.includes(p.id));
await q(`UPDATE payouts p SET state = x.state, paid_at = x.paid_at FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, state text, paid_at text) WHERE p.id = x.id`, JSON.stringify(back));

// 10. Writing off a held debt.
let [held] = await q(`SELECT id, owner_id, amount FROM owner_adjustments WHERE state = 'held' AND statement_id IS NULL ORDER BY id LIMIT 1`);
if (held) {
  r = await fin('PATCH', `/api/owners/${held.owner_id}/adjustments/${held.id}`, { action: 'settle', note: 'Owner sold the unit; debt waived by management' });
  const wo = r.json?.pendingApproval;
  check('writing off a held debt is staged (202); still held', r.status === 202 && wo?.kind === 'debt_write_off' && (await q(`SELECT state FROM owner_adjustments WHERE id = $1`, held.id))[0].state === 'held', r.text);
  r = await fin('PATCH', `/api/owners/${held.owner_id}/adjustments/${held.id}`, { action: 'settle', note: 'again' });
  check('a second write-off request for the same debt is refused (409)', r.status === 409, r.text);
  r = await mgmt('POST', `/api/approvals/${wo.id}`, { decision: 'approve' });
  check('approved: the debt is settled', r.status === 200 && (await q(`SELECT state FROM owner_adjustments WHERE id = $1`, held.id))[0].state === 'settled', r.text);
} else console.log('skip write-off: no held debt in this database');

// 11. A request still waiting when approvals are switched off can only be withdrawn.
r = await fin('POST', `/api/owners/${owner.id}/adjustments`, { kind: 'credit', amount: 2000, description: 'Check: left over', occurredOn: now.slice(0, 10) });
const left = r.json?.pendingApproval;
await setApprovals(false);
r = await mgmt('POST', `/api/approvals/${left.id}`, { decision: 'approve' });
check('switched off with a request waiting: approving it is refused (409 APPROVALS_OFF)', r.status === 409 && r.json?.error?.code === 'APPROVALS_OFF', r.text);
r = await mgmt('GET', '/api/approvals?view=pending');
const lv = r.json?.data?.find(a => a.id === left.id);
check('...the Approvals page says approvals are off and lists it with Withdraw only', r.json?.rules?.enabled === false && lv && !lv.can.approve && !lv.can.reject && lv.can.cancel, JSON.stringify(lv?.can));
r = await mgmt('GET', `/api/approvals?entity=owners&entityId=${encodeURIComponent(owner.id)}`);
check('...no banner on the owner', r.status === 200 && r.json?.data?.length === 0, r.text.slice(0, 200));
r = await mgmt('GET', '/api/nav/badges');
check('...and no approvals count in the menu', r.json?.approvals === 0 && r.json?.approvalsOn === false, r.text.slice(0, 200));
r = await fin('POST', `/api/approvals/${left.id}`, { decision: 'cancel' });
check('...the person who asked withdraws it', r.status === 200 && r.json?.status === 'cancelled', r.text);

console.log('\n== Guest documents ==');
const [direct] = await q(`SELECT id FROM reservations WHERE channel = 'direct' AND gross_booking_value > 0 AND state NOT IN ('cancelled','no_show') ORDER BY id LIMIT 1`);
const liveInv = await q(`SELECT id FROM issued_documents WHERE reservation_id = $1 AND doc_type = 'invoice' AND voided_at IS NULL`, direct.id);
for (const d of liveInv) await mgmt('POST', `/api/guest-documents/${d.id}/void`, { reason: 'Check re-run' });
const gross = Number((await q(`SELECT gross_booking_value FROM reservations WHERE id = $1`, direct.id))[0].gross_booking_value);
r = await fin('POST', '/api/guest-documents', { type: 'invoice', reservationId: direct.id });
const inv = r.json;
const yymm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(2, 7).replace('-', '');
check(`an invoice is issued with INV-${yymm}-NNNN for the booking total`, r.status === 201 && new RegExp(`^INV-${yymm}-\\d{4}$`).test(inv?.docNo) && inv.amount === gross, r.text);
r = await fin('POST', '/api/guest-documents', { type: 'invoice', reservationId: direct.id });
check('a second live invoice for the same booking is refused (409)', r.status === 409, r.text);
r = await fin('GET', `/api/guest-documents/${inv.id}/pdf`);
const rmText = `RM ${(gross / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
check('the invoice prints on the letterhead (company, number, logo) with the total in RM', r.status === 200 && r.type.includes('text/html') && /lh-head/.test(r.text) && /Company No:/.test(r.text) && r.text.includes('/brand/the-conts-logo.png') && r.text.includes(inv.docNo) && r.text.includes(rmText) && /lh-foot/.test(r.text), rmText);
r = await fin('POST', `/api/guest-documents/${inv.id}/void`, {});
check('void without a reason is refused (422)', r.status === 422, r.text);
r = await fin('POST', `/api/guest-documents/${inv.id}/void`, { reason: 'Guest name misspelt' });
check('void with a reason keeps the number', r.status === 200 && r.json.docNo === inv.docNo && r.json.voidedAt && r.json.voidReason === 'Guest name misspelt', r.text);
r = await fin('GET', `/api/guest-documents/${inv.id}/pdf`);
check('the voided document prints with VOID and the reason', r.text.includes('VOID') && r.text.includes('Guest name misspelt'));
r = await fin('POST', '/api/guest-documents', { type: 'invoice', reservationId: direct.id });
const inv2 = r.json;
check('a new invoice gets a new, higher number; the voided one is never reused', r.status === 201 && inv2.docNo !== inv.docNo && inv2.docNo > inv.docNo, r.text);
r = await fin('POST', `/api/guest-documents/${inv.id}/void`, { reason: 'again' });
check('voiding twice is refused (409)', r.status === 409, r.text);

// Receipts: only for money the guest paid us.
r = await fin('POST', `/api/reservations/${direct.id}/payments`, { amount: 12345, receivedOn: now.slice(0, 10), kind: 'guest_payment', method: 'DuitNow / QR', reference: 'CHK-QR-1' });
const pay = r.json;
check('a guest payment is recorded at once (201), not staged', r.status === 201 && pay?.id, r.text);
r = await fin('POST', '/api/guest-documents', { type: 'receipt', reservationId: direct.id, paymentId: pay.id });
const rec = r.json;
check(`a receipt OR-${yymm}-NNNN for RM 123.45`, r.status === 201 && /^OR-\d{4}-\d{4}$/.test(rec?.docNo) && rec.amount === 12345, r.text);
r = await fin('GET', `/api/guest-documents/${rec.id}/pdf`);
check('the receipt prints the amount and the sum in words', r.text.includes('RM 123.45') && r.text.includes('Ringgit Malaysia One Hundred Twenty Three and Sen Forty Five Only') && r.text.includes('CHK-QR-1'), r.text.slice(0, 200));
r = await fin('DELETE', `/api/reservations/${direct.id}/payments/${pay.id}`);
check('a payment with a live receipt cannot be removed (409)', r.status === 409 && r.json?.error?.code === 'HAS_RECEIPT', r.text);
const [otaPay] = await q(`SELECT id, reservation_id FROM booking_payments WHERE kind = 'ota_payout' LIMIT 1`);
r = await fin('POST', '/api/guest-documents', { type: 'receipt', reservationId: otaPay.reservation_id, paymentId: otaPay.id });
check('a booking site payout gets no receipt (422)', r.status === 422, r.text);
r = await fin('POST', '/api/guest-documents', { type: 'invoice', reservationId: otaPay.reservation_id });
check('an Airbnb booking with no direct payment gets no invoice (422)', r.status === 422, r.text);

// Numbering under concurrency: different bookings at once never share a number and leave no gap.
const directs = (await q(`SELECT r.id FROM reservations r WHERE r.channel = 'direct' AND r.gross_booking_value > 0 AND r.state NOT IN ('cancelled','no_show')
  AND NOT EXISTS (SELECT 1 FROM issued_documents d WHERE d.reservation_id = r.id AND d.doc_type = 'invoice' AND d.voided_at IS NULL) ORDER BY r.id LIMIT 6`)).map(x => x.id);
const results = await Promise.all(directs.map(id => fin('POST', '/api/guest-documents', { type: 'invoice', reservationId: id })));
const nos = results.map(x => x.json?.docNo).filter(Boolean).sort();
const seq = nos.map(n => Number(n.slice(-4)));
check(`${directs.length} invoices issued in parallel get ${directs.length} different, consecutive numbers`, results.every(x => x.status === 201) && new Set(nos).size === directs.length && seq.every((n, i) => !i || n === seq[i - 1] + 1), JSON.stringify(results.map(x => x.status)) + ' ' + nos.join(','));
// Two at once for the same booking: one wins, the other is refused, and the counter does not skip.
for (const d of results) if (d.json?.id) await fin('POST', `/api/guest-documents/${d.json.id}/void`, { reason: 'Concurrency check' });
const before2 = Number((await q(`SELECT last_no FROM document_counters WHERE doc_type = 'invoice' AND period = $1`, yymm))[0].last_no);
const pair = await Promise.all([1, 2].map(() => fin('POST', '/api/guest-documents', { type: 'invoice', reservationId: directs[0] })));
const after2 = Number((await q(`SELECT last_no FROM document_counters WHERE doc_type = 'invoice' AND period = $1`, yymm))[0].last_no);
check('two issues for one booking at once: one 201, one 409, counter moved by exactly one', pair.map(x => x.status).sort().join() === '201,409' && after2 === before2 + 1, `${pair.map(x => x.status)} ${before2}->${after2}`);
const dupes = await q(`SELECT doc_no FROM issued_documents GROUP BY doc_no HAVING COUNT(*) > 1`);
check('no document number is used twice', dupes.length === 0, JSON.stringify(dupes));

r = await mgmt('GET', '/api/guest-documents?pageSize=5');
check('the Documents list counts invoices, receipts and voids', r.status === 200 && r.json.counts.invoice >= 3 && r.json.counts.receipt >= 1 && r.json.counts.void >= 1 && r.json.data.length > 0, r.text.slice(0, 300));
r = await mgmt('GET', `/api/guest-documents?status=void&q=${encodeURIComponent(inv.docNo)}`);
check('a voided number is found in the list, marked void', r.json?.data?.[0]?.docNo === inv.docNo && r.json.data[0].voidedAt, r.text.slice(0, 300));
r = await mgmt('GET', `/api/reservations/${direct.id}`);
check('the booking drawer carries its documents', r.json?.documents?.length >= 3 && r.json?.can?.issueDocuments === true, r.text.slice(0, 200));

console.log('\n== Statement letterhead ==');
const [legacy] = await q(`SELECT s.id FROM owner_statements s WHERE NOT EXISTS (SELECT 1 FROM statement_units su WHERE su.statement_id = s.id) LIMIT 1`);
r = await mgmt('GET', `/api/statements/${legacy.id}/pdf`);
check('the owner statement print view uses the same letterhead and footer', r.status === 200 && /lh-head/.test(r.text) && /lh-foot/.test(r.text) && r.text.includes('/brand/the-conts-logo.png') && /Net Payout to Owner/i.test(r.text), r.text.slice(0, 300));

console.log('\n== Statements from booking payments ==');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = await build({ entryPoints: [join(root, 'functions/_lib/ownerStatement.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'stmt-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);
const unitRow = { id: 'u1', owner_id: 'o1', owner_name: 'Owner', unit_number: 'D49-03A', unit_code: null, property_name: 'Skyline KL', address: null, package: null, term: null,
  split_kind: 'Profit share', split_value: 75, unit_misc: 0, contract_id: null, model: null, management_fee_pct: null, grr_amount: null, starts_on: null, ends_on: null,
  minimum_guarantee: null, guarantee_starts_on: null, guarantee_ends_on: null, contract_misc: 0 };
const terms = M.termsFor(unitRow, 25);
const stay = { id: 's1', unit_id: 'u1', check_in: '2026-09-03', check_out: '2026-10-31', collected_revenue: 632903, channel: 'airbnb', external_ref: 'HMFA323EHS', guest_name: 'Guest' };
const sep = (s) => M.computeUnitMonth('2026-09', unitRow, terms, [s], [], [], 10000);
const one = { ...stay, parts: M.stayParts(stay, [{ reservation_id: 's1', amount: 632903, status: 'received', kind: 'ota_payout', source: 'owner_workbook', note: 'Payout line for 2026-09-03 to 2026-10-31' }]) };
check('one payout line over the whole stay gives the same September income as before (RM 3,055.39 for 28 of 58 nights)', sep(stay).gross === sep(one).gross && sep(one).gross === 305539, `${sep(stay).gross} vs ${sep(one).gross}`);
// Illustration only (not real data): the same money paid as two monthly instalments of different size.
const two = { ...stay, parts: M.stayParts(stay, [
  { reservation_id: 's1', amount: 352903, status: 'received', kind: 'ota_payout', source: 'owner_workbook', note: 'Payout line for 2026-09-03 to 2026-10-03' },
  { reservation_id: 's1', amount: 280000, status: 'expected', kind: 'ota_payout', source: 'owner_workbook', note: 'Payout line for 2026-10-03 to 2026-10-31' }]) };
const twoSep = sep(two).gross, twoOct = M.computeUnitMonth('2026-10', unitRow, terms, [two], [], [], 10000).gross;
check('two instalments: September gets 28/30 of the first (RM 3,293.76), October the rest; nothing lost', twoSep === 329376 && twoSep + twoOct === 632903, `${twoSep} + ${twoOct}`);
const directStay = { id: 's2', unit_id: 'u1', check_in: '2026-09-10', check_out: '2026-09-14', collected_revenue: 0, channel: 'direct', external_ref: 'TC-2609-0001', guest_name: 'Guest' };
const paidDirect = { ...directStay, parts: M.stayParts(directStay, [
  { reservation_id: 's2', amount: 60000, status: 'received', kind: 'guest_payment', source: 'manual', note: null },
  { reservation_id: 's2', amount: 10000, status: 'received', kind: 'refund', source: 'manual', note: null }]) };
check('a direct booking paid here is credited what the guest paid less refunds (RM 500.00; RM 0.00 before)', sep(directStay).gross === 0 && sep(paidDirect).gross === 50000, `${sep(directStay).gross} -> ${sep(paidDirect).gross}`);
check('a paid direct booking no longer raises "no payout recorded"', sep(directStay).warnings.length === 1 && sep(paidDirect).warnings.length === 0, JSON.stringify(sep(paidDirect).warnings));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
