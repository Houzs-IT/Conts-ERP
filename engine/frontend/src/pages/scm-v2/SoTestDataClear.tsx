/* The owner's one-off clear of testing data (owner, 5 Nov 2026). "Check" is a rehearsal that changes nothing; the clear
   itself needs the word typed. Remove this section with its route once the clear is done. */

import { useState } from "react";
import { api } from "../../api/client";
import { Button } from "../../components/Button";

interface Result {
  committed: boolean;
  counts: Record<string, { before: number; cleared: number; left: number }>;
  projects: string[];
  pos: string[];
}

const LABELS: Array<[string, string]> = [
  ["public.projects", "Testing projects"],
  ["scm.mfg_sales_orders", "Sales orders"],
  ["scm.mfg_sales_order_payments", "Payments"],
  ["scm.sales_invoices", "Sales invoices"],
  ["scm.purchase_orders", "Purchase orders"],
  ["scm.po_amendments", "PO amendments"],
  ["scm.grns", "Goods received"],
  ["scm.production_orders", "Production orders"],
  ["scm.delivery_orders", "Delivery orders"],
  ["scm.inventory_movements", "Stock movements"],
  ["scm.journal_entries", "Journal entries"],
];

export function SoTestDataClear() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = async (clear: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResult(clear ? await api.post<Result>("/api/scm/test-data/clear", { confirm: word }) : await api.get<Result>("/api/scm/test-data/preview"));
      setWord("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-ink-secondary">
        Removes the TESTING projects whole, and every PO on them, on DEMO Residence, on CURVO 1234 or on no project, with their
        goods received, production orders, deliveries, stock and journals. DEMO Residence and CURVO 1234 stay. This cannot be undone.
      </p>
      <div><Button variant="secondary" disabled={busy} onClick={() => void go(false)}>{busy ? "Checking" : "Check what will be cleared"}</Button></div>
      {error && <p role="alert" className="text-err">{error}</p>}
      {result && (
        <>
          <p className="font-semibold">{result.committed ? "Cleared." : "Nothing has been changed yet. This is what the clear will do:"}</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
            {LABELS.map(([key, label]) => (
              <div key={key} className="flex justify-between gap-3 border-b border-border-subtle py-1">
                <span>{label}</span>
                <span className="tabular-nums"><b>{result.counts[key]?.cleared ?? 0}</b> of {result.counts[key]?.before ?? 0}</span>
              </div>
            ))}
          </div>
          {!result.committed && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[12px] text-ink-secondary">Type CLEAR to confirm</span>
                <input aria-label="Type CLEAR to confirm" value={word} onChange={(e) => setWord(e.target.value)} className="h-9 w-40 rounded-md border border-border bg-surface px-2" />
              </label>
              <Button disabled={busy || word !== "CLEAR"} onClick={() => void go(true)}>Clear test data</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
