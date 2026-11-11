/* Which brand this sales order is under (owner, 5 Nov 2026). It saves when picked, and a contract's letterhead follows. */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBrands } from "../../lib/renovation/api";
import { soInfoApi, soInfoErrorText } from "../projects/renovation/customerPropertyApi";
import { useToast } from "../../vendor/scm/components/Toast";

export function SoBrandPicker({ docNo }: { docNo: string }) {
  const brands = useBrands();
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = (brands.data?.brands ?? []).filter((b) => b.active);

  /* The same read the order view already made, so Edit shows the brand at once instead of loading it again. */
  const info = useQuery({ queryKey: ["reno", "so-info", "so", docNo], queryFn: () => soInfoApi.so(docNo), staleTime: 30_000 });
  useEffect(() => {
    const r = info.data;
    if (!r) return;
    const id = r.brand?.id ?? rows.find((b) => b.name === r.brand?.name)?.brandId ?? null;
    setValue(id == null ? "" : String(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the name match needs the brand list once it arrives
  }, [info.data, rows.length]);

  const pick = async (next: string): Promise<void> => {
    if (!next || next === value) return;
    setBusy(true);
    setError(null);
    try {
      const r = await soInfoApi.saveBrand(docNo, Number(next));
      setValue(next);
      /* The order view and its project show the new brand at once. */
      void qc.invalidateQueries({ queryKey: ["reno", "so-info", "so", docNo] });
      toast.success(`${docNo} is now under ${r.name}, and so is its project`);
    } catch (e) {
      setError(soInfoErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="mt-2 block max-w-[320px]">
      <span className="mb-1 block font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Brand</span>
      <select aria-label="Brand" value={value} disabled={busy} onChange={(e) => void pick(e.target.value)} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]">
        {!value && <option value="">Choose a brand</option>}
        {rows.map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
      </select>
      {error && <span role="alert" className="mt-1 block text-[12px] text-err">{error}</span>}
    </label>
  );
}
