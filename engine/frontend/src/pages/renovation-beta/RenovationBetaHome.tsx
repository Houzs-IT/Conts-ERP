/* Beta > Home: the mockup's "All projects" screen (app.js renderHome, markup id="homeArea"). The title, the counts,
   the Design step filter, the table on a desktop and the cards on a phone, the footer line. A row opens the Beta project.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { BetaStageFilter } from "./BetaWsHeader";
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { useAuth } from "../../auth/AuthContext";
import { CreateRenovationPanel } from "../projects/renovation/CreateRenovationPanel";
import { money } from "../projects/renovation/renovationModel";
import { BETA, GLASS, TONES, betaDueTone, betaTagTone } from "./renovationBetaTheme";
import { buildModel, designSteps, filterCounts, homeCounts, homeList, homeRow, shortLeft, VARIANTS_FILTER, type BoardModel, type ConditionWord, type HomeFilter, type HomeRow } from "./renovationBetaBoard";
import { HOME_SORTS, keepOrder, onBrandList, matchesSearch, orderOf, sortFromParam, sortHome, voCell, type HomeSort } from "./renovationBetaHomeModel";
import { boardApi, boardKey, readLastProject, rememberLastProject } from "./renovationBetaBoardApi";
import { CARD, ErrorBanner, INK_SOFT, MUTED, useIsPhone } from "./BetaCalParts";
import { BetaSkin, useBetaPreload } from "./BetaWsUi";
import { simpleApi, type BoardRowV2 } from "../projects/renovation/simpleApi";
import { mytDay, slaDayText } from "./renovationBetaModel";
import { motion } from "motion/react";
import { fmtDate } from "@2990s/shared";
import { BetaLoading } from "./BetaLoading";
import { BetaMotion, SPRING } from "./betaMotion";
import { DataTable } from "../../components/DataTable";
import { Pagination } from "../../components/Pagination";
import type { Column } from "../../components/dataTableTypes";
import { fetchProjectSos, soColumns, type ProjectSo } from "./renovationBetaSoColumns";
import { readBoardCache, writeBoardCache } from "./boardCache";
import { VariantsSkuList } from "./renovationBetaVariantsList";

/** Each filter keeps its own columns (owner 2026-11-19). "All projects" stays on the original key so nobody's
    arrangement moves, Done Design keeps the key its old tab had, and each Design step has one by its code; they all
    start from the All projects columns until arranged on their own. */
/** The stages in the order a project goes through them (Sales order first, services/renovation/flow.ts). */
const STAGE_ORDER = ["signed", "design", "ordering", "renovation", "handover", "closed"] as const;
const DEFAULT_STAGE_LABEL: Partial<Record<string, string>> = { signed: "Sales order", design: "Design", ordering: "Ordering", renovation: "Renovation", handover: "Handover", closed: "Closed" };

const PAGE = 50;

export function layoutKey(f: HomeFilter): string {
  return f === "all" ? "projects-home" : f === "done" ? "projects-home-E" : `projects-home-step-${f.slice(5)}`;
}

const DASH = <span style={{ color: BETA.faint }}>–</span>;

function DuePill({ left, small = false }: { left: number; small?: boolean }): ReactElement {
  const [ink, bg] = betaDueTone(left);
  return (
    <span style={{ padding: "2px 8px", borderRadius: 6, background: bg, color: ink, fontWeight: 700, whiteSpace: "nowrap", fontSize: 12, flex: small ? "none" : undefined }}>
      {shortLeft(left)}
    </span>
  );
}

/* Payment colours (chew, 19 Nov 2026: each its own colour): green = fully paid, amber = a bill waits for money,
   blue = some instalments paid ("2 of 4 paid"), grey = none paid yet. [text, background, dot] */
/* The theme's blue family is near-grey; partly paid needs a blue that reads at a glance, mixed from the board's own
   blue band so it holds on a light and a dark page. */
