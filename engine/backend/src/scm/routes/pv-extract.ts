// POST /payment-vouchers/extract — the bill reader behind Scan bills (PV and AP
// invoice alike), and POST /payment-vouchers/split-pdf. Moved out of
// payment-vouchers.ts as Houzs did (pv-extract.ts, 2026-09-30); payment-vouchers.ts
// still registers the routes and re-exports the handlers.
//
// Ported from Houzs (#4642 parallel reads, #4700 AI usage, #5193 split PDF),
// without Houzs's event suggestions and its payment-request read (Conts's
// payment requests read their bill on the claims side, my-claims-routes.ts).

import { hasHouzsPerm } from '../lib/houzs-perms';
import { requireActiveCompanyId, scopeToCompany } from '../lib/companyScope';
import { extractOneBill, matchSupplier, normalizeVendor, BILL_IMAGE_MIMES, BILL_MODEL, MAX_BILLS_PER_CALL, MAX_FILES_PER_BILL, MAX_BILL_FILE_BYTES } from '../../acc/bill-extract';
import { requestAiTag } from '../../services/aiUsage';
import { toBase64 } from '../lib/scan-ocr';
import { base64ToBytes } from '../../services/mail-parse';
import { MAX_SPLIT_PAGES, splitPdfPages } from '../lib/pdf-split';

/** Bills read at once inside one batch: serial reads of twelve bills were past
    the browser's wait (Houzs #4642). */
export const PARALLEL_BILL_READS = 4;

/* ── Bill OCR — read incoming bills into voucher pre-fills (2026-09-02) ──────
   Each `bills` entry is ONE document (its files are its pages — the human said
   so at upload; the server never guesses whether two files are one bill). One
   vision call per bill, supplier matched server-side, and NOTHING written: the
   answer pre-fills a form a person still checks, saves, and sends through the
   untouched approval cycle. Each call is logged in ai_usage_events. */
