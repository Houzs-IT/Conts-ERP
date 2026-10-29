/* Beta > Home: the mockup's "All projects" screen (app.js renderHome, markup id="homeArea"). The title, the counts,
   five tabs, the table on a desktop and the cards on a phone, the footer line. A row opens the Beta project.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { useMemo, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { money } from "../projects/renovation/renovationModel";
import { BETA, GLASS, TONES, betaDueTone, betaTagTone } from "./renovationBetaTheme";
import { buildModel, HOME_TABS, homeCounts, homeList, homeRow, shortLeft, type ConditionWord, type HomeRow, type HomeTab } from "./renovationBetaBoard";
import { HOME_SORTS, keepOrder, matchesSearch, newestFirst, orderOf, sortFromParam, type HomeSort } from "./renovationBetaHomeModel";
import { boardApi, boardKey, prefetchOnIntent, readLastProject, rememberLastProject } from "./renovationBetaBoardApi";
import { CARD, ErrorBanner, INK_SOFT, MUTED, useIsPhone } from "./BetaCalParts";
import { BetaSkin, useBetaPreload } from "./BetaWsUi";
import { simpleApi, type BoardRowV2 } from "../projects/renovation/simpleApi";
import { mytDay, slaDayText } from "./renovationBetaModel";
import { motion } from "motion/react";
import { BetaLoading } from "./BetaLoading";
import { BetaMotion, SPRING } from "./betaMotion";

const TH = {
  padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: MUTED,
  borderBottom: `1px solid ${BETA.line}`, background: BETA.head, whiteSpace: "nowrap",
} as const;
const TD = { padding: "11px 12px", borderBottom: `1px solid ${BETA.lineSoft}`, verticalAlign: "middle", fontSize: 13 } as const;
const DASH = <span style={{ color: BETA.faint }}>–</span>;
/* Column shares of the table width (fixed layout), so the columns line up and fill the row at any width or zoom.
   The building tag wraps instead of being cut ("18 USJ 2/4P S...", owner 24 Oct 2026), so its column is wider.
   Order: Building, Project, ID condition, Due, Payment. */
const COLS_PAY = ["16%", "30%", "16%", "14%", "24%"] as const;
const COLS_NO_PAY = ["18%", "40%", "20%", "22%"] as const;

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

/* Pending, waiting and progress are amber, an amendment red, done green. [text, background, dot] */
const AMBER = [TONES.amber.ink, TONES.amber.soft, TONES.amber.dot] as const;
const WORD_TONE: Readonly<Record<ConditionWord, readonly [string, string, string]>> = {
  Pending: AMBER, Waiting: AMBER, Progress: AMBER,
  Amendment: [TONES.red.ink, TONES.red.soft, TONES.red.dot],
  Done: [TONES.accent.ink, TONES.accent.soft, TONES.accent.dot],
};

/** The condition as one word on a coloured pill; the hover text keeps the full "B - 3D amendment". */
function StatusCell({ r }: { r: HomeRow }): ReactElement {
  const [ink, bg, dot] = WORD_TONE[r.word];
  return <span title={r.cond} style={{ display: "inline-flex", minWidth: 0, maxWidth: "100%" }}><DotText dot={dot} ink={ink} bg={bg}>{r.word}</DotText></span>;
}

/** A finished design says Done in green; anything else shows the days left or late. On a phone card (small) no due
    date shows nothing: a lone dash in the card's corner read as a stray mark. */
function DueCell({ r, small = false }: { r: HomeRow; small?: boolean }): ReactElement | null {
  if (r.word === "Done") return <DotText dot={TONES.accent.dot} ink={TONES.accent.ink} bg={TONES.accent.soft}>Done</DotText>;
  if (r.left === null) return small ? null : DASH;
  return <DuePill left={r.left} small={small} />;
}

type Sla = { step: string; text: string; over: boolean } | null;

/** The project's step and its day against the step SLA: "Renovation · Day 1 of 45", red once past the SLA. The same
    words the workspace stepper shows (slaDayText). */
function slaOf(r: BoardRowV2 | undefined, today: string): Sla {
  if (!r) return null;
  const over = r.sla?.overdueBy != null && r.sla.overdueBy > 0;
  return { step: r.step.label, text: slaDayText(r.sla, today) ?? "", over };
}

/** The colours are set before anything else draws, so the loading line and an error already have them. */
export function RenovationBetaHome(): ReactElement {
  useBetaPreload();
  return (
    <>
      <BetaSkin />
      <HomeScreen />
    </>
  );
}

