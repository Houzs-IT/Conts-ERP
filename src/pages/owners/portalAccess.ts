import { mayRun } from '../../lib/areaAccess';
import type { SessionUser } from '../../lib/types';
import { api, errorMessage } from '../../lib/api';
import { date, titleCase } from '../../lib/format';
import { deliveryToast, type Delivery } from '../../lib/emailDelivery';
import type { ConfirmSpec } from '../../components/ConfirmDialog';
import type { Tone } from '../../lib/types';
import type { Owner, PortalLogin } from './shared';

/** Where the owner's portal login stands. Older API responses carry only portalInvited. */
export const portalOf = (o: Owner): PortalLogin => o.portal ?? { state: o.portalInvited ? 'active' : 'none', invitedAt: null, lastLoginAt: null };

/** Badge for the profile header (long) and the list column (short). */
export function portalBadge(o: Owner, short = false): { label: string; tone: Tone; hint?: string } {
  const p = portalOf(o);
  const invited = p.invitedAt ? `Invited ${date(p.invitedAt)}` : undefined;
  if (p.state === 'invited') return { label: short ? 'Invited' : 'Invited, not signed in yet', tone: 'warning', hint: invited };
  if (p.state === 'active') return { label: short ? 'Active' : 'Portal active', tone: 'success', hint: p.lastLoginAt ? `Last signed in ${date(p.lastLoginAt)}` : undefined };
  if (p.state === 'off') return { label: short ? 'Switched off' : 'Portal switched off', tone: 'neutral' };
  return { label: 'Not invited', tone: 'neutral' };
}

/** Who the invite endpoints accept (owners/[id]/invite.ts, resend-invite.ts, reset-email.ts): Full on Owners. */
export const mayInviteOwners = (user: SessionUser | null | undefined): boolean => mayRun(user, 'owners');

const NO_MAIL_INVITE = 'To get them in now, open Users and roles, find their portal login and use Reset password to get a temporary password to pass on yourself.';
const NO_MAIL_RESET = 'To get them in now, open Users and roles, find their portal login and use Get a reset link to pass on.';

export interface PortalAction { key: string; label: string; icon: string; run: () => void }

/**
 * The one portal action that fits the owner's state: invite (no login yet), resend the invitation (invited, never
 * signed in), or email a reset link (already signed in). Each asks first, then says whether the email went out.
 */
export function portalAction(o: Owner, ctx: {
  toast: (t: { tone: Tone; title: string; body?: string }) => void;
  confirm: (spec: ConfirmSpec | null) => void;
  onDone: (state: PortalLogin['state']) => void;
}): PortalAction | null {
  const p = portalOf(o);
  const name = titleCase(o.displayName);
  const call = async (path: string, ok: { title: string; body?: string }, what: string, fallback: string, failTitle: string, next: PortalLogin['state']) => {
    try {
      const res = await api.post<Delivery>(path, {});
      ctx.toast(deliveryToast(res, ok, what, fallback));
      ctx.onDone(next);
    } catch (e) {
      ctx.toast({ tone: 'critical', title: failTitle, body: errorMessage(e, 'Try again in a moment.') });
    } finally { ctx.confirm(null); }
  };
  if (p.state === 'none') {
    if (!o.email) return null;
    return { key: 'invite', label: 'Invite to portal', icon: 'Mail', run: () => ctx.confirm({
      title: `Invite ${name} to the owner portal?`,
      body: 'Creates an owner account with a temporary password, sent by email. They can view their statements, income and building health, and approve quotes.',
      meta: o.email, confirmLabel: 'Send invite', busyLabel: 'Sending…',
      onConfirm: () => call(`/owners/${o.id}/invite`, { title: 'Invite sent.', body: `${name} has a temporary password by email and chooses their own at first sign-in.` },
        'invitation', NO_MAIL_INVITE, 'Invite was not sent.', 'invited'),
    }) };
  }
  if (p.state === 'invited') {
    return { key: 'resend', label: 'Resend invitation', icon: 'Send', run: () => ctx.confirm({
      title: `Resend the portal invitation to ${name}?`,
      body: 'They get a fresh temporary password by email. The one in the earlier email stops working.',
      meta: `Sent to ${o.email}${p.invitedAt ? ` · last invited ${date(p.invitedAt)}` : ''}`, confirmLabel: 'Resend invitation', busyLabel: 'Sending…',
      onConfirm: () => call(`/owners/${o.id}/resend-invite`, { title: `Invitation re-sent to ${o.email}.`, body: 'A fresh temporary password is on its way.' },
        'invitation', NO_MAIL_INVITE, 'The invitation was not re-sent.', 'invited'),
    }) };
  }
  if (p.state === 'active') {
    return { key: 'reset', label: 'Email a password reset link', icon: 'KeyRound', run: () => ctx.confirm({
      title: `Send ${name} a password reset link?`,
      body: 'They get an email with a link to choose a new password. It works once and expires in 60 minutes. Their current password keeps working until they use it.',
      meta: `Sent to ${o.email}`, confirmLabel: 'Send link', busyLabel: 'Sending…',
      onConfirm: () => call(`/owners/${o.id}/reset-email`, { title: `Reset link sent to ${o.email}.` }, 'reset link', NO_MAIL_RESET, 'The reset link was not sent.', 'active'),
    }) };
  }
  return null;
}
