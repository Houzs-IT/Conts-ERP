/* Beta workspace > Overview, laid out as the mockup's project page: Payments across the top, then To do, Site progress
   and Unit key on the left and Design progress, Sales order, Final drawings and Client & team on the right. */

import { useId, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { daysBetween, money } from "../projects/renovation/renovationModel";
import { AssignDialog } from "./BetaWsHeader";
import { BetaWsKeyCard } from "./BetaWsKeyCard";
import {
  TONE_ALERT, TONE_PAID, TONE_QUIET, WS, WsBadge, WsBtn, WsCard, WsCheck, btnStyle, cardStyle, h2Style, subStyle,
} from "./BetaWsUi";
import { FileDialog, sendReminder, useGuarded, type BetaTabProps, type ViewedFile } from "./betaShared";
import {
  approvedSet, dayMonth, dayMonthYear, designProgress, nextStep, paymentCard, paymentStrip, renovationDays, siteTimeline, todoList, trimTimeline,
  type DesignRow, type SiteStep, type TodoRow,
} from "./renovationBetaModel";
import { BETA, betaDueTone } from "./renovationBetaTheme";
import type { DesignFile } from "../projects/renovation/simpleApi";

const column: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", gap: 20 };

export function BetaOverviewTab(p: BetaTabProps): ReactElement {
  const { detail: d, workspace, records, today } = p;
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  const [assigning, setAssigning] = useState(false);
  const todo = todoList({
    today,
    projectName: d.project.name,
    customerName: d.project.customer_name,
    customerPhone: d.project.customer_phone,
    currentStage: d.currentStage,
    files: records.files,
    measures: records.measures,
    workspace,
  });
  const openFile = (f: DesignFile): void => {
    if (f.external_url) window.open(f.external_url, "_blank", "noopener");
    else if (f.r2_key) setViewing({ key: f.r2_key, name: f.file_name });
  };
  return (
    <>
      <PaymentsCard p={p} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ ...column, flex: "999 1 520px" }}>
          <TodoCard rows={todo} p={p} />
          <SiteCard p={p} />
          <BetaWsKeyCard d={d} canWrite={p.canWrite} today={today} onDone={p.onDone} />
        </div>
        <aside style={{ ...column, flex: "1 1 320px" }}>
          <DesignCard rows={designProgress(records.files, records.measures, workspace, today)} p={p} />
          <OrderCard p={p} />
          <FinalDrawingsCard p={p} onOpen={openFile} />
          <TeamCard p={p} onEdit={() => setAssigning(true)} />
        </aside>
      </div>
      {viewing && <FileDialog projectId={p.projectId} file={viewing} onClose={() => setViewing(null)} />}
      {assigning && <AssignDialog d={d} onClose={() => setAssigning(false)} onDone={p.onDone} onError={p.onError} />}
    </>
  );
}

/* ---------- Payments ---------- */

const PAY_LOOK = {
  paid: { border: "1px solid #CFE3D6", bg: "#F3F9F5", pad: 14, tone: TONE_PAID },
  alert: { border: "2px solid #E8A5A2", bg: "#FDF4F3", pad: 13, tone: TONE_ALERT },
  quiet: { border: `1px solid ${BETA.line}`, bg: "#FAFBFB", pad: 14, tone: TONE_QUIET },
} as const;

