/** Which maintenance jobs the Open tab shows and in what order: one copy for the screen (MaintenancePage) and for the
 *  server's first page of it (functions/api/maintenance/issues.ts ?view=open), so the first rows shown are the rows
 *  the full list puts first. */

export type JobType = 'urgent' | 'pass_key' | 'normal';

/** The fields these rules read; the screen's Issue and the API's row both have them. */
export interface OrderFacts {
  state: string; urgency: string; jobType?: JobType | null; dueOn?: string | null; reportedAt: string;
  ownerApprovalRequired: boolean; ownerApprovedAt: string | null; chargeTo: string;
  endedAt: string | null; supportRequestedAt?: string | null;
}

export const JOB_ORDER: Record<JobType, number> = { urgent: 0, pass_key: 1, normal: 2 };

export const typeOf = (i: Pick<OrderFacts, 'jobType' | 'urgency'>): JobType => i.jobType ?? (i.urgency === 'urgent' ? 'urgent' : 'normal');
export const isUrgent = (i: Pick<OrderFacts, 'jobType' | 'urgency'>): boolean => typeOf(i) === 'urgent' || i.urgency === 'urgent';
/** A pass key handover for a day after tomorrow (and not urgent) waits under History until it is near. */
export const isOffDayPassKey = (i: OrderFacts, tomorrow: string): boolean => typeOf(i) === 'pass_key' && !!i.dueOn && i.dueOn > tomorrow && !isUrgent(i);
export const needsSupport = (i: OrderFacts): boolean => i.state !== 'resolved' && !i.endedAt && !!i.supportRequestedAt;
export const awaitingOwner = (i: OrderFacts) => i.state !== 'resolved' && i.ownerApprovalRequired && !i.ownerApprovedAt && i.chargeTo === 'owner';

/** The Open tab: not finished, not waiting for its owner, not a pass key for a later day. */
export const onOpenTab = (i: OrderFacts, tomorrow: string): boolean => i.state !== 'resolved' && !awaitingOwner(i) && !isOffDayPassKey(i, tomorrow);

/** Open jobs in the order they are worked: Urgent, Pass key, then Normal one by one by due date (the day reported when none). */
export const openOrder = (a: OrderFacts, b: OrderFacts): number =>
  JOB_ORDER[typeOf(a)] - JOB_ORDER[typeOf(b)] || (a.dueOn ?? a.reportedAt.slice(0, 10)).localeCompare(b.dueOn ?? b.reportedAt.slice(0, 10)) || a.reportedAt.localeCompare(b.reportedAt);
