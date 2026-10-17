import type { Tone } from './types';

export interface Delivery { delivery?: string; reason?: string }
interface ToastSpec { tone: Tone; title: string; body?: string }

/** notify() reports this when MAIL_API_KEY is not set on the environment (functions/_lib/notify.ts deliver()). */
const NO_MAIL = /not configured/i;

/**
 * The toast for an action that emails someone (an invitation, a reset link): success only when the email really
 * went out. When it did not, the toast says so plainly, and `fallback` says how to reach the person another way.
 */
export function deliveryToast(res: Delivery | undefined, sent: { title: string; body?: string }, what: string, fallback: string): ToastSpec {
  if (!res?.delivery || res.delivery === 'sent') return { tone: 'success', ...sent };
  if (res.delivery === 'failed' && NO_MAIL.test(res.reason ?? '')) {
    return { tone: 'critical', title: `The ${what} email was not sent: email is not set up on this system.`,
      body: `No mail provider key is set here, so nothing went out. ${fallback}` };
  }
  if (res.delivery === 'failed') {
    return { tone: 'critical', title: `The ${what} email could not be delivered.`, body: `${(res.reason ?? 'Unknown error').replace(/\.$/, '')}. It is retried automatically. ${fallback}` };
  }
  return { tone: 'warning', title: `The ${what} email is queued, not delivered yet.`, body: res.reason ?? 'It will send shortly.' };
}
