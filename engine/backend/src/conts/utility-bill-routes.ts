// Conts only (not part of Houzs's code): scanned utility bills from Property OS's "Scan bills" screen (plan
// docs/superpowers/plans/2026-11-02-utility-bill-scan.md Tasks 1-2). Property OS keeps the bills, matches pages to
// units and records them; the engine reads a page (it holds the Anthropic key) and keeps the payment requests.
// Mounted on the claims router, office staff only (Property OS lets finance and management in):
//   POST /utility-bills/read              { file: { name, mime, dataBase64 } } -> { read, model }
//   POST /utility-bills/payment-request   { provider, scanBatchId, note?, bills: [{ unitId, kind, billMonth, accountNo, amountSen }], files? }
//                                          -> { id, requestNo, amountSen }; 201 new, 200 when this scan's request exists
//   POST /utility-bills/payment-request/:id/resubmit   { bills }  a withdrawn or rejected one, sent again: same number
// The bills a scan records for the company to pay go to finance as one request per provider (chew, 2 Nov 2026: A): a
// Rental line per bill with its unit and no account (finance sets it on the voucher), made out to the provider's
// supplier when one is on the list, else to the provider's name for finance to link.
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { DOC_FILE_MIMES } from '../scm/lib/doc-files';
import { normalizeVendor } from '../acc/bill-extract';
import { readUtilityPage, UTILITY_READ_MODEL } from '../acc/utility-bill-read';
import { requestAiTag } from '../services/aiUsage';
import { decodeFiles, removeFiles, storeFiles } from './claims-files';
import { claimRequest, RETURNED, takeReturned } from './payment-request-routes';
import { billRefusal, liveBillOf } from './request-ap-invoice';
import type { Staff } from './staff-identity';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', sewerage: 'Indah Water', internet: 'Internet', other: 'Utility' };
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const officeOnly = (c: Ctx) => ((c.get('staff') as Staff).field ? c.json({ error: 'forbidden', message: 'Utility bills are entered by finance.' }, 403) : null);

export const readPageHandler = async (c: Ctx): Promise<Response> => {
  const refused = officeOnly(c);
  if (refused) return refused;
  const f = ((await bodyOf(c))?.file ?? null) as Record<string, unknown> | null;
  const page = { mime: String(f?.mime ?? ''), dataBase64: String(f?.dataBase64 ?? '') };
  if (!DOC_FILE_MIMES.has(page.mime) || !page.dataBase64) return c.json({ error: 'bad_type', message: 'Photos (JPEG, PNG, WebP) or a PDF only.' }, 400);
  const key = (c.env as { ANTHROPIC_API_KEY?: string } | undefined)?.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: 'SCAN_NOT_SET_UP', message: "Bill scanning isn't set up yet." }, 503);
  const r = await readUtilityPage(key, page, fetch, requestAiTag(c, 'utility_bill_read', UTILITY_READ_MODEL));
  if ('error' in r) return c.json({ error: 'unreadable', message: r.error }, 502);
  return c.json(r);
};

/* The long names on the bills and their short forms on the supplier list, as one (chew, 16 Nov 2026: TNB's bills went
   to finance "to be checked" because the list names it differently; water is paid to each building's management). */
const SHORT_FORMS: Array<[RegExp, string]> = [
  [/\bTENAGA NASIONAL\b/g, 'TNB'],
  [/\bINDAH WATER KONSORTIUM\b/g, 'IWK'],
  [/\b(?:PERBADANAN PENGURUSAN|MANAGEMENT CORPORATION)\b/g, 'MC'],
  [/\b(?:BADAN PENGURUSAN BERSAMA|JOINT MANAGEMENT BODY)\b/g, 'JMB'],
];
/** A provider's or supplier's name as compared: upper case, no "Sdn Bhd" / "Berhad"; as written, and with the long names
 *  in their short forms (both are tried). */
