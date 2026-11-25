// Conts only (not part of Houzs's code): the Reno review of a Direct Claim to Me (migration 0378). A claim with a line on
// a sub-department flagged reno_review waits here as RENO_REVIEW; the reviewer edits its lines and sends it on to
// finance (HANDED_IN), or sends it back (REJECTED, with a reason, so the claimant replaces it as for any rejection).
// Mounted on the forwarded router only: Property OS decides who may review, the engine session never sees these.
//   GET  /reno-review                       the claims waiting for review, oldest first
//   GET  /reno-review/:id/files/:fileId     one of their files
//   POST /reno-review/:id/send              { lines? } -> HANDED_IN, with the lines and amount as the reviewer leaves them
//   POST /reno-review/:id/reject            { reason } -> REJECTED
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { buildLines, defaultLineSubs, withTargetLabels } from './claims-lines';
import { fileResponse } from './claims-files';
import { fitRecoveries, recoveriesOf } from './owner-recovery';
import { RECEIPT_COLS, allRows, filesOf, linesOf, receiptView, staffNames, type ReceiptRow } from './petty-cash-store';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const MAX_REASON_LENGTH = 500;
const now = (): string => new Date().toISOString();
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const NOT_IN_REVIEW = { error: 'not_in_review', message: 'That claim is no longer waiting for review.' };

async function loadInReview(sb: any, companyId: number, id: string): Promise<ReceiptRow | null> {
  const { data } = await sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', companyId).eq('id', id).eq('status', 'RENO_REVIEW').maybeSingle();
  return (data as ReceiptRow | null) ?? null;
}

/** Change a claim's status only if it is still in review: true when exactly this call changed it. */
async function leaveReview(sb: any, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from('staff_receipts').update({ ...patch, updated_at: now() }).eq('id', id).eq('status', 'RENO_REVIEW').select('id').maybeSingle();
  return !error && data != null;
}

export const renoReviewListHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const all = await allRows<ReceiptRow>((from, to) => sb.from('staff_receipts').select(RECEIPT_COLS).eq('company_id', co.companyId).eq('status', 'RENO_REVIEW').order('id').range(from, to));
  const rows = all.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.receipt_no.localeCompare(b.receipt_no));
  const ids = rows.map((r) => r.id);
  const [lines, files, names, recovers] = await Promise.all([linesOf(sb, ids), filesOf(sb, ids), staffNames(sb), recoveriesOf(sb, ids, 'receipt')]);
  const views = rows.map((r) => ({ ...receiptView(r, lines.get(r.id) ?? [], files.get(r.id) ?? [], names), recoveries: recovers.get(r.id) ?? [] }));
  return c.json({ receipts: await withTargetLabels(sb, co.companyId, views) });
};

export const renoReviewFileHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const receipt = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!receipt) return c.json({ error: 'not_found' }, 404);
  const { data: file } = await sb.from('staff_receipt_files').select('r2_key, file_name, mime').eq('receipt_id', receipt.id).eq('id', c.req.param('fileId')).maybeSingle();
  if (!file) return c.json({ error: 'not_found' }, 404);
  const stored = await c.env?.SLIPS?.get(file.r2_key);
  if (!stored) return c.json({ error: 'not_found' }, 404);
  return fileResponse(stored, file.file_name, file.mime);
};

/** Replaces a claim's lines with the reviewer's and brings the owners' recoveries within them. */
async function rewriteLines(sb: any, companyId: number, receipt: ReceiptRow, reviewer: Staff, rawLines: unknown): Promise<{ ok: true; amountSen: number } | { ok: false; message: string }> {
  const sentSen = Array.isArray(rawLines) ? rawLines.reduce((sum: number, line: any) => sum + Number(line?.amountSen), 0) : Number(receipt.amount_sen);
  const built = await buildLines(sb, reviewer, rawLines, sentSen, companyId);
  if (!built.ok) return { ok: false, message: built.message };
  await defaultLineSubs(sb, companyId, built.lines, { staffDepartmentId: reviewer.departmentId, floatId: null });
  const amountSen = built.lines.reduce((sum, line) => sum + Number(line.amount_sen), 0);
  const previous = ((await linesOf(sb, [receipt.id])).get(receipt.id) ?? []).map(({ id: _id, ...line }) => line);
  const deleted = await sb.from('staff_receipt_lines').delete().eq('receipt_id', receipt.id);
  const inserted = deleted.error ? deleted : await sb.from('staff_receipt_lines').insert(built.lines.map((line) => ({ ...line, receipt_id: receipt.id })));
  if (inserted.error) {
    await sb.from('staff_receipt_lines').delete().eq('receipt_id', receipt.id);
    await sb.from('staff_receipt_lines').insert(previous.map((line) => ({ ...line, receipt_id: receipt.id })));
    return { ok: false, message: inserted.error.message };
  }
  const fit = fitRecoveries((await recoveriesOf(sb, [receipt.id], 'receipt')).get(receipt.id) ?? [], built.lines);
  for (const unitId of fit.drop) await sb.from('staff_receipt_recoveries').delete().eq('receipt_id', receipt.id).eq('unit_id', unitId);
  for (const lowered of fit.lower) await sb.from('staff_receipt_recoveries').update({ amount_sen: lowered.amountSen }).eq('receipt_id', receipt.id).eq('unit_id', lowered.unitId);
  return { ok: true, amountSen };
}

export const renoReviewSendHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const reviewer: Staff = c.get('staff');
  const body = await bodyOf(c);
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const receipt = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!receipt) return c.json(NOT_IN_REVIEW, 409);
  let amountSen = Number(receipt.amount_sen);
  if (body.lines !== undefined) {
    const rewritten = await rewriteLines(sb, co.companyId, receipt, reviewer, body.lines);
    if (!rewritten.ok) return c.json({ error: 'validation', message: rewritten.message }, 422);
    amountSen = rewritten.amountSen;
  }
  const moved = await leaveReview(sb, receipt.id, { status: 'HANDED_IN', amount_sen: amountSen, reno_reviewed_by: reviewer.name, reno_reviewed_at: now() });
  if (!moved) return c.json(NOT_IN_REVIEW, 409);
  return c.json({ id: receipt.id, receiptNo: receipt.receipt_no, amountSen });
};

export const renoReviewRejectHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const reviewer: Staff = c.get('staff');
  const body = await bodyOf(c);
  const reason = String(body?.reason ?? '').trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) return c.json({ error: 'validation', message: `Give the reason (up to ${MAX_REASON_LENGTH} characters).` }, 422);
  const receipt = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!receipt) return c.json(NOT_IN_REVIEW, 409);
  const moved = await leaveReview(sb, receipt.id, { status: 'REJECTED', reject_reason: reason, checked_by: reviewer.name, checked_at: now() });
  if (!moved) return c.json(NOT_IN_REVIEW, 409);
  return c.json({ id: receipt.id, receiptNo: receipt.receipt_no });
};

export function renoReviewRoutes(r: { get: (p: string, h: (c: Ctx) => Promise<Response>) => unknown; post: (p: string, h: (c: Ctx) => Promise<Response>) => unknown }) {
  r.get('/reno-review', renoReviewListHandler);
  r.get('/reno-review/:id/files/:fileId', renoReviewFileHandler);
  r.post('/reno-review/:id/send', renoReviewSendHandler);
  r.post('/reno-review/:id/reject', renoReviewRejectHandler);
}
