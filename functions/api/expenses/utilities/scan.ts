import { type Env, one, run, json, fail, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { forwardClaims } from '../../../_lib/claimsForward';
import { recentBills, scanContext } from '../../../_lib/utilityScan';
import { matchBill, type BillReadLite } from '../../../../src/lib/utilityMatch';

/** Scan bills (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 4): finance and management only.
 *    GET  /api/expenses/utilities/scan          every unit with its contracts, for the unit picker and the split preview
 *    POST /api/expenses/utilities/scan { documentId, batchId }
 *         reads one uploaded page (a receipt document) through the engine (Sonnet 5.5, conts/utility-bill-routes.ts),
 *         proposes the unit it is for, and logs the read (utility_bill_scans). Nothing is recorded here. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const { units } = await scanContext(env);
  return json({ units });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<{ documentId?: string; batchId?: string }>().catch(() => null);
  const documentId = String(b?.documentId ?? ''), batchId = String(b?.batchId ?? '').slice(0, 80);
  if (!documentId || !batchId) return fail('VALIDATION', 'Upload the page first.', 422);
  const doc = await one<{ storage_key: string; mime_type: string; file_name: string }>(env, `SELECT storage_key, mime_type, file_name FROM documents WHERE id = ? AND kind = 'receipt'`, documentId);
  if (!doc) return fail('NOT_FOUND', 'That page was not found. Upload it again.', 404);
  if (!env.MEDIA) return fail('NOT_CONFIGURED', 'File storage is not set up yet.', 501);
  const obj = await env.MEDIA.get(doc.storage_key);
  if (!obj) return fail('NOT_FOUND', 'That page was not found. Upload it again.', 404);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

  const res = await forwardClaims(env, session, 'POST', '/utility-bills/read', { file: { name: doc.file_name, mime: doc.mime_type, dataBase64: btoa(bin) } });
  if (!res.ok) return res;
  const { read, model } = await res.json<{ read: BillReadLite & Record<string, unknown>; model: string }>();
  const [{ accounts }, recent] = await Promise.all([scanContext(env), read.billMonth ? recentBills(env, read.kind, read.billMonth) : Promise.resolve([])]);
  const match = matchBill(read, accounts, recent);
  const scanId = crypto.randomUUID();
  await run(env, `INSERT INTO utility_bill_scans (id, batch_id, document_id, model, read, proposed_account_id, colour, created_by, created_at)
    VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)`, scanId, batchId, documentId, model, JSON.stringify(read), match.accountId, match.colour, session.userId, nowIso());
  const account = match.accountId ? accounts.find(a => a.accountId === match.accountId) : null;
  return json({ scanId, model, read, match, unitId: account?.unitId ?? null, candidates: match.candidates.map(c => ({ ...c, unitId: accounts.find(a => a.accountId === c.accountId)?.unitId ?? null })) });
};
