/* Beta > Home: the mockup's "All projects" screen (app.js renderHome, markup id="homeArea"). The title, the counts,
   five tabs, the table on a desktop and the cards on a phone, the footer line. A row opens the Beta project.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { useMemo, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { money } from "../projects/renovation/renovationModel";
import { BETA, BETA_STAGE, GLASS, TONES, betaConditionTone, betaDueTone, betaTagTone } from "./renovationBetaTheme";
import { buildModel, HOME_TABS, homeCounts, homeList, homeRow, initials, shortLeft, type HomeRow, type HomeTab } from "./renovationBetaBoard";
import { HOME_SORTS, keepOrder, matchesSearch, newestFirst, orderOf, sortFromParam, type HomeSort } from "./renovationBetaHomeModel";
import { boardApi, boardKey, invalidateBeta, readLastProject, rememberLastProject } from "./renovationBetaBoardApi";
import { BTN_MAIN, CARD, ErrorBanner, INK_SOFT, MUTED, useIsPhone, useToast } from "./BetaCalParts";
import { BetaDialogs, type BetaDialog } from "./BetaForms";
import { BetaSkin } from "./BetaWsUi";
import { simpleApi, type BoardRowV2 } from "../projects/renovation/simpleApi";
import { mytDay, slaDayText } from "./renovationBetaModel";

const TH = {
  padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: MUTED,
  borderBottom: `1px solid ${BETA.line}`, background: BETA.head, whiteSpace: "nowrap",
} as const;
const TD = { padding: "11px 12px", borderBottom: `1px solid ${BETA.lineSoft}`, verticalAlign: "middle", fontSize: 13 } as const;
const DASH = <span style={{ color: BETA.faint }}>–</span>;
/* Column shares of the table width (fixed layout), so the columns line up and fill the row at any width or zoom.
   The building tag wraps instead of being cut ("18 USJ 2/4P S...", owner 24 Oct 2026), so its column is wider.
   Order: building, project, status, who now, due, step, payment. */
const COLS_PAY = ["13%", "20%", "16%", "14%", "6%", "14%", "17%"] as const;
const COLS_NO_PAY = ["15%", "24%", "19%", "16%", "8%", "18%"] as const;
/* The dot before each filter tab, as the designs colour the stages. Saturated enough to read on both skins. */
const TAB_DOT: Readonly<Partial<Record<HomeTab, string>>> = { A: "#7FD3DC", BC: "#2F6BFF", D: "#F4A7BE", E: "#2EC4A6" };

function DuePill({ left, small = false }: { left: number; small?: boolean }): ReactElement {
  const [ink, bg] = betaDueTone(left);
  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, background: bg, color: ink, fontWeight: 700, whiteSpace: "nowrap", fontSize: 12, flex: small ? "none" : undefined }}>
      {shortLeft(left)}
    </span>
  );
}

/* Payment colours: green = fully paid, amber = a bill waits for money, grey = some received or nothing yet. [text, background, dot] */
function payTone(text: string): readonly [string, string, string] {
  if (/Fully paid/.test(text)) return [TONES.accent.ink, TONES.accent.soft, TONES.accent.dot];
  if (/Pending/.test(text)) return [TONES.amber.ink, TONES.amber.soft, TONES.amber.dot];
  return [TONES.grey.ink, TONES.grey.soft, TONES.grey.dot];
}

/** A coloured dot and its words on a soft pill, as the designs draw them: the one status style the list uses, for the
    condition and the payment alike. */
function DotText({ dot, ink, bg, children }: { dot: string; ink: string; bg: string; children: ReactNode }): ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 10px", borderRadius: 999, background: bg, color: ink, fontWeight: 600, fontSize: 12, minWidth: 0, maxWidth: "100%" }}>
      <span aria-hidden="true" style={{ flex: "none", width: 7, height: 7, borderRadius: 4, background: dot }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </span>
  );
}

function PayCell({ text, outstandingSen }: { text: string; outstandingSen: number | null }): ReactElement {
  const [ink, bg, dot] = payTone(text);
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, lineHeight: 1.3, minWidth: 0 }}>
      <DotText dot={dot} ink={ink} bg={bg}>{text}</DotText>
      {outstandingSen != null && outstandingSen > 0 && <span style={{ paddingLeft: 10, fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{money(outstandingSen)} to collect</span>}
    </span>
  );
}

