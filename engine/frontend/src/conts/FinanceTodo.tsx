// Conts: /scm/finance — Finance's To do (ported from Houzs pages/scm-v2/finance/FinanceTodo.tsx, the owner's Claude
// Design "Finance-1a-To-do"): what is waiting on you, on others, and what was done today, with the month's checklist.
// Every job is raised on the server from the live books (backend conts/finance-todo.ts); each one says what it is,
// how long it has waited, and links to the screen where it is handled. Houzs's money board, tasks, routines and
// calendar are not here. Without the Ledger the address shows the Finance menu instead (FinanceHome).
import { Link } from "react-router-dom";
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronRight, CircleDot, FileText, Gauge, HandCoins, Landmark, LayoutGrid,
  Receipt, Send, Settings2, Upload, Wallet, Zap, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "../components/Layout";
import { useAuth } from "../auth/AuthContext";
import { ScmSubgroupHub } from "../pages/ScmSubgroupHub";
import { fmtDate, fmtSen } from "../vendor/shared/format";
import { canUseLedger } from "./ledger";
import styles from "./FinanceTodo.module.css";
import { useFinanceTodo, type FinanceTodo, type TodoCheck, type TodoGroup, type TodoIcon, type TodoJob, type TodoTone } from "./financeTodoQueries";

const ICON: Record<TodoIcon, LucideIcon> = {
  upload: Upload, landmark: Landmark, send: Send, wallet: Wallet, receipt: Receipt, "alert-triangle": AlertTriangle,
  "file-text": FileText, "hand-coins": HandCoins, zap: Zap, gauge: Gauge,
};

/** Tile colours by kind of job (the design's `tone` table). */
const TILE: Record<TodoTone, string> = { bank: styles.tileBank, money: styles.tileMoney, out: styles.tileOut, err: styles.tileErr };

const GROUPS: Array<{ id: TodoGroup; label: string; icon: LucideIcon }> = [
  { id: "pay", label: "Payments", icon: Wallet },
  { id: "bank", label: "Bank statements", icon: Landmark },
  { id: "in", label: "Money in & e-invoice", icon: BookOpen },
];

const dayNo = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

type Tone = "late" | "warn" | "info" | "calm";

/** How long a job has waited, as the design's tag: New, Waiting 1 day (calm), 2 days (warn), 3+ (late, with a dot). */
export function ageTag(since: string | null, today: string): { text: string; tone: Tone; dot: boolean } | null {
  if (!since) return null;
  const n = Math.max(0, dayNo(today) - dayNo(since));
  if (n === 0) return { text: "New", tone: "info", dot: false };
  const text = `Waiting ${n} day${n > 1 ? "s" : ""}`;
  if (n === 1) return { text, tone: "calm", dot: false };
  if (n === 2) return { text, tone: "warn", dot: false };
  return { text, tone: "late", dot: true };
}

const TAG_CLASS: Record<Tone, string> = { late: styles.tagLate, warn: styles.tagWarn, info: styles.tagInfo, calm: styles.tagCalm };

function Tag({ job, today }: { job: TodoJob; today: string }) {
  const t = ageTag(job.since, today);
  if (!t) return null;
  return (
    <span className={`${styles.tag} ${TAG_CLASS[t.tone]}`}>
      {t.dot && <span className={styles.dot} />}
      {t.text}
    </span>
  );
}

function JobRow({ job, today, others = false }: { job: TodoJob; today: string; others?: boolean }) {
  const Icon = ICON[job.icon] ?? FileText;
  const button = (
    <Link to={job.action.to} className={`${styles.action} ${!others && job.action.primary ? styles.actionPrimary : styles.actionSecondary}`}>
      {job.action.label}<ChevronRight size={14} />
    </Link>
  );
  return (
    <div className={styles.row} data-testid={`todo-job-${job.rule}`}>
      <span className={`${styles.tile} ${TILE[job.tone]}`}><Icon size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div className={styles.titleLine}>
          <span className={styles.title}>{job.title}</span>
          <Tag job={job} today={today} />
        </div>
        <div className={styles.detail} title={job.detail}>{job.detail}</div>
      </div>
      <div className={styles.amount}>{job.amountSen != null && job.amountSen !== 0 ? fmtSen(job.amountSen) : ""}</div>
      {others ? (
        <span className={styles.othersSide}>
          {job.who && <span className={styles.pill}>{job.who}</span>}
          {button}
        </span>
      ) : button}
    </div>
  );
}

/** Oldest first; a job that has not started waiting (a bill not yet due) last. */
const byWait = (jobs: TodoJob[]): TodoJob[] =>
  [...jobs].sort((a, b) => (a.since ?? "9999-12-31").localeCompare(b.since ?? "9999-12-31") || a.title.localeCompare(b.title));

function Groups({ data }: { data: FinanceTodo }) {
  const shown = GROUPS.map((g) => ({ ...g, jobs: byWait(data.mine.filter((j) => j.group === g.id)) })).filter((g) => g.jobs.length > 0);
  if (shown.length === 0) {
    return <div className={styles.card}><div className={styles.empty}>Nothing is waiting on you.</div></div>;
  }
  return (
    <div className={styles.groups}>
      {shown.map((g) => (
        <div key={g.id} className={styles.card} aria-label={g.label}>
          <div className={styles.groupHead}>
            <g.icon size={14} />
            <span className={styles.groupLabel}>{g.label}</span>
            <span className={styles.groupCount}>{g.jobs.length}</span>
          </div>
          {g.jobs.map((j) => <JobRow key={j.key} job={j} today={data.today} />)}
        </div>
      ))}
    </div>
  );
}

