// Conts only (not part of Houzs's code): the Ledger setup page (finance phase 1, spec 3.7 and 3.8). Its first block,
// Books, holds the two settings the whole ledger reads: the day the books start in the engine (nothing dated before
// it posts — it is in the AutoCount opening balances) and the month the fiscal year ends.
//
// chew 10 Nov 2026 ("ledger setup 很乱"): a go-live checklist on top — what the system itself can check — then three
// tabs: Go-live (books, opening balances, old renovation contracts, opening deposits, in that order), Posting rules,
// and Departments & limit. Every block sits in the same frame (SetupCard). Layout only: no setting changes.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@2990s/design-system";
import { Button as TabButton } from "../components/Button";
import { Badge } from "../components/Badge";
import { PageHeader } from "../components/Layout";
import { DateField } from "../vendor/scm/components/DateField";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { Link, useSearchParams } from "react-router-dom";
import { CircleAlert, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { SearchCombo } from "../vendor/scm/components/SearchCombo";
import { leafAccounts, useAccounts } from "../vendor/scm/lib/accounting-queries";
import {
  MONTHS, PROBLEM_TEXT, ROLE_LABELS, useLedgerSettings, useSaveLedgerSettings, useSetRole, useSetupStatus,
  type LedgerSettings, type LedgerSetupStatus,
} from "./ledgerSettings";
import { useOpeningCheck } from "./opening";
import { useFloats } from "./claimsQueries";
import { SetupCard } from "./SetupCard";
import { OpeningBalances } from "./OpeningBalances";
import { EverydayExpense } from "./EverydayExpense";
import { ProjectLimitSettings } from "./ProjectLimitSettings";
import { SubDepartments } from "./SubDepartments";
import { RenovationOpening } from "./RenovationOpening";
import { OpeningDeposits } from "./OpeningDeposits";

const isClearingCode = (code: string): boolean => /^32[67]-/.test(code);
const rm = (sen: number): string => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** An item group's missing binding in the words of the Item group accounts page, not the column name. */
const SLOT_WORD: Record<string, string> = {
  purchase_account: "Purchase", sales_account: "Sales", sales_return_account: "Sales Return", purchase_return_account: "Purchase Return",
};
const missingText = (missing: string[]): string =>
  (missing.length >= 4 ? "all four accounts" : missing.map((m) => SLOT_WORD[m] ?? m).join(", "));

/** The page's tabs, in order; the address keeps the open one (?tab=), so a link or a refresh lands on it. */
const TABS = [["golive", "Go-live"], ["rules", "Posting rules"], ["departments", "Departments & limit"]] as const;
type Tab = (typeof TABS)[number][0];
const tabFrom = (v: string | null): Tab => (TABS.some(([k]) => k === v) ? (v as Tab) : "golive");

export function LedgerSetup() {
  const q = useLedgerSettings();
  // Saving needs the ledger's post key (PUT /accounting/settings/ledger); everyone with the Ledger may read.
  const { can } = useAuth();
  const canSave = can("scm.payment_voucher.post");
  const canApproveLimit = can("scm.project_limit.approve");
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get("tab"));
  const openTab = (t: Tab) => setParams((p) => { const next = new URLSearchParams(p); next.set("tab", t); return next; }, { replace: true });
  /* The checklist's Open: the block's tab, then the block itself in view. */
  const openBlock = (t: Tab, title: string) => {
    openTab(t);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom (the tests) has no scrollIntoView
    requestAnimationFrame(() => document.querySelector(`section[aria-label="${title}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  };
  const startDate = q.data?.ledgerStartDate ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title="Ledger setup"
        description="What the books need before they start in this system, and the settings finance keeps." />
      <GoLiveChecklist ledgerStartDate={startDate} onOpen={openBlock} />
      <div role="tablist" aria-label="Ledger setup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map(([k, label]) => (
          <TabButton key={k} role="tab" aria-selected={tab === k} variant={tab === k ? "primary" : "secondary"} className="h-8"
            onClick={() => openTab(k)}>
            {label}
          </TabButton>
        ))}
      </div>
      {tab === "golive" && (
        <>
          <Books canSave={canSave} />
          {/* The saved start date, not the one being typed: the opening day is the day before what is in force. */}
          {q.isSuccess && <OpeningBalances canSave={canSave} ledgerStartDate={q.data.ledgerStartDate} />}
          {/* Renovation contracts signed before the books start: their accounts and what AutoCount invoiced (plan Task 8). */}
          {q.isSuccess && <RenovationOpening canSave={canSave} ledgerStartDate={q.data.ledgerStartDate} />}
          {q.isSuccess && <OpeningDeposits canSave={canSave} ledgerStartDate={q.data.ledgerStartDate} />}
        </>
      )}
      {tab === "rules" && <PostingRules canSave={canSave} />}
      {tab === "departments" && (
        <>
          {/* Conts (SOP 1.1; chew 4 Nov 2026): the sub-departments every line names — the ledger post key. */}
          <SubDepartments canSave={canSave} />
          {/* Conts (SOP 3.4; chew 4 Nov 2026): the limit on or off, and the company's share — the limit's own key. */}
          <ProjectLimitSettings canSave={canApproveLimit} />
          {/* Conts (finance phase 1.5; SOP 3.4): the expense accounts outside a project limit. */}
          <EverydayExpense canSave={canSave} />
        </>
      )}
    </div>
  );
}

/* ── What go-live still needs, as far as the system can tell ─────────────────────────────────────────────────── */
type CheckState = "done" | "todo" | "warn" | "wait";
type CheckRow = { key: string; label: string; state: CheckState; detail: string; action: ReactNode };

const STATE_ICON: Record<CheckState, ReactNode> = {
  done: <CircleCheck size={18} strokeWidth={2} className="text-synced" aria-hidden />,
  todo: <CircleX size={18} strokeWidth={2} className="text-err" aria-hidden />,
  warn: <CircleAlert size={18} strokeWidth={2} className="text-warning-text" aria-hidden />,
  wait: <CircleDashed size={18} strokeWidth={2} className="text-ink-muted" aria-hidden />,
};
const STATE_WORD: Record<CheckState, string> = { done: "Done", todo: "To do", warn: "Check", wait: "Waiting" };

function GoLiveChecklist({ ledgerStartDate, onOpen }: { ledgerStartDate: string | null; onOpen: (t: Tab, block: string) => void }) {
  const status = useSetupStatus();
  const opening = useOpeningCheck(!!ledgerStartDate);
  const floats = useFloats();
  const s: LedgerSetupStatus | undefined = status.data;
  /** `block`: the title of the block to bring into view on that tab. */
  const open = (t: Tab, label: string, block: string) => (
    <TabButton variant="ghost" className="h-8 px-3" onClick={() => onOpen(t, block)} aria-label={`Open ${label}`}>Open</TabButton>
  );
  const go = (to: string, label: string) => (
    <Link to={to} className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-semibold text-ink-secondary hover:bg-surface-dim hover:text-ink"
      aria-label={`Open ${label}`}>Open</Link>
  );

  const rows: CheckRow[] = [];
  rows.push({
    key: "start", label: "Books start date",
    state: ledgerStartDate ? "done" : "todo",
    detail: ledgerStartDate ? `The books start on ${ledgerStartDate}.` : "Not set: every document posts as it does today.",
    action: open("golive", "Books start date", "Books"),
  });
  if (s) {
    const badRoles = s.roles.filter((r) => r.problem).length;
    const ruleIssues = [
      badRoles > 0 ? plural(badRoles, "posting rule needs an account", "posting rules need an account") : null,
      s.banksWithoutLetter.length > 0 ? plural(s.banksWithoutLetter.length, "bank has no voucher letter", "banks have no voucher letter") : null,
      s.controlsWithChildren.length > 0 ? plural(s.controlsWithChildren.length, "customer or supplier control has sub-accounts", "customer or supplier controls have sub-accounts") : null,
    ].filter((x): x is string => !!x);
    rows.push({
      key: "rules", label: "Posting rules and banks",
      state: ruleIssues.length ? "todo" : "done",
      detail: ruleIssues.length ? `${ruleIssues.join("; ")}.` : `All ${s.roles.length} rules point at a usable account; every bank has its voucher letter.`,
      action: open("rules", "Posting rules and banks", "Posting rules"),
    });
    rows.push({
      key: "groups", label: "Item group accounts",
      state: s.itemGroups.length ? "todo" : "done",
      detail: s.itemGroups.length
        ? `${plural(s.itemGroups.length, "group is", "groups are")} missing an account (${s.itemGroups.map((g) => g.group).join(", ")}): their sales and purchases cannot post.`
        : "Every item group has its four accounts.",
      action: go("/scm/accounting?tab=groups", "Item group accounts"),
    });
  }
  if (ledgerStartDate) {
    const c = opening.data;
    rows.push({
      key: "opening", label: "Opening balances",
      state: !c ? "wait" : !c.openingJeNo ? "todo" : c.balanced ? "done" : "warn",
      detail: !c ? (opening.isError ? "The opening check could not be loaded." : "Checking…")
        : !c.openingJeNo ? `Not imported yet: AutoCount's trial balance on ${c.openingDay}, then the open invoices and bills.`
          : c.balanced ? `Imported as ${c.openingJeNo}, and the figures agree.` : `Imported as ${c.openingJeNo}, but the figures do not agree yet.`,
      action: open("golive", "Opening balances", "Opening balances"),
    });
  }
  if (floats.isSuccess) {
    const live = floats.data.floats.filter((f) => f.active);
    rows.push({
      key: "floats", label: "Petty cash floats",
      state: live.length ? "done" : "todo",
      detail: live.length ? `${plural(live.length, "float is", "floats are")} set up.` : "None yet: each department's float, its keeper and the cash in hand at go-live.",
      action: go("/scm/petty-cash", "Petty cash floats"),
    });
  }
  const done = rows.filter((r) => r.state === "done").length;

  return (
    <SetupCard title="Go-live checklist"
      description="What the system can check before the books start here. The renovation contracts and deposits at go-live are on the Go-live tab."
      aside={rows.length > 0 ? <Badge tone={done === rows.length ? "success" : "warning"} size="sm" caseless>{done} of {rows.length} done</Badge> : undefined}>
      {status.isError && <p className="text-[13px] text-err" style={{ margin: 0 }}>The setup status could not be loaded.</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Go-live checklist">
        {rows.map((r, i) => (
          <li key={r.key} data-state={r.state}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: i === 0 ? undefined : "1px solid var(--line)" }}>
            <span title={STATE_WORD[r.state]} style={{ display: "inline-flex" }}>{STATE_ICON[r.state]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-[13px] font-semibold text-ink">{r.label}<span className="sr-only"> — {STATE_WORD[r.state]}</span></div>
              <div className="text-[12px] text-ink-muted">{r.detail}</div>
            </div>
            {r.action}
          </li>
        ))}
      </ul>
    </SetupCard>
  );
}

