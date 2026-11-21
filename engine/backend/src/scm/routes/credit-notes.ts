// ----------------------------------------------------------------------------
// Credit and debit notes — /scm/credit-notes (owner 2026-09-05: CN/DN approved,
// sales CN + supplier CN first, DN second, prefixes CN / DN / SCN; 2026-09-12:
// 这个要做). Three documents on one table (migration 20260912T0100):
//   CN  — to a customer: Dr each line's account (RETURN INWARDS by default)
//         / Cr AR, party the customer.
//   DN  — to a customer: Dr AR, party the customer / Cr each line's account.
//   SCN — from a supplier: Dr the supplier's AP control / Cr each line's
//         account (PURCHASES RETURN by default).
// A note is DRAFT until posted; posting writes ONE journal through the engine,
// keyed (source_type = kind, source_doc_no = note number), so a second post
// echoes; cancel writes the contra. The customer comes from the sales order
// or the invoice the note answers (the same party code a payment carries —
// docs/bugs/0788, one customer one code), else the name typed.
//
// Numbering: {co}-CN-YYMM-NNN / {co}-DN-YYMM-NNN / {co}-SCN-YYMM-NNN — NEW
// series (flagged to the owner 2026-09-12).
//
// KNOCK-OFF (ported from Houzs ERP, like AutoCount / an AP Payment): a credit
// note's credit comes off the party's open invoices — an SCN off the
// supplier's purchase and AP invoices, a CN off the customer's sales invoices.
// GET /knock-off?supplierId= | ?so= | ?customer= and GET /:id/knock-off give
// the table, PUT /:id/allocations sets it whole (untick = give it back),
// POST /:id/allocations/:allocationId/remove gives one back. A draft carries
// its ticks as a plan (create and edit take `allocations` too) and the post
// carries it out; a cancel gives everything back. Nothing here posts: the
// note's own journal already moved the party's control
// (acc/credit-note-allocations.ts).
// ----------------------------------------------------------------------------

import { Hono, type Context } from 'hono';
import type { Env, Variables } from '../env';
import { hasHouzsPerm } from '../lib/houzs-perms';
import { companyDocPrefix, requireActiveCompanyId, scopeToCompany } from '../lib/companyScope';
import { dateOrNull } from '../lib/date-coerce';
import { todayMyt } from '../lib/my-time';
import { resolveRoles, type NoteParty } from '../../acc/rules';
import { customerPartyCode } from '../../acc/payments';
import {
  CREDIT_NOTE_HEADER as HEADER, CREDIT_NOTE_LINE as LINE, NOTE_KINDS as KINDS, NOTE_KIND_WORD as KIND_WORD,
  cancelCreditNote, insertCreditNote, postCreditNote, type NoteKind as Kind,
} from '../../acc/credit-notes';
import { requireLeafAccount } from './accounting-chart';
import { supabaseAuth } from '../middleware/auth';
import {
  appliedByNote, carryOutPlan, checkKnockOff, customerParty, depositPaperBlock, knockOffRows, moveNumbers, noteAllocations,
  noteApplications, parseTargets, partyOfNote, removeAllocation, setNoteKnockOff, supplierParty, writePlan,
  type CreditParty, type CreditTarget, type KnockOffMove,
} from '../../acc/credit-note-allocations';
import { depositPapers } from '../../acc/credit-note-si';
import { assertAuditWritable, auditUnavailableBody, compactChanges, fieldChange, recordEntityAudit, statusChange, type AuditAction } from '../lib/entity-audit';
import { fmtSen } from '../shared/format';

type Row = Record<string, any>;
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
const NO_PERM = (what: string) => ({ error: `You don't have permission to ${what}.` });
/* The document itself — number, header, lines, journal, contra — is
   acc/credit-notes.ts (docs/bugs/0831): the deposit-invoice close-out raises
   a note from inside the posting path with no request to hand, so the core
   may not live here. This file keeps the caller's half: permissions, the
   party lookup, the leaf check on a typed account, the draft edit. */

type CleanLine = { description: string | null; code: string | null; amountSen: number };

