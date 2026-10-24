// Conts only (not part of Houzs's code): a supplier's payables control on its page (finance phase 1.5; chew, 24 Oct
// 2026: "我发现放错了，想要从 400-0000 换去 405-0000"). Shown to everyone; changed only with the ledger's post key. A
// change asks first; the server refuses it while the supplier still owes on its current control, and says how much.
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { useAccounts } from "../vendor/scm/lib/accounting-queries";
import { useUpdateSupplier, type SupplierRow } from "../vendor/scm/lib/suppliers-queries";
import { refusalOf } from "./debtorQueries";

/** What a supplier with no control of its own books to: its code's rule (405- other creditors, else trade creditors). */
const byCode = (code: string): string => (code.startsWith("405-") ? "405-0000" : "400-0000");

export function SupplierControl({ supplier, cellClass, labelClass, valueClass }: {
  supplier: Pick<SupplierRow, "id" | "code" | "control_account">; cellClass?: string; labelClass?: string; valueClass?: string;
}) {
  const canPost = useAuth().can("scm.payment_voucher.post");
  const current = supplier.control_account || byCode(supplier.code);
  return (
    <div className={cellClass}>
      <span className={labelClass}>Control</span>
      {canPost ? <ControlPicker supplier={supplier} current={current} /> : <span className={valueClass}>{current}</span>}
    </div>
  );
}

function ControlPicker({ supplier, current }: { supplier: Pick<SupplierRow, "id" | "code">; current: string }) {
  const accounts = useAccounts();
  const update = useUpdateSupplier();
  const askConfirm = useConfirm();
  const [note, setNote] = useState<string | null>(null);
  const controls = (accounts.data?.accounts ?? []).filter((a) => a.special_type === "SCC" && a.is_active);
  const options = controls.some((a) => a.account_code === current) ? controls : [{ account_code: current, account_name: "" }, ...controls];

  const choose = async (next: string) => {
    setNote(null);
    if (next === current) return;
    if (!(await askConfirm({
      title: `Move ${supplier.code} to ${next}?`,
      body: `From now on its bills and payments post to ${next} instead of ${current}. The code stays ${supplier.code}.`,
      confirmLabel: "Move it",
    }))) return;
    try {
      await update.mutateAsync({ id: supplier.id, controlAccount: next } as Partial<SupplierRow> & { id: string });
    } catch (err) {
      setNote(refusalOf(err).message ?? (err instanceof Error ? err.message : "The control could not be changed."));
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <select aria-label="Supplier control" value={current} disabled={update.isPending || accounts.isLoading}
        onChange={(e) => void choose(e.target.value)}>
        {options.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}
      </select>
      {note && <span role="alert" style={{ color: "var(--c-festive-b, #b3261e)", fontSize: "var(--fs-12)" }}>{note}</span>}
    </span>
  );
}
