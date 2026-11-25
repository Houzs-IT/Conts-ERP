// Conts only (not part of Houzs's code): the Reno review of a Direct Claim to Me (migration 0379). A claim with a line on
// a sub-department flagged reno_review waits here as RENO_REVIEW; the reviewer edits it (every field the hand-in form has)
// and sends it on to finance (HANDED_IN), or sends it back (REJECTED, with a reason, so the claimant replaces it as for any rejection).
// Mounted on the forwarded router only: Property OS decides who may review, the engine session never sees these.
//   GET  /reno-review                       the claims waiting for review, oldest first
//   GET  /reno-review/:id/files/:fileId     one of their files
//   POST /reno-review/:id/send              { spendDate?, amountSen?, vendorName?, note?, bank?, lines?, keepFileIds?, files? } -> HANDED_IN,
//                                           each field as the reviewer leaves it (one left out stays as the claim has it)
//   POST /reno-review/:id/reject            { reason } -> REJECTED
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { todayMyt } from '../scm/lib/my-time';
import { buildLines, defaultLineSubs, withTargetLabels, type LineRow } from './claims-lines';
import { MAX_FILES, decodeFiles, fileResponse, removeFiles, storeFiles, type Decoded } from './claims-files';
import { claimBank } from './my-claims-routes';
import { fitRecoveries, recoveriesOf } from './owner-recovery';
import { RECEIPT_COLS, allRows, filesOf, linesOf, receiptView, staffNames, type ReceiptRow } from './petty-cash-store';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const MAX_REASON_LENGTH = 500;
const MAX_VENDOR_LENGTH = 200;
const MAX_NOTE_LENGTH = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
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

type Bank = NonNullable<ReturnType<typeof claimBank>>;
export type ReviewEdit = {
  spendDate?: string; amountSen?: number; vendorName?: string | null; note?: string | null; bank?: Bank;
  rawLines?: unknown; keepFileIds?: string[]; newFiles: Decoded[];
};
type Refusal = { ok: false; status: 400 | 422; error: string; message: string };
const refuse = (message: string, status: 400 | 422 = 422, error = 'validation'): Refusal => ({ ok: false, status, error, message });
const optionalText = (value: unknown, maxLength: number): string | null => (value ? String(value).slice(0, maxLength) : null);

/** What the reviewer changed on the claim: every field optional, a field present is an edit. Checked as the hand-in form is. */
export function parseReviewEdit(body: Record<string, unknown>): { ok: true; edit: ReviewEdit } | Refusal {
  const edit: ReviewEdit = { newFiles: [] };
  if (body.spendDate !== undefined) {
    if (!DATE.test(String(body.spendDate))) return refuse('Enter the receipt date.');
    if (String(body.spendDate) > todayMyt()) return refuse('The receipt date cannot be in the future.');
    edit.spendDate = String(body.spendDate);
  }
  if (body.amountSen !== undefined) {
    const amountSen = Number(body.amountSen);
    if (!(Number.isInteger(amountSen) && amountSen > 0)) return refuse('Enter the amount on the receipt.');
    edit.amountSen = amountSen;
  }
  if (body.vendorName !== undefined) edit.vendorName = optionalText(body.vendorName, MAX_VENDOR_LENGTH);
  if (body.note !== undefined) edit.note = optionalText(body.note, MAX_NOTE_LENGTH);
  if (body.bank !== undefined) {
    const bank = claimBank(body.bank);
    if (!bank) return refuse('Enter the bank the money goes to: the bank, the account number (digits only) and the name on the account.');
    edit.bank = bank;
  }
  if (body.lines !== undefined) edit.rawLines = body.lines;
  if (body.keepFileIds !== undefined) {
    if (!Array.isArray(body.keepFileIds)) return refuse('Say which photos to keep.');
    edit.keepFileIds = body.keepFileIds.map(String);
  }
  if (Array.isArray(body.files) && body.files.length > 0) {
    const decoded = decodeFiles(body.files, 'a photo of the receipt');
    if (!decoded.ok) return refuse(decoded.message, decoded.status, decoded.error);
    edit.newFiles = decoded.files;
  }
  return { ok: true, edit };
}