export function providerKeys(name: string): string[] {
  const plain = normalizeVendor(name).replace(/\bBERHAD\b/g, ' ').replace(/\s+/g, ' ').trim();
  let short = plain;
  for (const [long, abbr] of SHORT_FORMS) short = short.replace(long, abbr);
  return [...new Set([plain, short.replace(/\s+/g, ' ').trim()])].filter(Boolean);
}

/** The provider's supplier: the same name ("Tenaga Nasional Berhad" -> "TNB", "TENAGA NASIONAL BHD"; "Perbadanan
    Pengurusan Skyline" -> "MC SKYLINE"), else the one listed name that starts with it ("Indah Water" -> "INDAH WATER
    KONSORTIUM SDN BHD"), else the one listed name it starts with ("Skyline Residence Management Office" -> "SKYLINE
    RESIDENCE"). A name merely containing it ("TIME" in "OVERTIME TRADING") is not taken, nor two that fit alike. */
export function providerSupplier(provider: string, suppliers: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const ps = providerKeys(provider);
  if (!ps.length) return null;
  const keyed = suppliers.map(s => ({ s, ks: providerKeys(s.name) })).filter(x => x.ks.length);
  const fits = (test: (p: string, k: string) => boolean) => keyed.filter(x => ps.some(p => x.ks.some(k => test(p, k))));
  const one = (xs: typeof keyed) => (xs.length === 1 ? xs[0]!.s : null);
  const exact = fits((p, k) => p === k);
  if (exact.length) return one(exact);
  return one(fits((p, k) => k.startsWith(`${p} `))) ?? one(fits((p, k) => p.startsWith(`${k} `)));
}

export const utilityRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const refused = officeOnly(c);
  if (refused) return refused;
  const staff: Staff = c.get('staff');
  const sb = c.get('supabase');
  const b = await bodyOf(c);
  if (!b) return c.json({ error: 'invalid_json' }, 400);
  const provider = String(b.provider ?? '').trim().slice(0, 100);
  const batch = String(b.scanBatchId ?? '').trim();
  if (!provider || !batch) return c.json({ error: 'validation', message: 'Name the provider and the scan.' }, 422);
  const lines = billLines(c, b.bills);
  if (lines instanceof Response) return lines;

  const sourceKey = `utility:${batch.slice(0, 80)}:${provider}`;
  const existing = async () => (await sb.from('payment_requests').select('id, request_no, amount_sen').eq('company_id', co.companyId).eq('source_key', sourceKey).maybeSingle()).data as { id: string; request_no: string; amount_sen: number } | null;
  const done = await existing();
  if (done) return c.json({ id: done.id, requestNo: done.request_no, amountSen: Number(done.amount_sen) }, 200);

  const badUnit = await unknownUnit(c, sb, lines);
  if (badUnit) return badUnit;

  const { data: sups } = await sb.from('suppliers').select('id, name').eq('company_id', co.companyId);
  const supplier = providerSupplier(provider, (sups ?? []) as Array<{ id: string; name: string }>);
  const files = Array.isArray(b.files) && b.files.length ? decodeFiles(b.files, 'the bills') : { ok: true as const, files: [] };
  if (!files.ok) return c.json({ error: files.error, message: files.message }, files.status);
  const bucket = c.env?.SLIPS;
  if (files.files.length && !bucket) return c.json({ error: 'not_configured', message: 'File storage is not set up yet.' }, 501);

  const id = crypto.randomUUID();
  const amountSen = lines.reduce((n, l) => n + l.amountSen, 0);
  let stored: Awaited<ReturnType<typeof storeFiles>> = [];
  if (files.files.length) {
    try { stored = await storeFiles(bucket, `payment-requests/${co.companyId}/${id}`, files.files); } catch {
      return c.json({ error: 'upload_failed', message: 'The files could not be saved. Try again.' }, 502);
    }
  }
  const fail = async (reason: string) => {
    await sb.from('payment_requests').delete().eq('id', id);
    if (stored.length) await removeFiles(bucket, stored.map(s => s.r2_key));
    return c.json({ error: 'save_failed', reason }, 500);
  };
  const { data: row, error } = await insertWithDocNoRetry<{ id: string; request_no: string }>(
    () => mintMonthlyDocNo(sb, 'payment_requests', 'request_no', `PRQ-${docMonthTag(todayMyt())}`),
    no => sb.from('payment_requests').insert({
      id, company_id: co.companyId, request_no: no, type: 'PAYMENT', requester_user_id: staff.userId,
      supplier_id: supplier?.id ?? null, payee_name: (supplier?.name ?? provider).slice(0, 200), payee_to_check: !supplier,
      purchase_order_id: null, wanted_on: null, owes_formal_invoice: false, source_key: sourceKey,
      note: (b.note ? String(b.note) : `${lines.length} ${provider} bills from a scan on the Utility bills screen.`).slice(0, 500),
      amount_sen: amountSen, status: 'SUBMITTED',
    }).select('id, request_no').single(),
  );
  if (error || !row) {
    /* Two clicks at once: the unique (company, source_key) index lets one through; the other answers with it. */
    if (error && (error.code === '23505' || /duplicate key/i.test(String(error.message ?? '')))) {
      if (stored.length) await removeFiles(bucket, stored.map(s => s.r2_key));
      const won = await existing();
      if (won) return c.json({ id: won.id, requestNo: won.request_no, amountSen: Number(won.amount_sen) }, 200);
    }
    return fail(error?.message ?? 'insert returned nothing');
  }
  const ins = await sb.from('payment_request_lines').insert(lineRows(id, lines, await accrualAccounts(sb, co.companyId)));
  if (ins.error) return fail(ins.error.message);
  if (stored.length) {
    const fr = await sb.from('payment_request_files').insert(stored.map(s => ({ ...s, request_id: id })));
    if (fr.error) return fail(fr.error.message);
  }
  return c.json({ id, requestNo: row.request_no, amountSen }, 201);
};

