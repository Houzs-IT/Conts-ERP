// Conts only (not part of Houzs's code): the Everyday expenses block of the Ledger setup page (finance phase 1.5;
// SOP 3.4). Rent, utilities and the like are paid as usual: a voucher line on one of these accounts does not count
// against a project's limit or an internal project's budget. Finance ticks which expense accounts they are.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

type Row = { account_code: string; account_name: string; everyday_expense: boolean | null };

export function EverydayExpense({ canSave }: { canSave: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["conts-everyday-expense"], queryFn: () => authedFetch<{ accounts: Row[] }>("/accounting/everyday-expense") });
  const set = useMutation({
    mutationFn: (b: { accountCode: string; on: boolean }) => authedFetch("/accounting/everyday-expense", { method: "PUT", body: JSON.stringify(b) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["conts-everyday-expense"] }); },
  });
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const rows = (q.data?.accounts ?? []).filter((a) => !filter || `${a.account_code} ${a.account_name}`.toUpperCase().includes(filter.toUpperCase()));
  const ticked = (q.data?.accounts ?? []).filter((a) => a.everyday_expense === true).length;

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Everyday expenses</h2>
      <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--fs-13)" }}>
        Rent, utilities and the like: paid as usual, outside a project&apos;s limit or an internal project&apos;s budget. {ticked} ticked.
      </p>
      <input aria-label="Find an expense account" placeholder="Find an account" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }} />
      {q.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>The expense accounts did not load.</div>}
      {note && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>{note}</div>}
      <div style={{ maxHeight: 280, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4 }}>
        {rows.map((a) => (
          <label key={a.account_code} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--fs-13)" }}>
            <input type="checkbox" checked={a.everyday_expense === true} disabled={!canSave || set.isPending}
              onChange={async (e) => {
                setNote(null);
                try { await set.mutateAsync({ accountCode: a.account_code, on: e.target.checked }); } catch (err) { setNote(err instanceof Error ? err.message : "Not saved."); }
              }} />
            <span style={{ fontFamily: "var(--font-mono)" }}>{a.account_code}</span> {a.account_name}
          </label>
        ))}
      </div>
    </section>
  );
}
