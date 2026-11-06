/* The stock of a project's lines (owner, 4 Nov 2026): the same coverage query as the sales order page, so the two read the
   same verdict and share the cache. */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import type { SoLineCoverage } from "../../vendor/scm/lib/sales-order-queries";

export function useProjectLineStock(docNos: readonly string[]): ReadonlyMap<string, SoLineCoverage> {
  const results = useQueries({
    queries: [...new Set(docNos)].map((docNo) => ({
      queryKey: ["mfg-sales-order-coverage", docNo],
      queryFn: () => authedFetch<{ coverage: SoLineCoverage[] }>(`/mfg-sales-orders/${docNo}/coverage`),
      staleTime: 30_000,
    })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join();
  return useMemo(
    () => new Map(results.flatMap((r) => r.data?.coverage ?? []).map((c) => [c.id, c])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- useQueries returns a new array each render; the stamps say when the data moved
    [stamp],
  );
}
