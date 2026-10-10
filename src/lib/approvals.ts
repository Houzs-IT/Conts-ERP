import { api } from './api';
import { rm } from './format';
import type { Tone } from './types';

/** Money requests waiting for a second person (functions/_lib/approvals.ts). */
export type ApprovalKind = 'guest_refund' | 'payout_run' | 'owner_adjustment' | 'expense' | 'debt_write_off';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Approval {
  id: string; kind: ApprovalKind; kindLabel: string; entity: string; entityId: string; amount: number; summary: string; reason: string;
  status: ApprovalStatus; requestedBy: { id: string; name: string }; requestedAt: string;
  decidedBy: { id: string; name: string } | null; decidedAt: string | null; decisionNote: string | null; selfApproved: boolean;
  payload: Record<string, unknown>; result: Record<string, unknown> | null; link: string | null;
  can: { approve: boolean; reject: boolean; cancel: boolean; why: string | null; selfApproval: boolean };
}

/** What a money action answers when it was staged instead of carried out (HTTP 202). */
export interface Staged { pendingApproval: { id: string; kind: ApprovalKind; amount: number; summary: string; selfApproval: boolean } }
export const isStaged = (x: unknown): x is Staged => !!x && typeof x === 'object' && 'pendingApproval' in (x as object);

export const STATUS_LABEL: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'critical' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};

export type Decision = 'approve' | 'reject' | 'cancel';
export const decide = (id: string, decision: Decision, note?: string) => api.post<Approval>(`/approvals/${encodeURIComponent(id)}`, { decision, note: note || undefined });

/** The toast after a money action was sent for approval. */
export function stagedToast(s: Staged) {
  const p = s.pendingApproval;
  return {
    tone: 'info' as Tone,
    title: `Sent for approval: ${rm(p.amount)}.`,
    body: p.selfApproval
      ? 'You are the only management user, so you can approve it yourself on the Approvals page, with a reason.'
      : 'Nothing has been paid or changed yet. It happens when a second person approves it on the Approvals page.',
  };
}
