// Conts only (not part of Houzs's code): Staff bank details — /scm/staff-banks (chew, 18 Nov 2026). Where a claim is paid
// back to when the claim names no bank: finance's own record of each person (scm.staff_bank_details), else the HR
// employee record (field staff only). Office staff are not on HR, so finance keeps theirs here. Ledger full only.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { DataTable, type Column } from "../components/DataTable";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

type Bank = { bankName: string; accountNo: string; accountName: string | null };
export type StaffBank = { userId: string; name: string; department: string | null; bank: Bank | null; source: "finance" | "hr" | null };

const KEY = ["conts-staff-banks"];
const SOURCE: Record<string, string> = { finance: "Finance", hr: "HR record" };

export function StaffBanks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => authedFetch<{ staff: StaffBank[] }>("/accounting/staff-banks") });
  const [editing, setEditing] = useState<StaffBank | null>(null);
  const [form, setForm] = useState({ bankName: "", accountNo: "", accountName: "" });
  const [note, setNote] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: { userId: string } & typeof form) =>
      authedFetch(`/accounting/staff-bank/${encodeURIComponent(v.userId)}`, { method: "PUT", body: JSON.stringify({ bankName: v.bankName, accountNo: v.accountNo, accountName: v.accountName }) }),
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => setNote(e instanceof Error ? e.message : "Not saved."),
  });
  const open = (s: StaffBank) => {
    setNote(null);
    setEditing(s);
    setForm({ bankName: s.bank?.bankName ?? "", accountNo: s.bank?.accountNo ?? "", accountName: s.bank?.accountName ?? s.name });
  };

  const columns: Column<StaffBank>[] = [
    { key: "name", label: "Staff", render: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span>, getValue: (s) => s.name },
    { key: "dept", label: "Department", render: (s) => s.department ?? "—", getValue: (s) => s.department ?? "" },
    { key: "bank", label: "Bank", render: (s) => s.bank?.bankName || <span className="text-err">No bank details</span>, getValue: (s) => s.bank?.bankName ?? "" },
    { key: "acct", label: "Account no.", render: (s) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.bank?.accountNo ?? "—"}</span>, getValue: (s) => s.bank?.accountNo ?? "" },
    { key: "holder", label: "Name on account", render: (s) => s.bank?.accountName ?? "—", getValue: (s) => s.bank?.accountName ?? "" },
    { key: "source", label: "From", render: (s) => (s.source ? SOURCE[s.source] : "—"), getValue: (s) => s.source ?? "" },
    { key: "edit", label: "", render: (s) => <Button className="h-8" variant="secondary" onClick={() => open(s)}>{s.bank ? "Change" : "Add"}</Button>, exportValue: () => null },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title="Staff bank details"
        description="Where a claim is paid back to when the claim itself names no bank. Saved here, it is used before the HR record." />
      {editing && (
        <section className={styles.card} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }} aria-label={`Bank details of ${editing.name}`}>
          <div style={{ fontWeight: 700 }}>{editing.name}</div>
          {(["bankName", "accountNo", "accountName"] as const).map((k) => (
            <label key={k} className={styles.field}>
              <span className={styles.fieldLabel}>{k === "bankName" ? "Bank" : k === "accountNo" ? "Account no. (digits only)" : "Name on account"}</span>
              <input className={styles.fieldInput} value={form[k]} inputMode={k === "accountNo" ? "numeric" : undefined}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            </label>
          ))}
          {note && <div role="alert" className="text-err">{note}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button className="h-8" disabled={save.isPending} onClick={() => save.mutate({ userId: editing.userId, ...form })}>Save</Button>
            <Button className="h-8" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </section>
      )}
      <DataTable<StaffBank>
        tableId="conts-staff-banks"
        columns={columns}
        rows={q.data?.staff ?? null}
        loading={q.isLoading}
        error={q.isError ? "The staff did not load." : null}
        emptyLabel="No staff."
        getRowKey={(s) => s.userId}
      />
    </div>
  );
}
