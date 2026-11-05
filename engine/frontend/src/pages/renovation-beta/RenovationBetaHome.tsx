/* Beta > Home: the mockup's "All projects" screen (app.js renderHome, markup id="homeArea"). The title, the counts,
   five tabs, the table on a desktop and the cards on a phone, the footer line. A row opens the Beta project.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { useAuth } from "../../auth/AuthContext";
import { CreateRenovationPanel } from "../projects/renovation/CreateRenovationPanel";
import { money } from "../projects/renovation/renovationModel";
import { BETA, GLASS, TONES, betaDueTone, betaTagTone } from "./renovationBetaTheme";
import { buildModel, HOME_TABS, homeCounts, homeList, homeRow, shortLeft, type ConditionWord, type HomeRow, type HomeTab } from "./renovationBetaBoard";
import { HOME_SORTS, keepOrder, matchesSearch, newestFirst, orderOf, sortFromParam, type HomeSort } from "./renovationBetaHomeModel";
import { boardApi, boardKey, readLastProject, rememberLastProject } from "./renovationBetaBoardApi";
import { CARD, ErrorBanner, INK_SOFT, MUTED, useIsPhone } from "./BetaCalParts";
import { BetaSkin, useBetaPreload } from "./BetaWsUi";
import { simpleApi, type BoardRowV2 } from "../projects/renovation/simpleApi";
import { mytDay, slaDayText } from "./renovationBetaModel";
import { motion } from "motion/react";
import { BetaLoading } from "./BetaLoading";
import { BetaMotion, SPRING } from "./betaMotion";
import { DataTable } from "../../components/DataTable";
import type { Column } from "../../components/dataTableTypes";
import { fetchProjectSos, soColumns, type ProjectSo } from "./renovationBetaSoColumns";

const DASH = <span style={{ color: BETA.faint }}>–</span>;

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

type TableRow = { r: HomeRow; sla: Sla; so: ProjectSo | undefined };

/* The list's own columns, then the sales order's: Columns shows, moves and hides them, and each has a filter. */
function homeColumns(showPay: boolean): Column<TableRow>[] {
  const own: Column<TableRow>[] = [
    { key: "building", label: "Building", group: "Project", width: "170px", getValue: (x) => x.r.p.tag, render: (x) => {
      const [ink, bg] = betaTagTone(x.r.p.tag);
      return <span title={x.r.p.tag} style={{ display: "inline-block", maxWidth: "100%", padding: "2px 8px", borderRadius: 10, background: bg, color: ink, fontSize: 12, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>{x.r.p.tag.toUpperCase()}</span>;
    } },
    { key: "project", label: "Project", group: "Project", width: "300px", getValue: (x) => x.r.p.title, render: (x) => (
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
        <Link to={`/beta/projects/${x.r.p.id}`} onClick={() => rememberLastProject(x.r.p.id)} style={{ color: BETA.ink, textDecoration: "none", fontWeight: 600, overflowWrap: "anywhere" }}>{x.r.p.title}</Link>
        {x.r.p.customer && <span style={{ color: MUTED, fontSize: 12, overflowWrap: "anywhere" }}>{x.r.p.customer}</span>}
      </span>
    ) },
    { key: "condition", label: "ID condition", group: "Project", width: "150px", getValue: (x) => x.r.word, render: (x) => <StatusCell r={x.r} /> },
    { key: "due", label: "Due", group: "Project", width: "120px", getValue: (x) => x.r.left, render: (x) => <DueCell r={x.r} /> },
    ...(showPay ? [{ key: "payment", label: "Payment", group: "Project", width: "220px", getValue: (x: TableRow) => x.r.p.payment,
      render: (x: TableRow) => (x.r.p.payment != null ? <PayCell text={x.r.p.payment} outstandingSen={x.r.p.outstandingSen} /> : DASH) }] : []),
    { key: "code", label: "Project code", group: "Project", width: "130px", defaultHidden: true, getValue: (x) => x.r.p.code, render: (x) => x.r.p.code ?? DASH },
    { key: "client", label: "Client", group: "Project", width: "170px", defaultHidden: true, getValue: (x) => x.r.p.customer, render: (x) => x.r.p.customer ?? DASH },
    { key: "stage", label: "Stage", group: "Project", width: "130px", defaultHidden: true, getValue: (x) => x.sla?.step, render: (x) => x.sla?.step ?? DASH },
    { key: "sales", label: "Sales", group: "Project", width: "140px", defaultHidden: true, getValue: (x) => x.r.p.salesName, render: (x) => x.r.p.salesName ?? DASH },
    { key: "lead", label: "Design lead", group: "Project", width: "140px", defaultHidden: true, getValue: (x) => x.r.p.lead?.name, render: (x) => x.r.p.lead?.name ?? DASH },
    { key: "handover", label: "Handover", group: "Project", width: "120px", defaultHidden: true, getValue: (x) => x.r.p.handover, render: (x) => x.r.p.handover ?? DASH },
  ];
  return [...own, ...soColumns<TableRow>((x) => x.so)];
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
  const q = useQuery(boardKey(), () => boardApi.board(), []);
  // Step and SLA come from the current project board, so both screens agree while they run side by side.
  const steps = useQuery(["renovation-beta", "step-sla"], () => simpleApi.boardRows(), []);
  const slaById = useMemo(() => new Map((steps.data?.data ?? []).map((r) => [r.id, r])), [steps.data]);
  const phone = useIsPhone();
  /* Every order in the company, for columns that start hidden: read only once one of them is showing. */
  const [soColumnsShown, setSoColumnsShown] = useState(false);
  const sos = useQuery(["renovation-beta", "project-sos"], () => fetchProjectSos(), [], { enabled: !phone && soColumnsShown });
  const soByDoc = useMemo(() => new Map((sos.data ?? []).map((s) => [s.doc_no, s])), [sos.data]);
  const today = mytDay(new Date().toISOString());
  const [tab, setTab] = useState<HomeTab>("all");
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
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

  const tableRows: TableRow[] = rows.map((r) => ({
    r, sla: slaOf(slaById.get(r.p.id), today),
    so: r.p.soDocNos.map((d) => soByDoc.get(d)).find(Boolean),
  }));

  return (
    <BetaMotion>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: BETA.ink }}>
      <section style={{ position: "relative" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-.02em" }}>All projects</h1>
        {can("projects.write") && (
          <button type="button" onClick={() => setCreating(true)}
            style={{ position: "absolute", top: 0, right: 0, minHeight: 40, padding: "0 16px", border: 0, borderRadius: 999, background: BETA.ink, color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            + New project
          </button>
        )}
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 14 }}>
          <span style={{ color: INK_SOFT }}>{m.projects.length} projects</span>
          {counts.late > 0 && <span style={{ padding: "2px 10px", borderRadius: 999, background: TONES.red.soft, color: TONES.red.ink, fontWeight: 600 }}>{counts.late} late</span>}
          {counts.week > 0 && <span style={{ padding: "2px 10px", borderRadius: 999, background: TONES.amber.soft, color: TONES.amber.ink, fontWeight: 600 }}>{counts.week} due this week</span>}
        </div>
      </section>
      {creating && <CreateRenovationPanel onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); open(id); }} />}

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
        <div style={{ ...CARD, overflow: "hidden" }}>
          <DataTable<TableRow>
            tableId="projects-home"
            onDisplayKeys={(keys) => setSoColumnsShown(keys.some((k) => k.startsWith("so_")))}
            documentLabel="Projects"
            rows={tableRows}
            columns={homeColumns(showPay)}
            getRowKey={(x) => x.r.p.id}
            onRowClick={(x) => open(x.r.p.id)}
            emptyLabel={query.trim() ? `No project matches "${query.trim()}".` : "No projects here."}
          />
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
