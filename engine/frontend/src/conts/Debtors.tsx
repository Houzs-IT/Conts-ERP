// Conts only (not part of Houzs's code): Debtors — /scm/debtors (finance phase 1.5, SOP 2.1). Every customer has a
// debtor code under its control (301-0000 renovation, 302-0000 inhouse renovation, 303-0000 rental), coded like
// AutoCount: 301-M001. New orders open one by themselves; here finance looks them up, adds one by hand, renames one or
// moves it to another control. A move asks first, and is refused while the customer still owes on the old control.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@2990s/design-system";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { Modal } from "../vendor/scm/components/Modal";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { useAuth } from "../auth/AuthContext";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { refusalOf, useDebtors, useSaveDebtor, type Debtor, type DebtorControl, type DebtorInput } from "./debtorQueries";

type Row = Debtor & { controlLabel: string };

const COLUMNS: Column<Row>[] = [
  { key: "control", label: "Control", render: (d) => d.controlLabel, getValue: (d) => d.controlLabel },
  { key: "code", label: "Code", render: (d) => <span style={{ fontFamily: "var(--font-mono)" }}>{d.code}</span>, getValue: (d) => d.code },
  { key: "name", label: "Name", render: (d) => <span style={{ fontWeight: 600 }}>{d.name}</span>, getValue: (d) => d.name },
  { key: "phone", label: "Phone", render: (d) => d.phone ?? "—", getValue: (d) => d.phone ?? "" },
  { key: "email", label: "Email", render: (d) => d.email ?? "—", getValue: (d) => d.email ?? "" },
  {
    key: "status", label: "Status",
    render: (d) => (
      <span style={{ fontSize: "var(--fs-11)", color: d.is_active ? "var(--c-secondary-a, #2F5D4F)" : "var(--fg-muted)" }}>
        {d.is_active ? "Active" : "Inactive"}
      </span>
    ),
    getValue: (d) => (d.is_active ? "ACTIVE" : "INACTIVE"),
  },
  {
    key: "ledger", label: "Ledger",
    render: (d) => <Link to={`/scm/party-ledger?kind=debtor&code=${encodeURIComponent(d.code)}`} onClick={(e) => e.stopPropagation()}>Ledger</Link>,
    getValue: () => "",
  },
];

type FormValues = { name: string; code: string; controlAccount: string; phone: string; email: string; address: string; notes: string; isActive: boolean };
const fromDebtor = (d: Debtor): FormValues => ({
  name: d.name, code: d.code, controlAccount: d.control_account, phone: d.phone ?? "", email: d.email ?? "",
  address: d.address ?? "", notes: d.notes ?? "", isActive: d.is_active,
});

export function Debtors() {
  const q = useDebtors();
  const save = useSaveDebtor();
  const askConfirm = useConfirm();
  // Writing needs the ledger's post key (backend debtors-routes.ts); everyone with the Ledger may read.
  const canWrite = useAuth().can("scm.payment_voucher.post");
  const controls: DebtorControl[] = useMemo(() => q.data?.controls ?? [], [q.data]);
  const rows = useMemo<Row[]>(() => controls.flatMap((c) => c.debtors.map((d) => ({ ...d, controlLabel: `${c.code} ${c.name}` }))), [controls]);
  const [editing, setEditing] = useState<Debtor | "new" | null>(null);
  const [v, setV] = useState<FormValues | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const open = (d: Debtor | "new") => {
    setNote(null);
    setEditing(d);
    setV(d === "new"
      ? { name: "", code: "", controlAccount: controls[0]?.code ?? "", phone: "", email: "", address: "", notes: "", isActive: true }
      : fromDebtor(d));
  };
  const close = () => { setEditing(null); setV(null); setNote(null); };
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setV((prev) => (prev ? { ...prev, [key]: value } : prev));

  const submit = async () => {
    if (!v || !editing) return;
    setNote(null);
    const id = editing === "new" ? null : editing.id;
    const body: DebtorInput = {
      name: v.name, controlAccount: v.controlAccount, phone: v.phone, email: v.email, address: v.address, notes: v.notes,
      ...(id ? { isActive: v.isActive } : { code: v.code }),
    };
    /* A move asks first; the server refuses it while the customer still owes on the old control, and says so. */
    if (editing !== "new" && v.controlAccount !== editing.control_account && !(await askConfirm({
      title: `Move ${editing.code} to ${v.controlAccount}?`,
      body: `From now on ${editing.name}'s invoices and payments post to ${v.controlAccount} instead of ${editing.control_account}. The code stays ${editing.code}.`,
      confirmLabel: "Move it",
    }))) return;
    try {
      await save.mutateAsync({ id, body });
      close();
    } catch (err) {
      setNote(refusalOf(err).message ?? (err instanceof Error ? err.message : "The customer could not be saved."));
    }
  };

  return (
    <div>
      <PageHeader
        title="Debtors"
        description="Every customer, under its control — the code is opened by itself when an order comes in."
        actions={canWrite ? <Button variant="primary" size="sm" onClick={() => open("new")}><Plus size={16} strokeWidth={1.75} /> New debtor</Button> : undefined}
      />
      <DataTable<Row>
        tableId="conts-debtors"
        exportName="debtors"
        exportXlsx
        columns={COLUMNS}
        rows={q.data ? rows : null}
        loading={q.isLoading}
        error={q.isError ? "The debtors did not load." : null}
        emptyLabel="No debtors yet."
        getRowKey={(d) => d.id}
        onRowClick={canWrite ? (d) => open(d) : undefined}
        groupBy={{ key: "control" }}
        clientSearch={{ placeholder: "Code, name or phone" }}
      />

      {editing && v && (
        <Modal
          title={editing === "new" ? "New debtor" : `Edit debtor — ${editing.code}`}
          onClose={close}
          ariaLabel={editing === "new" ? "New debtor" : "Edit debtor"}
          width="min(720px, 100%)"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--fs-13)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-3)" }}>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                <span className={styles.fieldLabel}>Name</span>
                <input className={styles.fieldInput} value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Control</span>
                <select className={styles.fieldInput} value={v.controlAccount} onChange={(e) => set("controlAccount", e.target.value)}>
                  {controls.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Code</span>
                {editing === "new"
                  ? <input className={styles.fieldInput} value={v.code} placeholder="Blank — the next one" onChange={(e) => set("code", e.target.value.toUpperCase())} />
                  : <input className={styles.fieldInput} value={v.code} readOnly aria-readonly="true" />}
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Phone</span>
                <input className={styles.fieldInput} value={v.phone} onChange={(e) => set("phone", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Email</span>
                <input className={styles.fieldInput} value={v.email} onChange={(e) => set("email", e.target.value)} />
              </label>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                <span className={styles.fieldLabel}>Address</span>
                <input className={styles.fieldInput} value={v.address} onChange={(e) => set("address", e.target.value)} />
              </label>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                <span className={styles.fieldLabel}>Notes</span>
                <input className={styles.fieldInput} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
              </label>
              {editing !== "new" && (
                <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                  <input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Active
                </label>
              )}
            </div>
            {note && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>{note}</div>}
            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" onClick={close} disabled={save.isPending}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!v.name.trim() || !v.controlAccount || save.isPending}>
                {save.isPending ? "Saving…" : editing === "new" ? "Save" : "Save changes"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
