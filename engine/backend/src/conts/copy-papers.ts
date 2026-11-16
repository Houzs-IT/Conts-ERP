// Conts only (not part of Houzs's code): the papers staff handed in with a payment request or a claim (the invoice, the
// receipt, a utility bill's scanned pages), copied onto the voucher or AP invoice made from it (chew, 16 Nov 2026: "prepare
// pv 后不会自动 attached 文件"), so finance checks, approves and prints them with it. Each document gets its own copies:
// removing one from the voucher never removes the request's. Best effort: a file that cannot be copied stays where it
// was, and the document still stands.

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
type Db = any;

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type PapersFrom = { requestIds?: string[]; receiptIds?: string[] };
export type PapersTo = { table: 'acc_pv_files' | 'acc_ap_invoice_files'; fkColumn: 'pv_id' | 'ap_invoice_id'; keyPrefix: string; docId: string };

/** The voucher's files table (routes/pv-files.ts PV_FILES), for `copyPapers`. */
export const toVoucher = (pvId: string): PapersTo => ({ table: 'acc_pv_files', fkColumn: 'pv_id', keyPrefix: 'pv-files', docId: pvId });
/** The AP invoice's files table (routes/ap-invoice-files.ts AP_INVOICE_FILES), for `copyPapers`. */
export const toBill = (billId: string): PapersTo => ({ table: 'acc_ap_invoice_files', fkColumn: 'ap_invoice_id', keyPrefix: 'ap-invoice-files', docId: billId });

/** Copies every paper of the requests and claims onto the document; the number copied. */
export async function copyPapers(c: Ctx, sb: Db, companyId: number, from: PapersFrom, to: PapersTo): Promise<number> {
  const bucket = c.env?.SLIPS;
  if (!bucket) return 0;
  const reqIds = [...new Set(from.requestIds ?? [])];
  const recIds = [...new Set(from.receiptIds ?? [])];
  const papers: Array<{ r2_key: string; file_name: string; mime: string }> = [];
  try {
    if (reqIds.length) papers.push(...(((await sb.from('payment_request_files').select('r2_key, file_name, mime, created_at').in('request_id', reqIds)).data ?? []) as typeof papers));
    if (recIds.length) papers.push(...(((await sb.from('staff_receipt_files').select('r2_key, file_name, mime, created_at').in('receipt_id', recIds)).data ?? []) as typeof papers));
  } catch { return 0; }
  if (papers.length === 0) return 0;
  const { data: had } = await sb.from(to.table).select('sort_no').eq('company_id', companyId).eq(to.fkColumn, to.docId);
  let sort = ((had ?? []) as Array<{ sort_no: number | null }>).reduce((m, r) => Math.max(m, Number(r.sort_no ?? 0)), 0);
  let n = 0;
  for (const f of papers) {
    try {
      const obj = await bucket.get(f.r2_key);
      if (!obj) continue;
      const bytes = await obj.arrayBuffer();
      const key = `${to.keyPrefix}/${companyId}/${to.docId}/${crypto.randomUUID()}.${EXT[f.mime] ?? 'bin'}`;
      await bucket.put(key, bytes, { httpMetadata: { contentType: f.mime } });
      sort += 1;
      const ins = await sb.from(to.table).insert({
        company_id: companyId, [to.fkColumn]: to.docId, file_key: key, file_name: f.file_name, mime: f.mime, size_bytes: bytes.byteLength, sort_no: sort,
        created_by: String(c.get('user')?.id ?? ''),
      });
      if (ins.error) { await bucket.delete(key); continue; }
      n += 1;
    } catch { /* one paper that cannot be copied stays on the request or claim */ }
  }
  return n;
}
