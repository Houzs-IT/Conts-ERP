/* Beta workspace > Overview, laid out as the Dream Crafter design of the project page (v10 / v13): Payments across the top,
   then Needs attention (what was To do) and Site progress on the left, and Unit key, Final drawings and Sales order on the
   right. The design has no place for Design progress and Client & team, so they stay below those three (owner, 26 Oct 2026). */

import { useId, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorText, money } from "../projects/renovation/renovationModel";
import { BetaSiteProgressCard } from "./BetaSiteProgressCard";
import { BetaWsDesignCard } from "./BetaWsDesignCard";
import { BetaWsKeyCard } from "./BetaWsKeyCard";
import {
  TONE_ALERT, TONE_PAID, TONE_QUIET, WS, WsBadge, WsBtn, WsCard, btnStyle, cardStyle, h2Style, subStyle, type WsBtnKind,
} from "./BetaWsUi";
import { FileDialog, sendReminder, useGuarded, type BetaTabProps, type ViewedFile } from "./betaShared";
import { add, ds, designKind } from "./renovationBetaBoard";
import { approveNewest, boardApi, markPoDone } from "./renovationBetaBoardApi";
import {
  approvedSet, dayMonth, dayMonthYear, emptyPaymentRows, flowStepRow, nextStep, paymentCard, paymentStrip, paymentTotals, soConfirmed, todoList, designTodoRows, mergeTodo,
  type PaymentTotals, type TodoAction, type TodoRow,
} from "./renovationBetaModel";
import { downloadAsPdf } from "./renovationBetaPdf";
import { sheetSetAt, sheetsApi } from "./renovationBetaSheets";
import { BETA, GLASS, TONES } from "./renovationBetaTheme";
import { useQuery } from "../../hooks/useQuery";
import type { DesignFile } from "../projects/renovation/simpleApi";

const column: CSSProperties = { minWidth: 0, display: "flex", flexDirection: "column", gap: 20 };