function PaymentsCard({ p }: { p: BetaTabProps }): ReactElement {
  const { payments } = p.workspace;
  const { detail: d } = p;
  const strip = paymentStrip(payments);
  const handoverOn = d.project.handed_over_at ?? d.project.planned_handover_date;
  const paid = strip?.rows.filter((r) => r.status === "paid").length ?? 0;
  const vo = d.vo && d.vo.count > 0 ? ` · VO ${d.vo.approved} of ${d.vo.count} approved` : "";
  return (
    <WsCard
      title="Payments"
      subInline
      sub={strip && strip.rows.length > 0 ? `${paid} of ${strip.rows.length} paid · each payment unlocks the next step` : undefined}
      right={strip ? <span style={subStyle}>Contract {money(strip.contractSen)}{vo}</span> : undefined}
    >
      {payments.state === "hidden" && <p style={{ fontSize: 14, color: BETA.muted }}>Payment figures are hidden for your role.</p>}
      {payments.state === "none" && <p style={{ fontSize: 14, color: BETA.muted }}>No sales order yet, or billing is not available. Nothing to show.</p>}
      {strip && strip.rows.length === 0 && <p style={{ fontSize: 14, color: BETA.muted }}>The sales order has no instalments.</p>}
      {strip && strip.rows.length > 0 && (
        <ol aria-label="Instalments" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {strip.rows.map((r) => {
            const v = paymentCard(r, d.currentStage, handoverOn);
            const look = PAY_LOOK[v.look];
            return (
              <li key={r.seq} style={{ border: look.border, background: look.bg, borderRadius: 10, padding: look.pad, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{r.label}</span>
                  <WsBadge tone={look.tone}>{v.badge}</WsBadge>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{money(r.amountSen)}</div>
                <div style={{ fontSize: 12, color: WS.text2 }}>{v.note}{r.status === "billed" && r.paidSen > 0 && ` · paid so far ${money(r.paidSen)}`}</div>
              </li>
            );
          })}
        </ol>
      )}
    </WsCard>
  );
}

/* ---------- To do ---------- */

const DOT: Record<TodoRow["tone"], string> = { err: WS.redDot, warn: WS.amberDot, muted: "#8C9593" };

function TodoCard({ rows, p }: { rows: TodoRow[]; p: BetaTabProps }): ReactElement {
  const { busy, run } = useGuarded();
  const id = useId();
  const { next, rest } = nextStep(rows);
  const act = (r: TodoRow, kind: "amber" | "dark", size: "sm" | "lg"): ReactNode => {
    const { action } = r;
    if (action.type === "open") return <WsBtn kind={kind} size={size} onClick={() => p.openTab(action.tab)}>{action.label}</WsBtn>;
    if (!p.canWrite) return null;
    return (
      <WsBtn kind={kind} size={size} disabled={busy} onClick={() => void run(() => sendReminder(p.projectId, action, p.onDone, p.onError))}>
        {action.label}<span className="sr">: {r.title}</span>
      </WsBtn>
    );
  };
  return (
    <section aria-labelledby={id} style={{ ...cardStyle, padding: 0, gap: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 0" }}><h2 id={id} style={h2Style}>To do</h2></div>
      {!next && <p style={{ padding: "12px 20px 16px", fontSize: 14, color: BETA.muted }}>Nothing needs attention right now.</p>}
      {next && (
        <div style={{ margin: "12px 20px 0", background: "#FFF6EA", border: "1px solid #F2CC94", borderRadius: 10, padding: 16, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
          <div style={{ minWidth: 0, flex: "1 1 240px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: WS.amber, textTransform: "uppercase", letterSpacing: ".05em" }}>Next step · {next.group}</div>
            <div style={{ margin: "4px 0 2px", fontSize: 18, fontWeight: 700, overflowWrap: "anywhere" }}>{next.title}</div>
            <div style={{ color: WS.text2 }}>{next.detail ?? " "}</div>
          </div>
          {act(next, "amber", "lg")}
        </div>
      )}
      {rest.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "4px 20px 8px" }}>
          {rest.map((r) => (
            <li key={r.id} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${WS.rowLine}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0, flex: "1 1 220px" }}>
                <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, marginTop: 7, borderRadius: 4, background: DOT[r.tone] }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.title}</div>
                  {r.detail && <div style={{ fontSize: 13, color: BETA.muted, overflowWrap: "anywhere" }}>{r.detail}</div>}
                </div>
              </div>
              {act(r, "dark", "sm")}
            </li>
          ))}
        </ul>
      )}
      {next && rest.length === 0 && <div style={{ height: 16 }} />}
    </section>
  );
}

/* ---------- Site progress ---------- */

function SiteCard({ p }: { p: BetaTabProps }): ReactElement {
  const { detail: d, today } = p;
  const [showAll, setShowAll] = useState(false);
  const handoverOn = d.project.handed_over_at ?? d.project.planned_handover_date;
  const all = siteTimeline(d.tasks, today, handoverOn);
  const trimmed = trimTimeline(all, showAll);
  const canTrim = trimTimeline(all, false).hiddenDone + trimTimeline(all, false).hiddenLater > 0;
  const live = all.filter((s) => s.id !== "handover");
  const done = live.filter((s) => s.state === "done").length;
  const span = renovationDays(d.tasks, today);
  const sub = live.length === 0 ? "No site tasks yet" : `${span && span.day > 0 ? `Day ${span.day} of ${span.total}` : `${done} of ${live.length} steps done`} · updated as each step is done`;
  return (
    <WsCard title="Site progress" sub={sub} right={<button type="button" className="link" onClick={() => p.openTab("site")}>Site photos →</button>}>
      {live.length > 0 && (
        <>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {trimmed.steps.map((s, i) => <SiteRow key={s.id} s={s} last={i === trimmed.steps.length - 1} today={today} />)}
          </ol>
          {canTrim && (
            <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll((x) => !x)}>
              {showAll ? "Show fewer steps" : `Show all ${all.length} steps`}
            </button>
          )}
        </>
      )}
    </WsCard>
  );
}