/* ── Books: the day the books start and the month the fiscal year ends ─────────────────────────────────────────── */
function Books({ canSave }: { canSave: boolean }) {
  const q = useLedgerSettings();
  const save = useSaveLedgerSettings();
  const askConfirm = useConfirm();
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
    <SetupCard title="Books" description="The day the books start in this system, and the month the fiscal year ends.">
      {q.isError && <p className="text-[13px] text-err" style={{ margin: 0 }}>The ledger settings could not be loaded.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, maxWidth: 820 }}>
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
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={save.isPending || !q.isSuccess || !canSave}>Save</Button>
        {note && <span style={{ fontSize: "var(--fs-13)" }}>{note}</span>}
        {!canSave && <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>Only someone who can post to the ledger may change these.</span>}
      </div>
    </SetupCard>
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
    <SetupCard title="Posting rules" description="The account each automatic posting goes to. Each rule offers only the accounts it may use."
      aside={<Badge tone={s.ready ? "success" : "error"} size="sm" caseless>{s.ready ? "Ready" : "Not ready"}</Badge>}>
      {!s.ready && <div className="text-[13px] text-ink-muted">{reasons.join("; ")}.</div>}
      {note && <p className="text-[13px] text-err" style={{ margin: 0 }}>{note}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--fg-muted)" }}>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Rule</th>
              <th style={{ padding: "6px 8px", fontWeight: 500, width: "45%" }}>Account</th>
              <th style={{ padding: "6px 8px", fontWeight: 500 }}>Problem</th>
            </tr>
          </thead>
          <tbody>
            {s.roles.map((r) => {
              const label = ROLE_LABELS[r.role] ?? r.role;
              return (
                <tr key={r.role} data-problem={r.problem ?? undefined}
                  style={{ borderTop: "1px solid var(--line)", background: r.problem ? "rgba(184, 51, 31, 0.08)" : undefined }}>
                  <td style={{ padding: "6px 8px" }}>{label}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <SearchCombo fill options={optionsByKind[r.kind]} value={r.accountCode}
                      onChange={(code) => { if (code && code !== r.accountCode) void choose(r.role, label, r.accountCode, code); }}
                      aria-label={`${label} account`} placeholder={r.accountCode || "Type a code or a name…"} disabled={!canSave || setRole.isPending} />
                  </td>
                  <td style={{ padding: "6px 8px" }} className="text-err">{r.problem ? `${r.accountCode} ${PROBLEM_TEXT[r.problem]}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {s.itemGroups.length > 0 && (
        <div className="text-[13px]">
          <b>Item groups missing an account</b> — set them on <Link className="underline" to="/scm/accounting?tab=groups">Item group accounts</Link>:
          <ul style={{ margin: "4px 0 0 18px" }}>{s.itemGroups.map((g) => <li key={g.group}>{g.group}: {missingText(g.missing)}</li>)}</ul>
        </div>
      )}
      {s.controlsWithChildren.length > 0 && (
        <div className="text-[13px]">
          <b>Controls with sub-accounts</b> — customers and suppliers are kept as Debtors and Suppliers, not as accounts under their control; move or remove these on <Link className="underline" to="/scm/chart-of-accounts">Chart of accounts</Link>: {s.controlsWithChildren.join(", ")}
        </div>
      )}
      {s.banksWithoutLetter.length > 0 && (
        <div className="text-[13px]">
          <b>Banks without a voucher letter</b> — set it on <Link className="underline" to="/scm/settlement-setup">Voucher numbering</Link>: {s.banksWithoutLetter.join(", ")}
        </div>
      )}
    </SetupCard>
  );
}
