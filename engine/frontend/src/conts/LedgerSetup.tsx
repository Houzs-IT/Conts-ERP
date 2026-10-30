// Conts only (not part of Houzs's code): the Ledger setup page (finance phase 1, spec 3.7 and 3.8). Its first block,
// Books, holds the two settings the whole ledger reads: the day the books start in the engine (nothing dated before
// it posts — it is in the AutoCount opening balances) and the month the fiscal year ends.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@2990s/design-system";
import { PageHeader } from "../components/Layout";
import { DateField } from "../vendor/scm/components/DateField";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { Link } from "react-router-dom";
import { SearchCombo } from "../vendor/scm/components/SearchCombo";
import { leafAccounts, useAccounts } from "../vendor/scm/lib/accounting-queries";
import {
  MONTHS, PROBLEM_TEXT, ROLE_LABELS, useLedgerSettings, useSaveLedgerSettings, useSetRole, useSetupStatus, type LedgerSettings,
} from "./ledgerSettings";
import { OpeningBalances } from "./OpeningBalances";
import { EverydayExpense } from "./EverydayExpense";

const isClearingCode = (code: string): boolean => /^32[67]-/.test(code);
const rm = (sen: number): string => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LedgerSetup() {
  const q = useLedgerSettings();
  const save = useSaveLedgerSettings();
  const askConfirm = useConfirm();
  // Saving needs the ledger's post key (PUT /accounting/settings/ledger); everyone with the Ledger may read.
  const canSave = useAuth().can("scm.payment_voucher.post");
  const [start, setStart] = useState("");
  const [fyEnd, setFyEnd] = useState(8);
  const [note, setNote] = useState<string | null>(null);

  // The form opens on what is saved.
  useEffect(() => {
    if (!q.data) return;
    setStart(q.data.ledgerStartDate ?? "");
    setFyEnd(q.data.fiscalYearEndMonth);
  }, [q.data]);

  const onSave = async () => {
    setNote(null);
    // Saves only from what was read: a form that failed to load is not a statement of the settings.
    if (!q.isSuccess) return;
    /* Only what changed is sent — the start date decides what posts (spec 3.8), so it is never resent by the way. */
    const patch: Partial<LedgerSettings> = {};
    const savedStart = q.data.ledgerStartDate ?? "";
    if (start !== savedStart) patch.ledgerStartDate = start || null;
    if (fyEnd !== q.data.fiscalYearEndMonth) patch.fiscalYearEndMonth = fyEnd;
    if (Object.keys(patch).length === 0) { setNote("Nothing changed."); return; }
    if (savedStart && patch.ledgerStartDate !== undefined) {
      const ok = await askConfirm({
        title: start ? `Move the start of the books to ${start}?` : "Clear the start of the books?",
        body: start
          ? "Documents dated before the new day stop posting; ones already posted stay in the books. Do this only when the opening balances are moved to match."
          : "With no start date every document posts again, including edits of old ones that are already in the AutoCount opening balances.",
        confirmLabel: start ? "Move it" : "Clear it",
      });
      if (!ok) return;
    }
    try {
      await save.mutateAsync(patch);
      setNote("Saved.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The settings could not be saved.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Finance" title="Ledger setup" />
      <section className={styles.card} style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 640 }}>
        <h2 className={styles.cardTitle}>Books</h2>
        {q.isError && <p style={{ color: "var(--c-festive-b, #B8331F)" }}>The ledger settings could not be loaded.</p>}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Books start on</span>
          <DateField value={start} onChange={setStart} aria-label="Books start on" className={styles.fieldInput} />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
            {start
              ? "Anything dated before this day is in the AutoCount opening balances: the ledger posts and reverses nothing before it."
              : "No start date yet — every document posts as it does today. Set it to the day the books move to this system."}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Fiscal year ends in</span>
          <select aria-label="Fiscal year ends in" className={styles.fieldInput} value={String(fyEnd)}
            onChange={(e) => setFyEnd(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
            The profit and loss opens on this fiscal year; the balance sheet keeps earlier years as retained earnings.
          </span>
        </label>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={save.isPending || !q.isSuccess || !canSave}>Save</Button>
          {note && <span style={{ fontSize: "var(--fs-13)" }}>{note}</span>}
          {!canSave && <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>Only someone who can post to the ledger may change these.</span>}
        </div>
      </section>
      <PostingRules canSave={canSave} />
      {/* The saved start date, not the one being typed: the opening day is the day before what is in force. */}
      {q.isSuccess && <OpeningBalances canSave={canSave} ledgerStartDate={q.data.ledgerStartDate} />}
      {/* Conts (finance phase 1.5; SOP 3.4): the expense accounts outside a project limit. */}
      <EverydayExpense canSave={canSave} />
    </div>
  );
}

/** Every automatic posting's account (spec 3.4): what each rule points at, what is wrong with it, and whether the
    ledger is ready to go live — every rule sound, every item group bound, every bank lettered, a start date set. */
function PostingRules({ canSave }: { canSave: boolean }) {
  const status = useSetupStatus();
  const accountsQ = useAccounts();
  const setRole = useSetRole();
  const askConfirm = useConfirm();
  const [note, setNote] = useState<string | null>(null);
  const leaves = useMemo(() => leafAccounts(accountsQ.data?.accounts ?? []).filter((a) => a.is_active !== false), [accountsQ.data]);
  /* Each rule's picker offers its kind only (the server says which): banks and the drawer, the 326- / 327- clearings
     (not money), or every account. */
  const optionsByKind = useMemo(() => {
    const opt = (xs: typeof leaves) => xs.map((a) => ({ value: a.account_code, label: `${a.account_code} — ${a.account_name}` }));
    return {
      any: opt(leaves),
      money: opt(leaves.filter((a) => a.acc_money === true)),
      clearing: opt(leaves.filter((a) => a.acc_money !== true && isClearingCode(a.account_code))),
    };
  }, [leaves]);

  /* Every change asks first (one stray Enter must not move a rule); a rule whose account already carries postings is
     asked about again, with what stays behind on the old account. */
  const choose = async (role: string, label: string, from: string, accountCode: string) => {
    setNote(null);
    const picked = leaves.find((a) => a.account_code === accountCode);
    if (!(await askConfirm({
      title: `Point ${label} at ${accountCode}${picked ? ` ${picked.account_name}` : ""}?`,
      body: `From now on this posting goes to ${accountCode} instead of ${from}.`,
      confirmLabel: "Change it",
    }))) return;
    try {
      await setRole.mutateAsync({ role, accountCode });
    } catch (err) {
      const e = err as Error & { status?: number; body?: string };
      let inUse: { error?: string; accountCode?: string; balanceSen?: number; message?: string } | null = null;
      try { inUse = e.status === 409 && e.body ? JSON.parse(e.body) : null; } catch { inUse = null; }
      if (inUse?.error !== "role_in_use") { setNote(e instanceof Error ? e.message : "The rule could not be saved."); return; }
      if (!(await askConfirm({
        title: `${inUse.accountCode} already has postings`,
        body: `${inUse.message ?? ""} Its balance is RM ${rm(inUse.balanceSen ?? 0)} and stays on ${inUse.accountCode}. Move it with a journal entry first, then change the rule.`,
        confirmLabel: "Change it anyway",
      }))) return;
      try { await setRole.mutateAsync({ role, accountCode, confirm: true }); } catch (again) { setNote(again instanceof Error ? again.message : "The rule could not be saved."); }
    }
  };

  if (!status.isSuccess) return null;
  const s = status.data;
  const badRoles = s.roles.filter((r) => r.problem).length;
  const reasons = [
    badRoles > 0 ? `${badRoles} posting rule${badRoles === 1 ? " needs an account" : "s need an account"}` : null,
    s.itemGroups.length > 0 ? `${s.itemGroups.length} item group${s.itemGroups.length === 1 ? " is" : "s are"} missing an account` : null,
    s.banksWithoutLetter.length > 0 ? `${s.banksWithoutLetter.length} bank${s.banksWithoutLetter.length === 1 ? " has" : "s have"} no voucher letter` : null,
    s.controlsWithChildren.length > 0 ? `${s.controlsWithChildren.length} customer or supplier control${s.controlsWithChildren.length === 1 ? " has" : "s have"} sub-accounts` : null,
    s.ledgerStartDate ? null : "the books have no start date",
  ].filter(Boolean);

  return (
    <section className={styles.card} style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h2 className={styles.cardTitle}>Posting rules</h2>
      <div style={{ fontWeight: 700, color: s.ready ? "var(--c-secondary-a, #2F5D4F)" : "var(--c-festive-b, #B8331F)" }}>
        {s.ready ? "Ready" : "Not ready"}
        {!s.ready && <span style={{ fontWeight: 400, color: "var(--fg-muted)" }}> — {reasons.join("; ")}</span>}
      </div>
      {note && <p style={{ color: "var(--c-festive-b, #B8331F)", margin: 0 }}>{note}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--fg-muted)" }}>
            <th style={{ padding: "4px 8px" }}>Rule</th>
            <th style={{ padding: "4px 8px", width: "45%" }}>Account</th>
            <th style={{ padding: "4px 8px" }}>Problem</th>
          </tr>
        </thead>
        <tbody>
          {s.roles.map((r) => {
            const label = ROLE_LABELS[r.role] ?? r.role;
            return (
              <tr key={r.role} data-problem={r.problem ?? undefined}
                style={{ borderTop: "1px solid var(--line)", background: r.problem ? "rgba(184, 51, 31, 0.08)" : undefined }}>
                <td style={{ padding: "4px 8px" }}>{label}</td>
                <td style={{ padding: "4px 8px" }}>
                  <SearchCombo fill options={optionsByKind[r.kind]} value={r.accountCode}
                    onChange={(code) => { if (code && code !== r.accountCode) void choose(r.role, label, r.accountCode, code); }}
                    aria-label={`${label} account`} placeholder={r.accountCode || "Type a code or a name…"} disabled={!canSave || setRole.isPending} />
                </td>
                <td style={{ padding: "4px 8px", color: "var(--c-festive-b, #B8331F)" }}>{r.problem ? `${r.accountCode} ${PROBLEM_TEXT[r.problem]}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.itemGroups.length > 0 && (
        <div>
          <b>Item groups missing an account</b> — set them on <Link to="/scm/accounting?tab=groups">Item group accounts</Link>:
          <ul style={{ margin: "4px 0 0 18px" }}>{s.itemGroups.map((g) => <li key={g.group}>{g.group}: {g.missing.join(", ")}</li>)}</ul>
        </div>
      )}
      {s.controlsWithChildren.length > 0 && (
        <div>
          <b>Controls with sub-accounts</b> — customers and suppliers are kept as Debtors and Suppliers, not as accounts under their control; move or remove these on <Link to="/scm/chart-of-accounts">Chart of accounts</Link>: {s.controlsWithChildren.join(", ")}
        </div>
      )}
      {s.banksWithoutLetter.length > 0 && (
        <div>
          <b>Banks without a voucher letter</b> — set it on <Link to="/scm/settlement-setup">Voucher numbering</Link>: {s.banksWithoutLetter.join(", ")}
        </div>
      )}
    </section>
  );
}