function SiteRow({ s, last, today }: { s: SiteStep; last: boolean; today: string }): ReactElement {
  const now = s.state === "current";
  const done = s.state === "done";
  const ring = s.state === "late" ? "2px solid #E8A5A2" : `2px solid ${BETA.border}`;
  return (
    <li aria-current={now ? "step" : undefined} style={{ display: "grid", gridTemplateColumns: "64px 24px 1fr", gap: 10 }}>
      <div style={{ padding: last ? "2px 0 0" : "2px 0 14px", color: now ? BETA.accentInk : BETA.muted, fontSize: 13, fontWeight: now ? 700 : 400 }}>
        {now ? <>Today<br />{dayMonth(today)}</> : dayMonth(s.date)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {done ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><WsCheck size={10} stroke={3.5} /></span>
        ) : now ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.surface, border: `3px solid ${BETA.accent}` }} />
        ) : (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.surface, border: ring }} />
        )}
        {!last && (done ? <span style={{ flex: 1, width: 2, background: BETA.accent }} /> : <span style={{ flex: 1, width: 0, borderLeft: `2px dashed ${BETA.border}` }} />)}
      </div>
      {now ? (
        <div style={{ marginBottom: last ? 0 : 14, padding: "10px 12px", borderRadius: 8, background: "#E4F1EF", minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: BETA.accentInk, overflowWrap: "anywhere" }}>{s.label}</div>
          {s.sub && <div style={{ fontSize: 13, color: "#2B3533" }}>{s.sub}</div>}
        </div>
      ) : (
        <div style={{ padding: last ? 0 : "0 0 14px", color: done ? BETA.ink : WS.text2, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.label}</div>
          {s.sub && <div style={{ fontSize: 13, color: s.state === "late" ? WS.red : BETA.muted, fontWeight: s.state === "late" ? 600 : 400 }}>{s.sub}</div>}
        </div>
      )}
    </li>
  );
}

/* ---------- Design progress ---------- */

