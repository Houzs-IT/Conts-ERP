/** Maker-checker for money leaving the company (owner, 10 Oct 2026; migration 0096).
 *
 *  A guest refund, an owner payout run, an owner credit or charge, an expense above Settings > Approvals' threshold
 *  and writing off a held owner debt are staged as a request instead of being carried out. A second person approves
 *  it, and approving runs the staged action and records the decision in one transaction, audited. Rejecting or
 *  cancelling changes nothing but the request.
 *
 *  Who may decide: management, any amount; finance_admin, amounts below approvals.financeAdminLimit. Never the person
 *  who asked, with one exception so a small team is not stuck: while there is exactly one active management user,
 *  that user may approve their own request with a written reason, and the approval is recorded and audited as
 *  self-approved. */
import { type Env, all, one, run, audit, nowIso, transaction } from './db';
import type { Session } from './auth';
import { insertPayment } from './bookingPayments';
import { isPeriodLocked } from './expenses';

export const APPROVAL_KINDS = ['guest_refund', 'payout_run', 'owner_adjustment', 'expense', 'debt_write_off'] as const;
export type ApprovalKind = typeof APPROVAL_KINDS[number];
export const KIND_LABEL: Record<ApprovalKind, string> = {
  guest_refund: 'Guest refund', payout_run: 'Payout run', owner_adjustment: 'Owner credit or charge', expense: 'Expense', debt_write_off: 'Debt write-off',
};
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** A refusal the screen can show as it is. Thrown by an executor to roll the approval back. */
export class ApprovalRefused extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface ApprovalSettings { expenseThreshold: number; financeAdminLimit: number }
/** Defaults (sen) for a database where nobody has saved Settings > Approvals yet; the same in settings/index.ts. */
export const APPROVAL_DEFAULTS: ApprovalSettings = { expenseThreshold: 50000, financeAdminLimit: 200000 };

