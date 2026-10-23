/* Beta > Home: the mockup's "All projects" screen (app.js renderHome, markup id="homeArea"). The title, the counts,
   five tabs, the table on a desktop and the cards on a phone, the footer line. A row opens the Beta project.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { useMemo, useState, type MouseEvent, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { BETA, betaDueTone, betaTagTone } from "./renovationBetaTheme";
import { buildModel, HOME_TABS, homeCounts, homeList, homeRow, shortLeft, type HomeRow, type HomeTab } from "./renovationBetaBoard";
import { boardApi, boardKey, invalidateBeta, readLastProject, rememberLastProject } from "./renovationBetaBoardApi";
import { BTN_FILL, CARD, CondPill, ErrorBanner, INK_SOFT, MUTED, useIsPhone, useToast } from "./BetaCalParts";
import { BetaDialogs, type BetaDialog } from "./BetaForms";
import { simpleApi, type BoardRowV2 } from "../projects/renovation/simpleApi";

const TH = { padding: "10px 10px", textAlign: "left", fontSize: 12, fontWeight: 600, color: MUTED, borderBottom: `1px solid ${BETA.line}`, whiteSpace: "nowrap" } as const;
const TD = { padding: "9px 10px", borderBottom: `1px solid ${BETA.lineSoft}`, verticalAlign: "middle", fontSize: 13 } as const;

function DuePill({ left, small = false }: { left: number; small?: boolean }): ReactElement {
  const [ink, bg] = betaDueTone(left);
  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, background: bg, color: ink, fontWeight: 700, whiteSpace: "nowrap", fontSize: small ? 12 : undefined, flex: small ? "none" : undefined }}>
      {shortLeft(left)}
    </span>
  );
}

/* Payment colours: green = fully paid, amber = a bill waits for money, blue = some received, grey = nothing yet. */
function payTone(text: string): readonly [string, string, string] {
  if (/Fully paid/.test(text)) return ["#1E6B3A", "#DDF0E3", "#3E9B5F"];
  if (/Pending/.test(text)) return ["#6B5600", "#F6EDC6", "#C9A227"];
  if (/^[1-9]\d* of/.test(text)) return ["#1F4E8C", "#D9EAF7", "#3A7BD5"];
  return [INK_SOFT, "#E8EDEC", "#8C9593"];
}

function PayPill({ text }: { text: string }): ReactElement {
  const [ink, bg, dot] = payTone(text);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: bg, color: ink, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: dot }} />
      {text}
    </span>
  );
}

type Sla = { step: string; text: string; over: boolean } | null;

/** The project's step on the current project page and its SLA: "Design · day 4 of 10", red once past the SLA. */
function slaOf(r: BoardRowV2 | undefined): Sla {
  if (!r) return null;
  const s = r.sla;
  if (!s || s.daysIn == null) return { step: r.step.label, text: "", over: false };
  const text = s.days != null ? `day ${s.daysIn} of ${s.days}` : `day ${s.daysIn}`;
  return { step: r.step.label, text: s.overdueBy != null && s.overdueBy > 0 ? `${s.overdueBy}d over SLA` : text, over: s.overdueBy != null && s.overdueBy > 0 };
}

function SlaCell({ sla }: { sla: Sla }): ReactElement {
  if (!sla) return <span style={{ color: "#8C9593" }}>–</span>;
  return (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
      <span style={{ fontWeight: 600 }}>{sla.step}</span>
      {sla.text && <span style={{ fontSize: 12, fontWeight: sla.over ? 700 : 400, color: sla.over ? "#A12622" : MUTED }}>{sla.text}</span>}
    </span>
  );
}