function DesignCard({ rows, p }: { rows: DesignRow[]; p: BetaTabProps }): ReactElement {
  const { detail: d, today, records, workspace } = p;
  const designer = d.people.designer.name ?? "not set";
  const approved3d = approvedSet(records.files, workspace.reviews, "3d").approved != null;
  const handoverOn = d.project.handed_over_at ?? d.project.planned_handover_date;
  const green = (t: string): ReactElement => <span style={{ color: WS.green, fontWeight: 700 }}>{t}</span>;
  const muted = (t: string): ReactElement => <span style={{ color: BETA.muted }}>{t}</span>;
  const status = (r: DesignRow): ReactElement => {
    if (r.kind === "onsite") return r.state === "done" ? <>{green("Done")}{muted(` · ${dayMonth(r.doneOn)}`)}</> : muted("Not measured");
    if (r.state === "done") return <>{green("Approved")}{muted(` · ${dayMonth(r.doneOn)}`)}</>;
    if (r.state === "waiting") {
      const sentOn = approvedSet(records.files, workspace.reviews, r.kind).waiting?.review?.sentOn ?? null;
      return <span style={{ color: WS.blue, fontWeight: 600 }}>{sentOn ? `Sent ${dayMonth(sentOn)} · ` : ""}waiting client</span>;
    }
    if (r.due && r.daysLeft != null) {
      const [ink] = betaDueTone(r.daysLeft);
      return <span style={{ color: ink, fontWeight: 700 }}>due {dayMonth(r.due)} ({r.daysLeft < 0 ? `${-r.daysLeft}d late` : `${r.daysLeft}d left`})</span>;
    }
    return muted(r.kind === "2d" && !approved3d ? "After 3D" : "Not started");
  };
  const left = handoverOn ? daysBetween(today, handoverOn.slice(0, 10)) : null;
  const lines: Array<{ key: string; label: string; body: ReactElement }> = rows.map((r) => ({
    key: r.kind,
    label: r.kind === "onsite" ? "Site measure" : `${r.label} · by ${designer}`,
    body: status(r),
  }));
  if (handoverOn) {
    lines.push({
      key: "handover",
      label: `Handover · ${d.people.pic.name ?? d.people.renoPic.name ?? "Site PIC not set"}`,
      body: muted(`${dayMonth(handoverOn)}${left == null ? "" : left >= 0 ? ` · ${left} days left` : ` · ${-left} days ago`}`),
    });
  }
  return (
    <WsCard title="Design progress" gap={10} right={<Link to="/beta/calendar" style={{ fontSize: 13, fontWeight: 600 }}>Calendar →</Link>}>
      <div>
        {lines.map((l) => (
          <div key={l.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "9px 0", borderTop: `1px solid ${BETA.lineSoft}` }}>
            <div style={{ flex: "1 1 160px", minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{l.label}</div>
              <div style={{ fontSize: 12 }}>{l.body}</div>
            </div>
          </div>
        ))}
      </div>
      {rows.every((r) => r.due == null) && <p style={{ fontSize: 12, color: BETA.muted }}>Deadlines start counting once the first site measure is recorded.</p>}
    </WsCard>
  );
}

/* ---------- Sales order ---------- */

function OrderCard({ p }: { p: BetaTabProps }): ReactElement {
  const { detail: d } = p;
  const rooms = [...new Set((d.lines ?? []).flatMap((l) => (l.room?.trim() ? [l.room.trim()] : [])))];
  const unit = [d.project.layout_label, [d.project.building, d.project.unit_no].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const rowsList: Array<[string, ReactNode]> = [];
  if (d.type?.name) rowsList.push(["Scope", d.type.name]);
  if (rooms.length > 0) rowsList.push(["Areas", rooms.join(", ")]);
  if (unit) rowsList.push(["Unit", unit]);
  if (d.vo && d.vo.count > 0) {
    rowsList.push(["VO", <>{d.vo.approved} of {d.vo.count} approved · <button type="button" className="link" style={{ color: WS.amber }} onClick={() => p.openTab("vo")}>Open VO</button></>]);
  }
  return (
    <WsCard
      title="Sales order"
      gap={12}
      sub={d.so ? `${d.so.doc_no} · signed ${dayMonthYear(d.so.so_date)}` : "Not signed yet"}
      right={d.so ? <Link to={`/scm/renovation/sales-orders/${encodeURIComponent(d.so.doc_no)}`} style={{ ...btnStyle("outline", "sm"), color: BETA.ink }}>Open SO</Link> : undefined}
    >
      {rowsList.length > 0 && (
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "110px 1fr", gap: "8px 10px", fontSize: 13 }}>
          {rowsList.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt style={{ color: BETA.muted }}>{k}</dt>
              <dd style={{ margin: 0, fontWeight: 600, overflowWrap: "anywhere" }}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.project.notes?.trim() && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: WS.panel, fontSize: 13 }}>
          <div style={{ color: BETA.muted, marginBottom: 2 }}>Notes</div>
          <div style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{d.project.notes}</div>
        </div>
      )}
    </WsCard>
  );
}

