/* The papers handed in with a request or claim come onto the voucher or AP invoice made from it (chew, 16 Nov 2026).
   Pinned: each gets its own copy under the document's key, in order after what the document already has; a paper that
   cannot be read is skipped, the rest still come. */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { copyPapers, toBill, toVoucher } from './copy-papers';

const bucket = () => {
  const bytes = (t: string): ArrayBuffer => { const u = new TextEncoder().encode(t); const out = new ArrayBuffer(u.byteLength); new Uint8Array(out).set(u); return out; };
  const m = new Map<string, ArrayBuffer>([['claims/1/r1.pdf', bytes('bill')], ['claims/1/c1.png', bytes('receipt')]]);
  return { m, get: async (k: string) => (m.has(k) ? { arrayBuffer: async () => m.get(k)! } : null), put: async (k: string, v: ArrayBuffer) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
};
const ctx = (b: ReturnType<typeof bucket>) => ({ env: { SLIPS: b }, get: (k: string) => (k === 'user' ? { id: 'u-fin' } : undefined) });

describe('papers onto the document', () => {
  test("a request's and a claim's papers onto a voucher, after its own; a missing one skipped", async () => {
    const sb = fakeSb({
      payment_request_files: [{ request_id: 'Q1', r2_key: 'claims/1/r1.pdf', file_name: 'TNB Oct.pdf', mime: 'application/pdf' }, { request_id: 'Q1', r2_key: 'gone.pdf', file_name: 'gone.pdf', mime: 'application/pdf' }],
      staff_receipt_files: [{ receipt_id: 'R1', r2_key: 'claims/1/c1.png', file_name: 'receipt.png', mime: 'image/png' }],
      acc_pv_files: [{ company_id: 1, pv_id: 'PV1', file_key: 'pv-files/1/PV1/own.pdf', file_name: 'own.pdf', mime: 'application/pdf', size_bytes: 3, sort_no: 1 }],
      acc_ap_invoice_files: [],
    });
    const b = bucket();
    expect(await copyPapers(ctx(b), sb, 1, { requestIds: ['Q1'], receiptIds: ['R1'] }, toVoucher('PV1'))).toBe(2);
    expect(sb.tables.acc_pv_files.map(f => [f.file_name, f.sort_no, String(f.file_key).startsWith('pv-files/1/PV1/')])).toEqual([
      ['own.pdf', 1, true], ['TNB Oct.pdf', 2, true], ['receipt.png', 3, true],
    ]);
    /* Its own copies: the request's paper is still there. */
    expect(b.m.has('claims/1/r1.pdf')).toBe(true);
    expect(await copyPapers(ctx(b), sb, 1, { requestIds: ['Q1'] }, toBill('API-1'))).toBe(1);
    expect(sb.tables.acc_ap_invoice_files[0]).toMatchObject({ ap_invoice_id: 'API-1', file_name: 'TNB Oct.pdf', sort_no: 1 });
  });
});