export function RenovationBetaHome(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canAssign = can("projects.write");
  const queryClient = useQueryClient();
  const q = useQuery(boardKey(), () => boardApi.board(), []);
  // Step and SLA come from the current project board, so both screens agree while they run side by side.
  const steps = useQuery(["renovation-beta", "step-sla"], () => simpleApi.boardRows(), []);
  const slaById = useMemo(() => new Map((steps.data?.data ?? []).map((r) => [r.id, r])), [steps.data]);
  const phone = useIsPhone();
  const [tab, setTab] = useState<HomeTab>("all");
  const [dialog, setDialog] = useState<BetaDialog | null>(null);
  const { toast, show } = useToast();
  const last = readLastProject();
  const m = useMemo(() => (q.data ? buildModel(q.data) : null), [q.data]);

  if (q.error && !m) return <ErrorBanner text={`The projects could not be loaded: ${q.error}`} onRetry={q.reload} />;
  if (!m) return <p style={{ padding: "40px 0", textAlign: "center", color: MUTED, fontSize: 14 }}>Loading projects...</p>;

  const counts = homeCounts(m);
  const list = homeList(m, tab);
  const rows = list.map((p) => homeRow(m, p, canAssign));
  const showPay = m.projects.some((p) => p.payment != null);

  function open(id: number): void {
    rememberLastProject(id);
    navigate(`/beta/projects/${id}`);
  }

  /* A click anywhere on the row opens the project; the link and the Assign button keep their own action. */
  function rowClick(e: MouseEvent<HTMLElement>, id: number): void {
    if (e.target instanceof Element && e.target.closest("a, button")) return;
    open(id);
  }

  function assign(id: number): void {
    setDialog({ t: "assign", projectId: id });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: BETA.ink }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.01em" }}>All projects</h1>
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 14 }}>
          <span style={{ color: INK_SOFT }}>{m.projects.length} projects</span>
          {counts.late > 0 && <span style={{ padding: "2px 10px", borderRadius: 999, background: "#FDF1F0", color: "#A12622", fontWeight: 700 }}>{counts.late} late</span>}
          {counts.week > 0 && <span style={{ padding: "2px 10px", borderRadius: 999, background: "#FDF1E2", color: "#8A4A00", fontWeight: 700 }}>{counts.week} due this week</span>}
        </div>
      </section>

      {q.error && <ErrorBanner text={`The projects could not be refreshed: ${q.error}`} onRetry={q.reload} />}

      <div role="tablist" aria-label="Project groups" style={{ display: "flex", flexWrap: "wrap", gap: 4, borderBottom: `1px solid ${BETA.line}` }}>
        {HOME_TABS.map(([key, label]) => {
          const on = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, minHeight: 40, padding: "0 12px", border: 0, borderRadius: "8px 8px 0 0",
                background: on ? "#E8EDEC" : "transparent", borderBottom: `3px solid ${on ? BETA.ink : "transparent"}`, font: "inherit", fontSize: 14,
                fontWeight: on ? 700 : 500, color: on ? BETA.ink : MUTED, cursor: "pointer",
              }}
            >
              {label}
              <span style={{ fontSize: 12, color: "#8C9593" }}>{counts.tabs[key]}</span>
            </button>
          );
        })}
      </div>

      {phone ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.length === 0 && <li style={{ color: MUTED }}>No projects here.</li>}
          {rows.map((r) => <PhoneCard key={r.p.id} r={r} sla={slaOf(slaById.get(r.p.id))} onOpen={() => rememberLastProject(r.p.id)} />)}
        </ol>
      ) : (
        <div style={{ ...CARD, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th scope="col" style={TH}>Building</th>
                <th scope="col" style={TH}>Project</th>
                <th scope="col" style={TH}>ID condition</th>
                <th scope="col" style={TH}>Who now</th>
                <th scope="col" style={TH}>Due</th>
                <th scope="col" style={TH}>Step · SLA</th>
                {showPay && <th scope="col" style={TH}>Payment</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={showPay ? 7 : 6} style={{ ...TD, color: MUTED }}>No projects here.</td></tr>}
              {rows.map((r) => {
                const [tagInk, tagBg] = betaTagTone(r.p.tag);
                return (
                  <tr key={r.p.id} onClick={(e) => rowClick(e, r.p.id)} style={{ cursor: "pointer", background: r.p.id === last ? "#F3F9F8" : "#FFFFFF" }}>
                    <td style={TD}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: tagBg, color: tagInk, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                        {r.p.tag.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...TD, fontWeight: 600, minWidth: 190 }}>
                      <Link to={`/beta/projects/${r.p.id}`} onClick={() => rememberLastProject(r.p.id)} style={{ color: BETA.ink, textDecoration: "none" }}>{r.p.title}</Link>
                      {r.p.customer && <span style={{ color: MUTED, fontWeight: 500 }}> · {r.p.customer}</span>}
                    </td>
                    <td style={TD}><CondPill text={r.cond} words={r.tone} /></td>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}><WhoNow r={r} onAssign={() => assign(r.p.id)} /></td>
                    <td style={TD}>{r.left === null ? <span style={{ color: "#8C9593" }}>–</span> : <DuePill left={r.left} />}</td>
                    <td style={{ ...TD, whiteSpace: "nowrap" }}><SlaCell sla={slaOf(slaById.get(r.p.id))} /></td>
                    {showPay && <td style={TD}>{r.p.payment != null && <PayPill text={r.p.payment} />}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: MUTED }}>{list.length} shown · tap a project to open it</div>

      <BetaDialogs
        dialog={dialog}
        env={{
          m, who: "All",
          onClose: () => setDialog(null),
          onSaved: (text) => { setDialog(null); void invalidateBeta(queryClient); show(text); },
        }}
      />
      {toast}
    </div>
  );
}

function WhoNow({ r, onAssign }: { r: HomeRow; onAssign: () => void }): ReactElement {
  if (r.whoNow.kind === "assign") {
    return <button type="button" onClick={onAssign} aria-label={`Assign ${r.p.name}`} style={{ ...BTN_FILL, minHeight: 30 }}>Assign</button>;
  }
  if (r.whoNow.kind === "needs") return <span style={{ color: "#8A4A00", fontWeight: 600 }}>Needs team</span>;
  return <>{r.whoNow.name}</>;
}

function PhoneCard({ r, sla, onOpen }: { r: HomeRow; sla: Sla; onOpen: () => void }): ReactElement {
  const { p } = r;
  return (
    <li>
      <Link
        to={`/beta/projects/${p.id}`}
        onClick={onOpen}
        style={{ width: "100%", boxSizing: "border-box", textAlign: "left", padding: "12px 14px", border: `1px solid ${BETA.line}`, borderRadius: 12, background: "#FFFFFF", color: BETA.ink, textDecoration: "none", display: "flex", flexDirection: "column", gap: 6 }}
      >
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <span style={{ fontWeight: 700, fontSize: 15, minWidth: 0, overflowWrap: "anywhere" }}>
            {p.title}
            <span style={{ display: "block", fontWeight: 500, fontSize: 12, color: MUTED }}>{p.customer ?? ""}</span>
          </span>
          {r.left !== null && <DuePill left={r.left} small />}
        </span>
        <span style={{ alignSelf: "flex-start" }}><CondPill text={r.cond} words={r.tone} /></span>
        {sla && <span style={{ fontSize: 12, color: sla.over ? "#A12622" : INK_SOFT, fontWeight: sla.over ? 700 : 400 }}>{sla.step}{sla.text ? ` · ${sla.text}` : ""}</span>}
        <span style={{ fontSize: 12, color: INK_SOFT }}>
          {r.whoNow.kind === "name" ? `Now: ${r.whoNow.name}` : <b style={{ color: "#8A4A00" }}>Needs team</b>}
          {p.payment != null ? ` · ${p.payment}` : ""}
        </span>
      </Link>
    </li>
  );
}

