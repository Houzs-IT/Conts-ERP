// ----------------------------------------------------------------------------
// /accounting/renovation-opening — renovation contracts signed before the ledger start, seeded at go-live (plan
// 2026-10-30-renovation-revenue-ledger.md Task 8; the work is acc/reno-opening). The Ledger setup page uploads the
// Excel, shows the preview with each row's problems, and applies. Finance's alone (scm.payment_voucher.post), like
// the opening balances beside it.
// ----------------------------------------------------------------------------

import { hasHouzsPerm } from '../lib/houzs-perms';
import { requireActiveCompanyId } from '../lib/companyScope';
import { applyRenoOpening, previewRenoOpening, type RenoOpeningRow, type RenoOpeningTx } from '../../acc/reno-opening';
import { inRenoTx, sqlFor } from '../lib/renovation-db';
import { AUTOCOUNT_RECEIVED_MAX_ROWS, applyAutocountReceived, previewAutocountReceived, type AutocountReceivedRow } from '../../acc/reno-autocount-received';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context, untyped as in the other accounting-* handlers */
const MAX_ROWS = 2000;

async function readRows(c: any): Promise<{ ok: true; companyId: number; rows: RenoOpeningRow[] } | { ok: false; res: Response }> {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) {
    return { ok: false, res: c.json({ error: "Only finance (the ledger's post permission) can seed renovation contracts." }, 403) };
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return { ok: false, res: c.json(co.refusal, 409) };
  let body: any;
  try { body = await c.req.json(); } catch { return { ok: false, res: c.json({ error: 'invalid_json' }, 400) }; }
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, res: c.json({ error: 'The file has no rows.' }, 400) };
  if (rows.length > MAX_ROWS) return { ok: false, res: c.json({ error: `At most ${MAX_ROWS} rows at a time.` }, 400) };
  return {
    ok: true,
    companyId: co.companyId,
    rows: rows.map((r: any) => ({
      soDocNo: String(r?.soDocNo ?? ''), debtorCode: String(r?.debtorCode ?? ''), advanceAccountCode: String(r?.advanceAccountCode ?? ''),
      billedBeforeGoLiveSen: Number(r?.billedBeforeGoLiveSen),
      /* Blank keeps what is saved; a figure (sen) is AutoCount's project cost before go-live. */
      costBeforeGoLiveSen: r?.costBeforeGoLiveSen == null || r?.costBeforeGoLiveSen === '' ? null : Number(r.costBeforeGoLiveSen),
    })),
  };
}

/* POST /accounting/renovation-opening/preview { rows } → { rows: [...each with its problems] } */
export const renoOpeningPreview = async (c: any): Promise<Response> => {
  const b = await readRows(c);
  if (!b.ok) return b.res;
  const r = await previewRenoOpening(c.get('supabase'), b.companyId, b.rows);
  return r.ok ? c.json(r) : c.json({ error: r.error }, 503);
};

/* POST /accounting/renovation-opening/apply { rows } → { ok, applied }; 409 with the rows when any has a problem. */
export const renoOpeningApply = async (c: any): Promise<Response> => {
  const b = await readRows(c);
  if (!b.ok) return b.res;
  /* Every row in one SQL transaction (the renovation routes' own): a failure on any row rolls back them all. */
  const sql = sqlFor(c.env ?? {});
  const runTx: RenoOpeningTx | null = sql ? (f) => inRenoTx(sql, (db) => f(db)) : null;
  const r = await applyRenoOpening(c.get('supabase'), b.companyId, b.rows, runTx);
  if (r.ok) return c.json(r);
  if (r.status === 'problems') return c.json({ error: 'Some rows have problems: nothing was applied.', rows: r.rows }, 409);
  return c.json({ error: r.error }, sql ? 500 : 503);
};

/* POST /accounting/renovation-opening/autocount-received { rows: [{ soDocNo, receivedSen | null }], dryRun? }
   What AutoCount collected on each contract before go-live, from its AR collection list (acc/reno-autocount-received).
   dryRun → { ok, rows } with each row's problems and what it holds now; else { ok, applied }, or 409 with the rows. */
export const renoAutocountReceived = async (c: any): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) {
    return c.json({ error: "Only finance (the ledger's post permission) can set what AutoCount collected." }, 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const raw = body?.rows;
  if (!Array.isArray(raw) || raw.length === 0) return c.json({ error: 'No rows.' }, 400);
  if (raw.length > AUTOCOUNT_RECEIVED_MAX_ROWS) return c.json({ error: `At most ${AUTOCOUNT_RECEIVED_MAX_ROWS} rows at a time.` }, 400);
  const rows: AutocountReceivedRow[] = raw.map((r: any) => ({
    soDocNo: String(r?.soDocNo ?? '').trim(),
    receivedSen: r?.receivedSen == null || r?.receivedSen === '' ? null : Number(r.receivedSen),
  }));
  const sb = c.get('supabase');
  if (body?.dryRun === true) {
    const p = await previewAutocountReceived(sb, co.companyId, rows);
    return p.ok ? c.json(p) : c.json({ error: p.error }, 503);
  }
  const r = await applyAutocountReceived(sb, co.companyId, rows);
  if (r.ok) return c.json(r);
  if (r.status === 'problems') return c.json({ error: 'Some rows have problems: nothing was applied.', rows: r.rows }, 409);
  return c.json({ error: r.error }, 500);
};