function buildLines(raw: unknown): { lines: CleanLine[]; total: number } | { error: string; message: string } {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length === 0 || arr.length > 50) return { error: 'lines_required', message: 'A note takes 1 to 50 lines.' };
  const lines: CleanLine[] = [];
  for (const [i, l] of arr.entries()) {
    const code = String(l?.accountCode ?? '').trim() || null;
    const amount = Number(l?.amountSen);
    if (!Number.isInteger(amount) || amount <= 0) {
      return { error: 'bad_line', message: `Line ${i + 1}: amountSen must be a positive integer (got ${String(l?.amountSen)}).` };
    }
    lines.push({ description: l?.description ? String(l.description).trim() : null, code, amountSen: amount });
  }
  return { lines, total: lines.reduce((s, l) => s + l.amountSen, 0) };
}

/* Read loosely: a caller the bridge did not resolve has neither, and the note records '' rather than throwing. */
const who = (c: Ctx): string => {
  const caller = c.get('houzsUser') as { name?: string | null } | undefined;
  const user = c.get('user') as { id?: string } | undefined;
  return String(caller?.name ?? user?.id ?? '');
};

/* A knock-off given back or changed moves what an invoice owes. The pre-flight
   runs before the first write (entity-audit.ts); the row records each
   document's applied amount from -> to, in sen, labelled by its number. */
const knockOffAuditRefusal = async (c: Ctx, companyId: number, note: any, action: AuditAction): Promise<Response | null> => {
  const pf = await assertAuditWritable(c.get('supabase'), { entityType: 'CREDIT_NOTE', entityId: String(note.id), action, companyId });
  return pf.ok ? null : c.json(auditUnavailableBody(), 409);
};

const recordKnockOffAudit = async (
  c: Ctx, companyId: number, note: any, action: AuditAction, moves: KnockOffMove[], extra: { status?: { from: string; to: string }; note?: string } = {},
): Promise<void> => {
  const sb = c.get('supabase');
  const numbers = moves.length > 0 ? await moveNumbers(sb, companyId, moves) : new Map<string, string>();
  const changes = [
    ...(extra.status ? statusChange(extra.status.from, extra.status.to) : []),
    ...compactChanges(moves.map((m) => fieldChange(`appliedSen:${numbers.get(m.id) ?? m.id}`, m.fromSen, m.toSen))),
  ];
  if (changes.length === 0) return;
  await recordEntityAudit(sb, {
    entityType: 'CREDIT_NOTE', entityId: String(note.id), entityDocNo: String(note.note_number ?? ''), action,
    actor: c.get('houzsUser'), companyId, fieldChanges: changes, statusSnapshot: extra.status?.to ?? note.status ?? null,
    ...(extra.note ? { note: extra.note } : {}),
  });
};

async function loadNote(c: Ctx, id: string): Promise<{ note: Row } | { resp: Response }> {
  const sb = c.get('supabase');
  const { data, error } = await scopeToCompany(sb.from('acc_credit_notes').select(HEADER).eq('id', id), c).maybeSingle();
  if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
  if (!data) return { resp: c.json({ error: 'not_found', message: 'That note is not in the company you are working in.' }, 404) };
  return { note: data as Row };
}

async function loadSupplier(c: Ctx, supplierId: string): Promise<{ supplier: { id: string; code: string | null; name: string | null } } | { resp: Response }> {
  const sb = c.get('supabase');
  const { data, error } = await scopeToCompany(sb.from('suppliers').select('id, code, name').eq('id', supplierId), c).maybeSingle();
  if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
  if (!data) return { resp: c.json({ error: 'supplier_unknown', message: 'That supplier is not in the company you are working in.' }, 400) };
  return { supplier: data as { id: string; code: string | null; name: string | null } };
}

/* WHO THE CUSTOMER IS. The sales order first (2990's every order carries a
   customer_id; the party code is the one a payment on it carries), the sales
   invoice next, the typed name last — a note must name somebody. */
async function resolveCustomer(c: Ctx, body: any): Promise<
  | { party: NoteParty; soDocNo: string | null; salesInvoiceId: string | null }
  | { resp: Response }