export function BetaOverviewTab(p: BetaTabProps): ReactElement {
  const { detail: d, workspace, today } = p;
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  // Design rows come from the board logic Calendar uses; payment and defect rows from the workspace.
  // Past design, the step bar's step leads To do; design leftovers stay listed under it.
  const step = flowStepRow(d.flow, d.tasks, today);
  const merged = mergeTodo(
    designTodoRows(p.board.m, p.board.p, p.canWrite, d.project.customer_phone),
    todoList({ today, projectName: d.project.name, currentStage: d.currentStage, workspace }),
  );
  const todo = step ? [step, ...merged.map((r) => (r.group === "to book" ? { ...r, tone: "muted" as const } : r))] : merged;
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
          <BetaSiteProgressCard p={p} />
        </div>
        <aside style={{ ...column, flex: "1 1 320px" }}>
          <BetaWsKeyCard d={d} canWrite={p.canWrite} today={today} onDone={p.onDone} />
          <FinalDrawingsCard p={p} onOpen={openFile} />
          <OrderCard p={p} />
          <BetaWsDesignCard board={p.board} canWrite={p.canWrite} openDialog={p.openDialog} onDone={p.onDone} onError={p.onError} />
          <TeamCard p={p} onEdit={() => p.openDialog({ t: "assign", projectId: p.projectId })} />
        </aside>
      </div>
      {viewing && <FileDialog projectId={p.projectId} file={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/* ---------- Payments ---------- */

/* The design's tiles: paid is a teal glass gradient, needs attention a pink one, and a payment still to come plain glass. */
const PAY_LOOK = {
  paid: { border: `1px solid ${BETA.payEdge}`, bg: BETA.payPaid, tone: TONE_PAID },
  alert: { border: `1px solid ${BETA.payEdge}`, bg: BETA.payAlert, tone: TONE_ALERT },
  quiet: { border: `1px solid ${BETA.payLaterEdge}`, bg: BETA.payLater, tone: TONE_QUIET },
} as const;

function PaymentsCard({ p }: { p: BetaTabProps }): ReactElement {
  const { payments } = p.workspace;
  const { detail: d } = p;
  const strip = paymentStrip(payments);
  // Before a sales order is linked the four payments still show, empty, so the card never changes shape.
  const rows = strip ? strip.rows : payments.state === "none" ? emptyPaymentRows() : [];
  const handoverOn = d.project.handed_over_at ?? d.project.planned_handover_date;
  const paid = rows.filter((r) => r.status === "paid").length;
  const vo = d.vo && d.vo.count > 0 ? `VO ${d.vo.approved} of ${d.vo.count} approved` : "";
  const soNo = payments.state === "ok" ? payments.docNo : undefined;
  const totals = paymentTotals(payments);
  return (
    <WsCard
      title="Payments"
      subInline
      sub={rows.length > 0 ? `${paid} of ${rows.length} received${soNo ? ` · from ${soNo}` : ""}` : undefined}
      right={strip && vo ? <span style={subStyle}>{vo}</span> : undefined}
    >
      {totals && <PaymentTotalsRow totals={totals} linked={payments.state === "ok"} />}
      {payments.state === "hidden" && <p style={{ fontSize: 14, color: BETA.muted }}>Payment figures are hidden for your role.</p>}
      {payments.state === "none" && <p style={{ fontSize: 14, color: BETA.muted }}>No sales order is linked yet. Once one is, each payment recorded on it fills the next box here.</p>}
      {rows.length > 0 && (
        <ol aria-label="Payments" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {rows.map((r) => {
            const v = paymentCard(r, d.currentStage, handoverOn);
            const look = PAY_LOOK[v.look];
            return (
              <li key={r.seq} style={{ border: look.border, background: look.bg, borderRadius: 26, padding: 14, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.label}</span>
                  <WsBadge tone={look.tone}>{v.badge}</WsBadge>
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em", color: r.amountSen > 0 ? undefined : BETA.muted }}>{r.amountSen > 0 ? money(r.amountSen) : "-"}</div>
                <div style={{ fontSize: 12, color: WS.text2 }}>{v.note}{r.status === "billed" && r.paidSen > 0 && ` · paid so far ${money(r.paidSen)}`}</div>
              </li>
            );
          })}
        </ol>
      )}
    </WsCard>
  );
}

/** Total, received and outstanding side by side, with a thin bar for the share received. */
function PaymentTotalsRow({ totals, linked }: { totals: PaymentTotals; linked: boolean }): ReactElement {
  const pct = totals.totalSen > 0 ? Math.min(100, Math.round((totals.receivedSen / totals.totalSen) * 100)) : 0;
  const cells: ReadonlyArray<{ label: string; value: string; note: string; ink?: string }> = [
    { label: "Total amount", value: linked ? money(totals.totalSen) : "RM 0.00", note: linked ? "Sales order total" : "No sales order yet" },
    { label: "Total received", value: money(totals.receivedSen), note: linked && totals.totalSen > 0 ? `${pct}% of total` : "–", ink: totals.receivedSen > 0 ? WS.green : undefined },
    {
      label: "Outstanding", value: linked ? money(totals.outstandingSen) : "–",
      note: !linked ? "–" : totals.outstandingSen === 0 && totals.totalSen > 0 ? "Fully paid" : "Still to collect",
      ink: linked && totals.outstandingSen > 0 ? WS.red : undefined,
    },
  ];
  return (
    <div style={{ border: `1px solid ${BETA.line}`, borderRadius: 16, background: WS.panel, overflow: "hidden" }}>
      <dl aria-label="Payment totals" style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, background: BETA.line }}>
        {cells.map((c) => (
          <div key={c.label} style={{ padding: "12px 16px", background: WS.panel, minWidth: 0 }}>
            <dt style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: BETA.muted }}>{c.label}</dt>
            <dd style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: linked ? c.ink ?? BETA.ink : BETA.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c.value}</dd>
            <dd style={{ margin: "2px 0 0", fontSize: 12, color: WS.text2 }}>{c.note}</dd>
          </div>
        ))}
      </dl>
      <div aria-hidden="true" style={{ height: 4, background: BETA.stepTrack }}>
        <div style={{ width: `${pct}%`, height: "100%", background: TONES.accent.dot }} />
      </div>
    </div>
  );
}