type StoredFile = { id: string; r2_key: string };
/** The photos the claim ends with: the kept ones (all, when none are named) and the new; the ones left out are dropped. */
export function planFiles(current: StoredFile[], keepFileIds: string[] | undefined, newCount: number): { ok: true; drop: StoredFile[] } | Refusal {
  const currentIds = new Set(current.map((file) => file.id));
  if (keepFileIds?.some((fileId) => !currentIds.has(fileId))) return refuse('One of the photos to keep is not on this claim.');
  const kept = keepFileIds ? new Set(keepFileIds) : currentIds;
  if (kept.size + newCount === 0) return refuse('Keep or add a photo of the receipt.');
  if (kept.size + newCount > MAX_FILES) return refuse(`Up to ${MAX_FILES} photos on a claim.`);
  return { ok: true, drop: current.filter((file) => !kept.has(file.id)) };
}

type PlannedLines = { ok: true; lines: LineRow[] | null; amountSen: number } | { ok: false; message: string };
/** The lines the claim ends with: as the reviewer sent, or the one line moved to a new amount, or as they are (null). */
async function planLines(sb: any, companyId: number, receipt: ReceiptRow, reviewer: Staff, edit: ReviewEdit): Promise<PlannedLines> {
  if (edit.rawLines !== undefined) {
    const raw = edit.rawLines;
    const sentSen = edit.amountSen ?? (Array.isArray(raw) ? raw.reduce((sum: number, line: any) => sum + Number(line?.amountSen), 0) : Number(receipt.amount_sen));
    const built = await buildLines(sb, reviewer, raw, sentSen, companyId);
    if (!built.ok) return { ok: false, message: built.message };
    await defaultLineSubs(sb, companyId, built.lines, { staffDepartmentId: reviewer.departmentId, floatId: null });
    return { ok: true, lines: built.lines, amountSen: built.lines.reduce((sum, line) => sum + Number(line.amount_sen), 0) };
  }
  if (edit.amountSen === undefined) return { ok: true, lines: null, amountSen: Number(receipt.amount_sen) };
  const current = (await linesOf(sb, [receipt.id])).get(receipt.id) ?? [];
  if (current.length !== 1) return { ok: false, message: 'Send the lines with the new amount.' };
  const { id: _id, ...line } = current[0]!;
  return { ok: true, lines: [{ ...line, amount_sen: edit.amountSen }], amountSen: edit.amountSen };
}

/** Replaces a claim's lines and brings the owners' recoveries within them. Returns how to put the old lines back. */
async function replaceLines(sb: any, receipt: ReceiptRow, lines: LineRow[]): Promise<{ ok: true; restore: () => Promise<void> } | { ok: false; message: string }> {
  const previous = ((await linesOf(sb, [receipt.id])).get(receipt.id) ?? []).map(({ id: _id, ...line }) => line);
  const writeLines = async (rows: object[]) => {
    const deleted = await sb.from('staff_receipt_lines').delete().eq('receipt_id', receipt.id);
    return deleted.error ? deleted : sb.from('staff_receipt_lines').insert(rows.map((line) => ({ ...line, receipt_id: receipt.id })));
  };
  const restore = async () => { await writeLines(previous); };
  const written = await writeLines(lines);
  if (written.error) { await restore(); return { ok: false, message: written.error.message }; }
  const fit = fitRecoveries((await recoveriesOf(sb, [receipt.id], 'receipt')).get(receipt.id) ?? [], lines);
  for (const unitId of fit.drop) await sb.from('staff_receipt_recoveries').delete().eq('receipt_id', receipt.id).eq('unit_id', unitId);
  for (const lowered of fit.lower) await sb.from('staff_receipt_recoveries').update({ amount_sen: lowered.amountSen }).eq('receipt_id', receipt.id).eq('unit_id', lowered.unitId);
  return { ok: true, restore };
}