/** POST /utility-bills/payment-request/:id/resubmit { bills } — a utility request that was withdrawn or rejected goes back
 *  to finance with its bills as they are now (chew, 13 Nov 2026: change it and send it again): the same request and
 *  number, a Rental line per bill, the new total. A bill taken off it (now owner paid, or deleted) is simply not sent.
 *  Any office staff may send it, as any may record the bills; a rejection's reason and who decided stay for finance to
 *  see, and the scan's files stay. The lines are saved while it is still returned; the status goes back last. */
export const resubmitUtilityRequestHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const refused = officeOnly(c);
  if (refused) return refused;
  const sb = c.get('supabase');
  const { data: r } = await sb.from('payment_requests').select('id, request_no, status, source_key, updated_at').eq('company_id', co.companyId).eq('id', c.req.param('id')).maybeSingle();
  if (!r || !String(r.source_key ?? '').startsWith('utility:')) return c.json({ error: 'not_found' }, 404);
  if (!RETURNED.has(String(r.status))) return c.json({ error: 'not_returned', message: 'Only a withdrawn or rejected request can be sent again.' }, 409);
  const bill = await liveBillOf(sb, r.id);
  if (bill) return billRefusal(c, bill);
  const b = await bodyOf(c);
  if (!b) return c.json({ error: 'invalid_json' }, 400);
  const lines = billLines(c, b.bills);
  if (lines instanceof Response) return lines;
  const badUnit = await unknownUnit(c, sb, lines);
  if (badUnit) return badUnit;
  const amountSen = lines.reduce((n, l) => n + l.amountSen, 0);
  const changedElsewhere = () => c.json({ error: 'not_returned', message: 'This request was changed somewhere else. Open it again.' }, 409);
  const claim = await takeReturned(sb, r);
  if (!claim) return changedElsewhere();
  const gone = await sb.from('payment_request_lines').delete().eq('request_id', r.id);
  if (gone.error) return c.json({ error: 'save_failed', reason: gone.error.message }, 500);
  const ins = await sb.from('payment_request_lines').insert(lineRows(r.id, lines, await accrualAccounts(sb, co.companyId)));
  if (ins.error) return c.json({ error: 'save_failed', reason: ins.error.message }, 500);
  if (!(await claimRequest(sb, r.id, String(r.status), { amount_sen: amountSen, status: 'SUBMITTED' }, claim))) return changedElsewhere();
  return c.json({ id: r.id, requestNo: r.request_no, amountSen }, 200);
};