> {
  const sb = c.get('supabase');
  const soDocNo = String(body.soDocNo ?? '').trim() || null;
  const salesInvoiceId = String(body.salesInvoiceId ?? '').trim() || null;
  if (soDocNo) {
    const { data, error } = await scopeToCompany(sb.from('mfg_sales_orders').select('doc_no, debtor_code, debtor_name, customer_id').eq('doc_no', soDocNo), c).maybeSingle();
    if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
    if (!data) return { resp: c.json({ error: 'so_unknown', message: `${soDocNo} is not a sales order of the company you are working in.` }, 400) };
    const so = data as { doc_no: string; debtor_code: string | null; debtor_name: string | null; customer_id: string | null };
    return { party: { code: customerPartyCode(so.debtor_code, so.customer_id), name: so.debtor_name ?? null }, soDocNo: so.doc_no, salesInvoiceId };
  }
  if (salesInvoiceId) {
    const { data, error } = await scopeToCompany(sb.from('sales_invoices').select('id, invoice_number, so_doc_no, debtor_code, debtor_name').eq('id', salesInvoiceId), c).maybeSingle();
    if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
    if (!data) return { resp: c.json({ error: 'si_unknown', message: 'That sales invoice is not in the company you are working in.' }, 400) };
    const si = data as { id: string; so_doc_no: string | null; debtor_code: string | null; debtor_name: string | null };
    return { party: { code: si.debtor_code ?? null, name: si.debtor_name ?? null }, soDocNo: si.so_doc_no ?? null, salesInvoiceId: si.id };
  }
  const name = String(body.partyName ?? '').trim();
  if (!name) return { resp: c.json({ error: 'party_required', message: 'Name the customer — the sales order, the invoice, or the name itself.' }, 400) };
  return { party: { code: String(body.partyCode ?? '').trim() || null, name }, soDocNo: null, salesInvoiceId: null };
}

/** The final invoice's number for a note that answers one (docs/bugs/0834):
    the print says which invoice a close-out note follows, and the row carries
    only the id. Read once per list, the way the deposit-invoice page reads
    its note numbers. */
async function withInvoiceNumbers(c: Ctx, rows: Row[]): Promise<{ rows: Row[] } | { resp: Response }> {
  const ids = [...new Set(rows.map((r) => r.sales_invoice_id).filter((x): x is string => typeof x === 'string' && x !== ''))];
  const numberOf = new Map<string, string>();
  if (ids.length > 0) {
    const co = requireActiveCompanyId(c);
    if (!co.ok) return { resp: c.json(co.refusal, 409) };
    const { data, error } = await c.get('supabase').from('sales_invoices').select('id, invoice_number').eq('company_id', co.companyId).in('id', ids);
    if (error) return { resp: c.json({ error: 'load_failed', reason: error.message }, 500) };
    for (const s of (Array.isArray(data) ? data : []) as Array<{ id: string; invoice_number: string }>) numberOf.set(String(s.id), String(s.invoice_number));
  }
  return { rows: rows.map((r) => ({ ...r, sales_invoice_number: typeof r.sales_invoice_id === 'string' ? numberOf.get(r.sales_invoice_id) ?? null : null })) };
}

export const listCreditNotesHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const kind = String(c.req.query('kind') ?? '').trim().toUpperCase();
  const status = String(c.req.query('status') ?? '').trim().toUpperCase();
  const sb = c.get('supabase');
  let q = sb.from('acc_credit_notes').select(HEADER).eq('company_id', co.companyId);
  if (KINDS.has(kind)) q = q.eq('kind', kind);
  if (status === 'DRAFT' || status === 'POSTED' || status === 'CANCELLED') q = q.eq('status', status);
  const { data, error } = await q.order('note_date', { ascending: false }).order('note_number', { ascending: false }).limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const numbered = await withInvoiceNumbers(c, (Array.isArray(data) ? data : []) as Row[]);
  if ('resp' in numbered) return numbered.resp;
  /* A posted credit note's use: what its knock-offs took, and the credit left. */
  const credited = numbered.rows.filter((r) => (r.kind === 'SCN' || r.kind === 'CN') && r.status === 'POSTED');
  if (credited.length > 0) {
    const used = await appliedByNote(sb, co.companyId, credited.map((r) => String(r.id)));
    if (!used.ok) return c.json({ error: 'load_failed', reason: used.reason }, 500);
    for (const r of credited) {
      const applied = used.byNote.get(String(r.id)) ?? 0;
      r.appliedSen = applied;
      r.unusedSen = Math.max(0, Number(r.total_sen ?? 0) - applied);
    }
  }
  /* A customer note that answers a deposit invoice knocks off nothing — its
     credit is not the customer's (acc/credit-note-si.ts). */
  const customerNotes = numbered.rows.filter((r) => r.kind === 'CN');
  if (customerNotes.length > 0) {
    const papers = await depositPapers(sb, co.companyId, customerNotes);
    if (!papers.ok) return c.json({ error: 'load_failed', reason: papers.reason }, 500);
    for (const r of customerNotes) {
      const paper = papers.value.get(String(r.id));
      r.depositPaper = paper?.kind ?? null;
      if (paper && r.unusedSen !== undefined) r.unusedSen = 0;
    }
  }
  return c.json({ rows: numbered.rows });
};