/** The status words. A project with no team says only "New": the Who now cell already offers the Assign. */
const statusWords = (r: HomeRow): string => (r.p.unassigned ? "New" : r.tone);

/** The condition letter in its stage colour, then the words with the condition's dot. */
function StatusCell({ r }: { r: HomeRow }): ReactElement {
  const [lInk, lBg] = BETA_STAGE[r.letter];
  const [ink, bg, dot] = betaConditionTone(r.tone);
  return (
    <span title={r.cond} style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
      <span aria-label={`Stage ${r.letter}`} style={{ flex: "none", display: "inline-grid", placeItems: "center", width: 22, height: 22, borderRadius: 6, background: lBg, color: lInk, fontSize: 12, fontWeight: 700 }}>
        {r.letter}
      </span>
      <DotText dot={r.p.unassigned ? TONES.grey.dot : dot} ink={r.p.unassigned ? INK_SOFT : ink} bg={r.p.unassigned ? TONES.grey.soft : bg}>{statusWords(r)}</DotText>
    </span>
  );
}

function Avatar({ name }: { name: string }): ReactElement {
  return (
    <span aria-hidden="true" style={{ flex: "none", display: "inline-grid", placeItems: "center", width: 26, height: 26, borderRadius: 13, background: TONES.accent.soft, color: BETA.accent, fontSize: 11, fontWeight: 700 }}>
      {initials(name)}
    </span>
  );
}

type Sla = { step: string; text: string; over: boolean } | null;

/** The project's step and its day against the step SLA: "Renovation · Day 1 of 45", red once past the SLA. The same
    words the workspace stepper shows (slaDayText). */
function slaOf(r: BoardRowV2 | undefined, today: string): Sla {
  if (!r) return null;
  const over = r.sla?.overdueBy != null && r.sla.overdueBy > 0;
  return { step: r.step.label, text: slaDayText(r.sla, today) ?? "", over };
}

function SlaCell({ sla }: { sla: Sla }): ReactElement {
  if (!sla) return DASH;
  return (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{sla.step}</span>
      {sla.text && <span style={{ fontSize: 12, fontWeight: sla.over ? 700 : 400, color: sla.over ? TONES.red.ink : MUTED }}>{sla.text}</span>}
    </span>
  );
}

/** The colours are set before anything else draws, so the loading line and an error already have them. */
export function RenovationBetaHome(): ReactElement {
  return (
    <>
      <BetaSkin />
      <HomeScreen />
    </>
  );
}

