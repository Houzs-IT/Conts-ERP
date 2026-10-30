// Conts only (not part of Houzs's code): E-invoice — /scm/einvoice (plan 2026-10-30-renovation-einvoice-ready.md Task
// 7). Every renovation invoice and credit note is prepared for LHDN e-invoice and waits here; nothing is sent until
// chew connects MyInvois and switches it on. Finance keeps the seller's details and the codes, sees what is ready,
// and follows a not-ready row to the customer account to fill in what is missing.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@2990s/design-system";
import { PageHeader } from "../components/Layout";
import { DataTable, type Column } from "../components/DataTable";
import { Modal } from "../vendor/scm/components/Modal";
import { useAuth } from "../auth/AuthContext";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { refusalOf } from "./debtorQueries";
import {
  LHDN_STATES, STATUS_LABEL, formOf, previewDescription, useEInvoiceSettings, useOutbox, useOutboxRow, useRefreshOutbox, useSaveEInvoiceSettings,
  type EInvoiceSettings, type EInvoiceSeller, type OutboxRow, type OutboxStatus,
} from "./einvoiceQueries";

const rm = (sen: number): string => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_COLOR: Record<OutboxStatus, string> = {
  READY: "var(--c-secondary-a, #2F5D4F)", NOT_READY: "var(--c-festive-b, #b3261e)", SUBMITTED: "var(--fg-muted)", VALID: "var(--c-secondary-a, #2F5D4F)",
  REJECTED: "var(--c-festive-b, #b3261e)", CANCELLED: "var(--fg-muted)",
};
const card = { padding: "var(--space-4)", display: "flex", flexDirection: "column" as const, gap: "var(--space-3)" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-3)" };

const SELLER_FIELDS: Array<[keyof EInvoiceSeller, string, boolean]> = [
  ["tin", "Seller TIN", false], ["brn", "Registration no. (SSM)", false], ["sstNo", "SST registration no. (blank = NA)", false],
  ["msicCode", "MSIC code", false], ["activityDesc", "Business activity", true], ["address1", "Address line 1", true],
  ["address2", "Address line 2", true], ["city", "City", false], ["postcode", "Postcode", false], ["phone", "Phone", false], ["email", "Email", false],
];

const COLUMNS: Column<OutboxRow>[] = [
  { key: "doc", label: "Document", render: (r) => <span style={{ fontFamily: "var(--font-mono)" }}>{r.docNumber}</span>, getValue: (r) => r.docNumber },
  { key: "kind", label: "Kind", render: (r) => (r.docKind === "INVOICE" ? "Invoice" : "Credit note"), getValue: (r) => r.docKind },
  { key: "date", label: "Date", render: (r) => r.date ?? "—", getValue: (r) => r.date ?? "" },
  { key: "customer", label: "Customer", render: (r) => <span>{r.debtorName ?? "—"}<span style={{ color: "var(--fg-muted)" }}> {r.debtorCode ?? ""}</span></span>, getValue: (r) => `${r.debtorName ?? ""} ${r.debtorCode ?? ""}` },
  { key: "amount", label: "Amount (RM)", align: "right", render: (r) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{rm(r.amountSen)}</span>, getValue: (r) => r.amountSen },
  { key: "status", label: "Status", render: (r) => <span style={{ fontWeight: 600, color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status]}</span>, getValue: (r) => STATUS_LABEL[r.status] },
  {
    key: "missing", label: "What is missing",
    render: (r) => (r.missing.length
      ? <span>{r.missing.join(", ")}{r.missing.some((m) => m.startsWith("buyer")) && <> · <Link to="/scm/debtors" onClick={(e) => e.stopPropagation()}>Customer account</Link></>}</span>
      : "—"),
    getValue: (r) => r.missing.join(", "),
  },
];