export const extractBillsHandler = async (c: any) => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create')) {
    return c.json({ error: "You don't have permission to do that." }, 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const apiKey = c.env?.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'anthropic_key_missing', message: 'The bill reader is not set up here (no ANTHROPIC_API_KEY on the engine).' }, 503);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const bills = Array.isArray(body.bills) ? body.bills : [];
  if (bills.length === 0) return c.json({ error: 'no_bills', message: 'Send at least one bill.' }, 400);
  if (bills.length > MAX_BILLS_PER_CALL) {
    return c.json({ error: 'too_many_bills', message: `At most ${MAX_BILLS_PER_CALL} bills per batch — split the pile.` }, 400);
  }
  for (const [i, b] of bills.entries()) {
    const files = Array.isArray(b?.files) ? b.files : [];
    if (files.length === 0) return c.json({ error: 'empty_bill', message: `Bill ${i + 1} has no files.` }, 400);
    if (files.length > MAX_FILES_PER_BILL) {
      return c.json({ error: 'too_many_pages', message: `Bill ${i + 1} has more than ${MAX_FILES_PER_BILL} pages.` }, 400);
    }
    for (const f of files) {
      const mime = String(f?.mime ?? '');
      if (!BILL_IMAGE_MIMES.has(mime) && mime !== 'application/pdf') {
        return c.json({ error: 'bad_file_type', message: `Bill ${i + 1}: ${mime || 'unknown type'} — JPEG / PNG / WebP / PDF only.` }, 400);
      }
      const size = Math.floor(String(f?.dataBase64 ?? '').length * 0.75);
      if (size > MAX_BILL_FILE_BYTES) {
        return c.json({ error: 'file_too_big', message: `Bill ${i + 1}: a file is over ${Math.round(MAX_BILL_FILE_BYTES / 1024 / 1024)}MB.` }, 400);
      }
    }
  }

  /* Suppliers once for the whole batch — matching is per bill, in code. */
  const sb = c.get('supabase');
  const { data: supRaw, error: supErr } = await scopeToCompany(
    sb.from('suppliers').select('id, code, name').eq('status', 'ACTIVE'), c,
  );
  if (supErr) return c.json({ error: 'load_failed', reason: supErr.message }, 500);
  const suppliers = (supRaw ?? []) as Array<{ id: string; code: string | null; name: string }>;

  /* Vendor memory (0341), once for the batch — what the operator saved the
     last time each vendor was paid. */
  const { data: memRaw, error: memErr } = await scopeToCompany(
    sb.from('acc_vendor_memory').select('vendor_key, payee_name, debit_account_code, purpose, times_seen'), c,
  );
  if (memErr) return c.json({ error: 'load_failed', reason: memErr.message }, 500);
  type MemRow = { vendor_key: string; payee_name: string | null; debit_account_code: string | null; purpose: string | null; times_seen: number };
  const memByKey = new Map(((memRaw ?? []) as MemRow[]).map((m) => [m.vendor_key, m]));
  /* The printed name first; the MATCHED supplier's name second. */
  const memoryFor = (vendorName: string | null, matchedName: string | null): MemRow | null => {
    for (const raw of [vendorName, matchedName]) {
      if (!raw) continue;
      const hit = memByKey.get(normalizeVendor(raw));
      if (hit) return hit;
    }
    return null;
  };

  /* Bills are read together, PARALLEL_BILL_READS at a time. */
  const tag = requestAiTag(c, 'bill_extract', BILL_MODEL);
  const read: Array<Awaited<ReturnType<typeof extractOneBill>>> = new Array(bills.length);
  let nextBill = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL_BILL_READS, bills.length) }, async () => {
    for (let i = nextBill++; i < bills.length; i = nextBill++) {
      const files = (bills[i]!.files as Array<{ name?: unknown; mime?: unknown; dataBase64?: unknown }>).map((f) => ({
        name: String(f.name ?? `file-${i}`), mime: String(f.mime ?? ''), dataBase64: String(f.dataBase64 ?? ''),
      }));
      read[i] = await extractOneBill(apiKey, files, tag);
    }
  }));

  const out = read.map((r, i) => {
    if (!r.ok) return { index: i, ok: false, reason: r.reason };
    const match = matchSupplier(r.extraction.vendorName, suppliers);
    const mem = memoryFor(r.extraction.vendorName, match?.supplier.name ?? null);
    return {
      index: i, ok: true, extraction: r.extraction,
      supplierMatch: match ? { id: match.supplier.id, code: match.supplier.code, name: match.supplier.name, confidence: match.confidence } : null,
      memory: mem ? { payeeName: mem.payee_name, debitAccountCode: mem.debit_account_code, purpose: mem.purpose, timesSeen: mem.times_seen } : null,
    };
  });
  return c.json({ bills: out });
};

/* POST /payment-vouchers/split-pdf — one PDF of several bills, cut into one
   PDF per page (Houzs HC-0204) for the pile to read one by one. Nothing is
   kept or written: the pages go back to the browser and travel on as pile
   files. */
export const splitPdfHandler = async (c: any) => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create')) {
    return c.json({ error: "You don't have permission to do that." }, 403);
  }
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const bytes = base64ToBytes(String(body?.dataBase64 ?? ''));
  if (!bytes || bytes.length === 0) return c.json({ error: 'no_file', message: 'Send the PDF to split.' }, 400);
  if (bytes.length > MAX_BILL_FILE_BYTES) {
    return c.json({ error: 'file_too_big', message: `The PDF is over ${Math.round(MAX_BILL_FILE_BYTES / 1024 / 1024)}MB.` }, 400);
  }
  const got = await splitPdfPages(bytes);
  if (!got.ok) {
    return got.reason === 'too_many_pages'
      ? c.json({ error: 'too_many_pages', message: `The PDF has ${got.pageCount} pages — a pile holds at most ${MAX_SPLIT_PAGES}.` }, 400)
      : c.json({ error: 'unreadable_pdf', message: 'This PDF could not be split — it may be password-protected or damaged.' }, 422);
  }
  return c.json({ pages: got.pages.map((p) => toBase64(p.slice().buffer)) });
};
