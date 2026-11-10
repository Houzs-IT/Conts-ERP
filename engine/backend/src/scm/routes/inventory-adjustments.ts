// ----------------------------------------------------------------------------
// /inventory/adjustments — the manual stock ADJUSTMENT document, split OFF the
// Inventory page's permission.
//
// WHY its own router: a stock adjustment changes inventory VALUATION, so the
// owner wants adjusting gated on a separate, more-sensitive permission than
// merely VIEWING the stock listing (owner 2026-07-18: viewing inventory and
// adjusting stock must be TWO separable permissions). Viewing the Inventory page
// (stock card / listing / warehouses / racks) stays on `scm.warehouse.inventory`;
// everything here is gated on `scm.warehouse.adjustments`.
//
// WHY a dedicated sub-mount rather than a second guard on /inventory/*: Hono
// runs ALL middleware whose pattern matches, so layering a second guard on top
// of the broad `/inventory/*` one would require inventory AND adjustments.
// Mounted at `/inventory/adjustments/*` BEFORE the broad guard (scm/index.ts),
// this router answers first and the broad guard is never reached. The reads the
// adjustment FORM needs (warehouses, buckets, breakdown) stay on /inventory.
//
// THE DOCUMENT (BUG-66, 2026-10-07). An adjustment used to be nothing but its
// movement rows — no number, no page, no edit. It is now a numbered header
// (`<prefix>SA-YYMM-NNN`, scm.stock_adjustments) holding its CURRENT lines
// (scm.stock_adjustment_lines), and every movement it writes carries
// source_doc_type 'ADJUSTMENT' + source_doc_id = header id. The lines are what
// the document says now; the movements are the ledger and keep every step.
//
//   GET    /       documents, newest first, with their lines
//   GET    /:id    one document
//   POST   /       create + post (one warehouse, 1..N lines)
//   PATCH  /:id    notes and/or a full replace of the lines
//
// DOUBLE SUBMIT. POST takes the form's Idempotency-Key (middleware/idempotency):
// a double click replays the first answer instead of raising a second document;
// every refusal above the header insert releases the claim (refuseWithoutWriting)
// so the corrected resubmit goes through. PATCH is optimistic: the client sends
// the header's updated_at as `expectedUpdatedAt`, and the handler CLAIMS the
// document with `update … set updated_at = now() where id = ? and updated_at =
// <sent>` before it writes any movement. Two saves of the same version (a double
// click, two tabs) both compute the same delta from the ledger, so without the
// claim both would post it; with it the second finds no row and gets 409
// stale_document and nothing is written.
//
// EDIT writes one signed ADJUSTMENT per (item, variant, batch) bucket whose net
// changed (new net - what the document already moved), not a reverse-all +
// re-post: the trigger never sees an intermediate state, and a bucket the edit
// did not touch gets no movement. A bucket that would take out more than it
// holds is refused before anything is written.
// ----------------------------------------------------------------------------

import { Hono, type Context } from 'hono';
import { resolveForcedUnitCostSen, type LotCostRow } from '../shared';
import { supabaseAuth } from '../middleware/auth';
import { recomputeSoStockAllocation } from '../lib/so-stock-allocation';
import { reconcileUncostedAfterIn } from '../lib/oversell-retrocost';
import { activeCompanyId, requireActiveCompanyId, companyDocPrefix, NOT_THIS_COMPANY } from '../lib/companyScope';
import { assertWarehouseInCompany } from '../lib/ref-in-company';
import { recordEntityAudit, compactChanges, fieldChange, assertAuditWritable, auditUnavailableBody } from '../lib/entity-audit';
import { resolveCallerStaffId } from '../lib/salesScope';
import { scmDb, companyScope, CENTRALISED, type ScopedDb } from '../lib/scopedDb';
import { mintMonthlyDocNo, insertWithDocNoRetry, docMonthTag } from '../lib/doc-no';
import { paginateAll, chunkIn } from '../lib/paginate-all';
import { refuseWithoutWriting } from '../lib/no-write-refusal';
import {
  linesFromBody,
  parseAdjustmentLines,
  bucketDeltas,
  bucketKeyOf,
  bucketLabel,
  writtenOffUnitCostSen,
  type AdjustmentLine,
  type Bucket,
  type BucketDelta,
} from '../lib/stock-adjustment-doc';
import type { Env, Variables } from '../env';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export const inventoryAdjustments = new Hono<{ Bindings: Env; Variables: Variables }>();
inventoryAdjustments.use('*', supabaseAuth);