export async function approvalSettings(env: Env): Promise<ApprovalSettings> {
  const rows = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key IN ('approvals.expenseThreshold','approvals.financeAdminLimit')`);
  const m = new Map(rows.map(r => [r.key, Number(r.value)]));
  const pick = (k: string, d: number) => { const v = m.get(k); return v !== undefined && Number.isFinite(v) && v >= 0 ? v : d; };
  return { expenseThreshold: pick('approvals.expenseThreshold', APPROVAL_DEFAULTS.expenseThreshold), financeAdminLimit: pick('approvals.financeAdminLimit', APPROVAL_DEFAULTS.financeAdminLimit) };
}

/* ------------------------------------------------------------------ */
/* Who may decide                                                      */
/* ------------------------------------------------------------------ */

export interface DecideContext { settings: ApprovalSettings; managementCount: number }

export async function decideContext(env: Env): Promise<DecideContext> {
  const [settings, m] = await Promise.all([
    approvalSettings(env),
    one<{ n: number }>(env, `SELECT COUNT(*)::int AS n FROM users WHERE role = 'management' AND is_active = 1`),
  ]);
  return { settings, managementCount: Number(m?.n ?? 0) };
}

interface RequestLike { requested_by: string; amount: number; status: string }

/** Null when this person may approve or reject the request, else the reason in words. `self` is true when it is
 *  the single-management self-approval, which needs a written note. */
export function decisionRule(session: Pick<Session, 'userId' | 'role'>, r: RequestLike, ctx: DecideContext): { refusal: string | null; self: boolean } {
  if (r.status !== 'pending') return { refusal: 'This request has already been decided.', self: false };
  const own = r.requested_by === session.userId;
  if (session.role === 'management') {
    if (!own) return { refusal: null, self: false };
    return ctx.managementCount === 1
      ? { refusal: null, self: true }
      : { refusal: 'You asked for this, so someone else must approve it.', self: false };
  }
  if (session.role === 'finance_admin') {
    if (own) return { refusal: 'You asked for this, so someone else must approve it.', self: false };
    if (Number(r.amount) < ctx.settings.financeAdminLimit) return { refusal: null, self: false };
    return { refusal: `Finance admins approve amounts below RM ${(ctx.settings.financeAdminLimit / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}. Management must approve this one.`, self: false };
  }
  return { refusal: 'Only management and finance admins approve money requests.', self: false };
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface ApprovalView {
  id: string; kind: ApprovalKind; kindLabel: string; entity: string; entityId: string; amount: number; summary: string; reason: string;
  status: ApprovalStatus; requestedBy: { id: string; name: string }; requestedAt: string;
  decidedBy: { id: string; name: string } | null; decidedAt: string | null; decisionNote: string | null; selfApproved: boolean;
  payload: Record<string, unknown>; result: Record<string, unknown> | null; link: string | null;
  can: { approve: boolean; reject: boolean; cancel: boolean; why: string | null; selfApproval: boolean };
}

export const VIEW_SQL = `
  SELECT a.*, rq.full_name AS requested_by_name, dc.full_name AS decided_by_name
  FROM approval_requests a JOIN users rq ON rq.id = a.requested_by LEFT JOIN users dc ON dc.id = a.decided_by`;

const parse = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v ?? null);

/** Where on screen the request's record lives. */
function linkFor(kind: ApprovalKind, entityId: string, payload: any): string | null {
  switch (kind) {
    case 'guest_refund': return `/reservations/bookings?open=${encodeURIComponent(entityId)}`;
    case 'payout_run': return '/finance/payouts?state=pending';
    case 'owner_adjustment': case 'debt_write_off': return payload?.ownerId ? `/owners/${encodeURIComponent(payload.ownerId)}` : null;
    case 'expense': return payload?.unitId ? `/finance/expenses?unit=${encodeURIComponent(payload.unitId)}` : '/finance/expenses';
  }
}

export function toView(r: any, session: Pick<Session, 'userId' | 'role'>, ctx: DecideContext): ApprovalView {
  const rule = decisionRule(session, r, ctx);
  const pending = r.status === 'pending';
  const payload = parse(r.payload) ?? {};
  const mayCancel = pending && (r.requested_by === session.userId || session.role === 'management');
  return {
    id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind as ApprovalKind] ?? r.kind, entity: r.entity, entityId: r.entity_id, amount: Number(r.amount),
    summary: r.summary, reason: r.reason, status: r.status,
    requestedBy: { id: r.requested_by, name: r.requested_by_name ?? 'Unknown' }, requestedAt: r.requested_at,
    decidedBy: r.decided_by ? { id: r.decided_by, name: r.decided_by_name ?? 'Unknown' } : null, decidedAt: r.decided_at ?? null,
    decisionNote: r.decision_note ?? null, selfApproved: !!r.self_approved,
    payload, result: parse(r.result), link: linkFor(r.kind, r.entity_id, payload),
    can: {
      approve: pending && !rule.refusal, reject: pending && !rule.refusal && !rule.self, cancel: mayCancel,
      why: pending ? rule.refusal : null, selfApproval: pending && rule.self,
    },
  };
}

/** Pending requests shown as a banner on one record (a booking, an owner, a unit, the payouts screen). */
export async function pendingFor(env: Env, session: Session, entity: string, entityId: string | null): Promise<ApprovalView[]> {
  const [rows, ctx] = await Promise.all([
    all<any>(env, `${VIEW_SQL} WHERE a.status = 'pending' AND a.entity = ? ${entityId ? 'AND a.entity_id = ?' : ''} ORDER BY a.requested_at`, entity, ...(entityId ? [entityId] : [])),
    decideContext(env),
  ]);
  return rows.map(r => toView(r, session, ctx));
}

/** How many pending requests this person may decide (the menu's Approvals count). */
export async function waitingCount(env: Env, session: Pick<Session, 'userId' | 'role'>): Promise<number> {
  if (session.role !== 'management' && session.role !== 'finance_admin') return 0;
  try {
    const [rows, ctx] = await Promise.all([
      all<RequestLike>(env, `SELECT requested_by, amount, status FROM approval_requests WHERE status = 'pending'`),
      decideContext(env),
    ]);
    return rows.filter(r => !decisionRule(session, r, ctx).refusal).length;
  } catch {
    return 0; // before migration 0096
  }
}

/* ------------------------------------------------------------------ */
/* Staging                                                             */
/* ------------------------------------------------------------------ */

export interface StageInput {
  kind: ApprovalKind; entity: string; entityId: string; amount: number; summary: string; reason: string; payload: Record<string, unknown>;
}

/** Records the request; nothing else changes. The caller answers 202 with what this returns. */
export async function stage(env: Env, session: Session, x: StageInput): Promise<{ pendingApproval: { id: string; kind: ApprovalKind; amount: number; summary: string; selfApproval: boolean } }> {
  const id = crypto.randomUUID(), now = nowIso();
  const reason = x.reason.trim().slice(0, 500);
  await run(env, `INSERT INTO approval_requests (id, kind, entity, entity_id, amount, summary, payload, reason, requested_by, requested_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?::text::jsonb, ?, ?, ?, 'pending')`,
    id, x.kind, x.entity, x.entityId, Math.abs(Math.round(x.amount)), x.summary.slice(0, 300), JSON.stringify(x.payload), reason, session.userId, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'approval.request', entityTable: 'approval_requests', entityId: id,
    after: { kind: x.kind, entity: x.entity, entityId: x.entityId, amount: Math.abs(Math.round(x.amount)), summary: x.summary } });
  await notifyApprovers(env, { id, kind: x.kind, amount: x.amount, summary: x.summary, requestedBy: session.fullName });
  const ctx = await decideContext(env);
  return { pendingApproval: { id, kind: x.kind, amount: Math.abs(Math.round(x.amount)), summary: x.summary, selfApproval: decisionRule(session, { requested_by: session.userId, amount: x.amount, status: 'pending' }, ctx).self } };
}

/** Tells the people who may decide that a request is waiting. Stream 3's notifyUsers (functions/_lib/notify.ts) is
 *  the channel once it is on main; until then the Approvals count in the menu is how approvers learn of it. A
 *  notification must never fail the request, so everything here is caught and recorded. TODO.md tracks wiring it. */
async function notifyApprovers(env: Env, r: { id: string; kind: ApprovalKind; amount: number; summary: string; requestedBy: string }) {
  try {
    void r; // TODO(notifyUsers): notifyUsers(env, { roles: ['management', 'finance_admin'], title: `${KIND_LABEL[r.kind]} waiting for approval`, body: r.summary, link: '/finance/approvals' })
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'system', action: 'approval.notify_failed', entityTable: 'approval_requests', entityId: r.id, after: { error: String(e).slice(0, 300) } }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Deciding                                                            */
/* ------------------------------------------------------------------ */

export type Decision = 'approve' | 'reject' | 'cancel';

/** Approve runs the staged action in the same transaction as the decision; if the action is refused (the payout was
 *  already moved, the month is now final, ...) nothing is written and the request stays pending. */
export async function decide(env: Env, session: Session, id: string, decision: Decision, note: string | null): Promise<{ ok: true; view: any } | { ok: false; code: string; message: string; status: number }> {
  const ctx = await decideContext(env);
  try {
    const row = await transaction(env, async tx => {
      // Locks the row: two approvers pressing at once cannot both carry it out.
      const cur = await one<any>(tx, `SELECT * FROM approval_requests WHERE id = ? FOR UPDATE`, id);
      if (!cur) throw new ApprovalRefused('NOT_FOUND', 'That request no longer exists.', 404);
      if (cur.status !== 'pending') throw new ApprovalRefused('ALREADY_DECIDED', `This request was already ${cur.status}.`);
      const now = nowIso();
      const text = (note ?? '').trim().slice(0, 500) || null;

      if (decision === 'cancel') {
        if (cur.requested_by !== session.userId && session.role !== 'management') throw new ApprovalRefused('FORBIDDEN', 'Only the person who asked, or management, can withdraw a request.', 403);
        await run(tx, `UPDATE approval_requests SET status = 'cancelled', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`, session.userId, now, text, id);
        await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'approval.cancel', entityTable: 'approval_requests', entityId: id, before: { status: 'pending' }, after: { status: 'cancelled', note: text } });
        return { ...cur, status: 'cancelled' };
      }

      const rule = decisionRule(session, cur, ctx);
      if (rule.refusal) throw new ApprovalRefused('FORBIDDEN', rule.refusal, 403);
      if (decision === 'reject') {
        if (rule.self) throw new ApprovalRefused('FORBIDDEN', 'Withdraw your own request instead of rejecting it.', 403);
        if (!text) throw new ApprovalRefused('VALIDATION', 'Say why it is rejected.', 422);
        await run(tx, `UPDATE approval_requests SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`, session.userId, now, text, id);
        await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'approval.reject', entityTable: 'approval_requests', entityId: id, before: { status: 'pending' }, after: { status: 'rejected', note: text } });
        return { ...cur, status: 'rejected' };
      }

      if (rule.self && !text) throw new ApprovalRefused('VALIDATION', 'You are approving your own request as the only management user. Write why.', 422);
      const payload = parse(cur.payload) ?? {};
      const result = await EXECUTE[cur.kind as ApprovalKind](tx, payload, { approvalId: id, approver: session, requestedBy: cur.requested_by });
      await run(tx, `UPDATE approval_requests SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, self_approved = ?, result = ?::text::jsonb WHERE id = ?`,
        session.userId, now, text, rule.self, JSON.stringify(result), id);
      await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: rule.self ? 'approval.self_approved' : 'approval.approve', entityTable: 'approval_requests', entityId: id,
        before: { status: 'pending' }, after: { status: 'approved', kind: cur.kind, amount: Number(cur.amount), note: text, selfApproved: rule.self, result } });
      return { ...cur, status: 'approved' };
    });
    void notifyRequester(env, row, decision);
    const fresh = await one<any>(env, `${VIEW_SQL} WHERE a.id = ?`, id);
    return { ok: true, view: toView(fresh, session, ctx) };
  } catch (e) {
    if (e instanceof ApprovalRefused) return { ok: false, code: e.code, message: e.message, status: e.status };
    throw e;
  }
}

/** Tells the requester the outcome. Same wiring note as notifyApprovers. */
async function notifyRequester(env: Env, r: any, decision: Decision) {
  try {
    void r; void decision; // TODO(notifyUsers): notifyUsers(env, { userIds: [r.requested_by], title: `Your ${KIND_LABEL[r.kind]} request was ${r.status}`, body: r.summary, link: '/finance/approvals' })
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'system', action: 'approval.notify_failed', entityTable: 'approval_requests', entityId: r.id, after: { error: String(e).slice(0, 300) } }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Carrying out an approved request                                    */
/* ------------------------------------------------------------------ */

interface ExecCtx { approvalId: string; approver: Session; requestedBy: string }
type Executor = (tx: Env, p: any, c: ExecCtx) => Promise<Record<string, unknown>>;

const actor = (c: ExecCtx) => ({ actorId: c.approver.userId, actorLabel: c.approver.fullName });

const EXECUTE: Record<ApprovalKind, Executor> = {
  /** booking_payments refund row, as Record payment writes it, attributed to the person who asked. */
  async guest_refund(tx, p, c) {
    const r = await one<{ id: string }>(tx, 'SELECT id FROM reservations WHERE id = ?', p.reservationId);
    if (!r) throw new ApprovalRefused('NOT_FOUND', 'The booking no longer exists.', 404);
    const pay = await insertPayment(tx, { reservationId: p.reservationId, amount: Number(p.amount), receivedOn: p.receivedOn, method: p.method ?? null, reference: p.reference ?? null, kind: 'refund', note: p.note ?? null, userId: c.requestedBy });
    await audit(tx, { ...actor(c), action: 'reservation.payment', entityTable: 'reservations', entityId: p.reservationId,
      after: { paymentId: pay.id, amount: pay.amount, kind: 'refund', receivedOn: p.receivedOn, method: pay.method, reference: pay.reference, approvalId: c.approvalId } });
    return { paymentId: pay.id };
  },

  /** Pending payouts to Processing (functions/api/payouts/run.ts). One that is no longer pending is left out and named. */
  async payout_run(tx, p, c) {
    const ids: string[] = Array.isArray(p.payoutIds) ? p.payoutIds.map(String) : [];
    const runRef = String(p.runRef);
    const started: string[] = [], skipped: { id: string; reason: string }[] = [];
    let total = 0;
    for (const id of ids) {
      const moved = await one<{ amount: number; bank_last4: string | null }>(tx, "UPDATE payouts SET state = 'processing' WHERE id = ? AND state = 'pending' AND bank_last4 IS NOT NULL RETURNING amount, bank_last4", id);
      if (!moved) { skipped.push({ id, reason: 'No longer pending, or no bank account.' }); continue; }
      await audit(tx, { ...actor(c), action: 'payout.run', entityTable: 'payouts', entityId: id, before: { state: 'pending' }, after: { state: 'processing', run: runRef, amount: Number(moved.amount), approvalId: c.approvalId } });
      started.push(id); total += Number(moved.amount);
    }
    if (!started.length) throw new ApprovalRefused('NOTHING_TO_RUN', 'None of these payouts is still pending. Reject this request and start a new run.');
    return { run: runRef, started: started.length, total, skipped };
  },

  /** An open owner credit or charge (functions/api/owners/[id]/adjustments). */
  async owner_adjustment(tx, p, c) {
    if (!await one(tx, 'SELECT 1 AS x FROM owners WHERE id = ?', p.ownerId)) throw new ApprovalRefused('NOT_FOUND', 'The owner no longer exists.', 404);
    const id = crypto.randomUUID(), now = nowIso();
    await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, state, source, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'manual', ?, ?, ?)`, id, p.ownerId, p.unitId ?? null, p.kind, Number(p.amount), p.description, p.occurredOn, c.requestedBy, now, now);
    await audit(tx, { ...actor(c), action: 'owner_adjustment.create', entityTable: 'owner_adjustments', entityId: id,
      after: { ownerId: p.ownerId, kind: p.kind, amount: Number(p.amount), occurredOn: p.occurredOn, state: 'open', approvalId: c.approvalId } });
    return { adjustmentId: id };
  },

  /** A new expense, or a change raising one above the threshold (functions/api/expenses). The month must still be open. */
  async expense(tx, p, c) {
    if (p.op === 'update') {
      const cur = await one<any>(tx, 'SELECT id, unit_id, category, amount, incurred_on, charge_to FROM expenses WHERE id = ?', p.expenseId);
      if (!cur) throw new ApprovalRefused('NOT_FOUND', 'The expense no longer exists.', 404);
      const d = p.changes ?? {};
      for (const day of [cur.incurred_on, d.incurredOn].filter(Boolean)) {
        if (await isPeriodLocked(tx, cur.unit_id, day)) throw new ApprovalRefused('PERIOD_LOCKED', 'That month\'s owner statement is now final, so the expense cannot change.');
      }
      await run(tx, `UPDATE expenses SET category = COALESCE(?, category), description = COALESCE(?, description), amount = COALESCE(?, amount),
        incurred_on = COALESCE(?, incurred_on), reference = COALESCE(?, reference), charge_to = COALESCE(?, charge_to) WHERE id = ?`,
        d.category ?? null, d.description ?? null, d.amount ?? null, d.incurredOn ?? null, d.reference ?? null, d.chargeTo ?? null, cur.id);
      await audit(tx, { ...actor(c), action: 'expense.update', entityTable: 'expenses', entityId: cur.id,
        before: { category: cur.category, amount: Number(cur.amount), incurredOn: cur.incurred_on, chargeTo: cur.charge_to },
        after: { category: d.category ?? cur.category, amount: d.amount ?? Number(cur.amount), incurredOn: d.incurredOn ?? cur.incurred_on, chargeTo: d.chargeTo ?? cur.charge_to, approvalId: c.approvalId } });
      return { expenseId: cur.id };
    }
    if (await isPeriodLocked(tx, p.unitId, p.incurredOn)) throw new ApprovalRefused('PERIOD_LOCKED', 'That month\'s owner statement is now final, so nothing can be added to it.');
    const id = crypto.randomUUID();
    await run(tx, `
      INSERT INTO expenses (id, unit_id, maintenance_id, task_id, parent_expense_id, category, description, amount, currency, incurred_on, reference, charge_to, receipt_document_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?, ?, ?)`,
      id, p.unitId, p.maintenanceId ?? null, p.taskId ?? null, p.parentExpenseId ?? null, p.category, p.description ?? '', Number(p.amount),
      p.incurredOn, p.reference ?? null, p.chargeTo ?? 'owner', p.receiptDocumentId ?? null, c.requestedBy, nowIso());
    await audit(tx, { ...actor(c), action: 'expense.create', entityTable: 'expenses', entityId: id,
      after: { unitId: p.unitId, category: p.category, amount: Number(p.amount), incurredOn: p.incurredOn, chargeTo: p.chargeTo ?? 'owner', approvalId: c.approvalId } });
    return { expenseId: id };
  },

  /** A held owner debt settled outside Property OS (written off): never deducted from a statement. */
  async debt_write_off(tx, p, c) {
    const done = await one<{ id: string }>(tx, `UPDATE owner_adjustments SET state = 'settled', statement_id = NULL, settled_note = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND state = 'held' RETURNING id`,
      p.note, nowIso(), p.adjustmentId, p.ownerId);
    if (!done) throw new ApprovalRefused('WRONG_STATE', 'This debt is no longer held (someone released or settled it). Reject this request.');
    await audit(tx, { ...actor(c), action: 'owner_adjustment.settle', entityTable: 'owner_adjustments', entityId: p.adjustmentId,
      before: { state: 'held' }, after: { state: 'settled', noted: true, writeOff: true, approvalId: c.approvalId } });
    return { adjustmentId: p.adjustmentId };
  },
};