const PART_BLUE = "#1F4E8C";
export const PART_PAID = [`color-mix(in srgb, ${PART_BLUE} 75%, ${BETA.ink})`, `color-mix(in srgb, ${PART_BLUE} 14%, transparent)`, PART_BLUE] as const;
export function payTone(text: string): readonly [string, string, string] {
  if (/Fully paid/.test(text)) return [TONES.accent.ink, TONES.accent.soft, TONES.accent.dot];
  if (/Pending/.test(text)) return [TONES.amber.ink, TONES.amber.soft, TONES.amber.dot];
  if (/^[1-9]\d* of \d+ paid/.test(text)) return PART_PAID;
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

type TableRow = { r: HomeRow; sla: Sla; so: ProjectSo | undefined; board: BoardRowV2 | undefined };

/** "2 of 12 lines" and the SKUs still waiting for a variant; every SKU is in the hover text. */
export function MissingVariants({ v }: { v: HomeRow["p"]["variants"] }): ReactElement {
  if (v.lines === 0) return <span style={{ color: MUTED }}>No SO lines</span>;
  if (v.missing === 0) return <span style={{ color: TONES.accent.ink, fontWeight: 600 }}>All picked</span>;
  const codes = [...new Set(v.pending.map((x) => x.itemCode))];
  const all = v.pending.map((x) => `${x.itemCode}: ${x.missing.join(", ")}`).join("\n");
  return (
    <span title={all} style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
      <span style={{ color: TONES.amber.ink, fontWeight: 600 }}>{v.missing} of {v.lines} lines</span>
      <span style={{ color: MUTED, fontSize: 12, overflowWrap: "anywhere" }}>{codes.slice(0, 4).join(", ")}{codes.length > 4 ? ` +${codes.length - 4} more` : ""}</span>
    </span>
  );
}

/* The list's own columns, then the sales order's: Columns shows, moves and hides them, and each has a filter. */
function homeColumns(showPay: boolean, variantsView: boolean): Column<TableRow>[] {
  const own: Column<TableRow>[] = [
    /* The SKUs still waiting for a variant (owner, 20 Nov 2026); shown first on the Variants step, in Columns elsewhere. */
    { key: "variants_missing", label: "Missing variants", group: "Project", width: "320px", defaultHidden: !variantsView,
      getValue: (x) => x.r.p.variants.missing, render: (x) => <MissingVariants v={x.r.p.variants} /> },
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
    { key: "created", label: "Created", group: "Project", width: "120px", getValue: (x) => x.r.p.createdAt, render: (x) => (x.r.p.createdAt ? fmtDate(x.r.p.createdAt) : DASH),
      filterType: "date", dateValue: (x) => x.r.p.createdAt },
    { key: "brand", label: "Brand", group: "Project", width: "170px", getValue: (x) => x.r.p.brand, render: (x) => x.r.p.brand ?? <span style={{ color: MUTED }}>Not set</span> },
    { key: "condition", label: "ID condition", group: "Project", width: "150px", getValue: (x) => x.r.word, render: (x) => <StatusCell r={x.r} /> },
    { key: "due", label: "Due", group: "Project", width: "120px", getValue: (x) => x.r.left, render: (x) => <DueCell r={x.r} /> },
    ...(showPay ? [{ key: "payment", label: "Payment", group: "Project", width: "220px", getValue: (x: TableRow) => x.r.p.payment,
      render: (x: TableRow) => (x.r.p.payment != null ? <PayCell text={x.r.p.payment} outstandingSen={x.r.p.outstandingSen} /> : DASH) }] : []),
    { key: "stage", label: "Step", group: "Project", width: "130px", getValue: (x) => x.sla?.step, render: (x) => x.sla?.step ?? DASH },
    { key: "pic", label: "PIC", group: "Project", width: "140px", getValue: (x) => x.board?.renoPic.name ?? "Unassigned", render: (x) => x.board?.renoPic.name ?? <span style={{ color: MUTED }}>Unassigned</span> },
    { key: "sales", label: "Salesperson", group: "Project", width: "140px", getValue: (x) => x.r.p.salesName, render: (x) => x.r.p.salesName ?? DASH },
    { key: "handover", label: "Handover", group: "Project", width: "120px", getValue: (x) => x.r.p.handover, render: (x) => (x.r.p.handover ? fmtDate(x.r.p.handover) : DASH) },
    { key: "vo", label: "VO", group: "Project", width: "110px", getValue: (x) => voCell(x.board?.vo), render: (x) => voCell(x.board?.vo) ?? DASH },
    { key: "code", label: "Project code", group: "Project", width: "130px", defaultHidden: true, getValue: (x) => x.r.p.code, render: (x) => x.r.p.code ?? DASH },
    { key: "client", label: "Client", group: "Project", width: "170px", defaultHidden: true, getValue: (x) => x.r.p.customer, render: (x) => x.r.p.customer ?? DASH },
    { key: "lead", label: "Design lead", group: "Project", width: "140px", defaultHidden: true, getValue: (x) => x.r.p.lead?.name, render: (x) => x.r.p.lead?.name ?? DASH },
  ];
  return [...own, ...soColumns<TableRow>((x) => x.so, (x) => x.r.p)];
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
  /* The last list shows at once and the server's answer replaces it (initialDataUpdatedAt 0 = always refetch). */
  const [cachedBoard] = useState(() => readBoardCache<Awaited<ReturnType<typeof boardApi.board>>>("board"));
  const [cachedSteps] = useState(() => readBoardCache<Awaited<ReturnType<typeof simpleApi.boardRows>>>("step-sla"));
  const q = useQuery(boardKey(), async () => { const r = await boardApi.board(); writeBoardCache("board", r); return r; }, [],
    cachedBoard ? { initialData: () => cachedBoard.data, initialDataUpdatedAt: () => 0 } : {});
  // Step and SLA come from the current project board, so both screens agree while they run side by side.
  const steps = useQuery(["renovation-beta", "step-sla"], async () => { const r = await simpleApi.boardRows(); writeBoardCache("step-sla", r); return r; }, [],
    cachedSteps ? { initialData: () => cachedSteps.data, initialDataUpdatedAt: () => 0 } : {});
  const slaById = useMemo(() => new Map((steps.data?.data ?? []).map((r) => [r.id, r])), [steps.data]);
  const phone = useIsPhone();
  /* Every order in the company, for columns that start hidden: read only once one of them is showing. */
  const [soColumnsShown, setSoColumnsShown] = useState(false);
  // The phone page, tied to the view it was picked in: a new filter, sort or search starts again at page 1.
  const [phonePage, setPhonePage] = useState({ view: "", n: 1 });
  const sos = useQuery(["renovation-beta", "project-sos"], () => fetchProjectSos(), [], { enabled: !phone && soColumnsShown });
  const soByDoc = useMemo(() => new Map((sos.data ?? []).map((s) => [s.doc_no, s])), [sos.data]);
  const today = mytDay(new Date().toISOString());
  // The stage pressed in the stage row (owner, 19 Nov 2026), and within Design the step pressed in its second layer.
  const [stage, setStage] = useState<string | null>(null);
  const [filter, setFilter] = useState<HomeFilter>("all");
  // Within Renovation, the catalog category pressed in its second layer: projects with that category still open.
  const [cat, setCat] = useState<string | null>(null);
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const sort = sortFromParam(params.get("sort"));
  /* The order rows were first shown in, per filter, sort and search: Assign and other saves reload the board, and a row
     must not jump under the finger (live run, 24 Oct 2026: the wrong project was opened). A reload starts afresh. */
  const kept = useRef<{ key: string; order: Map<number, number> } | null>(null);
  const brand = params.get("brand") ?? "";
  function setParam(k: "q" | "sort" | "brand", v: string): void {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v && !(k === "sort" && v === "newest")) next.set(k, v); else next.delete(k);
      return next;
    }, { replace: true });
  }
  const last = readLastProject();
  const m = useMemo(() => (q.data ? buildModel({ ...q.data, projects: q.data.projects.filter((p) => onBrandList(p, brand)) }) : null), [q.data, brand]);

  if (q.error && !m) return <ErrorBanner text={`The projects could not be loaded: ${q.error}`} onRetry={q.reload} />;
  if (!m) return <BetaLoading label="Loading projects" size="page" />;

  const counts = homeCounts(m);
  const stageOf = (id: number): string | null => slaById.get(id)?.step.key ?? null;
  const openCats = (id: number): string[] => (slaById.get(id)?.renovationCategories ?? []).filter((k) => !k.done).map((k) => k.code);
  const inFilter = homeList(m, filter).filter((p) => (stage == null || stageOf(p.id) === stage) && (cat == null || openCats(p.id).includes(cat)));
  const found = sortHome(inFilter, sort).filter((p) => matchesSearch(p, query));
  const viewKey = `${filter}|${cat ?? ""}|${sort}|${query.trim().toLowerCase()}`;
  if (!kept.current || kept.current.key !== viewKey) kept.current = { key: viewKey, order: orderOf(found) };
  const list = keepOrder(found, kept.current.order);
  const rows = list.map((p) => homeRow(m, p));
  const phoneNo = Math.min(phonePage.view === viewKey ? phonePage.n : 1, Math.max(1, Math.ceil(rows.length / PAGE)));
  const searched = m.projects.filter((p) => matchesSearch(p, query));
  const stageCount = (key: string): number => searched.filter((p) => stageOf(p.id) === key).length;
  const stepCounts = filterCounts(m, searched.filter((p) => stageOf(p.id) === "design"));
  const inRenovation = searched.filter((p) => stageOf(p.id) === "renovation");
  const catCount = (code: string): number => inRenovation.filter((p) => openCats(p.id).includes(code)).length;
  const stageLabels = new Map((steps.data?.data ?? []).map((r) => [r.step.key, r.step.label] as const));
  // The first stage reads "Sales order" as on the project page's stage row, whatever the old step label says.
  const stages = STAGE_ORDER.filter((k) => stageLabels.has(k) || DEFAULT_STAGE_LABEL[k]).map((k) => ({ key: k, label: k === "signed" ? "Sales order" : stageLabels.get(k) ?? DEFAULT_STAGE_LABEL[k]!, count: stageCount(k) }));
  const tableKey = stage == null ? "projects-home" : cat != null ? `projects-home-cat-${cat}` : filter !== "all" && filter !== "done" ? `projects-home-${filter.replace(":", "-")}` : `projects-home-stage-${stage}`;
  const showPay = m.projects.some((p) => p.payment != null);

  function open(id: number): void {
    rememberLastProject(id);
    navigate(`/beta/projects/${id}`);
  }

  const tableRows: TableRow[] = rows.map((r) => ({
    r, sla: slaOf(slaById.get(r.p.id), today),
    board: slaById.get(r.p.id),
    so: r.p.soDocNos.map((d) => soByDoc.get(d)).find(Boolean),
  }));

  return (
    <BetaMotion>
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: BETA.ink }}>
      <section style={{ position: "relative" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-.02em" }}>All projects</h1>
        {can("projects.write") && (
          <button type="button" onClick={() => setCreating(true)}
            style={{ position: "absolute", top: 0, right: 0, minHeight: 40, padding: "0 16px", border: 0, borderRadius: 999, background: BETA.ink, color: BETA.selInkText, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
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
            style={{ width: "100%", minHeight: 46, padding: "0 40px 0 40px", border: `1px solid ${BETA.border}`, borderRadius: 999, background: BETA.field, boxShadow: BETA.btnGlassShadow, font: "inherit", fontSize: 15, color: BETA.ink, boxSizing: "border-box" }}
          />
          {query && (
            <button type="button" aria-label="Clear the search" onClick={() => setParam("q", "")}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, border: 0, borderRadius: 17, background: "transparent", color: MUTED, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={16} />
            </button>
          )}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: MUTED }}>
          Brand
          <select aria-label="Filter by brand" value={brand} onChange={(e) => setParam("brand", e.target.value)}
            style={{ minHeight: 40, padding: "0 12px", border: `1px solid ${BETA.glassEdge}`, borderRadius: 999, background: BETA.field, font: "inherit", fontSize: 14, color: BETA.ink }}>
            <option value="">All brands</option>
            {[...new Set((q.data?.projects ?? []).map((p) => p.brand?.trim()).filter((b): b is string => Boolean(b)))].sort().map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: MUTED }}>
          Sort
          <select aria-label="Sort projects" value={sort} onChange={(e) => setParam("sort", e.target.value as HomeSort)}
            style={{ minHeight: 40, padding: "0 12px", border: `1px solid ${BETA.glassEdge}`, borderRadius: 999, background: BETA.field, font: "inherit", fontSize: 14, color: BETA.ink }}>
            {HOME_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {query.trim() && <span role="status" style={{ fontSize: 13, fontWeight: 600, color: INK_SOFT }}>{list.length} of {inFilter.length}</span>}
      </div>

      <BetaStageFilter stages={stages} selected={stage} onSelect={(k) => { setStage(k); setFilter("all"); setCat(null); }}
        layer={stage === "design" ? {
          label: "Design", rule: "The steps are set in Project Maintenance > Design work.",
          steps: designSteps(m).map(([code, label]) => ({ key: code, label, count: stepCounts.steps[code] ?? 0 })),
          selected: filter.startsWith("step:") ? filter.slice(5) : null,
          onSelect: (k) => setFilter(k ? `step:${k}` : "all"),
        } : stage === "renovation" ? {
          label: "Renovation", rule: "Press a category to see the projects where it is not complete yet.",
          steps: (steps.data?.categories ?? []).map((k) => ({ key: k.code, label: k.label, count: catCount(k.code) })),
          selected: cat,
          onSelect: setCat,
        } : null} />

      {!phone && filter === VARIANTS_FILTER ? (
        <VariantsSkuList projects={list} canWrite={can("projects.write")} cardStyle={{ ...CARD, overflow: "hidden" }} onSaved={() => { q.reload(); steps.reload(); }} />
      ) : phone ? (
        <ol className="stag" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.length === 0 && <li style={{ color: MUTED }}>{query.trim() ? `No project matches "${query.trim()}".` : "No projects here."}</li>}
          {rows.slice((phoneNo - 1) * PAGE, phoneNo * PAGE).map((r) => <PhoneCard key={r.p.id} r={r} sla={slaOf(slaById.get(r.p.id), today)} onOpen={() => rememberLastProject(r.p.id)} />)}
          {rows.length > PAGE && <li><Pagination page={phoneNo} perPage={PAGE} total={rows.length} onPageChange={(n) => setPhonePage({ view: viewKey, n })} /></li>}
        </ol>
      ) : (
        <div style={{ ...CARD, overflow: "hidden" }}>
          <DataTable<TableRow>
            key={`${tableKey}|${sort}`}
            tableId={tableKey}
            layoutSeedId="projects-home"
            onDisplayKeys={(keys) => setSoColumnsShown(keys.some((k) => k.startsWith("so_")))}
            documentLabel="Projects"
            rows={tableRows}
            columns={homeColumns(showPay, false)}
            getRowKey={(x) => x.r.p.id}
            onRowClick={(x) => open(x.r.p.id)}
            pageSize={PAGE}
            emptyLabel={query.trim() ? `No project matches "${query.trim()}".` : "No projects here."}
          />
        </div>
      )}

      <div style={{ fontSize: 12, color: MUTED }}>{list.length} shown · tap a project to open it</div>
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
            {(p.customer || p.brand) && <span style={{ fontWeight: 500, fontSize: 12, color: MUTED, overflowWrap: "anywhere" }}>{[p.customer, p.brand].filter(Boolean).join(" · ")}</span>}
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