function CheckRow({ c }: { c: TodoCheck }) {
  const icon = c.state === "late"
    ? <AlertTriangle size={15} className={styles.checkLate} />
    : c.state === "open" ? <CircleDot size={15} className={styles.checkOpen} /> : <CheckCircle2 size={15} className={styles.checkOk} />;
  const tone = c.state === "late" ? styles.valueLate : c.state === "open" ? styles.valueOpen : styles.valueOk;
  const body = (<>{icon}<span className={styles.checkLabel}>{c.label}</span><span className={`${styles.checkValue} ${tone}`}>{c.value}</span></>);
  return c.to
    ? <Link to={c.to} className={styles.checkRow} title={c.detail}>{body}</Link>
    : <div className={styles.checkRow} title={c.detail}>{body}</div>;
}

const monthName = (ym: string): string =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-MY", { month: "long", timeZone: "UTC" });

export function FinanceTodoPage() {
  const q = useFinanceTodo();
  const data = q.data;
  const doneCount = data?.done.length ?? 0;
  const jobCount = doneCount + (data?.mine.length ?? 0);
  const pct = jobCount > 0 ? Math.round((doneCount / jobCount) * 100) : 0;
  const carried = data ? data.mine.filter((j) => (j.since ?? data.today) < data.today).length : 0;

  return (
    <div>
      <PageHeader
        eyebrow={`Finance${data ? ` · ${fmtDate(data.today)}` : ""}`}
        title="To do"
        actions={(
          <div className={styles.headStats}>
            {data && <span>{doneCount} of {jobCount} done today</span>}
            {data && <span className={styles.bar}><span className={styles.barFill} style={{ width: `${pct}%` }} /></span>}
            <Link to="/scm/finance/rules" className={`${styles.action} ${styles.actionSecondary}`} title="To do rules"><Settings2 size={14} />Rules</Link>
            <Link to="/scm/finance/menu" className={`${styles.action} ${styles.actionSecondary}`} title="Every Finance screen"><LayoutGrid size={14} />All screens</Link>
          </div>
        )}
      />
      {q.isError && <div className={styles.problem}>To do could not be read — {q.error instanceof Error ? q.error.message : "try again"}.</div>}
      {data && data.problems.length > 0 && (
        <div className={styles.problem}>Some of it could not be read, so it is not listed: {data.problems.join(" · ")}.</div>
      )}
      {!data && !q.isError && <div className={styles.page} aria-busy="true"><div className={styles.card} style={{ height: 320 }} /><div className={styles.card} style={{ height: 240 }} /></div>}
      {data && (
        <div className={styles.page}>
          <div className={styles.column}>
            <section aria-label="Waiting on you">
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>Waiting on you</span>
                <span className={styles.sectionCount}>{data.mine.length}</span>
                {carried > 0 && <span className={styles.carried}>· {carried} from earlier days</span>}
              </div>
              <Groups data={data} />
            </section>

            {data.others.length > 0 && (
              <section aria-label="Waiting on others">
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>Waiting on others</span>
                  <span className={styles.sectionCount}>{data.others.length}</span>
                </div>
                <div className={styles.card}>
                  {byWait(data.others).map((j) => <JobRow key={j.key} job={j} today={data.today} others />)}
                </div>
              </section>
            )}

            <section aria-label="Done today">
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>Done today</span>
                <span className={styles.sectionCount}>{data.done.length}</span>
              </div>
              <div className={styles.card}>
                {data.done.length === 0 && <div className={styles.empty}>Nothing done yet today.</div>}
                {data.done.map((d) => (
                  <div key={d.key} className={styles.doneRow}>
                    <CheckCircle2 size={16} />
                    <span className={styles.doneText}>{d.text}</span>
                    {d.ref && <span className={styles.ref}>{d.ref}</span>}
                    <span className={styles.time}>{d.at}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className={styles.side}>
            <div className={styles.checkCard} aria-label="Month checklist">
              <div className={styles.checkHead}>
                <span className={styles.checkTitle}>{monthName(data.checklist.month)} checklist</span>
                <span className={styles.checkDays}>{data.checklist.daysLeft === 0 ? "last day" : `${data.checklist.daysLeft} day${data.checklist.daysLeft > 1 ? "s" : ""} left`}</span>
              </div>
              {data.checklist.items.map((c) => <CheckRow key={c.key} c={c} />)}
              <Link to="/scm/accounting?tab=close" className={styles.checkReview}>Review {monthName(data.checklist.month)}</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FINANCE_MENU = { groupId: "scm-finance", description: "Accounting and outstanding receivables." } as const;

/** /scm/finance/menu — every Finance screen as cards (the hub /scm/finance used to be). */
export function FinanceMenu() {
  return <ScmSubgroupHub {...FINANCE_MENU} />;
}

/** /scm/finance — To do for whoever opens the Ledger; the Finance menu for everyone else (official receipts, say). */
export function FinanceHome() {
  const { user } = useAuth();
  return canUseLedger(user?.permissions) ? <FinanceTodoPage /> : <FinanceMenu />;
}