export const creditNoteDetailHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  const sb = c.get('supabase');
  const { data: lines, error } = await scopeToCompany(sb.from('acc_credit_note_lines').select(LINE).eq('note_id', found.note.id), c).order('line_no');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const numbered = await withInvoiceNumbers(c, [found.note as unknown as Row]);
  if ('resp' in numbered) return numbered.resp;
  /* A credit note's applications and the credit it has left. */
  let credit: Row = {};
  if (found.note.kind === 'SCN' || found.note.kind === 'CN') {
    const al = await noteAllocations(sb, co.companyId, found.note);
    if (!al.ok) return c.json({ error: 'load_failed', reason: al.reason }, 500);
    credit = { allocations: al.allocations, appliedSen: al.appliedSen, leftSen: al.leftSen };
  }
  /* A customer note answering a deposit invoice says what it answers and leaves no credit on the customer. */
  if (found.note.kind === 'CN') {
    const papers = await depositPapers(sb, co.companyId, [found.note]);
    if (!papers.ok) return c.json({ error: 'load_failed', reason: papers.reason }, 500);
    const paper = papers.value.get(String(found.note.id)) ?? null;
    credit.depositPaper = paper;
    if (paper) credit.leftSen = 0;
  }
  return c.json({ note: numbered.rows[0], lines: (Array.isArray(lines) ? lines : []) as Row[], ...credit });
};