function HomeScreen(): ReactElement {
  const navigate = useNavigate();
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
  const last = readLastProject();
  const m = useMemo(() => (q.data ? buildModel(q.data) : null), [q.data]);

  if (q.error && !m) return <ErrorBanner text={`The projects could not be loaded: ${q.error}`} onRetry={q.reload} />;
  if (!m) return <BetaLoading label="Loading projects" size="page" />;

  const counts = homeCounts(m);
  const inTab = homeList(m, tab);
  const sorted = sort === "newest" ? newestFirst(inTab) : inTab;
  const found = sorted.filter((p) => matchesSearch(p, query));
  const viewKey = `${tab}|${sort}|${query.trim().toLowerCase()}`;
  if (!kept.current || kept.current.key !== viewKey) kept.current = { key: viewKey, order: orderOf(found) };
  const list = keepOrder(found, kept.current.order);
  const rows = list.map((p) => homeRow(m, p));
  const tabCount = (key: HomeTab): number => (query.trim() ? homeList(m, key).filter((p) => matchesSearch(p, query)).length : counts.tabs[key]);
  const showPay = m.projects.some((p) => p.payment != null);

  function open(id: number): void {
    rememberLastProject(id);
    navigate(`/beta/projects/${id}`);
  }

  /* A click anywhere on the row opens the project; the link keeps its own action. */
  function rowClick(e: MouseEvent<HTMLElement>, id: number): void {
    if (e.target instanceof Element && e.target.closest("a, button")) return;
    open(id);
  }

  return (
    <BetaMotion>
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

      {/* One row that scrolls sideways when narrow: wrapped, the five groups took three uneven rows on a phone. */}
      <div role="tablist" aria-label="Project groups" style={{ display: "flex", flexWrap: "nowrap", gap: 4, overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none", borderBottom: `1px solid ${BETA.line}`,
        // A solid backing: the page's grid lines ran through the tab labels.
        background: BETA.glassSolid, padding: "4px 8px 0", borderRadius: "12px 12px 0 0" }}>
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
                display: "inline-flex", flex: "none", whiteSpace: "nowrap", alignItems: "center", gap: 6, minHeight: 40, padding: "0 12px", border: 0, borderRadius: "8px 8px 0 0",
                marginBottom: -1, background: on ? BETA.chip : "transparent", borderBottom: "3px solid transparent", position: "relative", font: "inherit", fontSize: 14,
                fontWeight: on ? 700 : 500, color: on ? BETA.ink : MUTED, cursor: "pointer",
              }}
            >
              {label}
              <span style={{ fontSize: 12, color: MUTED }}>{tabCount(key)}</span>
              {on && <motion.span layoutId="home-tab-ink" transition={SPRING} aria-hidden="true" style={{ position: "absolute", left: 6, right: 6, bottom: -3, height: 3, borderRadius: "3px 3px 0 0", background: BETA.selInk }} />}
            </button>
          );
        })}
      </div>

      {phone ? (
        <ol className="stag" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
                <th scope="col" style={TH}>ID condition</th>
                <th scope="col" style={TH}>Due</th>
                {showPay && <th scope="col" style={TH}>Payment</th>}
              </tr>
            </thead>
            <tbody className="stag">
              {rows.length === 0 && <tr><td colSpan={showPay ? 5 : 4} style={{ ...TD, color: MUTED }}>{query.trim() ? `No project matches "${query.trim()}".` : "No projects here."}</td></tr>}
              {rows.map((r) => {
                const [tagInk, tagBg] = betaTagTone(r.p.tag);
                return (
                  <tr key={r.p.id} onClick={(e) => rowClick(e, r.p.id)} {...prefetchOnIntent(queryClient, r.p.id)} style={{ cursor: "pointer", background: r.p.id === last ? BETA.pick : BETA.row }}>
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
                    <td style={TD}><DueCell r={r} /></td>
                    {showPay && <td style={TD}>{r.p.payment != null ? <PayCell text={r.p.payment} outstandingSen={r.p.outstandingSen} /> : DASH}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: MUTED }}>{list.length} shown · {sort === "newest" ? "newest first" : "due soonest first"} · tap a project to open it</div>
    </div>
    </BetaMotion>
  );
}

function PhoneCard({ r, sla, onOpen }: { r: HomeRow; sla: Sla; onOpen: () => void }): ReactElement {
  const { p } = r;
  const [tagInk, tagBg] = betaTagTone(p.tag);
  const pay = [p.payment, p.outstandingSen != null && p.outstandingSen > 0 ? `${money(p.outstandingSen)} to collect` : null].filter(Boolean).join(" · ");
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
          <DueCell r={r} small />
        </span>
        <StatusCell r={r} />
        {sla && <span style={{ fontSize: 12, color: sla.over ? TONES.red.ink : INK_SOFT, fontWeight: sla.over ? 700 : 400 }}>{sla.step}{sla.text ? ` · ${sla.text}` : ""}</span>}
        {pay && <span style={{ fontSize: 12, color: INK_SOFT, paddingTop: 8, borderTop: `1px solid ${BETA.lineSoft}` }}>{pay}</span>}
      </Link>
    </li>
  );
}