/* ---------- To do ---------- */

const DOT: Record<TodoRow["tone"], string> = { err: WS.redDot, warn: WS.amberDot, muted: TONES.grey.dot };

function TodoCard({ rows, p }: { rows: TodoRow[]; p: BetaTabProps }): ReactElement {
  const { busy, run } = useGuarded();
  const id = useId();
  const { next, rest } = nextStep(rows);
  const { m, raw } = p.board;

  // One design write from a row button, the same calls Calendar makes.
  async function design(action: Extract<TodoAction, { type: "design" }>): Promise<void> {
    try {
      switch (action.op) {
        case "book": p.openDialog({ t: "book", projectId: p.projectId, key: action.key }); return;
        case "amend": p.openDialog({ t: "amend", projectId: p.projectId, k: action.k }); return;
        case "dates": p.openDialog({ t: "dates", projectId: p.projectId }); return;
        case "assign": p.openDialog({ t: "assign", projectId: p.projectId }); return;
        case "start":
          await boardApi.saveDesign(p.projectId, action.k === "3" ? { start3dOn: m.today } : { start2dOn: m.today });
          p.onDone(`${action.k}D started · due ${ds(add(m.today, m.sop[action.k]))}`);
          return;
        case "approve":
          await approveNewest(raw, designKind(action.k), m.today, p.board.p.customer ?? "Client");
          p.onDone(action.k === "3" ? "3D approved · 2D is ready to start" : "2D approved · now PO, carpentry measure and site briefing");
          return;
        case "po":
          await markPoDone(p.projectId, m.today);
          p.onDone("PO done");
          return;
      }
    } catch (e) {
      p.onError(errorText(e));
    }
  }

  const button = (r: TodoRow, action: TodoAction, kind: WsBtnKind, size: "sm" | "lg"): ReactNode => {
    if (action.type === "open") return <WsBtn key={action.label} kind={kind} size={size} onClick={() => p.openTab(action.tab)}>{action.label}</WsBtn>;
    if (!p.canWrite) return null;
    return (
      <WsBtn
        key={action.label}
        kind={kind}
        size={size}
        disabled={busy}
        onClick={() => void run(() => (action.type === "remind" ? sendReminder(p.projectId, action, p.onDone, p.onError) : design(action)))}
      >
        {action.label}<span className="sr">: {r.title}</span>
      </WsBtn>
    );
  };
  // The first action is the row's main button, the blue pill; the others sit beside it as glass pills.
  const act = (r: TodoRow, kind: "dark", size: "sm" | "lg"): ReactNode => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {button(r, r.action, kind, size)}
      {(r.more ?? []).map((a) => button(r, a, "outline", size))}
    </div>
  );
  /* One row as the design draws it: a coloured bar, the words, then the blue pill. */
  const row = (r: TodoRow, key: string, bar: string, lead: ReactNode, size: "sm" | "lg"): ReactElement => (
    <li key={key} style={{ display: "grid", gridTemplateColumns: "4px minmax(0, 1fr) auto", gap: 14, alignItems: "center", padding: "14px 20px", borderTop: `1px solid ${WS.rowLine}` }}>
      <span aria-hidden="true" style={{ alignSelf: "stretch", borderRadius: 2, background: bar }} />
      <div style={{ minWidth: 0 }}>
        {lead}
        <div style={{ fontWeight: 600, fontSize: 15, overflowWrap: "anywhere" }}>{r.title}</div>
        {r.detail && <div style={{ fontSize: 13, color: BETA.muted, overflowWrap: "anywhere" }}>{r.detail}</div>}
      </div>
      {act(r, "dark", size)}
    </li>
  );
  return (
    <section aria-labelledby={id} style={{ ...cardStyle, padding: 0, gap: 0, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px 6px" }}><h2 id={id} style={h2Style}>Needs attention</h2></div>
      {!next && <p style={{ padding: "6px 20px 18px", fontSize: 14, color: BETA.muted }}>Nothing needs attention right now.</p>}
      {(next || rest.length > 0) && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {next && row(next, "next", TONES.amber.dot, <div style={{ fontSize: 12, fontWeight: 600, color: WS.amber, textTransform: "uppercase", letterSpacing: ".05em" }}>Next step · {next.group}</div>, "sm")}
          {rest.map((r) => row(r, String(r.id), DOT[r.tone], null, "sm"))}
        </ul>
      )}
    </section>
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
      sub={d.signedSo ? `${d.signedSo.doc_no} · signed ${dayMonthYear(d.signedSo.so_date)}` : d.so ? (soConfirmed(d.so.status) ? `${d.so.doc_no} · signed ${dayMonthYear(d.so.so_date)}` : `${d.so.doc_no} · draft, not signed yet`) : "Not signed yet"}
      right={(d.so ?? d.signedSo) ? <Link to={`/scm/sales-orders/${encodeURIComponent((d.so ?? d.signedSo)!.doc_no)}`} style={{ ...btnStyle("outline", "sm"), color: BETA.ink }}>Open SO</Link> : undefined}
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
  const sheetsQ = useQuery(["renovation-beta", "sheets", p.projectId], () => sheetsApi.list(p.projectId), [p.projectId]);
  const sheets = sheetsQ.data?.sheets ?? [];
  const [making, setMaking] = useState(false);
  // A 2D version made of sheets downloads as one PDF of its whole set, not only its first sheet.
  async function download2d(f: DesignFile): Promise<void> {
    if (!sheets.length) { onOpen(f); return; }
    const parts = sheetSetAt(records.files, sheets, f.version).filter((x) => x.key).map((x) => ({ key: x.key ?? "", fileName: x.fileName }));
    setMaking(true);
    try {
      const r = await downloadAsPdf(p.projectId, parts, `${p.detail.project.name} 2D V${f.version}.pdf`.replace(/[\/:*?"<>|]+/g, " "));
      if (r.skipped.length) p.onError(`Not in the PDF (not a PDF or photo): ${r.skipped.join(", ")}`);
    } catch (e) {
      p.onError(`The PDF could not be made: ${errorText(e)}`);
    } finally {
      setMaking(false);
    }
  }
  return (
    <WsCard title="Final drawings" gap={10} right={<button type="button" className="link" onClick={() => p.openTab("drawings")}>All versions →</button>}>
      <div style={{ border: `1px solid ${two ? WS.tealLine : BETA.line}`, background: two ? WS.tealSoft : BETA.panel, borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700 }}>2D · Approved set</div>
            <div style={{ fontSize: 12, color: BETA.muted }}>{two ? `Client approved ${dayMonth(two.review?.approvedOn)} · for site` : "Not approved yet"}</div>
          </div>
          {two && <span style={{ padding: "3px 8px", borderRadius: 999, background: TONES.accent.soft, color: TONES.accent.ink, fontSize: 11, fontWeight: 600 }}>For site</span>}
        </div>
        {two && <button type="button" style={outline} disabled={making} onClick={() => void (two.file.external_url ? onOpen(two.file) : download2d(two.file))}>{two.file.external_url ? "Open 2D link" : making ? "Making PDF..." : "Download 2D PDF"}</button>}
      </div>
      <div style={{ border: `1px solid ${BETA.line}`, background: BETA.panel, borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700 }}>3D · Approved set</div>
          <div style={{ fontSize: 12, color: BETA.muted }}>{three ? `Client approved ${dayMonth(three.review?.approvedOn)}` : "Not approved yet"}</div>
        </div>
        {three && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
    ["Designer", p.board.p.lead?.name ?? "-"],
    ["Sales", d.people.sales.name ?? "-"],
    ["Site PIC", p.board.p.site?.name ?? "-"],
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