const HEADER = 'id, adjustment_no, warehouse_id, notes, created_by, created_at, updated_at';
/* unit_cost_sen is deliberately NOT read back: cost is finance-only, and the
   movement rows (stripped for non-finance callers) are where it lives. */
const LINE =
  'id, stock_adjustment_id, line_no, item_code, product_name, item_group, variants, description2, ' +
  'variant_key, batch_no, qty, reason_code, notes';

const AUDIT_CLIENT = 'library hand-off: the audit sink takes the raw client and is told the company explicitly as companyId';

const nextAdjustmentNo = (db: ScopedDb, c: Ctx): Promise<string> =>
  mintMonthlyDocNo(db.unscoped(
    'library hand-off: mintMonthlyDocNo partitions by the per-company DOC-NUMBER PREFIX, not by a predicate — its .like() for HC-SA-2610-% never matches another company\'s numbers',
  ), 'stock_adjustments', 'adjustment_no', `${companyDocPrefix(c)}SA-${docMonthTag(null)}`);

/* ONE read per table for the whole document, never one per line: a 40-line
   adjustment that read its lots line by line spent the Worker's 50-subrequest
   budget between the header insert and the movement insert, leaving a document
   whose lines never moved stock. */
type LotReads = {
  /** Open qty per bucket (bucketKeyOf). A null batch means the un-batched lots only. */
  open: Map<string, number>;
  /** Every lot (open + consumed) per item_code + variant_key, for the found-stock cost. */
  lots: Map<string, LotCostRow[]>;
};

const costKey = (itemCode: string, variantKey: string | null) => JSON.stringify([itemCode, variantKey ?? '']);

async function readLots(db: ScopedDb, c: Ctx, warehouseId: string, codes: readonly string[]): Promise<LotReads> {
  const uniq = [...new Set(codes)];
  const out: LotReads = { open: new Map(), lots: new Map() };
  if (uniq.length === 0) return out;
  const [openRes, lotRes] = await Promise.all([
    chunkIn<{ item_code: string; variant_key: string | null; batch_no: string | null; qty_remaining: number | null }>(uniq, (batch, pFrom, pTo) =>
      db.from('v_inventory_lots_open', companyScope(c))
        .select('item_code, variant_key, batch_no, qty_remaining')
        .eq('warehouse_id', warehouseId).in('item_code', batch).range(pFrom, pTo)),
    chunkIn<LotCostRow & { item_code: string; variant_key: string | null }>(uniq, (batch, pFrom, pTo) =>
      db.from('inventory_lots', companyScope(c))
        .select('item_code, variant_key, unit_cost_sen, qty_remaining, source_doc_type, received_at')
        .eq('warehouse_id', warehouseId).in('item_code', batch).range(pFrom, pTo)),
  ]);
  if (openRes.error) throw new Error(openRes.error.message);
  if (lotRes.error) throw new Error(lotRes.error.message);
  for (const l of openRes.data) {
    const k = bucketKeyOf(l);
    out.open.set(k, (out.open.get(k) ?? 0) + Number(l.qty_remaining ?? 0));
  }
  for (const l of lotRes.data) {
    const k = costKey(l.item_code, l.variant_key);
    out.lots.set(k, [...(out.lots.get(k) ?? []), l]);
  }
  return out;
}

/** Every bucket whose net goes DOWN by more than it holds, as one sentence. */
function shortages(reads: LotReads, deltas: readonly BucketDelta[]): string[] {
  const out: string[] = [];
  for (const d of deltas) {
    if (d.delta >= 0) continue;
    const open = reads.open.get(bucketKeyOf(d.bucket)) ?? 0;
    if (-d.delta > open) out.push(`${bucketLabel(d.bucket)}: only ${open} on hand, this takes out ${-d.delta}`);
  }
  return out;
}

/** The cost found stock enters at. Never 0 (audit R3): the operator's figure,
    else what this document wrote the same bucket off at, else the bucket's
    known lot cost. null = nothing to go on, so the caller refuses. */