type BillLine = { unitId: string; amountSen: number; sort: number; description: string; kind: string };

/* Each kind's accrual (chew, 16 Nov 2026: utilities are paid against "ACCRUAL - ABNB UTILITIES", one account per kind;
   no supplier, no AP invoice). The line starts on it, so Make voucher books the payment against the accrual. */
export const UTILITY_ACCRUAL: Record<string, string> = { electricity: '420-0010', water: '420-0020', internet: '420-0030', sewerage: '420-0040' };

/** The kinds whose accrual account is on this company's chart and in use; a kind without one starts with no account. */
async function accrualAccounts(sb: any, companyId: number): Promise<Map<string, string>> {
  const codes = [...new Set(Object.values(UTILITY_ACCRUAL))];
  const { data } = await sb.from('accounts').select('account_code, is_active').eq('company_id', companyId).in('account_code', codes);
  const live = new Set(((data ?? []) as Array<{ account_code: string; is_active: boolean | null }>).filter(a => a.is_active !== false).map(a => a.account_code));
  return new Map(Object.entries(UTILITY_ACCRUAL).filter(([, code]) => live.has(code)));
}

/** A Rental line per bill, each with its unit and amount ("Electricity 2026-10 2104010945XX02"); or the refusal. */
function billLines(c: Ctx, raw: unknown): BillLine[] | Response {
  const bills = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  if (!bills.length || bills.length > 500) return c.json({ error: 'validation', message: 'Send the bills to pay (up to 500).' }, 422);
  const lines = bills.map((x, i) => ({
    unitId: String(x.unitId ?? ''), amountSen: Number(x.amountSen), sort: i, kind: String(x.kind ?? ''),
    description: [KIND_LABEL[String(x.kind)] ?? 'Utility', MONTH.test(String(x.billMonth ?? '')) ? String(x.billMonth) : null, x.accountNo ? String(x.accountNo).slice(0, 40) : null].filter(Boolean).join(' '),
  }));
  if (lines.some(l => !l.unitId || !Number.isInteger(l.amountSen) || l.amountSen <= 0)) return c.json({ error: 'validation', message: 'Every bill needs its unit and an amount.' }, 422);
  return lines;
}

/** The refusal when a bill names a unit that does not exist, else null. */
async function unknownUnit(c: Ctx, sb: any, lines: BillLine[]): Promise<Response | null> {
  const unitIds = [...new Set(lines.map(l => l.unitId))];
  const { data: units, error: uErr } = await sb.schema('public').from('conts_units').select('id').in('id', unitIds);
  if (uErr) return c.json({ error: 'read_failed', reason: uErr.message }, 500);
  const known = new Set(((units ?? []) as Array<{ id: string }>).map(u => u.id));
  return unitIds.some(u => !known.has(u)) ? c.json({ error: 'validation', message: 'A bill names a unit that does not exist.' }, 422) : null;
}

/** The request's lines: a Rental line per bill, with its unit and its kind's accrual account (none when the chart lacks it). */
const lineRows = (requestId: string, lines: BillLine[], accruals: Map<string, string>) => lines.map(l => ({
  id: crypto.randomUUID(), request_id: requestId, department: 'rental', unit_id: l.unitId, maintenance_issue_id: null, project_id: null,
  account_code: accruals.get(l.kind) ?? null, amount_sen: l.amountSen, description: l.description, sort: l.sort,
}));

export function utilityBillRoutes(r: { post: (p: string, h: (c: Ctx) => Promise<Response>) => unknown }) {
  r.post('/utility-bills/read', readPageHandler);
  r.post('/utility-bills/payment-request', utilityRequestHandler);
  r.post('/utility-bills/payment-request/:id/resubmit', resubmitUtilityRequestHandler);
}
