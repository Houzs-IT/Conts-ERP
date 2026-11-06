/* On-site receipts and deliveries raise each other (backend scm/routes/onsite-twin.ts). The confirm has already landed
   when this runs, so a failure here is told, never thrown back over it. */
import { useQuery } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import { serviceNotify } from './dialog-service';

export type OnsiteTwin = { onSite: boolean; pos?: string[]; open?: boolean; linked: Array<{ id: string; no: string }> };

export const useOnsiteTwin = (kind: 'grn' | 'do', id: string | null) => useQuery({
  queryKey: ['onsite-twin', kind, id],
  enabled: Boolean(id),
  queryFn: () => authedFetch<OnsiteTwin>(`/onsite-twin/${kind}/${id}`),
});

export const syncOnsiteTwin = (kind: 'grn' | 'do', id: string) =>
  authedFetch<{ raised?: string[] }>(`/onsite-twin/${kind}/${id}`, { method: 'POST' });

export function afterOnsiteConfirm(kind: 'grn' | 'do', id: string, refresh: () => void): void {
  void syncOnsiteTwin(kind, id).then(refresh).catch((e: unknown) => {
    serviceNotify({
      title: kind === 'grn' ? 'Delivery order not raised' : 'Goods receipt not raised',
      body: `${e instanceof Error ? e.message : 'Something went wrong.'} What you confirmed is saved. Open it and press Raise to try again.`,
      tone: 'error',
    });
    refresh();
  });
}