function increaseCostSen(reads: LotReads, b: Bucket, preferredSen: number): number | null {
  const forced = resolveForcedUnitCostSen({ operatorCostSen: preferredSen, lots: reads.lots.get(costKey(b.item_code, b.variant_key)) ?? [] });
  return forced.ok ? forced.unitCostSen : null;
}

const costRequired = (b: Bucket) => ({
  error: 'cost_required',
  message: `${bucketLabel(b)} has no known cost yet. Enter the unit cost for the found stock so it is not added at RM0.`,
});

async function performerStaffId(c: Ctx & { get(k: 'houzsUser'): unknown; get(k: 'supabase'): unknown; get(k: 'user'): unknown }): Promise<string> {
  /* Stamp the caller's REAL scm.staff uuid (mig-0066 bridge), not the pinned
     system uuid the scm auth sets as user.id — that one resolves to nobody, and
     "Performed By" read "Unknown user" for every adjustment until 2026-08-08. */
  let staffId: string | null = null;
  try {
    staffId = await resolveCallerStaffId(c.get('supabase'), (c.get('houzsUser') as { id?: number } | null)?.id ?? null);
  } catch { /* fallback below */ }
  return staffId ?? (c.get('user') as { id: string }).id;
}

type MovementRow = Record<string, unknown> & { movement_type: 'ADJUSTMENT'; warehouse_id: string; item_code: string; variant_key: string; qty: number };

/** Two timestamps name the same instant (PostgREST may print +00:00 where the
    client kept Z, or drop trailing zeros). */
