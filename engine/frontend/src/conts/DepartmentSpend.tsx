// Conts only (not part of Houzs's code): Spending by department — /scm/department-spend (SOP 1.1; chew 4 Nov 2026;
// backend acc/sub-department-spend.ts). Top: each department's cost against the period of the same length before.
// Then each department's sub-departments (Cleaning, Maintenance, Dream Crafter, The Conts…) adding up to it; the money
// is counted once, so the units in Rental Unit Costs are the same money seen by unit. Last: a team's costs that name
// no unit, for finance to check.
import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { DateField } from "../vendor/scm/components/DateField";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

type SpendRow = { subDepartmentId: string; name: string; active: boolean; incomeSen: number; costSen: number; previousCostSen: number };
type Spend = {
  from: string; to: string; previous: { from: string; to: string };
  departments: Array<{ department: "rental" | "supply" | "shared"; label: string; incomeSen: number; costSen: number; previousCostSen: number; rows: SpendRow[] }>;
  totals: { incomeSen: number; costSen: number; previousCostSen: number };
};
type NoUnit = { rows: Array<{ jeNo: string; date: string; source: string; subDepartment: string; accountCode: string; accountName: string; amountSen: number; notes: string | null }> };

const MUTED = "var(--fg-muted)";
const num: CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };
const th: CSSProperties = { padding: "8px 12px", fontSize: "var(--fs-12)", fontWeight: 600, color: MUTED, borderBottom: "1px solid var(--line)", textAlign: "left", position: "sticky", top: 0, background: "var(--surface, inherit)" };
const td: CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--line)" };
const card: CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const myt = (): string => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const monthStart = (d: string): string => `${d.slice(0, 7)}-01`;
const rm = (sen: number): string => {
  const s = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(sen) / 100);
  return sen < 0 ? `(${s})` : s;
};
const pct = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A cost against the period before. More cost is bad, less is good; nothing before has no percentage. */
export function costChange(nowSen: number, beforeSen: number): { text: string; tone: "default" | "success" | "error" } {
  if (beforeSen === 0) return nowSen === 0 ? { text: "No cost either period", tone: "default" } : { text: "New this period", tone: "default" };
  const change = ((nowSen - beforeSen) / Math.abs(beforeSen)) * 100;
  if (change === 0) return { text: "Same as previous period", tone: "default" };
  return { text: `${change > 0 ? "▲" : "▼"} ${pct.format(Math.abs(change))}% vs previous period`, tone: change > 0 ? "error" : "success" };
}
const toneColour = (t: "default" | "success" | "error") => (t === "error" ? "var(--c-festive-b, #b3261e)" : t === "success" ? "var(--c-success, #1a7f4b)" : MUTED);