/* ---------- Final drawings ---------- */

function FinalDrawingsCard({ p, onOpen }: { p: BetaTabProps; onOpen: (f: DesignFile) => void }): ReactElement {
  const { records, workspace } = p;
  const two = approvedSet(records.files, workspace.reviews, "2d").approved;
  const three = approvedSet(records.files, workspace.reviews, "3d").approved;
  const outline: CSSProperties = { ...btnStyle("outline", "sm"), minHeight: 38, flex: 1 };
  return (
    <WsCard title="Final drawings" gap={10} right={<button type="button" className="link" onClick={() => p.openTab("drawings")}>All versions →</button>}>
      <div style={{ border: `1px solid ${two ? WS.tealLine : BETA.line}`, background: two ? WS.tealSoft : BETA.surface, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700 }}>2D · Approved set</div>
            <div style={{ fontSize: 12, color: BETA.muted }}>{two ? `Client approved ${dayMonth(two.review?.approvedOn)} · for site` : "Not approved yet"}</div>
          </div>
          {two && <span style={{ padding: "3px 8px", borderRadius: 6, background: BETA.accent, color: "#FFFFFF", fontSize: 11, fontWeight: 600 }}>For site</span>}
        </div>
        {two && <button type="button" style={outline} onClick={() => onOpen(two.file)}>{two.file.external_url ? "Open 2D link" : "Download 2D PDF"}</button>}
      </div>
      <div style={{ border: `1px solid ${BETA.line}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700 }}>3D · Approved set</div>
          <div style={{ fontSize: 12, color: BETA.muted }}>{three ? `Client approved ${dayMonth(three.review?.approvedOn)}` : "Not approved yet"}</div>
        </div>
        {three && (
          <div style={{ display: "flex", gap: 8 }}>
            {three.file.r2_key && <button type="button" style={outline} onClick={() => onOpen(three.file)}>3D PDF</button>}
            {three.file.external_url && (
              <a href={three.file.external_url} target="_blank" rel="noopener noreferrer" style={{ ...btnStyle("teal", "sm"), minHeight: 38, flex: 1 }}>3D link</a>
            )}
          </div>
        )}
      </div>
    </WsCard>
  );
}

/* ---------- Client & team ---------- */

function TeamCard({ p, onEdit }: { p: BetaTabProps; onEdit: () => void }): ReactElement {
  const { detail: d } = p;
  const id = useId();
  const attending = d.people.attending.map((a) => a.name).join(", ");
  const rowsList: Array<[string, string]> = [
    ["Client", [d.project.customer_name, d.project.customer_phone].filter(Boolean).join(" · ") || "-"],
    ["Designer", d.people.designer.name ?? "-"],
    ["Sales", d.people.sales.name ?? "-"],
    ["Site PIC", d.people.pic.name ?? d.people.renoPic.name ?? "-"],
  ];
  if (attending) rowsList.push(["Attending", attending]);
  return (
    <section aria-labelledby={id} style={{ ...cardStyle, gap: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: `1px solid ${WS.rowLine}` }}>
        <h2 id={id} style={h2Style}>Client &amp; team</h2>
        {p.canWrite && <button type="button" className="link" onClick={onEdit}>Edit</button>}
      </div>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "90px 1fr", fontSize: 13 }}>
        {rowsList.map(([k, v], i) => {
          const border = i < rowsList.length - 1 ? `1px solid ${WS.rowLine}` : undefined;
          return (
            <div key={k} style={{ display: "contents" }}>
              <dt style={{ padding: "8px 0", color: BETA.muted, borderBottom: border }}>{k}</dt>
              <dd style={{ margin: 0, padding: "8px 0", borderBottom: border, overflowWrap: "anywhere" }}>{v}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