export const createCreditNoteHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create') && !hasHouzsPerm(c, 'scm.payment_voucher.write')) {
    return c.json(NO_PERM('raise a credit or debit note'), 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const kind = String(body.kind ?? '').trim().toUpperCase();
  if (!KINDS.has(kind)) return c.json({ error: 'kind_required', message: 'Say which note this is: CN (to a customer), DN (to a customer) or SCN (from a supplier).' }, 400);
  const built = buildLines(body.lines);
  if ('error' in built) return c.json({ error: built.error, message: built.message }, 400);
  const noteDate = dateOrNull(body.noteDate) ?? todayMyt();
  const sb = c.get('supabase');
  const roles = await resolveRoles(sb, co.companyId);

  /* The party, by kind. */
  let party: NoteParty;
  let supplierId: string | null = null;
  let soDocNo: string | null = null;
  let salesInvoiceId: string | null = null;
  if (kind === 'SCN') {
    const supplierIdRaw = String(body.supplierId ?? '').trim();
    if (!supplierIdRaw) return c.json({ error: 'supplier_required', message: 'Pick the supplier this credit note is from.' }, 400);
    const sup = await loadSupplier(c, supplierIdRaw);
    if ('resp' in sup) return sup.resp;
    party = { code: sup.supplier.code, name: sup.supplier.name };
    supplierId = sup.supplier.id;
  } else {
    const cust = await resolveCustomer(c, body);
    if ('resp' in cust) return cust.resp;
    party = cust.party; soDocNo = cust.soDocNo; salesInvoiceId = cust.salesInvoiceId;
  }

  /* A line with no account lands on the kind's default (the owner's own
     RETURN INWARDS / PURCHASES RETURN); every line must be a leaf and never a
     control (父户不记账, 由模块过账). */
  const fallback = kind === 'SCN' ? roles.PURCHASE_RETURNS : roles.SALES_RETURNS;
  const lines = built.lines.map((l) => ({ ...l, code: l.code ?? fallback }));
  for (const code of [...new Set(lines.map((l) => l.code))]) {
    const leafErr = await requireLeafAccount(c, co.companyId, code);
    if (leafErr) return leafErr;
  }

  /* The knock-off — the ticks, carried by the draft as its plan and carried
     out by the post. A supplier note that names its invoice but brings no
     ticks plans the credit off that invoice, as much as it owes. Checked
     before anything is written. */
  const apInvoiceId = String(body.apInvoiceId ?? '').trim() || null;
  const purchaseInvoiceId = String(body.purchaseInvoiceId ?? '').trim() || null;
  let plan: CreditTarget[] = [];
  if (body.allocations !== undefined && kind === 'DN' && parseTargets(body.allocations).length > 0) {
    return c.json({ error: 'invoice_not_this_kind', message: 'A debit note knocks nothing off.' }, 400);
  }
  if (kind === 'CN' && body.allocations !== undefined) {
    plan = parseTargets(body.allocations);
    if (plan.some((t) => t.kind !== 'SI')) {
      return c.json({ error: 'invoice_not_this_kind', message: "A customer's credit note knocks off the customer's sales invoices." }, 400);
    }
    const checked = await checkKnockOff(sb, { companyId: co.companyId, label: 'This note', party: customerParty({ code: party.code, name: party.name }), totalSen: built.total, posted: false, targets: plan, current: new Map() });
    if (!checked.ok) return c.json({ error: checked.refusal.error, message: checked.refusal.message }, checked.refusal.status);
  }
  if (kind === 'SCN' && supplierId) {
    if (body.allocations !== undefined) {
      plan = parseTargets(body.allocations);
    } else {
      const namedId = purchaseInvoiceId ?? apInvoiceId;
      const namedKind = purchaseInvoiceId ? 'PI' as const : 'API' as const;
      if (namedId) {
        const { data: doc, error: docErr } = await sb.from(namedKind === 'PI' ? 'purchase_invoices' : 'ap_invoices')
          .select('total_sen, paid_sen, status, supplier_id').eq('company_id', co.companyId).eq('id', namedId).maybeSingle();
        if (docErr) return c.json({ error: 'load_failed', reason: docErr.message }, 500);
        const d = doc as Row | null;
        const owed = d && String(d.supplier_id) === supplierId && (d.status === 'POSTED' || d.status === 'PARTIALLY_PAID') ? Number(d.total_sen ?? 0) - Number(d.paid_sen ?? 0) : 0;
        const amount = Math.min(built.total, owed);
        if (amount > 0) plan = [{ kind: namedKind, id: namedId, amountSen: amount }];
      }
    }
    const checked = await checkKnockOff(sb, { companyId: co.companyId, label: 'This note', party: supplierParty(supplierId), totalSen: built.total, posted: false, targets: plan, current: new Map() });
    if (!checked.ok) return c.json({ error: checked.refusal.error, message: checked.refusal.message }, checked.refusal.status);
  }

  const raised = await insertCreditNote(sb, {
    companyId: co.companyId,
    docPrefix: companyDocPrefix(c),
    kind: kind as Kind,
    party,
    supplierId,
    soDocNo,
    salesInvoiceId,
    apInvoiceId,
    purchaseInvoiceId,
    sourceDocNo: String(body.sourceDocNo ?? '').trim() || null,
    noteDate,
    reason: String(body.reason ?? '').trim() || null,
    notes: String(body.notes ?? '').trim() || null,
    lines: lines.map((l) => ({ description: l.description, code: l.code, amountSen: l.amountSen })),
    createdBy: who(c),
  });
  if (!raised.ok) return c.json({ error: 'save_failed', reason: raised.reason }, 500);
  if (plan.length > 0) {
    /* The note stands either way — a second Save would raise it twice. */
    const written = await writePlan(sb, { companyId: co.companyId, noteId: String(raised.note.id), targets: plan, actor: who(c) });
    if (!written.ok) {
      return c.json({ ok: true, note: raised.note, knockOffFailed: `${raised.note.note_number} is saved, but its knock-off is not (${written.reason}) — open it and tick again.` }, 201);
    }
  }
  return c.json({ ok: true, note: raised.note }, 201);
};

/* A DRAFT changes; a posted note is cancelled and raised again — the ledger
   keeps the trail. */