function HomeScreen(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canAssign = can("projects.write");
  const queryClient = useQueryClient();
  const q = useQuery(boardKey(), () => boardApi.board(), []);
  // Step and SLA come from the current project board, so both screens agree while they run side by side.
  const steps = useQuery(["renovation-beta", "step-sla"], () => simpleApi.boardRows(), []);
  const slaById = useMemo(() => new Map((steps.data?.data ?? []).map((r) => [r.id, r])), [steps.data]);
  const phone = useIsPhone();
  const today = mytDay(new Date().toISOString());
  const [tab, setTab] = useState<HomeTab>("all");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const sort = sortFromParam(params.get("sort"));
  /* The order rows were first shown in, per tab, sort and search: Assign and other saves reload the board, and a row
     must not jump under the finger (live run, 24 Oct 2026: the wrong project was opened). A reload starts afresh. */
  const kept = useRef<{ key: string; order: Map<number, number> } | null>(null);
  function setParam(k: "q" | "sort", v: string): void {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v && !(k === "sort" && v === "newest")) next.set(k, v); else next.delete(k);
      return next;
    }, { replace: true });
  }
  const [dialog, setDialog] = useState<BetaDialog | null>(null);
  const { toast, show } = useToast();
  const last = readLastProject();
  const m = useMemo(() => (q.data ? buildModel(q.data) : null), [q.data]);

  if (q.error && !m) return <ErrorBanner text={`The projects could not be loaded: ${q.error}`} onRetry={q.reload} />;
  if (!m) return <p style={{ padding: "40px 0", textAlign: "center", color: MUTED, fontSize: 14 }}>Loading projects...</p>;

  const counts = homeCounts(m);
  const inTab = homeList(m, tab);
  const sorted = sort === "newest" ? newestFirst(inTab) : inTab;
  const found = sorted.filter((p) => matchesSearch(p, query));
  const viewKey = `${tab}|${sort}|${query.trim().toLowerCase()}`;
  if (!kept.current || kept.current.key !== viewKey) kept.current = { key: viewKey, order: orderOf(found) };
  const list = keepOrder(found, kept.current.order);
  const rows = list.map((p) => homeRow(m, p, canAssign));
  const tabCount = (key: HomeTab): number => (query.trim() ? homeList(m, key).filter((p) => matchesSearch(p, query)).length : counts.tabs[key]);
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
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-.02em" }}>All projects</h1>
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 14 }}>
          <span style={{ color: INK_SOFT }}>{m.projects.length} projects</span>
          {counts.late > 0 && <span style={{ padding: "2px 10px", borderRadius: 999, background: TONES.red.soft, color: TONES.red.ink, fontWeight: 600 }}>{counts.late} late</span>}
          {counts.week > 0 && <span style={{ padding: "2px 10px", borderRadius: 999, background: TONES.amber.soft, color: TONES.amber.ink, fontWeight: 600 }}>{counts.week} due this week</span>}
        </div>
      </section>

      {q.error && <ErrorBanner text={`The projects could not be refreshed: ${q.error}`} onRetry={q.reload} />}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ position: "relative", flex: "1 1 320px", minWidth: 0, display: "block" }}>
          <span className="sr" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Search projects</span>
          <Search size={18} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: MUTED }} />
          <style>{".bh-search::-webkit-search-cancel-button{display:none}"}</style>
          <input
            type="search"
            className="bh-search"
            aria-label="Search projects"
            placeholder="Search name, building, unit, client, RN- code, SO no or person"
            value={query}
            onChange={(e) => setParam("q", e.target.value)}
            style={{ width: "100%", minHeight: 46, padding: "0 40px 0 40px", border: `1px solid ${BETA.glassEdge}`, borderRadius: 999, background: BETA.field, boxShadow: BETA.btnGlassShadow, font: "inherit", fontSize: 15, color: BETA.ink, boxSizing: "border-box" }}
          />
          {query && (
            <button type="button" aria-label="Clear the search" onClick={() => setParam("q", "")}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, border: 0, borderRadius: 17, background: "transparent", color: MUTED, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={16} />
            </button>
          )}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: MUTED }}>
          Sort
          <select aria-label="Sort projects" value={sort} onChange={(e) => setParam("sort", e.target.value as HomeSort)}
            style={{ minHeight: 40, padding: "0 12px", border: `1px solid ${BETA.glassEdge}`, borderRadius: 999, background: BETA.field, font: "inherit", fontSize: 14, color: BETA.ink }}>
            {HOME_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {query.trim() && <span role="status" style={{ fontSize: 13, fontWeight: 600, color: INK_SOFT }}>{list.length} of {inTab.length}</span>}
      </div>

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
                marginBottom: -1, background: on ? BETA.chip : "transparent", borderBottom: `3px solid ${on ? BETA.blue : "transparent"}`, font: "inherit", fontSize: 14,
                fontWeight: on ? 700 : 500, color: on ? BETA.ink : MUTED, cursor: "pointer",
              }}
            >
              {TAB_DOT[key] && <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: TAB_DOT[key] }} />}
              {label}
              <span style={{ fontSize: 12, color: MUTED }}>{tabCount(key)}</span>
            </button>
          );
        })}
      </div>

      {phone ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.length === 0 && <li style={{ color: MUTED }}>{query.trim() ? `No project matches "${query.trim()}".` : "No projects here."}</li>}
          {rows.map((r) => <PhoneCard key={r.p.id} r={r} sla={slaOf(slaById.get(r.p.id), today)} onOpen={() => rememberLastProject(r.p.id)} />)}
        </ol>
      ) : (
        <div style={{ ...CARD, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 960, borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              {(showPay ? COLS_PAY : COLS_NO_PAY).map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" style={TH}>Building</th>
                <th scope="col" style={TH}>Project</th>
                <th scope="col" style={TH}>Status</th>
                <th scope="col" style={TH}>Who now</th>
                <th scope="col" style={TH}>Due</th>
                <th scope="col" style={TH}>Step · SLA</th>
                {showPay && <th scope="col" style={TH}>Payment</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={showPay ? 7 : 6} style={{ ...TD, color: MUTED }}>{query.trim() ? `No project matches "${query.trim()}".` : "No projects here."}</td></tr>}
              {rows.map((r) => {
                const [tagInk, tagBg] = betaTagTone(r.p.tag);
                return (
                  <tr key={r.p.id} onClick={(e) => rowClick(e, r.p.id)} style={{ cursor: "pointer", background: r.p.id === last ? BETA.pick : BETA.row }}>
                    <td style={TD}>
                      <span title={r.p.tag} style={{ display: "inline-block", maxWidth: "100%", padding: "2px 8px", borderRadius: 10, background: tagBg, color: tagInk, fontSize: 12, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                        {r.p.tag.toUpperCase()}
                      </span>
                    </td>
                    <td style={TD}>
                      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
                        <Link to={`/beta/projects/${r.p.id}`} onClick={() => rememberLastProject(r.p.id)} style={{ color: BETA.ink, textDecoration: "none", fontWeight: 600, overflowWrap: "anywhere" }}>{r.p.title}</Link>
                        {r.p.customer && <span style={{ color: MUTED, fontSize: 12, overflowWrap: "anywhere" }}>{r.p.customer}</span>}
                      </span>
                    </td>
                    <td style={TD}><StatusCell r={r} /></td>
                    <td style={TD}><WhoNow r={r} onAssign={() => assign(r.p.id)} /></td>
                    <td style={TD}>{r.left === null ? DASH : <DuePill left={r.left} />}</td>
                    <td style={TD}><SlaCell sla={slaOf(slaById.get(r.p.id), today)} /></td>
                    {showPay && <td style={TD}>{r.p.payment != null ? <PayCell text={r.p.payment} outstandingSen={r.p.outstandingSen} /> : DASH}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: MUTED }}>{list.length} shown · {sort === "newest" ? "newest first" : "due soonest first"} · tap a project to open it</div>

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
    return (
      <button type="button" onClick={onAssign} aria-label={`Assign ${r.p.name}`} style={{ ...BTN_MAIN, minHeight: 30, padding: "0 12px", fontSize: 12 }}>
        + Assign team
      </button>
    );
  }
  if (r.whoNow.kind === "needs") return <span style={{ color: TONES.amber.ink, fontWeight: 600 }}>Needs team</span>;
  if (!r.whoNow.name) return DASH;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
      <Avatar name={r.whoNow.name} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.whoNow.name}</span>
    </span>
  );
}

function PhoneCard({ r, sla, onOpen }: { r: HomeRow; sla: Sla; onOpen: () => void }): ReactElement {
  const { p } = r;
  const [tagInk, tagBg] = betaTagTone(p.tag);
  return (
    <li>
      <Link
        to={`/beta/projects/${p.id}`}
        onClick={onOpen}
        style={{ ...GLASS, width: "100%", boxSizing: "border-box", textAlign: "left", padding: "12px 14px", borderRadius: 18, color: BETA.ink, textDecoration: "none", display: "flex", flexDirection: "column", gap: 8 }}
      >
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ alignSelf: "flex-start", padding: "1px 7px", borderRadius: 10, background: tagBg, color: tagInk, fontSize: 11, fontWeight: 600 }}>{p.tag.toUpperCase()}</span>
            <span style={{ fontWeight: 700, fontSize: 15, overflowWrap: "anywhere" }}>{p.title}</span>
            {p.customer && <span style={{ fontWeight: 500, fontSize: 12, color: MUTED }}>{p.customer}</span>}
          </span>
          {r.left !== null && <DuePill left={r.left} small />}
        </span>
        <StatusCell r={r} />
        {sla && <span style={{ fontSize: 12, color: sla.over ? TONES.red.ink : INK_SOFT, fontWeight: sla.over ? 700 : 400 }}>{sla.step}{sla.text ? ` · ${sla.text}` : ""}</span>}
        <span style={{ fontSize: 12, color: INK_SOFT, paddingTop: 8, borderTop: `1px solid ${BETA.lineSoft}` }}>
          {r.whoNow.kind === "name" ? `Now: ${r.whoNow.name}` : <b style={{ color: TONES.amber.ink }}>Needs team</b>}
          {p.payment != null ? ` · ${p.payment}` : ""}
          {p.outstandingSen != null && p.outstandingSen > 0 ? ` · ${money(p.outstandingSen)} to collect` : ""}
        </span>
      </Link>
    </li>
  );
}
