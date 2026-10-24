// Conts only (not part of Houzs's code): /scm/party-ledger — one customer's or supplier's ledger (finance phase 1.5;
// SOP 2.1: "每个顾客看得到欠款、所有往来和余额"). Pick a customer or a supplier and a period: what was owed at the start,
// every line of the period with a running balance, and what is owed at the end. The choice lives in the address
// (?kind=debtor&code=301-M001&from=&to=), so the Debtors list links straight to one customer's ledger.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { fmtSen, fmtSenPlain } from "../vendor/shared/format";
import { useSuppliers } from "../vendor/scm/lib/suppliers-queries";
import { useDebtors } from "./debtorQueries";
import { usePartyLedger, type PartyKind, type PartyLedgerLine } from "./partyLedgerQueries";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

const myt = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const money = (sen: number): string => (sen === 0 ? "—" : fmtSenPlain(sen));
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

type Row = PartyLedgerLine & { key: string };

const COLUMNS: Column<Row>[] = [
  { key: "date", label: "Date", render: (l) => l.date, getValue: (l) => l.date },
  { key: "doc", label: "Document", render: (l) => <span style={{ fontFamily: "var(--font-mono)" }}>{l.doc ?? l.jeNo}</span>, getValue: (l) => l.doc ?? l.jeNo },
  { key: "description", label: "Description", render: (l) => l.description ?? "—", getValue: (l) => l.description ?? "" },
  { key: "jeNo", label: "Journal", render: (l) => <span style={{ color: "var(--fg-muted)" }}>{l.jeNo}</span>, getValue: (l) => l.jeNo },
  { key: "debit", label: "Debit (RM)", align: "right", render: (l) => <span style={num}>{money(l.debitSen)}</span>, getValue: (l) => l.debitSen, exportValue: (l) => l.debitSen / 100, exportFormat: "money" },
  { key: "credit", label: "Credit (RM)", align: "right", render: (l) => <span style={num}>{money(l.creditSen)}</span>, getValue: (l) => l.creditSen, exportValue: (l) => l.creditSen / 100, exportFormat: "money" },
  {
    key: "balance", label: "Balance (RM)", align: "right",
    render: (l) => <span style={{ ...num, fontWeight: 600, color: l.balanceSen < 0 ? "var(--c-festive-b, #b3261e)" : undefined }}>{fmtSenPlain(l.balanceSen)}</span>,
    getValue: (l) => l.balanceSen, exportValue: (l) => l.balanceSen / 100, exportFormat: "money",
  },
];

function Figure({ label, sen, hint, tone }: { label: string; sen: number; hint?: string; tone?: "bad" }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, minWidth: 0 }}>
      <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>{label}</div>
      <div style={{ ...num, fontSize: 24, fontWeight: 650, color: tone === "bad" ? "var(--c-festive-b, #b3261e)" : undefined }}>{fmtSen(sen)}</div>
      {hint && <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>{hint}</div>}
    </div>
  );
}

export function PartyLedger() {
  const [params, setParams] = useSearchParams();
  const kind: PartyKind = params.get("kind") === "creditor" ? "creditor" : "debtor";
  const code = params.get("code") ?? "";
  const from = params.get("from") ?? `${myt().slice(0, 4)}-01-01`;
  const to = params.get("to") ?? myt();
  const set = (patch: Record<string, string>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    return next;
  }, { replace: true });

  const debtors = useDebtors();
  const suppliers = useSuppliers();
  const parties = useMemo(() => (kind === "debtor"
    ? (debtors.data?.controls ?? []).flatMap((c) => c.debtors.map((d) => ({ code: d.code, name: d.name })))
    : (suppliers.data ?? []).map((s) => ({ code: s.code, name: s.name }))), [kind, debtors.data, suppliers.data]);
  /* What is typed; the ledger follows only once it names a real code (picked from the list or typed in full). */
  const [text, setText] = useState(code);
  const q = usePartyLedger({ kind, code, from, to });
  const rows = useMemo<Row[]>(() => (q.data?.lines ?? []).map((l, i) => ({ ...l, key: `${l.jeNo}-${i}` })), [q.data]);
  const owes = kind === "debtor" ? "Owes us" : "We owe";
  const d = q.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title={kind === "debtor" ? "Customer ledger" : "Supplier ledger"} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Ledger of</span>
          <select className={styles.fieldInput} value={kind} onChange={(e) => { setText(""); set({ kind: e.target.value, code: "" }); }}>
            <option value="debtor">Customers</option>
            <option value="creditor">Suppliers</option>
          </select>
        </label>
        <label className={styles.field} style={{ minWidth: 280, flex: "1 1 280px" }}>
          <span className={styles.fieldLabel}>{kind === "debtor" ? "Customer" : "Supplier"}</span>
          <input className={styles.fieldInput} list="party-ledger-parties" value={text} placeholder="Code or name"
            onChange={(e) => {
              setText(e.target.value);
              const picked = e.target.value.split(" — ")[0].trim().toUpperCase();
              const hit = parties.find((p) => p.code.toUpperCase() === picked);
              if (hit) set({ code: hit.code });
            }} />
          <datalist id="party-ledger-parties">
            {parties.map((p) => <option key={p.code} value={`${p.code} — ${p.name}`} />)}
          </datalist>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>From</span>
          <input type="date" className={styles.fieldInput} value={from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To</span>
          <input type="date" className={styles.fieldInput} value={to} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>

      {!code && <div style={{ color: "var(--fg-muted)", fontSize: "var(--fs-13)" }}>Pick a {kind === "debtor" ? "customer" : "supplier"} to see their ledger.</div>}
      {code && q.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>{q.error instanceof Error ? q.error.message : "The ledger did not load."}</div>}
      {d && (
        <>
          <div style={{ fontSize: "var(--fs-14)" }}>
            <b>{d.party.code}</b> {d.party.name}
            {d.party.control_account && <span style={{ color: "var(--fg-muted)" }}> · under {d.party.control_account}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <Figure label={`Brought forward (${from})`} sen={d.openingSen} />
            <Figure label="Debits in the period" sen={d.debitSen} />
            <Figure label="Credits in the period" sen={d.creditSen} />
            <Figure label={`${owes} at ${to}`} sen={d.closingSen} tone={d.closingSen < 0 ? "bad" : undefined}
              hint={d.closingSen < 0 ? (kind === "debtor" ? "In credit: paid more than owed" : "Paid ahead: they owe us") : undefined} />
          </div>
        </>
      )}
      {code && (
        <DataTable<Row>
          tableId="conts-party-ledger"
          exportName={`ledger-${code}`}
          exportXlsx
          columns={COLUMNS}
          rows={d ? rows : null}
          loading={q.isLoading}
          error={null}
          emptyLabel="No postings in this period."
          getRowKey={(l) => l.key}
        />
      )}
    </div>
  );
}