export function DepartmentSpend() {
  const [from, setFrom] = useState(monthStart(myt()));
  const [to, setTo] = useState(myt());
  const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const spend = useQuery({
    queryKey: ["conts-department-spend", from, to],
    queryFn: () => authedFetch<Spend>(`/accounting/reports/sub-departments?${range}`),
    enabled: from <= to, staleTime: 60_000,
  });
  const noUnit = useQuery({
    queryKey: ["conts-no-unit-costs", from, to],
    queryFn: () => authedFetch<NoUnit>(`/accounting/no-unit-costs?${range}`),
    enabled: from <= to, staleTime: 60_000,
  });
  const d = spend.data;
  const noUnitTotal = useMemo(() => (noUnit.data?.rows ?? []).reduce((s, r) => s + r.amountSen, 0), [noUnit.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1280 }}>
      <PageHeader
        eyebrow="Finance"
        title="Spending by department"
        description={d ? `${d.from} to ${d.to}, against ${d.previous.from} to ${d.previous.to}. Amounts in RM; each line counted once.` : "What each department and its sub-departments earned and spent."}
        actions={(
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label className={styles.field} style={{ minWidth: 150 }}>
              <span className={styles.fieldLabel}>From</span>
              <DateField value={from} onChange={(v) => v && setFrom(v)} aria-label="From" className={styles.fieldInput} />
            </label>
            <label className={styles.field} style={{ minWidth: 150 }}>
              <span className={styles.fieldLabel}>To</span>
              <DateField value={to} onChange={(v) => v && setTo(v)} aria-label="To" className={styles.fieldInput} />
            </label>
          </div>
        )}
      />
      {from > to && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>The start is after the end.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        {(d ? [...d.departments.map((x) => ({ key: x.department, label: `${x.label} cost`, now: x.costSen, before: x.previousCostSen })), { key: "all", label: "Total cost", now: d.totals.costSen, before: d.totals.previousCostSen }]
          : ["Rental cost", "Renovation cost", "Company cost", "Total cost"].map((label) => ({ key: label, label, now: 0, before: 0 }))).map((k) => {
          const ch = costChange(k.now, k.before);
          return (
            <div key={k.key} role="group" aria-label={k.label}>
              <StatCard label={`${k.label} (RM)`} value={d ? rm(k.now) : null} pending={spend.isLoading} failed={spend.isError} onRetry={() => void spend.refetch()}
                subtitle={d ? <span style={{ color: toneColour(ch.tone) }}>{ch.text}</span> : undefined} />
            </div>
          );
        })}
      </div>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Spending by sub-department (RM)</h2>
        {spend.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>The spending did not load. <button type="button" onClick={() => void spend.refetch()}>Retry</button></div>}
        {spend.isLoading && <div style={{ height: 240, borderRadius: 8, background: "var(--line)", opacity: 0.4 }} aria-hidden />}
        {d && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Spending by sub-department" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
              <thead>
                <tr>
                  <th style={th}>Department</th>
                  <th style={{ ...th, textAlign: "right" }}>Income</th>
                  <th style={{ ...th, textAlign: "right" }}>Cost</th>
                  <th style={{ ...th, textAlign: "right" }}>Previous cost</th>
                  <th style={{ ...th, textAlign: "right" }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {d.departments.flatMap((g) => [
                  <tr key={g.department}>
                    <td style={{ ...td, fontWeight: 600 }}>{g.label}</td>
                    <td style={{ ...td, ...num, fontWeight: 600 }}>{rm(g.incomeSen)}</td>
                    <td style={{ ...td, ...num, fontWeight: 600 }}>{rm(g.costSen)}</td>
                    <td style={{ ...td, ...num, fontWeight: 600 }}>{rm(g.previousCostSen)}</td>
                    <td style={{ ...td, ...num, color: toneColour(costChange(g.costSen, g.previousCostSen).tone) }}>{costChange(g.costSen, g.previousCostSen).text}</td>
                  </tr>,
                  ...g.rows.map((r) => {
                    const ch = costChange(r.costSen, r.previousCostSen);
                    return (
                      <tr key={r.subDepartmentId}>
                        <td style={{ ...td, paddingLeft: 28 }}>{r.name}{!r.active && <span style={{ color: MUTED }}> (retired)</span>}</td>
                        <td style={{ ...td, ...num }}>{r.incomeSen ? rm(r.incomeSen) : <span style={{ color: MUTED }}>–</span>}</td>
                        <td style={{ ...td, ...num }}>{r.costSen ? rm(r.costSen) : <span style={{ color: MUTED }}>–</span>}</td>
                        <td style={{ ...td, ...num, color: MUTED }}>{r.previousCostSen ? rm(r.previousCostSen) : "–"}</td>
                        <td style={{ ...td, ...num, color: toneColour(ch.tone) }}>{ch.text}</td>
                      </tr>
                    );
                  }),
                ])}
                <tr>
                  <td style={{ ...td, fontWeight: 700, borderBottom: 0 }}>Total</td>
                  <td style={{ ...td, ...num, fontWeight: 700, borderBottom: 0 }}>{rm(d.totals.incomeSen)}</td>
                  <td style={{ ...td, ...num, fontWeight: 700, borderBottom: 0 }}>{rm(d.totals.costSen)}</td>
                  <td style={{ ...td, ...num, fontWeight: 700, borderBottom: 0 }}>{rm(d.totals.previousCostSen)}</td>
                  <td style={{ ...td, ...num, borderBottom: 0, color: toneColour(costChange(d.totals.costSen, d.totals.previousCostSen).tone) }}>{costChange(d.totals.costSen, d.totals.previousCostSen).text}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          Team costs with no unit (RM){noUnit.data && noUnit.data.rows.length > 0 ? ` · ${noUnit.data.rows.length} lines, ${rm(noUnitTotal)}` : ""}
        </h2>
        <p style={{ margin: 0, color: MUTED, fontSize: "var(--fs-13)" }}>Maintenance, Cleaning and other team lines saved without a unit. Add the unit where there is one.</p>
        {noUnit.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>The list did not load. <button type="button" onClick={() => void noUnit.refetch()}>Retry</button></div>}
        {noUnit.isLoading && <div style={{ height: 120, borderRadius: 8, background: "var(--line)", opacity: 0.4 }} aria-hidden />}
        {noUnit.data && noUnit.data.rows.length === 0 && <p style={{ margin: 0, color: MUTED }}>None for this period: every team line names its unit.</p>}
        {noUnit.data && noUnit.data.rows.length > 0 && (
          <div style={{ overflowX: "auto", maxHeight: 480 }}>
            <table aria-label="Team costs with no unit" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
              <thead>
                <tr>
                  <th style={th}>Date</th><th style={th}>Entry</th><th style={th}>Document</th><th style={th}>Department</th><th style={th}>Account</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {noUnit.data.rows.map((r, i) => (
                  <tr key={`${r.jeNo}-${i}`}>
                    <td style={{ ...td, ...num, textAlign: "left" }}>{r.date}</td>
                    <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{r.jeNo}</td>
                    <td style={td}>{r.source}{r.notes ? <span style={{ color: MUTED }}> · {r.notes}</span> : null}</td>
                    <td style={td}>{r.subDepartment}</td>
                    <td style={td}><span style={{ fontFamily: "var(--font-mono)" }}>{r.accountCode}</span> {r.accountName}</td>
                    <td style={{ ...td, ...num }}>{rm(r.amountSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
