/* The production orders behind a PO or a sales order (owner, 4 Nov 2026: the flow is SO, PO, Production Order). Says
   nothing when there are none, or when the viewer has no access to production orders. */

import { Link } from "react-router-dom";
import { Factory } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";

type Linked = { id: string; po_number: string; status: string };

export function ProductionOrderChips({ poId, soDocNo, label }: { poId?: string; soDocNo?: string; label?: string }) {
  const qs = poId ? `poId=${encodeURIComponent(poId)}` : `soDocNo=${encodeURIComponent(soDocNo ?? "")}`;
  const q = useQuery({
    queryKey: ["production-order-links", qs],
    enabled: Boolean(poId || soDocNo),
    queryFn: () => authedFetch<{ productionOrders: Linked[] }>(`/production-orders/links?${qs}`).then((r) => r.productionOrders),
    retry: false,
    staleTime: 30_000,
  });
  if (!q.data?.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {label && <span className="text-[12px] font-semibold text-ink-secondary">{label}</span>}
      {q.data.map((o) => (
        <Link
          key={o.id}
          to={`/scm/production-orders/${o.id}`}
          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-primary hover:underline"
        >
          <Factory size={11} aria-hidden="true" />{o.po_number}
        </Link>
      ))}
    </span>
  );
}
