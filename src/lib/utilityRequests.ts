import { api, errorMessage } from './api';

/** What a utility bill save hands back for finance to pay: one group per provider (functions/_lib/utilityRequests.ts). */
export interface ToPay { provider: string; count: number; amountSen: number; expenseIds: string[] }

/** Sends each provider's bills as one payment request (POST /api/expenses/utilities/payment-requests; chew, 5 Nov 2026,
 *  SOP 3.10). A provider that fails is listed, not retried: its bills stay recorded without a request, and saving them
 *  again sends them. */
export async function sendUtilityRequests(toPay: ToPay[] | undefined): Promise<{ sent: { provider: string; requestNo: string | null }[]; failed: { provider: string; message: string }[] }> {
  const sent: { provider: string; requestNo: string | null }[] = [], failed: { provider: string; message: string }[] = [];
  for (const g of toPay ?? []) {
    try {
      const r = await api.post<{ requestNo: string | null }>('/expenses/utilities/payment-requests', { expenseIds: g.expenseIds, provider: g.provider });
      sent.push({ provider: g.provider, requestNo: r.requestNo ?? null });
    } catch (e) {
      failed.push({ provider: g.provider, message: errorMessage(e, 'The finance system could not be reached.') });
    }
  }
  return { sent, failed };
}

/** One line for a toast: "Payment requests sent: TNB (PRQ-2611-004), Air Selangor." */
export function requestsNote(r: Awaited<ReturnType<typeof sendUtilityRequests>>): string {
  const parts: string[] = [];
  if (r.sent.length) parts.push(`Payment ${r.sent.length === 1 ? 'request' : 'requests'} sent: ${r.sent.map(s => (s.requestNo ? `${s.provider} (${s.requestNo})` : s.provider)).join(', ')}.`);
  if (r.failed.length) parts.push(`Not sent for ${r.failed.map(f => f.provider).join(', ')}: ${r.failed[0].message} Save those bills again to send them.`);
  return parts.join(' ');
}