const sameInstant = (a: string, b: string): boolean => {
  if (a === b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && ta === tb;
};

const STALE_DOCUMENT = {
  error: 'stale_document',
  message: 'Someone else changed this stock adjustment after you opened it. Reload the page to see their changes, then make your edit again.',
} as const;

const lineSummary = (lines: ReadonlyArray<{ item_code: string; qty: number; reason_code: string | null }>) =>
  lines.map((l) => `${l.item_code} ${l.qty > 0 ? '+' : ''}${l.qty}${l.reason_code ? ` ${l.reason_code}` : ''}`).join('; ');

// ── List ──────────────────────────────────────────────────────────────
inventoryAdjustments.get('/', async (c) => {
  const db = scmDb(c);
  const warehouseId = c.req.query('warehouseId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const { data, error } = await paginateAll((from, to) => {
    let q = db.from('stock_adjustments', companyScope(c))
      .select(HEADER)
      .order('created_at', { ascending: false });
    if (warehouseId) q = q.eq('warehouse_id', warehouseId);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59Z`);
    return q.range(from, to);
  });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const headers = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;

  const ids = headers.map((h) => h.id);
  const { data: lineRows, error: lErr } = await chunkIn<Record<string, unknown>>(ids, (batch, from, to) => db
    .from('stock_adjustment_lines', CENTRALISED(
      'read only for ids the company-scoped header list above returned',
    ))
    .select(LINE)
    .in('stock_adjustment_id', batch)
    .order('line_no')
    .range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>);
  if (lErr) return c.json({ error: 'load_failed', reason: lErr.message }, 500);
  const byDoc = new Map<string, Array<Record<string, unknown>>>();
  for (const l of lineRows) {
    const k = String(l.stock_adjustment_id);
    const list = byDoc.get(k) ?? [];
    list.push(l);
    byDoc.set(k, list);
  }

  return c.json({ adjustments: headers.map((h) => ({ ...h, lines: byDoc.get(h.id) ?? [] })) });
});

// ── Detail ────────────────────────────────────────────────────────────
inventoryAdjustments.get('/:id', async (c) => {
  const db = scmDb(c);
  const id = c.req.param('id');
  const { data: header, error } = await db.from('stock_adjustments', companyScope(c))
    .select(HEADER).eq('id', id).maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!header) return c.json(NOT_THIS_COMPANY, 404);
  const { data: lines, error: lErr } = await db.from('stock_adjustment_lines', CENTRALISED(
    'the company-scoped header read above is the gate; these are that document\'s own lines',
  )).select(LINE).eq('stock_adjustment_id', id).order('line_no');
  if (lErr) return c.json({ error: 'load_failed', reason: lErr.message }, 500);
  return c.json({ adjustment: { ...(header as Record<string, unknown>), lines } });
});

// ── Create + post ─────────────────────────────────────────────────────
inventoryAdjustments.post('/', async (c) => {
  const db = scmDb(c);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return refuseWithoutWriting(c, { error: 'invalid_json' }, 400); }

  const warehouseId = String(body.warehouseId ?? '');
  const raw = linesFromBody(body);
  if (!warehouseId || !raw) return refuseWithoutWriting(c, { error: 'warehouse_and_product_required' }, 400);
  const parsed = parseAdjustmentLines(raw);
  if (!parsed.ok) return refuseWithoutWriting(c, { error: parsed.error, message: parsed.message }, 400);
  const lines = parsed.lines;
  const incomplete = lines.find((l) => l.increase_errors.length > 0);
  if (incomplete) {
    return refuseWithoutWriting(c, { error: 'adjustment_incomplete', message: `${incomplete.item_code}: ${incomplete.increase_errors.join(' ')}` }, 422);
  }

  /* THE WAREHOUSE IS A BODY FIELD and this handler writes movements that open
     and consume lots. The lot reads below are company-scoped, so a foreign
     warehouse id would read as "no stock here" and an INCREASE would land goods
     in the other company's warehouse. See lib/ref-in-company.ts. */
  const co = requireActiveCompanyId(c);
  if (!co.ok) return refuseWithoutWriting(c, co.refusal, 409);
  const whCheck = await assertWarehouseInCompany(c.get('supabase'), warehouseId, co.companyId);
  if (!whCheck.ok) return refuseWithoutWriting(c, whCheck.body, whCheck.status);

  const deltas = bucketDeltas([], lines);
  let reads: LotReads;
  try {
    reads = await readLots(db, c, warehouseId, lines.map((l) => l.item_code));
  } catch (e) {
    return refuseWithoutWriting(c, { error: 'stock_check_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
  const short = shortages(reads, deltas);
  if (short.length) return refuseWithoutWriting(c, { error: 'insufficient_bucket', message: `Not enough stock — ${short.join('; ')}.` }, 422);

  const costs = new Map<number, number>();
  for (const l of lines) {
    if (l.qty < 0) continue;
    const sen = increaseCostSen(reads, l, l.unit_cost_sen ?? 0);
    if (sen == null) return refuseWithoutWriting(c, costRequired(l), 422);
    costs.set(l.line_no, sen);
  }

  /* Everything above is read-only, so refusing here leaves nothing changed. The
     audit row below cannot say that: it runs after stock has moved. */
  const pf = await assertAuditWritable(db.unscoped(AUDIT_CLIENT), { entityType: 'INVENTORY_ADJUSTMENT', action: 'CREATE', companyId: co.companyId });
  if (!pf.ok) return refuseWithoutWriting(c, auditUnavailableBody(), 409);

  const performedBy = await performerStaffId(c);
  const notes = String(body.notes ?? '').trim() || null;

  const { data: headerData, error: hErr } = await insertWithDocNoRetry<{ id: string; adjustment_no: string }>(
    () => nextAdjustmentNo(db, c),
    (adjustmentNo) => db.from('stock_adjustments', companyScope(c))
      .insert({ adjustment_no: adjustmentNo, warehouse_id: warehouseId, notes, created_by: performedBy })
      .select('id, adjustment_no').single(),
  );
  if (hErr || !headerData) return c.json({ error: 'insert_failed', reason: hErr?.message ?? 'no header' }, 500);
  const header = headerData as unknown as { id: string; adjustment_no: string };
  const dropHeader = () => db.from('stock_adjustments', CENTRALISED(
    'rollback of the header this handler inserted moments ago — a handler-minted id, not caller-supplied',
  )).delete().eq('id', header.id);
  /* A failure after the header insert, once the header is gone again (its lines
     cascade, the movements are one statement that failed whole), has left no
     document and moved no stock — so the Idempotency-Key is released and the
     retry goes through. Only the burned document number remains, which is a
     gap, not a duplicate. If the rollback itself failed the claim is kept. */
  const failAfterHeader = async (body: Record<string, unknown>) => {
    const { error: dErr } = await dropHeader();
    return dErr ? c.json({ ...body, rollbackFailed: dErr.message }, 500) : refuseWithoutWriting(c, body, 500);
  };

  const { error: lErr } = await db.from('stock_adjustment_lines', companyScope(c))
    .insert(lines.map((l) => lineRow(header.id, l, costs.get(l.line_no) ?? null)));
  if (lErr) return failAfterHeader({ error: 'lines_insert_failed', reason: lErr.message });

  /* ONE insert statement, so the FIFO trigger runs every line inside one
     transaction: a failure moves nothing at all. Found stock goes first so a
     write-off in the same bucket consumes lots that already exist. */
  const movements: MovementRow[] = [...lines]
    .sort((a, b) => Number(b.qty > 0) - Number(a.qty > 0))
    .map((l) => ({
      movement_type: 'ADJUSTMENT',
      warehouse_id: warehouseId,
      item_code: l.item_code,
      variant_key: l.variant_key,
      variants: l.variants,
      description2: l.description2,
      batch_no: l.batch_no,
      product_name: l.product_name,
      qty: l.qty,
      // A write-off's cost is stamped by the trigger from the lots it consumes.
      unit_cost_sen: l.qty > 0 ? costs.get(l.line_no) ?? 0 : 0,
      source_doc_type: 'ADJUSTMENT',
      source_doc_id: header.id,
      source_doc_no: header.adjustment_no,
      reason_code: l.reason_code,
      notes: l.notes,
      performed_by: performedBy,
    }));
  const { error: mErr } = await db.from('inventory_movements', companyScope(c)).insert(movements);
  if (mErr) return failAfterHeader({ error: 'insert_failed', reason: mErr.message });

  /* Oversell retro-cost (0154): found stock opens lots, so an earlier "ship
     anyway" DO that went out at RM0 here can now be costed. Best-effort — the
     movements are committed and must not be undone by a failed repair. */
  await reconcileUncostedAfterIn(c.get('supabase'), movements, performedBy);

  await recordEntityAudit(db.unscoped(AUDIT_CLIENT), {
    entityType: 'INVENTORY_ADJUSTMENT',
    entityId: header.id,
    entityDocNo: header.adjustment_no,
    action: 'CREATE',
    actor: c.get('houzsUser'),
    companyId: co.companyId,
    fieldChanges: compactChanges([
      fieldChange('warehouseId', null, warehouseId),
      fieldChange('lines', null, lineSummary(lines)),
      fieldChange('lineCount', null, lines.length),
      fieldChange('netQty', null, lines.reduce((s, l) => s + l.qty, 0)),
      fieldChange('notes', null, notes),
    ]),
  });

  /* Every stock-mutating path re-walks the SO allocation (audit 2026-06-10
     #12): a write-off must un-READY lines whose stock just vanished. */
  try { await recomputeSoStockAllocation(c.get('supabase')); } catch { /* best-effort */ }
  return c.json({ id: header.id, adjustmentNo: header.adjustment_no }, 201);
});

function lineRow(docId: string, l: AdjustmentLine, costSen: number | null) {
  return {
    stock_adjustment_id: docId,
    line_no: l.line_no,
    item_code: l.item_code,
    product_name: l.product_name,
    item_group: l.item_group,
    variants: l.variants,
    description2: l.description2,
    variant_key: l.variant_key,
    batch_no: l.batch_no,
    qty: l.qty,
    unit_cost_sen: costSen ?? l.unit_cost_sen,
    reason_code: l.reason_code,
    notes: l.notes,
  };
}

// ── Edit ──────────────────────────────────────────────────────────────
inventoryAdjustments.patch('/:id', async (c) => {
  const db = scmDb(c);
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_json' }, 400); }

  const hasNotes = Object.hasOwn(body, 'notes');
  const raw = Array.isArray(body.lines) ? body.lines : null;
  if (!hasNotes && !raw) return c.json({ error: 'nothing_to_update' }, 400);
  /* The version the editor opened. Required: without it two saves of the same
     version cannot be told apart, and each would post the same delta. */
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : '';
  if (!expectedUpdatedAt) return c.json({ error: 'expected_updated_at_required', message: 'Reload this adjustment and make your edit again.' }, 400);

  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);

  const { data: headerData, error: hErr } = await db.from('stock_adjustments', companyScope(c))
    .select(HEADER).eq('id', id).maybeSingle();
  if (hErr) return c.json({ error: 'load_failed', reason: hErr.message }, 500);
  if (!headerData) return c.json(NOT_THIS_COMPANY, 404);
  const header = headerData as unknown as { id: string; adjustment_no: string; warehouse_id: string; notes: string | null; updated_at: string };
  /* The version THIS request validated, kept as its own string at read time —
     the claim below compares against exactly what was checked here. */
  const readVersion = header.updated_at;
  // Cheap early answer; the conditional claim below is what actually decides.
  if (!sameInstant(readVersion, expectedUpdatedAt)) return c.json(STALE_DOCUMENT, 409);

  let lines: AdjustmentLine[] = [];
  let oldLines: Array<{ id: string; item_code: string; qty: number; reason_code: string | null; product_name: string | null; variants: Record<string, unknown> | null; description2: string | null }> = [];
  let deltas: BucketDelta[] = [];
  let moved: Array<{ item_code: string; variant_key: string | null; batch_no: string | null; qty: number; unit_cost_sen: number | null }> = [];
  const costs = new Map<string, number>();

  if (raw) {
    const parsed = parseAdjustmentLines(raw);
    if (!parsed.ok) return c.json({ error: parsed.error, message: parsed.message }, 400);
    lines = parsed.lines;

    const { data: ol, error: olErr } = await db.from('stock_adjustment_lines', CENTRALISED(
      'the company-scoped header read above is the gate; these are that document\'s own lines',
    )).select('id, item_code, qty, reason_code, product_name, variants, description2').eq('stock_adjustment_id', id).order('line_no');
    if (olErr) return c.json({ error: 'load_failed', reason: olErr.message }, 500);
    oldLines = ol as unknown as typeof oldLines;

    /* What the document has ALREADY moved is read from the ledger, not from
       its old lines: the movements are the truth about stock, and after an
       edit they are the only record of the net each bucket carries. */
    const { data: mv, error: mvErr } = await db.from('inventory_movements', companyScope(c))
      .select('item_code, variant_key, batch_no, qty, unit_cost_sen')
      .eq('source_doc_type', 'ADJUSTMENT')
      .eq('source_doc_id', id);
    if (mvErr) return c.json({ error: 'load_failed', reason: mvErr.message }, 500);
    moved = mv as unknown as typeof moved;

    deltas = bucketDeltas(moved, lines);
    const changed = new Set(deltas.map((d) => bucketKeyOf(d.bucket)));
    const incomplete = lines.find((l) => l.increase_errors.length > 0 && changed.has(bucketKeyOf(l)));
    if (incomplete) {
      return c.json({ error: 'adjustment_incomplete', message: `${incomplete.item_code}: ${incomplete.increase_errors.join(' ')}` }, 422);
    }
    let reads: LotReads;
    try {
      reads = await readLots(db, c, header.warehouse_id, deltas.map((d) => d.bucket.item_code));
    } catch (e) {
      return c.json({ error: 'stock_check_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
    }
    const short = shortages(reads, deltas);
    if (short.length) return c.json({ error: 'insufficient_stock', message: `Not enough stock — ${short.join('; ')}.` }, 409);
    for (const d of deltas) {
      if (d.delta < 0) continue;
      const k = bucketKeyOf(d.bucket);
      const typed = lines.find((l) => bucketKeyOf(l) === k && (l.unit_cost_sen ?? 0) > 0)?.unit_cost_sen ?? 0;
      const preferred = typed || writtenOffUnitCostSen(moved, k);
      const sen = increaseCostSen(reads, d.bucket, preferred);
      if (sen == null) return c.json(costRequired(d.bucket), 422);
      costs.set(k, sen);
    }
  }

  const pf = await assertAuditWritable(db.unscoped(AUDIT_CLIENT), { entityType: 'INVENTORY_ADJUSTMENT', entityId: id, action: 'UPDATE', companyId: co.companyId });
  if (!pf.ok) return c.json(auditUnavailableBody(), 409);

  const performedBy = await performerStaffId(c);
  const newNotes = hasNotes ? (String(body.notes ?? '').trim() || null) : header.notes;

  /* THE CLAIM — before any movement. Compare-and-set on the version the editor
     opened: of two saves of the same version exactly one gets the row back; the
     other moved nothing and is told to reload. The value is sent back exactly as
     the header read returned it, so PostgREST compares the same timestamp. */
  const { data: claimed, error: claimErr } = await db.from('stock_adjustments', companyScope(c))
    .update({ notes: newNotes, updated_at: new Date().toISOString() })
    .eq('id', id).eq('updated_at', readVersion)
    .select('id').maybeSingle();
  if (claimErr) return c.json({ error: 'update_failed', reason: claimErr.message }, 500);
  if (!claimed) return c.json(STALE_DOCUMENT, 409);

  const movements: MovementRow[] = deltas.map((d) => {
    const k = bucketKeyOf(d.bucket);
    const src = lines.find((l) => bucketKeyOf(l) === k);
    return {
      movement_type: 'ADJUSTMENT',
      warehouse_id: header.warehouse_id,
      item_code: d.bucket.item_code,
      variant_key: d.bucket.variant_key,
      variants: src?.variants ?? null,
      description2: src?.description2 ?? null,
      batch_no: d.bucket.batch_no,
      product_name: src?.product_name ?? oldLines.find((o) => o.item_code === d.bucket.item_code)?.product_name ?? null,
      qty: d.delta,
      unit_cost_sen: d.delta > 0 ? costs.get(k) ?? 0 : 0,
      source_doc_type: 'ADJUSTMENT',
      source_doc_id: header.id,
      source_doc_no: header.adjustment_no,
      reason_code: src?.reason_code ?? oldLines.find((o) => o.item_code === d.bucket.item_code)?.reason_code ?? null,
      notes: `Edited ${header.adjustment_no}: ${d.oldNet > 0 ? '+' : ''}${d.oldNet} -> ${d.newNet > 0 ? '+' : ''}${d.newNet}`,
      performed_by: performedBy,
    };
  });

  if (movements.length) {
    // One statement — every bucket's correction lands, or none does.
    const { error: mErr } = await db.from('inventory_movements', companyScope(c)).insert(movements);
    if (mErr) return c.json({ error: 'update_failed', reason: mErr.message }, 500);
  }

  if (raw) {
    /* New lines in BEFORE the old ones go, so a failure part-way leaves the
       document with too many lines (visible, fixable) rather than none. */
    const costFor = (l: AdjustmentLine) => (l.qty > 0 ? costs.get(bucketKeyOf(l)) ?? null : null);
    const { error: insErr } = await db.from('stock_adjustment_lines', companyScope(c))
      .insert(lines.map((l) => lineRow(id, l, costFor(l))));
    if (insErr) return c.json({ error: 'lines_replace_failed', reason: insErr.message, stockMoved: movements.length > 0 }, 500);
    if (oldLines.length) {
      const { error: delErr } = await db.from('stock_adjustment_lines', CENTRALISED(
        'deleting this document\'s previous lines by the ids read above, after the company-scoped header gate',
      )).delete().in('id', oldLines.map((o) => o.id));
      if (delErr) return c.json({ error: 'lines_replace_failed', reason: delErr.message, stockMoved: movements.length > 0 }, 500);
    }
  }

  if (movements.length) await reconcileUncostedAfterIn(c.get('supabase'), movements, performedBy);

  await recordEntityAudit(db.unscoped(AUDIT_CLIENT), {
    entityType: 'INVENTORY_ADJUSTMENT',
    entityId: id,
    entityDocNo: header.adjustment_no,
    action: 'UPDATE',
    actor: c.get('houzsUser'),
    companyId: co.companyId,
    note: movements.length
      ? `Stock corrected: ${deltas.map((d) => `${bucketLabel(d.bucket)} ${d.delta > 0 ? '+' : ''}${d.delta}`).join('; ')}`
      : undefined,
    fieldChanges: compactChanges([
      hasNotes ? fieldChange('notes', header.notes, newNotes) : null,
      ...(raw ? [
        fieldChange('lines', lineSummary(oldLines), lineSummary(lines)),
        fieldChange('lineCount', oldLines.length, lines.length),
        fieldChange('netQty', oldLines.reduce((s, l) => s + Number(l.qty), 0), lines.reduce((s, l) => s + l.qty, 0)),
      ] : []),
    ]),
  });

  if (movements.length) {
    try { await recomputeSoStockAllocation(c.get('supabase')); } catch { /* best-effort */ }
  }

  const { data: after } = await db.from('stock_adjustments', companyScope(c)).select(HEADER).eq('id', id).maybeSingle();
  return c.json({ adjustment: after, movedBuckets: movements.length });
});
