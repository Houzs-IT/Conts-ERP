/* Brands on Sales Order Maintenance (owner, 5 Nov 2026): the same brands and logo upload as Project Maintenance, here
   because a sales order picks its brand. Logos print on that brand's documents. */

import { useQuery } from "../../hooks/useQuery";
import { api } from "../../api/client";
import { BrandLogoCell, type BrandRow } from "../ProjectMaintenance";

export function SoBrandsSection() {
  const q = useQuery(["so-maintenance", "brands"], () => api.get<{ data: BrandRow[] }>("/api/projects/brands?full=1"), []);
  const rows = q.data?.data ?? [];
  if (q.error && !q.data) return <p role="alert" className="text-[13px] text-err">The brands could not be loaded.</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-4 border-t border-border-subtle py-2.5 first:border-t-0">
          <span className="text-[13px] font-semibold">{b.name}</span>
          <BrandLogoCell brand={b} onChanged={q.reload} />
        </li>
      ))}
      {rows.length === 0 && !q.loading && <li className="text-[13px] text-ink-muted">No brands yet.</li>}
    </ul>
  );
}