export function EInvoice() {
  const settings = useEInvoiceSettings();
  const save = useSaveEInvoiceSettings();
  const refresh = useRefreshOutbox();
  const canWrite = useAuth().can("scm.payment_voucher.post");
  const [status, setStatus] = useState("");
  const outbox = useOutbox(status);
  const [v, setV] = useState<EInvoiceSettings | null>(null);
  const [note, setNote] = useState<{ field?: string; text: string; ok?: boolean } | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const row = useOutboxRow(openRow);
  const [recheck, setRecheck] = useState<{ text: string; ok: boolean } | null>(null);
  const runRecheck = () => {
    setRecheck(null);
    refresh.mutate(undefined, {
      onSuccess: (r) => setRecheck({ ok: true, text: r.remaining > 0 ? `${r.refreshed} checked, ${r.remaining} still to go: press Re-check all again.` : `${r.refreshed} checked. All up to date.` }),
      onError: (err) => setRecheck({ ok: false, text: refusalOf(err).message ?? (err instanceof Error ? err.message : "The re-check failed.") }),
    });
  };

  useEffect(() => {
    if (settings.data && !v) setV(formOf(settings.data));
  }, [settings.data, v]);
  const setSeller = (k: keyof EInvoiceSeller, value: string) => setV((p) => (p ? { ...p, seller: { ...p.seller, [k]: value } } : p));
  const counts = outbox.data?.counts;
  const preview = useMemo(() => (v ? previewDescription(v.renoDescriptionTemplate, { seq: 1, pctBp: 1500, label: "Deposit & Design Fee", soDocNo: "SO-2611-001" }) : ""), [v]);

  const submit = async () => {
    if (!v) return;
    setNote(null);
    try {
      const saved = await save.mutateAsync(v);
      /* The form shows what the server keeps (an upper-cased TIN, the default template for a blank one). */
      setV(formOf(saved));
      const left = saved.recheckRemaining ?? 0;
      setNote({ text: left > 0 ? `Saved. ${left} waiting e-invoices still to re-check: press Re-check all.` : "Saved. Waiting e-invoices were checked again.", ok: true });
    } catch (err) {
      const r = refusalOf(err) as { message?: string; field?: string };
      setNote({ field: r.field, text: r.message ?? (err instanceof Error ? err.message : "The settings could not be saved.") });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="E-invoice"
        description="Renovation invoices and credit notes, prepared for LHDN e-invoice. Nothing is sent until MyInvois is connected and e-invoice is switched on."
      />
      <div role="status" style={{ fontWeight: 600 }}>
        {settings.data?.active ? "On — waiting for the MyInvois connection. Nothing is sent yet." : "Off — nothing is sent."}
      </div>

      <section className={styles.card} style={card}>
        <h2 className={styles.cardTitle}>Status</h2>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "flex-end" }}>
          {(["READY", "NOT_READY", "CANCELLED"] as const).map((s) => (
            <div key={s}>
              <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>{STATUS_LABEL[s]}</div>
              <div data-testid={`count-${s}`} style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: s === "NOT_READY" && counts?.[s] ? STATUS_COLOR.NOT_READY : undefined }}>
                {counts ? counts[s] : "—"}
              </div>
            </div>
          ))}
          {canWrite && (
            <Button variant="ghost" size="sm" disabled={refresh.isPending} onClick={runRecheck}>
              {refresh.isPending ? "Checking…" : "Re-check all"}
            </Button>
          )}
        </div>
        {recheck && <div role={recheck.ok ? "status" : "alert"} style={{ color: recheck.ok ? undefined : "var(--c-festive-b, #b3261e)" }}>{recheck.text}</div>}
      </section>

      {v && (
        <section className={styles.card} style={card}>
          <h2 className={styles.cardTitle}>Settings</h2>
          <div style={{ fontWeight: 600 }}>Seller (Dream Crafter and The Conts issue as one company)</div>
          <div style={grid}>
            {SELLER_FIELDS.map(([k, label, wide]) => (
              <label key={k} className={styles.field} style={wide ? { gridColumn: "1 / -1" } : undefined}>
                <span className={styles.fieldLabel}>{label}</span>
                <input className={styles.fieldInput} value={v.seller[k]} disabled={!canWrite} onChange={(e) => setSeller(k, e.target.value)} />
              </label>
            ))}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>State</span>
              <select className={styles.fieldInput} value={v.seller.stateCode} disabled={!canWrite} onChange={(e) => setSeller("stateCode", e.target.value)}>
                <option value="">—</option>
                {LHDN_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </div>
          {!!settings.data?.sellerMissing.length && (
            <div style={{ color: "var(--fg-muted)", fontSize: "var(--fs-12)" }}>Still needed before switching on: {settings.data.sellerMissing.join(", ")}.</div>
          )}

          <div style={{ fontWeight: 600 }}>Codes</div>
          <div style={grid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Classification code</span>
              <input className={styles.fieldInput} value={v.classificationCode} disabled={!canWrite} onChange={(e) => setV({ ...v, classificationCode: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Tax type</span>
              <select className={styles.fieldInput} value={v.taxType} disabled={!canWrite} onChange={(e) => setV({ ...v, taxType: e.target.value })}>
                {Object.entries(settings.data?.taxTypes ?? {}).map(([code, name]) => <option key={code} value={code}>{code} {name}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <input type="checkbox" checked={v.sstEnabled} disabled aria-label="SST" /> SST
              <span style={{ color: "var(--fg-muted)", fontSize: "var(--fs-12)" }}>SST postings are not built yet</span>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Invoice description</span>
            <input className={styles.fieldInput} value={v.renoDescriptionTemplate} disabled={!canWrite} onChange={(e) => setV({ ...v, renoDescriptionTemplate: e.target.value })} />
          </label>
          <div style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
            Placeholders: {"{ordinal}"} (1st, 2nd), {"{pct}"}, {"{label}"} (the instalment), {"{so}"}, {"{seq}"}. At most 300 characters on the e-invoice.
          </div>
          <div data-testid="template-preview" style={{ fontSize: "var(--fs-13)" }}>{preview}</div>

          <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontWeight: 600 }}>
            <input type="checkbox" checked={v.active} disabled={!canWrite} onChange={(e) => setV({ ...v, active: e.target.checked })} /> E-invoice active
          </label>
          {note && <div role={note.ok ? "status" : "alert"} style={{ color: note.ok ? "var(--c-secondary-a, #2F5D4F)" : "var(--c-festive-b, #b3261e)" }}>{note.text}</div>}
          {canWrite && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => void submit()}>{save.isPending ? "Saving…" : "Save settings"}</Button>
            </div>
          )}
        </section>
      )}

      <section className={styles.card} style={card}>
        <h2 className={styles.cardTitle}>Outbox</h2>
        <label className={styles.field} style={{ maxWidth: 220 }}>
          <span className={styles.fieldLabel}>Show</span>
          <select className={styles.fieldInput} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {(Object.keys(STATUS_LABEL) as OutboxStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <DataTable<OutboxRow>
          tableId="conts-einvoice-outbox"
          exportName="einvoice-outbox"
          columns={COLUMNS}
          rows={outbox.data ? outbox.data.rows : null}
          loading={outbox.isLoading}
          error={outbox.isError ? "The outbox did not load." : null}
          emptyLabel="No renovation invoices or credit notes prepared yet."
          getRowKey={(r) => r.id}
          onRowClick={(r) => setOpenRow(r.id)}
        />
      </section>

      {openRow && (
        <Modal title={row.data ? `E-invoice — ${row.data.docNumber}` : "E-invoice"} onClose={() => setOpenRow(null)} ariaLabel="E-invoice record" width="min(720px, 100%)">
          {row.isLoading ? <div>Loading…</div> : row.data ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--fs-13)" }}>
              <div>{STATUS_LABEL[row.data.status]}{row.data.missing.length ? ` — missing: ${row.data.missing.join(", ")}` : ""}</div>
              <pre style={{ maxHeight: 420, overflow: "auto", background: "var(--bg-subtle, rgba(0,0,0,0.04))", padding: "var(--space-3)", borderRadius: 6, fontSize: 12 }}>
                {JSON.stringify(row.data.payload, null, 2)}
              </pre>
            </div>
          ) : <div role="alert">The record did not load.</div>}
        </Modal>
      )}
    </div>
  );
}