export const updateCreditNoteHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create') && !hasHouzsPerm(c, 'scm.payment_voucher.write')) {
    return c.json(NO_PERM('edit a credit or debit note'), 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  const note = found.note;
  if (note.status !== 'DRAFT') {
    return c.json({ error: 'not_editable', message: `${note.note_number} is ${String(note.status).toLowerCase()} — cancel it and raise it again.` }, 409);
  }
  const sb = c.get('supabase');
  const roles = await resolveRoles(sb, co.companyId);
  /* The lines are checked first — the knock-off below is held against their total. */
  const builtNew = body.lines !== undefined ? buildLines(body.lines) : null;
  if (builtNew && 'error' in builtNew) return c.json({ error: builtNew.error, message: builtNew.message }, 400);
  const newTotal = builtNew ? builtNew.total : Number(note.total_sen ?? 0);
  /* A draft's knock-off plan: replaced when the body brings ticks; a new total
     below what is planned is refused, never trimmed — the ticks are Finance's. */
  let plan: CreditTarget[] | null = null;
  const party: CreditParty | null = partyOfNote(note);
  if (body.allocations !== undefined) {
    if (!party) return c.json({ error: 'invoice_not_this_kind', message: 'A debit note knocks nothing off.' }, 400);
    plan = parseTargets(body.allocations);
    if (plan.length > 0) {
      const paper = await depositPaperBlock(sb, co.companyId, note);
      if (!paper.ok) return c.json({ error: 'load_failed', reason: paper.reason }, 500);
      if (paper.refusal) return c.json({ error: paper.refusal.error, message: paper.refusal.message }, 409);
    }
    const checked = await checkKnockOff(sb, {
      companyId: co.companyId, label: String(note.note_number), party, totalSen: newTotal, posted: false, targets: plan, current: new Map(),
    });
    if (!checked.ok) return c.json({ error: checked.refusal.error, message: checked.refusal.message }, checked.refusal.status);
  } else if (party && builtNew) {
    const al = await noteAllocations(sb, co.companyId, note);
    if (!al.ok) return c.json({ error: 'load_failed', reason: al.reason }, 500);
    const planned = al.allocations.reduce((s, a) => s + a.amountSen, 0);
    if (planned > newTotal) {
      return c.json({ error: 'over_credit', message: `The knock-off planned (${fmtSen(planned)}) is more than the note's new total (${fmtSen(newTotal)}) — untick some first.` }, 409);
    }
  }
  const patch: Row = { updated_at: new Date().toISOString() };
  if (body.noteDate !== undefined) patch.note_date = dateOrNull(body.noteDate) ?? note.note_date;
  if (body.reason !== undefined) patch.reason = String(body.reason ?? '').trim() || null;
  if (body.notes !== undefined) patch.notes = String(body.notes ?? '').trim() || null;
  if (body.sourceDocNo !== undefined) patch.source_doc_no = String(body.sourceDocNo ?? '').trim() || null;
  if (body.lines !== undefined) {
    const built = buildLines(body.lines);
    if ('error' in built) return c.json({ error: built.error, message: built.message }, 400);
    const fallback = note.kind === 'SCN' ? roles.PURCHASE_RETURNS : roles.SALES_RETURNS;
    const lines = built.lines.map((l) => ({ ...l, code: l.code ?? fallback }));
    for (const code of [...new Set(lines.map((l) => l.code))]) {
      const leafErr = await requireLeafAccount(c, co.companyId, code);
      if (leafErr) return leafErr;
    }
    const { error: delErr } = await sb.from('acc_credit_note_lines').delete().eq('company_id', co.companyId).eq('note_id', note.id);
    if (delErr) return c.json({ error: 'save_failed', reason: delErr.message }, 500);
    const { error: insErr } = await sb.from('acc_credit_note_lines').insert(lines.map((l, i) => ({
      company_id: co.companyId, note_id: note.id, line_no: i + 1, description: l.description, account_code: l.code, amount_sen: l.amountSen,
    })));
    if (insErr) return c.json({ error: 'save_failed', reason: insErr.message }, 500);
    patch.total_sen = built.total;
  }
  const { data: saved, error: upErr } = await sb.from('acc_credit_notes').update(patch).eq('company_id', co.companyId).eq('id', note.id).select(HEADER).single();
  if (upErr) return c.json({ error: 'save_failed', reason: upErr.message }, 500);
  if (plan) {
    const written = await writePlan(sb, { companyId: co.companyId, noteId: String(note.id), targets: plan, actor: who(c) });
    if (!written.ok) return c.json({ error: 'save_failed', reason: written.reason }, 500);
  }
  return c.json({ ok: true, note: saved });
};

