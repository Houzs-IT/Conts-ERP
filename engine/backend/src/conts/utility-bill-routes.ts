// Conts only (not part of Houzs's code): scanned utility bills from Property OS's "Scan bills" screen (plan
// docs/superpowers/plans/2026-11-02-utility-bill-scan.md Tasks 1-2). Property OS keeps the bills, matches pages to
// units and records them; the engine reads a page (it holds the Anthropic key) and keeps the payment requests.
// Mounted on the claims router, office staff only (Property OS lets finance and management in):
//   POST /utility-bills/read              { file: { name, mime, dataBase64 } } -> { read, model }
//   POST /utility-bills/payment-request   { provider, scanBatchId, note?, bills: [{ unitId, kind, billMonth, accountNo, amountSen }], files? }
//                                          -> { id, requestNo, amountSen }; 201 new, 200 when this scan's request exists
// The bills a scan records for the company to pay go to finance as one request per provider (chew, 2 Nov 2026: A): a
// Rental line per bill with its unit and no account (finance sets it on the voucher), made out to the provider's
// supplier when one is on the list, else to the provider's name for finance to link.
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { DOC_FILE_MIMES } from '../scm/lib/doc-files';
import { normalizeVendor } from '../acc/bill-extract';
import { readUtilityPage } from '../acc/utility-bill-read';
import { decodeFiles, removeFiles, storeFiles } from './claims-files';
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
  const r = await readUtilityPage(key, page);
  if ('error' in r) return c.json({ error: 'unreadable', message: r.error }, 502);
  return c.json(r);
};

/** The provider's supplier: the same name, or a listed name that starts with it ("Indah Water" -> "INDAH WATER
    KONSORTIUM SDN BHD"). A name merely containing it ("TIME" in "OVERTIME TRADING") is not taken. */
export function providerSupplier(provider: string, suppliers: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const p = normalizeVendor(provider);
  if (!p) return null;
  return suppliers.find(s => normalizeVendor(s.name) === p) ?? suppliers.find(s => normalizeVendor(s.name).startsWith(`${p} `)) ?? null;
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
  const bills = Array.isArray(b.bills) ? (b.bills as Array<Record<string, unknown>>) : [];
  if (!bills.length || bills.length > 500) return c.json({ error: 'validation', message: 'Send the bills to pay (up to 500).' }, 422);
  const lines = bills.map((x, i) => ({
    unitId: String(x.unitId ?? ''), amountSen: Number(x.amountSen), sort: i,
    description: [KIND_LABEL[String(x.kind)] ?? 'Utility', MONTH.test(String(x.billMonth ?? '')) ? String(x.billMonth) : null, x.accountNo ? String(x.accountNo).slice(0, 40) : null].filter(Boolean).join(' '),
  }));
  if (lines.some(l => !l.unitId || !Number.isInteger(l.amountSen) || l.amountSen <= 0)) return c.json({ error: 'validation', message: 'Every bill needs its unit and an amount.' }, 422);

  const sourceKey = `utility:${batch.slice(0, 80)}:${provider}`;
  const existing = async () => (await sb.from('payment_requests').select('id, request_no, amount_sen').eq('company_id', co.companyId).eq('source_key', sourceKey).maybeSingle()).data as { id: string; request_no: string; amount_sen: number } | null;
  const done = await existing();
  if (done) return c.json({ id: done.id, requestNo: done.request_no, amountSen: Number(done.amount_sen) }, 200);

  const unitIds = [...new Set(lines.map(l => l.unitId))];
  const { data: units, error: uErr } = await sb.schema('public').from('conts_units').select('id').in('id', unitIds);
  if (uErr) return c.json({ error: 'read_failed', reason: uErr.message }, 500);
  const known = new Set(((units ?? []) as Array<{ id: string }>).map(u => u.id));
  if (unitIds.some(u => !known.has(u))) return c.json({ error: 'validation', message: 'A bill names a unit that does not exist.' }, 422);

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
  const ins = await sb.from('payment_request_lines').insert(lines.map(l => ({
    id: crypto.randomUUID(), request_id: id, department: 'rental', unit_id: l.unitId, maintenance_issue_id: null, project_id: null,
    account_code: null, amount_sen: l.amountSen, description: l.description, sort: l.sort,
  })));
  if (ins.error) return fail(ins.error.message);
  if (stored.length) {
    const fr = await sb.from('payment_request_files').insert(stored.map(s => ({ ...s, request_id: id })));
    if (fr.error) return fail(fr.error.message);
  }
  return c.json({ id, requestNo: row.request_no, amountSen }, 201);
};

export function utilityBillRoutes(r: { post: (p: string, h: (c: Ctx) => Promise<Response>) => unknown }) {
  r.post('/utility-bills/read', readPageHandler);
  r.post('/utility-bills/payment-request', utilityRequestHandler);
}
