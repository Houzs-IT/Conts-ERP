// Conts only (not part of Houzs's code): the lines of what finance is about to pay, each with the account finance chooses
// for it (chew, 16 Nov 2026: "科目行本来就我选的"). Make voucher (one ordinary voucher for everything ticked, from a bank)
// and Make AP invoice (one bill per request: the formal invoice, or a quotation booked first) both open it.
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Modal } from "../vendor/scm/components/Modal";
import { SearchCombo } from "../vendor/scm/components/SearchCombo";
import { Money } from "./ClaimsParts";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

export type PayLine = { key: string; source: string; payee: string; description: string; amountSen: number; accountCode: string | null };
export type PaySubmit = { accounts: Record<string, string>; bankAccountCode: string; provisional: boolean };

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", fontSize: "var(--fs-11)", fontWeight: 600, textTransform: "uppercase", color: "var(--fg-muted)", borderBottom: "1px solid var(--border-weak, #e3e1da)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 8px", verticalAlign: "middle", fontSize: "var(--fs-13)" };

export function PayDialog({ mode, title, lines, accounts, banks = [], allQuotation = false, busy, onClose, onSubmit }: {
  mode: "voucher" | "bill";
  title: string;
  lines: PayLine[];
  accounts: { code: string; name: string }[];
  banks?: { code: string; name: string }[];
  /** Every request is a deposit: its bill is the quotation, nothing to choose. */
  allQuotation?: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (v: PaySubmit) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, l.accountCode ?? ""])));
  const [bank, setBank] = useState("");
  const [paper, setPaper] = useState<"invoice" | "quotation">(allQuotation ? "quotation" : "invoice");
  const options = useMemo(() => accounts.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })), [accounts]);
  const missing = lines.filter((l) => !chosen[l.key]).length;
  const total = lines.reduce((n, l) => n + l.amountSen, 0);
  const ready = missing === 0 && (mode === "bill" || !!bank) && !busy;
  /* One account for every line still empty: a pile of the same kind of cost is chosen once. */
  const fillEmpty = (code: string) => setChosen((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v || code])));

  return (
    <Modal title={title} onClose={onClose} ariaLabel={title} actions={(
      <Button variant="primary" disabled={!ready} onClick={() => onSubmit({ accounts: chosen, bankAccountCode: bank, provisional: paper === "quotation" })}>
        {busy ? "Making…" : mode === "voucher" ? "Make voucher" : lines.length && new Set(lines.map((l) => l.source)).size > 1 ? "Make AP invoices" : "Make AP invoice"}
      </Button>
    )}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-end" }}>
          {mode === "voucher" && (
            <label className={styles.field} style={{ minWidth: 260 }}>
              <span className={styles.fieldLabel}>Pay from *</span>
              <select className={styles.fieldInput} value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Bank">
                <option value="">Choose the bank…</option>
                {banks.map((b) => <option key={b.code} value={b.code}>{b.code} {b.name}</option>)}
              </select>
            </label>
          )}
          {mode === "bill" && !allQuotation && (
            <label className={styles.field} style={{ minWidth: 260 }}>
              <span className={styles.fieldLabel}>The paper</span>
              <select className={styles.fieldInput} value={paper} onChange={(e) => setPaper(e.target.value as "invoice" | "quotation")} aria-label="The paper">
                <option value="invoice">The formal invoice</option>
                <option value="quotation">A quotation (no formal invoice yet)</option>
              </select>
            </label>
          )}
          {mode === "bill" && <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>One AP invoice per request; a deposit's is its quotation.</span>}
          {missing > 1 && (
            <label className={styles.field} style={{ minWidth: 280 }}>
              <span className={styles.fieldLabel}>Same account for the {missing} empty lines</span>
              <SearchCombo options={options} value="" onChange={fillEmpty} className={styles.fieldInput} aria-label="Account for the empty lines" placeholder="Type to find the account" />
            </label>
          )}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>From</th>
              <th style={th}>Paid to</th>
              <th style={th}>Description</th>
              <th style={{ ...th, textAlign: "right" }}>Amount</th>
              <th style={{ ...th, width: 320 }}>Account *</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{l.source}</td>
                <td style={td}>{l.payee}</td>
                <td style={td}>{l.description || "—"}</td>
                <td style={{ ...td, textAlign: "right" }}><Money sen={l.amountSen} /></td>
                <td style={td}>
                  <SearchCombo options={options} value={chosen[l.key] ?? ""} onChange={(code) => setChosen((c) => ({ ...c, [l.key]: code }))}
                    className={styles.fieldInput} aria-label={`Account for ${l.source} ${l.description}`} placeholder="Type to find the account" />
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--border-weak, #e3e1da)" }}>
              <td colSpan={3} style={{ ...td, fontWeight: 600 }}>{lines.length} {lines.length === 1 ? "line" : "lines"}{missing ? ` · ${missing} without an account` : ""}</td>
              <td style={{ ...td, textAlign: "right" }}><Money sen={total} strong /></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