export const postCreditNoteHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) return c.json(NO_PERM('post to the general ledger'), 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  const note = found.note;
  if (note.status === 'CANCELLED') return c.json({ error: 'cancelled', message: `${note.note_number} is cancelled.` }, 409);
  const posted = await postCreditNote(c.get('supabase'), { companyId: co.companyId, note, actor: who(c) });
  if (!posted.ok) {
    if (posted.status === 'lines_required') return c.json({ error: 'lines_required', message: posted.reason }, 400);
    if (posted.status === 'customer_no_account') return c.json({ error: 'customer_no_account', message: posted.reason }, 409);
    if (posted.status === 'load_failed' || posted.status === 'save_failed') return c.json({ error: posted.status, reason: posted.reason }, 500);
    return c.json({ error: 'post_failed', status: posted.status, reason: posted.reason }, 500);
  }
  /* The draft's knock-off carried out: each planned invoice takes its credit
     now — as much as it still owes; what it cannot take stays with the
     supplier, or as credit on the customer. The post stands whatever this says. */
  if ((note.kind !== 'SCN' && note.kind !== 'CN') || posted.status !== 'posted') return c.json({ ok: true, jeNo: posted.jeNo, status: posted.status });
  const done = await carryOutPlan(c.get('supabase'), { companyId: co.companyId, note: { ...note, status: 'POSTED' } });
  if (!done.ok) {
    return c.json({ ok: true, jeNo: posted.jeNo, status: posted.status, applied: [], notApplied: `The knock-off did not run (${done.reason}) — open the note and save its ticks again.` });
  }
  return c.json({
    ok: true, jeNo: posted.jeNo, status: posted.status,
    ...(done.applied.length > 0 ? { applied: done.applied } : {}),
    ...(done.notApplied.length > 0 ? { notApplied: done.notApplied.join(' ') } : {}),
  });
};

/* ── Knock off like an AP Payment ────────────────────────────────────────── */

/** GET /knock-off?supplierId= | ?so= | ?customer= — a new note's table: the
    supplier's invoices still owing, or the customer's sales invoices — the
    customer the note will carry: the sales order's (?so=), else the name typed
    (?customer=). */
export const partyKnockOffHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const supplierId = String(c.req.query('supplierId') ?? '').trim();
  const so = String(c.req.query('so') ?? '').trim();
  const customer = String(c.req.query('customer') ?? '').trim();
  let party: CreditParty;
  if (supplierId) {
    const sup = await loadSupplier(c, supplierId);
    if ('resp' in sup) return sup.resp;
    party = supplierParty(sup.supplier.id);
  } else if (so || customer) {
    const found = await resolveCustomer(c, so ? { soDocNo: so } : { partyName: customer });
    if ('resp' in found) return found.resp;
    party = customerParty({ code: found.party.code, name: found.party.name });
  } else {
    return c.json({ rows: [] });
  }
  const rows = await knockOffRows(c.get('supabase'), co.companyId, { party, note: null });
  if (!rows.ok) return c.json({ error: 'load_failed', reason: rows.reason }, 500);
  return c.json({ rows: rows.rows });
};

/** GET /:id/knock-off — the note's table: what it takes from each invoice, and the credit left. */
export const creditNoteKnockOffHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  const note = found.note;
  const totalSen = Number(note.total_sen ?? 0);
  const posted = note.status === 'POSTED';
  const party = partyOfNote(note);
  if (!party || note.status === 'CANCELLED') return c.json({ rows: [], totalSen, takenSen: 0, leftSen: party ? 0 : totalSen, posted });
  /* A note answering a deposit invoice has no credit on the customer to knock off — it says why. */
  const paper = await depositPaperBlock(c.get('supabase'), co.companyId, note);
  if (!paper.ok) return c.json({ error: 'load_failed', reason: paper.reason }, 500);
  if (paper.refusal) return c.json({ rows: [], totalSen, takenSen: 0, leftSen: 0, posted, refusal: paper.refusal.message });
  const rows = await knockOffRows(c.get('supabase'), co.companyId, { party, note });
  if (!rows.ok) return c.json({ error: 'load_failed', reason: rows.reason }, 500);
  const takenSen = rows.rows.reduce((s, r) => s + r.noteSen, 0);
  return c.json({ rows: rows.rows, totalSen, takenSen, leftSen: Math.max(0, totalSen - takenSen), posted });
};

/** PUT /:id/allocations { targets: [{ kind, id, amountSen }] } — the knock-off
    set whole: a draft's plan (the editor's keys), a posted note's knock-off
    carried out at once (the poster's key) — untick = give it back. */
