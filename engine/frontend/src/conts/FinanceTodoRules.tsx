// Conts: /scm/finance/rules — To do rules (ported from Houzs FinanceTodoRules.tsx, the rule switches only): which
// built-in rules fill Finance's To do. Nothing is deleted here — a rule is switched off and its jobs stop showing.
// Ledger full switches; everyone else with the Ledger reads. Houzs's routines, groups and template rules are not here.
import { PageHeader } from "../components/Layout";
import styles from "./FinanceTodo.module.css";
import { useSaveRulesOff, useTodoSettings, type TodoRule } from "./financeTodoQueries";

/** What each rule finds, where it lands, whose desk it is on (backend conts/finance-todo.ts). */
export const RULES: Array<[TodoRule, string, string, string, string]> = [
  ["requests", "Payment requests", "Requests sent from Property OS, waiting for payment, no voucher or AP invoice made yet", "Payments", "Finance"],
  ["utilities", "Utility bills due", "Utility bill requests waiting for payment, due within 7 days or past due", "Payments", "Finance"],
  ["claims-check", "Staff claims to check", "Receipts handed in, not checked yet", "Payments", "Finance"],
  ["claims-pay", "Staff claims to pay back", "Claims finance pays back, checked, with no voucher yet", "Payments", "Finance"],
  ["pv-check", "Vouchers to check", "Vouchers prepared, not yet checked", "Payments", "Checker"],
  ["pv-approve", "Vouchers to approve", "Checked vouchers waiting for approval", "Payments", "Approver"],
  ["ap-overdue", "Supplier bills overdue", "AP invoices past their due date and not fully paid", "Payments", "Finance"],
  ["ap-due", "Supplier bills due soon", "AP invoices due within 7 days and not fully paid", "Payments", "Finance"],
  ["limits", "Limit requests", "Extra project limit or budget asked for, not decided (never by whoever asked)", "Payments", "Limit approver"],
  ["bank-missing", "Bank statement missing", "A bank account with no statement for 3 days", "Bank statements", "Finance"],
  ["bank-decide", "Bank lines to match", "Statement lines not matched, in a month not locked", "Bank statements", "Finance"],
  ["receipts", "Payments to confirm", "Customer payments whose receipt is still draft: the money is not seen in the bank yet", "Money in & e-invoice", "Finance"],
  ["deposit-invoices", "Deposit invoices to issue", "Confirmed order payments with no deposit invoice (when deposit invoices are on)", "Money in & e-invoice", "Finance"],
  ["einvoice", "E-invoices to fix", "Renovation invoices and credit notes not ready for LHDN, or rejected", "Money in & e-invoice", "Finance"],
];

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`${styles.switch} ${on ? styles.switchOn : ""}`} onClick={onClick} />;
}

export function FinanceTodoRulesPage() {
  const q = useTodoSettings();
  const save = useSaveRulesOff();
  const s = q.data;
  const off = new Set(s?.rulesOff ?? []);
  const flip = (id: string) => save.mutate(off.has(id) ? [...off].filter((r) => r !== id) : [...off, id]);
  return (
    <div>
      <PageHeader eyebrow="Finance · Setup" title="To do rules" />
      {q.isError && <div className={styles.problem}>The rules could not be read — {q.error instanceof Error ? q.error.message : "try again"}.</div>}
      {save.isError && <div className={styles.problem}>Not saved — {save.error instanceof Error ? save.error.message : "try again"}.</div>}
      {s && (
        <div className={styles.rulesPage}>
          <section className={styles.card} aria-label="Built-in rules">
            <div className={styles.cardHead}>Rules<span className={styles.cardNote}>
              Each one fills To do from the books by itself. Switch one off and its jobs stop showing.{s.mayEdit ? "" : " Only Ledger full can switch them."}
            </span></div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Rule</th><th>Puts it under</th><th>For</th><th>On</th></tr></thead>
                <tbody>
                  {RULES.map(([id, name, finds, group, who]) => (
                    <tr key={id} className={off.has(id) ? styles.offRow : ""}>
                      <td><div className={styles.ruleName}>{name}</div><div className={styles.ruleFinds}>{finds}</div></td>
                      <td>{group}</td>
                      <td>{who}</td>
                      <td><Switch on={!off.has(id)} label={`${name} on`} disabled={!s.mayEdit || save.isPending} onClick={() => flip(id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
