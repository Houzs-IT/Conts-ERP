// E-invoice settings and outbox (plan 2026-10-30-renovation-einvoice-ready.md Task 6). Mounted under /accounting, so
// the Ledger guard stands in front; saving and "Re-check all" need the post key, as the ledger settings do.
//   GET  /accounting/einvoice/settings          the settings, what the seller still lacks, the tax types
//   PUT  /accounting/einvoice/settings          save (400 invalid_setting with the field and message)
//   GET  /accounting/einvoice/outbox?status=    the rows, newest first, with counts by status
//   GET  /accounting/einvoice/outbox/:id        one row with its payload
//   POST /accounting/einvoice/outbox/refresh    prepare every open row again
// Nothing here sends anything to LHDN.
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { paginateAll } from '../scm/lib/paginate-all';
import { refreshAll, type OutboxStatus } from './einvoice-outbox';
import { loadEInvoiceSettings, saveEInvoiceSettings, sellerMissing, TAX_TYPES, type EInvoiceSeller, type EInvoiceSettings } from './einvoice-settings';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const NO_PERM = { error: "You don't have permission to change the e-invoice settings." };
const canWrite = (c: Ctx) => hasHouzsPerm(c, 'scm.payment_voucher.post');
const STATUSES: OutboxStatus[] = ['NOT_READY', 'READY', 'SUBMITTED', 'VALID', 'REJECTED', 'CANCELLED'];

const view = (s: EInvoiceSettings) => ({ ...s, sellerMissing: sellerMissing(s), taxTypes: TAX_TYPES });

export const einvoiceSettingsGet = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  try {
    return c.json(view(await loadEInvoiceSettings(c.get('supabase'), co.companyId)));
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};

const SELLER_KEYS: Array<keyof EInvoiceSeller> = ['tin', 'brn', 'sstNo', 'msicCode', 'activityDesc', 'address1', 'address2', 'city', 'postcode', 'stateCode', 'phone', 'email'];

/** The body as settings, or null when it is not shaped like them. */
function settingsOf(b: any): EInvoiceSettings | null {
  if (!b || typeof b !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : null);
  if (typeof b.active !== 'boolean' || typeof b.sstEnabled !== 'boolean') return null;
  const classificationCode = str(b.classificationCode); const taxType = str(b.taxType); const tpl = str(b.renoDescriptionTemplate);
  if (classificationCode == null || taxType == null || tpl == null || !b.seller || typeof b.seller !== 'object') return null;
  const seller = {} as EInvoiceSeller;
  for (const k of SELLER_KEYS) {
    const v = str(b.seller[k] ?? '');
    if (v == null) return null;
    seller[k] = v;
  }
  const mode = b.sstMode === 'EXCLUSIVE' || b.sstMode === 'INCLUSIVE' ? b.sstMode : null;
  return { active: b.active, classificationCode, taxType, sstEnabled: b.sstEnabled, sstMode: mode, sstOutputAccount: str(b.sstOutputAccount) || null, renoDescriptionTemplate: tpl, seller };
}

export const einvoiceSettingsPut = async (c: Ctx): Promise<Response> => {
  if (!canWrite(c)) return c.json(NO_PERM, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const s = settingsOf(body);
  if (!s) return c.json({ error: 'invalid_body', message: 'Send every e-invoice setting.' }, 400);
  const sb = c.get('supabase');
  const who = String((c.get('houzsUser') as { name?: string } | undefined)?.name ?? '');
  const saved = await saveEInvoiceSettings(sb, co.companyId, s, who);
  if (!saved.ok) {
    return saved.field ? c.json({ error: 'invalid_setting', field: saved.field, message: saved.message }, 400) : c.json({ error: 'save_failed', reason: saved.message }, 500);
  }
  /* The seller's details and the codes are in every payload: the waiting rows are prepared again. */
  try { await refreshAll(sb, co.companyId); } catch (err) {
    /* eslint-disable-next-line no-console */
    console.error('[einvoice] refresh after settings save failed:', err instanceof Error ? err.message : err);
  }
  try {
    return c.json(view(await loadEInvoiceSettings(sb, co.companyId)));
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};

type OutRow = { id: string; doc_kind: string; doc_number: string; debtor_code: string | null; status: OutboxStatus; missing: string[] | null; payload: any; prepared_at: string };

const rowView = (r: OutRow) => ({
  id: r.id, docKind: r.doc_kind, docNumber: r.doc_number, debtorCode: r.debtor_code,
  debtorName: r.payload?.buyer?.name ?? null, date: r.payload?.issueDate ?? null,
  amountSen: Math.round(Number(r.payload?.totals?.payable ?? 0) * 100), status: r.status, missing: r.missing ?? [],
});

export const einvoiceOutboxList = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const status = String(c.req.query('status') ?? '').trim().toUpperCase();
  const sb = c.get('supabase');
  const res = await paginateAll((from, to) => sb.from('acc_einvoice_outbox')
    .select('id, doc_kind, doc_number, debtor_code, status, missing, payload, prepared_at').eq('company_id', co.companyId)
    .order('prepared_at', { ascending: false }).range(from, to));
  if (res.error) return c.json({ error: 'load_failed', reason: (res.error as { message?: string }).message ?? '' }, 500);
  const all = (res.data ?? []) as OutRow[];
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.status === s).length]));
  const rows = all.filter((r) => !status || r.status === status).map(rowView);
  return c.json({ rows, counts });
};

export const einvoiceOutboxGet = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await c.get('supabase').from('acc_einvoice_outbox')
    .select('id, doc_kind, doc_number, debtor_code, status, missing, payload, prepared_at').eq('company_id', co.companyId).eq('id', c.req.param('id')).maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...rowView(data as OutRow), payload: (data as OutRow).payload, preparedAt: (data as OutRow).prepared_at });
};

export const einvoiceRefresh = async (c: Ctx): Promise<Response> => {
  if (!canWrite(c)) return c.json(NO_PERM, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  try {
    return c.json({ refreshed: await refreshAll(c.get('supabase'), co.companyId) });
  } catch (e) {
    return c.json({ error: 'refresh_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};