export const setCreditNoteAllocationsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  const note = found.note;
  const may = note.status === 'POSTED'
    ? hasHouzsPerm(c, 'scm.payment_voucher.post')
    : hasHouzsPerm(c, 'scm.payment_voucher.create') || hasHouzsPerm(c, 'scm.payment_voucher.write');
  if (!may) return c.json(NO_PERM(note.kind === 'CN' ? "knock off a customer's invoice" : "knock off a supplier's invoice"), 403);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (note.status === 'POSTED') {
    const refused = await knockOffAuditRefusal(c, co.companyId, note, 'UPDATE');
    if (refused) return refused;
  }
  const set = await setNoteKnockOff(c.get('supabase'), { companyId: co.companyId, note, targets: parseTargets(body?.targets), actor: who(c) });
  await recordKnockOffAudit(c, co.companyId, note, 'UPDATE', set.moved ?? [], set.ok ? {} : { note: `Stopped part-way: ${set.refusal.message}` });
  if (!set.ok) return c.json({ error: set.refusal.error, message: set.refusal.message }, set.refusal.status);
  return c.json({ ok: true, short: set.short });
};

/** POST /:id/allocations/:allocationId/remove — the credit given back to the note; the invoice owes it again. */
export const removeCreditNoteAllocationHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) return c.json(NO_PERM('give a credit back'), 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  if (found.note.status !== 'POSTED') return c.json({ error: 'note_not_posted', message: `${found.note.note_number} is ${String(found.note.status).toLowerCase()}.` }, 409);
  const refused = await knockOffAuditRefusal(c, co.companyId, found.note, 'UPDATE');
  if (refused) return refused;
  const back = await removeAllocation(c.get('supabase'), { companyId: co.companyId, note: found.note, allocationId: (c.req.param('allocationId') ?? '') });
  if (!back.ok) return c.json({ error: back.refusal.error, message: back.refusal.message }, back.refusal.status);
  await recordKnockOffAudit(c, co.companyId, found.note, 'UPDATE', [back.moved]);
  return c.json({ ok: true });
};

export const cancelCreditNoteHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.cancel')) return c.json(NO_PERM('cancel a credit or debit note'), 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const found = await loadNote(c, (c.req.param('id') ?? ''));
  if ('resp' in found) return found.resp;
  const note = found.note;
  if (note.status === 'CANCELLED') return c.json({ ok: true, already: true });
  const refused = await knockOffAuditRefusal(c, co.companyId, note, 'CANCEL');
  if (refused) return refused;
  const statusBefore = String(note.status);
  const applied = await noteApplications(c.get('supabase'), co.companyId, String(note.id));
  if (!applied.ok) return c.json({ error: 'load_failed', reason: applied.reason }, 500);
  const cancelled = await cancelCreditNote(c.get('supabase'), { companyId: co.companyId, note, actor: who(c) });
  if (!cancelled.ok) {
    if (cancelled.status === 'save_failed') return c.json({ error: 'save_failed', reason: cancelled.reason }, 500);
    if (cancelled.status === 'settle_failed' || cancelled.status === 'load_failed') return c.json({ error: cancelled.status, message: cancelled.reason }, 500);
    return c.json({ error: 'reverse_failed', status: cancelled.status, reason: cancelled.reason }, 500);
  }
  if (cancelled.status === 'cancelled') await recordKnockOffAudit(c, co.companyId, note, 'CANCEL', applied.moves, { status: { from: statusBefore, to: 'CANCELLED' } });
  return c.json({ ok: true });
};

export const creditNotes = new Hono();
/* EVERY SCM router carries the bridge (docs/bugs/0648): it turns the JWT into
   the real caller as houzsUser — what hasHouzsPerm reads — and hands out the
   scoped client. */
creditNotes.use('*', supabaseAuth);
creditNotes.get('/', listCreditNotesHandler);
creditNotes.post('/', createCreditNoteHandler);
creditNotes.get('/knock-off', partyKnockOffHandler);
creditNotes.get('/:id', creditNoteDetailHandler);
creditNotes.patch('/:id', updateCreditNoteHandler);
creditNotes.post('/:id/post', postCreditNoteHandler);
creditNotes.post('/:id/cancel', cancelCreditNoteHandler);
creditNotes.get('/:id/knock-off', creditNoteKnockOffHandler);
creditNotes.put('/:id/allocations', setCreditNoteAllocationsHandler);
creditNotes.post('/:id/allocations/:allocationId/remove', removeCreditNoteAllocationHandler);
