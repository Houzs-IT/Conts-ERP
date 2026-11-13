/* A request to finance changed and sent again from My claims, keeping its number (chew, 13 Nov 2026: no copy, "just
   change it and submit again"; SOP 3.5). The engine route is POST /requests/:id/resubmit (conts/payment-request-routes.ts). */

const RETURNED = new Set(['WITHDRAWN', 'REJECTED']);

/** Withdrawn by its asker or rejected by finance: they may change it and send it again. One made from utility bills is
 *  fixed on Utility bills instead, where its bills are (fixOnUtilityBills). */
export const canResubmit = (q: { status: string; fromBills?: boolean }): boolean => RETURNED.has(q.status) && !q.fromBills;

/** A withdrawn or rejected request made from utility bills: its bills are fixed, and it is sent again, on Utility bills. */
export const fixOnUtilityBills = (q: { status: string; fromBills?: boolean }): boolean => RETURNED.has(q.status) && !!q.fromBills;

/** A saved line as the form edits it: what it is for (a maintenance job, a unit, a project or nothing), its amount and
 *  words. A job's line also names the job's unit; it comes back as the job. */
export function lineDraftOf(l: { unitId: string | null; maintenanceIssueId: string | null; projectId: number | null; amountSen: number; description: string | null }) {
  const where: 'job' | 'unit' | 'project' | 'none' = l.maintenanceIssueId ? 'job' : l.unitId ? 'unit' : l.projectId != null ? 'project' : 'none';
  return { where, unitId: l.unitId ?? '', jobId: l.maintenanceIssueId ?? '', projectId: l.projectId != null ? String(l.projectId) : '', amountSen: l.amountSen, description: l.description ?? '' };
}

/** How a request's reason reads (review, 13 Nov 2026): the reason now while it is rejected or closed; once it has been
 *  sent again it is kept as a record and reads "Rejected before", as on finance's list (engine requestStatusNote). */
export function reasonNote(q: { status: string; reason: string | null; decidedBy?: string | null }): { text: string; now: boolean } | null {
  if (!q.reason) return null;
  if (q.status === 'REJECTED' || q.status === 'CLOSED') return { text: q.reason, now: true };
  return { text: `Rejected before${q.decidedBy ? ` by ${q.decidedBy}` : ''}: ${q.reason}`, now: false };
}

/** The pay-by date to start from: the request's own, unless it has passed (the form takes today or later). */
export const wantedOnAgain = (wantedOn: string | null, today: string): string => (wantedOn && wantedOn >= today ? wantedOn : '');
