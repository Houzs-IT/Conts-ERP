import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { todayMyt } from '../../_lib/ops';
import { monthEndExclusive } from '../../_lib/revenue';
import { LOCKED_SQL } from '../../_lib/expenses';
import { classifyCost } from '../../_lib/ownerStatement';
import { mayChangeAdjustments } from '../../_lib/ownerScope';

/** GET /api/finance/deductions?month=YYYY-MM — Units > Deductions (PLAN-deduction-panel.md): the workbook's misc deductions
 *  sheet for one month, read from where the statement takes it.
 *    additional  owner-paid expenses the statement puts under "Additional Deduction" (before the split), by the
 *                month whose statement deducts them
 *    o2          owner credits and charges (owner_adjustments) dated in the month, taken after the split
 *  `amount` is what the line does to the owner's payout, sen: negative takes money off, positive gives it back.
 *  New lines are added through POST /api/expenses and POST /api/owners/:id/adjustments. Read only. */

export type DeductionType = 'additional' | 'o2';
export type DeductionStatus = 'open' | 'held' | 'settled' | 'final';
export interface DeductionLine {
  id: string; type: DeductionType; unitId: string | null; unitLabel: string | null; ownerId: string | null; ownerName: string | null;
  date: string; remarks: string; reference: string | null; amount: number; status: DeductionStatus; hasReceipt: boolean;
}

interface ExpenseRow {
  id: string; unit_id: string; category: string; description: string | null; amount: number | string; incurred_on: string; reference: string | null;
  receipt_document_id: string | null; property_name: string; unit_number: string; owner_id: string | null; owner_name: string | null; locked: boolean;
}
interface AdjustmentRow {
  id: string; owner_id: string; unit_id: string | null; amount: number | string; description: string; occurred_on: string; reference: string | null;
  state: string; property_name: string | null; unit_number: string | null; owner_name: string | null; statement_state: string | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FINAL = ['finalised', 'sent', 'paid'];
// Imported workbook lines carry the sheet's type in front ("O2: MAINTENANCE FEE SEPT 26").
const stripType = (d: string | null) => (d ?? '').replace(/^(o2|additional deduction):\s*/i, '');
const adjustmentStatus = (state: string, statementState: string | null): DeductionStatus =>
  statementState && FINAL.includes(statementState) ? 'final' : state === 'held' || state === 'settled' ? state : 'open';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(session.manage || can(session, 'finance', 'view'))) return fail('FORBIDDEN', 'Deductions are visible to finance and management roles.', 403);
  const month = new URL(request.url).searchParams.get('month') || todayMyt().slice(0, 7);
  if (!MONTH.test(month)) return fail('VALIDATION', 'The month must look like 2026-09.', 422);

  const [expenses, adjustments] = await Promise.all([
    all<ExpenseRow>(env, `
      SELECT e.id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.reference, e.receipt_document_id,
             p.name AS property_name, u.unit_number, u.owner_id, o.display_name AS owner_name, ${LOCKED_SQL} AS locked
      FROM expenses e JOIN units u ON u.id = e.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN owners o ON o.id = u.owner_id
      WHERE e.charge_to = 'owner' AND NOT e.record_only AND e.deduct_month = ?
        AND e.category NOT IN ('cleaning', 'housekeeping', 'electricity', 'water', 'internet', 'sewerage')
      ORDER BY e.incurred_on DESC, e.created_at DESC`, month),
    all<AdjustmentRow>(env, `
      SELECT a.id, a.owner_id, a.unit_id, a.amount, a.description, a.occurred_on, a.reference, a.state,
             p.name AS property_name, u.unit_number, o.display_name AS owner_name, s.state AS statement_state
      FROM owner_adjustments a JOIN owners o ON o.id = a.owner_id
      LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN properties p ON p.id = u.property_id
      LEFT JOIN owner_statements s ON s.id = a.statement_id
      WHERE a.kind IN ('credit', 'charge') AND a.occurred_on >= ? AND a.occurred_on < ?
      ORDER BY a.occurred_on DESC, a.created_at DESC`, `${month}-01`, monthEndExclusive(month)),
  ]);

  const data: DeductionLine[] = [
    // Indah Water typed in as 'utilities' is a utility on the statement, not an additional deduction.
    ...expenses.filter(e => classifyCost({ category: e.category, description: e.description ?? '', task_kind: null }) === 'additional').map((e): DeductionLine => ({
      id: e.id, type: 'additional', unitId: e.unit_id, unitLabel: `${e.property_name} ${e.unit_number}`, ownerId: e.owner_id, ownerName: e.owner_name,
      date: e.incurred_on, remarks: stripType(e.description), reference: e.reference, amount: -Number(e.amount),
      status: e.locked ? 'final' : 'open', hasReceipt: !!e.receipt_document_id,
    })),
    ...adjustments.map((a): DeductionLine => ({
      id: a.id, type: 'o2', unitId: a.unit_id, unitLabel: a.unit_number ? `${a.property_name} ${a.unit_number}` : null, ownerId: a.owner_id, ownerName: a.owner_name,
      date: a.occurred_on, remarks: stripType(a.description), reference: a.reference, amount: Number(a.amount),
      status: adjustmentStatus(a.state, a.statement_state), hasReceipt: false,
    })),
  ].sort((x, y) => y.date.localeCompare(x.date));

  return json({ generatedAt: nowIso(), month, canAdd: session.manage, canAddO2: mayChangeAdjustments(session), data });
};