function receiptPatch(edit: ReviewEdit, amountSen: number, reviewer: Staff): Record<string, unknown> {
  return {
    status: 'HANDED_IN', amount_sen: amountSen, reno_reviewed_by: reviewer.name, reno_reviewed_at: now(),
    ...(edit.spendDate !== undefined ? { spend_date: edit.spendDate } : {}),
    ...(edit.vendorName !== undefined ? { vendor_name: edit.vendorName } : {}),
    ...(edit.note !== undefined ? { note: edit.note } : {}),
    ...(edit.bank ? { payee_bank_name: edit.bank.bankName, payee_account_no: edit.bank.accountNo, payee_account_name: edit.bank.accountName } : {}),
  };
}

export const renoReviewSendHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const reviewer: Staff = c.get('staff');
  const bucket = c.env?.SLIPS;
  const body = await bodyOf(c);
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const parsed = parseReviewEdit(body);
  if (!parsed.ok) return c.json({ error: parsed.error, message: parsed.message }, parsed.status);
  const { edit } = parsed;
  if (!bucket && (edit.newFiles.length > 0 || edit.keepFileIds)) return c.json({ error: 'not_configured', message: 'File storage is not set up yet.' }, 501);
  const receipt = await loadInReview(sb, co.companyId, c.req.param('id'));
  if (!receipt) return c.json(NOT_IN_REVIEW, 409);
  const { data: currentFiles } = await sb.from('staff_receipt_files').select('id, r2_key').eq('receipt_id', receipt.id);
  const files = planFiles((currentFiles ?? []) as StoredFile[], edit.keepFileIds, edit.newFiles.length);
  if (!files.ok) return c.json({ error: files.error, message: files.message }, files.status);
  const planned = await planLines(sb, co.companyId, receipt, reviewer, edit);
  if (!planned.ok) return c.json({ error: 'validation', message: planned.message }, 422);

  let stored: Awaited<ReturnType<typeof storeFiles>> = [];
  try { stored = await storeFiles(bucket, `claims/${co.companyId}/${receipt.id}`, edit.newFiles); } catch {
    return c.json({ error: 'upload_failed', message: 'The photos could not be saved. Try again.' }, 502);
  }
  const storedKeys = stored.map((file) => file.r2_key);
  const undoUploads = async () => {
    await sb.from('staff_receipt_files').delete().eq('receipt_id', receipt.id).in('r2_key', storedKeys);
    await removeFiles(bucket, storedKeys);
  };
  const insertedFiles = stored.length ? await sb.from('staff_receipt_files').insert(stored.map((file) => ({ ...file, receipt_id: receipt.id }))) : { error: null };
  if (insertedFiles.error) { await undoUploads(); return c.json({ error: 'save_failed', reason: insertedFiles.error.message }, 500); }
  const replaced = planned.lines ? await replaceLines(sb, receipt, planned.lines) : null;
  if (replaced && !replaced.ok) { await undoUploads(); return c.json({ error: 'validation', message: replaced.message }, 422); }
  const moved = await leaveReview(sb, receipt.id, receiptPatch(edit, planned.amountSen, reviewer));
  if (!moved) {
    if (replaced?.ok) await replaced.restore();
    await undoUploads();
    return c.json(NOT_IN_REVIEW, 409);
  }
  if (files.drop.length > 0) {
    await sb.from('staff_receipt_files').delete().eq('receipt_id', receipt.id).in('id', files.drop.map((file) => file.id));
    await removeFiles(bucket, files.drop.map((file) => file.r2_key));
  }
  return c.json({ id: receipt.id, receiptNo: receipt.receipt_no, amountSen: planned.amountSen });
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
