// AI usage — /scm/ai-usage (Houzs pages/AiUsage.tsx, #4700; TODO item 19). What the AI reader (Scan bills, receipt
// and request bill reads, utility bills) cost each month, how often it answered (the read rate), and the latest calls
// that failed. Read from public.ai_usage_events (backend services/aiUsage.ts) for the active company. An estimate:
// Anthropic's invoice is the final figure.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { fmtDateTime } from "../vendor/shared/format";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

type FeatureUsage = {
  feature: string; label: string; calls: number; failures: number; readRatePct: number | null; rm: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
};
type MonthUsage = { month: string; totalRm: number; calls: number; failures: number; readRatePct: number | null; partial: boolean; note: string | null; features: FeatureUsage[] };
export type AiUsageReport = {
  months: MonthUsage[]; usdToRm: number; firstRecordedAt: string | null;
  recentFailures: Array<{ at: string; feature: string; label: string; error: string | null; httpStatus: number | null }>;
};

const MUTED = "var(--fg-muted)";
const num: CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };
const th: CSSProperties = { padding: "8px 12px", fontSize: "var(--fs-12)", fontWeight: 600, color: MUTED, borderBottom: "1px solid var(--line)", textAlign: "left" };
const td: CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--line)" };
const card: CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 };
const rm = (v: number): string => new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const int = new Intl.NumberFormat("en-MY");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11" as "Nov 2026". */
export const monthLabel = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;
/** A read rate as words: none with no calls. */
export const rateText = (pct: number | null): string => (pct == null ? "–" : `${pct.toFixed(1)}%`);
/** Under 90% read is worth a look (an outage, a bad key, the reader refusing). */
const rateColour = (pct: number | null) => (pct != null && pct < 90 ? "var(--c-festive-b, #b3261e)" : undefined);

export function AiUsage() {
  const [months, setMonths] = useState(6);
  const q = useQuery({
    queryKey: ["conts-ai-usage", months],
    queryFn: () => authedFetch<AiUsageReport>(`/accounting/ai-usage?months=${months}`),
    staleTime: 60_000,
  });
  const d = q.data;
  const shown = d ? [...d.months].reverse() : [];
  const now = shown[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1280 }}>
      <PageHeader
        eyebrow="Finance"
        title="AI usage"
        description={`What the AI reader costs (Scan bills, receipts, request bills, utility bills) and how often it answered. An estimate in RM at ${d ? d.usdToRm : "4.7"} to the US dollar; Anthropic's invoice is the final figure.`}
        actions={(
          <label className={styles.field} style={{ minWidth: 150 }}>
            <span className={styles.fieldLabel}>Months</span>
            <select aria-label="Months" className={styles.fieldInput} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[3, 6, 12, 24].map((n) => <option key={n} value={n}>Last {n}</option>)}
            </select>
          </label>
        )}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <StatCard label="This month (RM)" value={now ? rm(now.totalRm) : null} pending={q.isLoading} failed={q.isError} onRetry={() => void q.refetch()} />
        <StatCard label="Calls this month" value={now ? int.format(now.calls) : null} pending={q.isLoading} failed={q.isError} onRetry={() => void q.refetch()} />
        <StatCard label="Read rate this month" value={now ? rateText(now.readRatePct) : null} pending={q.isLoading} failed={q.isError} onRetry={() => void q.refetch()}
          subtitle={now && now.failures > 0 ? <span style={{ color: rateColour(now.readRatePct) }}>{int.format(now.failures)} failed</span> : undefined} />
      </div>

      {q.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>AI usage did not load. <button type="button" onClick={() => void q.refetch()}>Retry</button></div>}
      {q.isLoading && <div style={{ height: 240, borderRadius: 8, background: "var(--line)", opacity: 0.4 }} aria-hidden />}
      {d && !d.firstRecordedAt && <p style={{ margin: 0, color: MUTED }}>Nothing recorded yet. Each bill read from now on is counted here.</p>}

      {shown.filter((m) => m.calls > 0).map((m) => (
        <section key={m.month} style={card} aria-label={monthLabel(m.month)}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {monthLabel(m.month)} · RM {rm(m.totalRm)} · {int.format(m.calls)} calls · read rate {rateText(m.readRatePct)}
          </h2>
          {m.note && <p style={{ margin: 0, color: MUTED, fontSize: "var(--fs-13)" }}>{m.note}</p>}
          <div style={{ overflowX: "auto" }}>
            <table aria-label={`AI usage ${monthLabel(m.month)}`} style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
              <thead>
                <tr>
                  <th style={th}>Feature</th>
                  <th style={{ ...th, textAlign: "right" }}>Calls</th>
                  <th style={{ ...th, textAlign: "right" }}>Failed</th>
                  <th style={{ ...th, textAlign: "right" }}>Read rate</th>
                  <th style={{ ...th, textAlign: "right" }}>Tokens in</th>
                  <th style={{ ...th, textAlign: "right" }}>Tokens out</th>
                  <th style={{ ...th, textAlign: "right" }}>Cost (RM)</th>
                </tr>
              </thead>
              <tbody>
                {m.features.map((f) => (
                  <tr key={f.feature}>
                    <td style={td}>{f.label}</td>
                    <td style={{ ...td, ...num }}>{int.format(f.calls)}</td>
                    <td style={{ ...td, ...num, color: f.failures ? rateColour(f.readRatePct) : MUTED }}>{f.failures ? int.format(f.failures) : "–"}</td>
                    <td style={{ ...td, ...num, color: rateColour(f.readRatePct) }}>{rateText(f.readRatePct)}</td>
                    <td style={{ ...td, ...num }}>{int.format(f.inputTokens + f.cacheReadTokens + f.cacheWriteTokens)}</td>
                    <td style={{ ...td, ...num }}>{int.format(f.outputTokens)}</td>
                    <td style={{ ...td, ...num }}>{rm(f.rm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {d && d.recentFailures.length > 0 && (
        <section style={card}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Latest failed calls</h2>
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Latest failed calls" style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
              <thead>
                <tr><th style={th}>When</th><th style={th}>Feature</th><th style={th}>What went wrong</th></tr>
              </thead>
              <tbody>
                {d.recentFailures.map((f, i) => (
                  <tr key={`${f.at}-${i}`}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDateTime(f.at)}</td>
                    <td style={td}>{f.label}</td>
                    <td style={{ ...td, color: MUTED }}>{f.httpStatus ? `${f.httpStatus} · ` : ""}{f.error ?? "No answer"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
