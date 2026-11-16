import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, ChevronDown, ChevronRight, DoorOpen, Search } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { BetaLoading } from "./BetaLoading";
import {
  BetaSkin, WS, WsBadge, WsEmpty, WsPageHead, WsStyle, inputStyle, TONE_ACCENT, TONE_ALERT, TONE_DONE, TONE_QUIET, TONE_WAIT,
} from "./BetaWsUi";
import { requirementsApi, type RequirementLine, type RequirementProject, type TradePlan, type TradePlanStatus } from "./renovationBetaRequirementsApi";
import {
  PLAN_STATUS_LABEL, brandOptions, filterProjectLines, groupByRoom, groupByTrade, hasPlanDates, isPlanLate, onPoCount, planDates, plural, roomSummary,
  type GroupCard, type RoomGroup, type TradeGroup,
} from "./renovationBetaRequirementsModel";
import { onBrandList } from "./renovationBetaHomeModel";
import { dayMonth } from "./renovationBetaModel";
import { BANDS, BETA, type BetaTone } from "./renovationBetaTheme";

const projectSoHref = (projectId: number): string => `/beta/projects/${projectId}?tab=po`;

const GROUP_BANDS: Record<GroupCard["key"], (typeof BANDS)[number]> = {
  works: BANDS[0],
  builtin: BANDS[1],
};

const PLAN_STATUS_TONE: Record<TradePlanStatus, BetaTone> = {
  overdue: TONE_ALERT,
  late_start: TONE_ALERT,
  in_progress: TONE_ACCENT,
  planned: TONE_QUIET,
  unscheduled: TONE_WAIT,
  done: TONE_DONE,
  skipped: TONE_QUIET,
};

interface Toggles {
  isOpen: (sectionKey: string) => boolean;
  toggle: (sectionKey: string) => void;
}

interface ShownProject {
  project: RequirementProject;
  lines: RequirementLine[];
}

export function RenovationBetaRequirements(): ReactElement {
  return (
    <>
      <BetaSkin />
      <BoardScreen />
    </>
  );
}

function useToggles(isSearching: boolean): Toggles & { reset: () => void } {
  const [toggledKeys, setToggledKeys] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (sectionKey) => toggledKeys.has(sectionKey) !== isSearching,
    toggle: (sectionKey) => setToggledKeys((current) => {
      const next = new Set(current);
      if (!next.delete(sectionKey)) next.add(sectionKey);
      return next;
    }),
    reset: () => setToggledKeys(new Set()),
  };
}

function BoardScreen(): ReactElement {
  const query = useQuery(["renovation-beta", "requirements"], () => requirementsApi.board(), []);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const isSearching = search.trim() !== "";
  const toggles = useToggles(isSearching);
  const allProjects = useMemo(() => query.data?.projects ?? [], [query.data]);
  const brands = useMemo(() => brandOptions(allProjects), [allProjects]);
  const brandProjects = useMemo(() => allProjects.filter((project) => onBrandList(project, brand)), [allProjects, brand]);
  const withoutLinesCount = brandProjects.filter((project) => project.lines.length === 0).length;
  const shown = useMemo<ShownProject[]>(
    () => brandProjects
      .map((project) => ({ project, lines: filterProjectLines(project, search) }))
      .filter(({ lines }) => lines.length > 0),
    [brandProjects, search],
  );
  const changeSearch = (nextSearch: string): void => {
    if ((nextSearch.trim() !== "") !== isSearching) toggles.reset();
    setSearch(nextSearch);
  };

  return (
    <div className="bws" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", minWidth: 0, paddingBottom: 40 }}>
      <WsStyle />
      <WsPageHead
        title="Renovation"
        sub={<>Works and built-in lines on each project's sales order, by room{withoutLinesCount > 0 && ` · ${plural(withoutLinesCount, "project")} with no lines yet`}</>}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <label style={{ flex: "1 1 160px", maxWidth: 220 }}>
          <span className="sr">Filter by brand</span>
          <select value={brand} style={{ ...inputStyle, fontSize: 16 }} onChange={(event) => setBrand(event.target.value)}>
            <option value="">All brands</option>
            {brands.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label style={{ position: "relative", flex: "2 1 220px", maxWidth: 360 }}>
          <span className="sr">Search the lines</span>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: BETA.muted }} />
          <input type="search" value={search} placeholder="Project, room, SKU, item" style={{ ...inputStyle, fontSize: 16, paddingLeft: 32 }} onChange={(event) => changeSearch(event.target.value)} />
        </label>
      </div>
      {query.data?.isTruncated && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: WS.amber }}>Only the first lines are shown. Pick a brand or search to narrow the list.</p>
      )}

      {query.loading && !query.data ? <BetaLoading label="Loading renovation lines" size="inline" />
        : query.error && !query.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The renovation lines could not be loaded: {query.error}</p>
        : shown.length === 0 ? <WsEmpty>{isSearching ? "Nothing matches." : "No project has Works or Built-in lines yet. They appear here once a quotation is converted to a sales order."}</WsEmpty>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map(({ project, lines }) => <ProjectSection key={project.id} project={project} lines={lines} toggles={toggles} />)}
          </div>
        )}
    </div>
  );
}

interface SectionHeaderProps {
  isOpen: boolean;
  controls: string;
  onToggle: () => void;
  indent: number;
  children: ReactNode;
}

function SectionHeader({ isOpen, controls, onToggle, indent, children }: SectionHeaderProps): ReactElement {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <button type="button" aria-expanded={isOpen} aria-controls={controls} onClick={onToggle}
      style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 44, padding: `8px 14px 8px ${indent}px`, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
      <Chevron size={16} aria-hidden="true" style={{ flexShrink: 0, color: BETA.muted }} />
      {children}
    </button>
  );
}

const countStyle = { flexShrink: 0, marginLeft: "auto", fontSize: 13, fontWeight: 400, color: BETA.muted, whiteSpace: "nowrap" } as const;

function ProjectSection({ project, lines, toggles }: { project: RequirementProject; lines: RequirementLine[]; toggles: Toggles }): ReactElement {
  const sectionKey = `project-${project.id}`;
  const isOpen = toggles.isOpen(sectionKey);
  return (
    <section aria-label={project.name} style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "stretch", background: WS.panel }}>
        <SectionHeader isOpen={isOpen} controls={sectionKey} onToggle={() => toggles.toggle(sectionKey)} indent={12}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>
            {project.name}
            {project.brand && <span style={{ fontSize: 13, fontWeight: 400, color: BETA.muted }}> · {project.brand}</span>}
          </span>
          <span style={countStyle}>{plural(lines.length, "line")}</span>
        </SectionHeader>
        <Link to={projectSoHref(project.id)} aria-label={`Open the sales order of ${project.name}`} title="Open the project's SO"
          style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 48, color: BETA.muted, borderLeft: `1px solid ${BETA.line}` }}>
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </div>
      {isOpen && (
        <div id={sectionKey}>
          {groupByRoom(lines).map((room) => <RoomSection key={room.name} room={room} plans={project.plans} sectionKey={`${sectionKey}-room-${room.name}`} toggles={toggles} />)}
        </div>
      )}
    </section>
  );
}

interface SectionProps {
  sectionKey: string;
  toggles: Toggles;
  plans: TradePlan[];
}

function RoomSection({ room, sectionKey, toggles, plans }: SectionProps & { room: RoomGroup }): ReactElement {
  const isOpen = toggles.isOpen(sectionKey);
  return (
    <div style={{ borderTop: `1px solid ${BETA.line}` }}>
      <SectionHeader isOpen={isOpen} controls={sectionKey} onToggle={() => toggles.toggle(sectionKey)} indent={20}>
        <DoorOpen size={15} aria-hidden="true" style={{ flexShrink: 0, color: BETA.muted }} />
        <span style={{ minWidth: 0, fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{room.name}</span>
        <span style={countStyle}>{roomSummary(room)}</span>
      </SectionHeader>
      {isOpen && (
        <div id={sectionKey}>
          {room.cards.map((card) => <GroupSection key={card.key} card={card} plans={plans} sectionKey={`${sectionKey}-${card.key}`} toggles={toggles} />)}
        </div>
      )}
    </div>
  );
}

function GroupSection({ card, sectionKey, toggles, plans }: SectionProps & { card: GroupCard }): ReactElement {
  const isOpen = toggles.isOpen(sectionKey);
  const [bar, tint, text] = GROUP_BANDS[card.key];
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <div style={{ borderTop: `1px solid ${BETA.line}` }}>
      <button type="button" aria-expanded={isOpen} aria-controls={sectionKey} onClick={() => toggles.toggle(sectionKey)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 44, padding: "8px 14px 8px 28px", border: 0,
          borderLeft: `4px solid ${bar}`, background: tint, color: text, font: "inherit", fontSize: 14, fontWeight: 700, textAlign: "left", cursor: "pointer",
        }}>
        <Chevron size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>{card.label}</span>
        <span style={countStyle}>{plural(card.lines.length, "line")} · {onPoCount(card.lines)} on PO</span>
      </button>
      {isOpen && (
        <div id={sectionKey}>
          {groupByTrade(card.lines, plans).map((trade) => <TradeBlock key={trade.key} trade={trade} />)}
        </div>
      )}
    </div>
  );
}

function TradeBlock({ trade }: { trade: TradeGroup }): ReactElement {
  return (
    <div style={{ borderTop: `1px solid ${BETA.line}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", minHeight: 40, padding: "8px 14px 8px 44px", background: WS.panel }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{trade.label}</span>
        {trade.plans.length === 0
          ? <span style={{ fontSize: 13, color: BETA.muted }}>Not planned yet</span>
          : trade.plans.map((plan) => <PlanChip key={plan.taskId} plan={plan} isNamed={trade.plans.length > 1} />)}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {trade.lines.map((line) => <li key={line.id} style={{ borderTop: `1px solid ${BETA.line}` }}><LineRow line={line} /></li>)}
      </ul>
    </div>
  );
}

function PlanChip({ plan, isNamed }: { plan: TradePlan; isNamed: boolean }): ReactElement {
  const isLate = isPlanLate(plan.status);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: isLate ? WS.red : WS.text2, fontWeight: isLate ? 700 : 400 }}>
      {hasPlanDates(plan) && <CalendarDays size={13} aria-hidden="true" />}
      {isNamed && <span>{plan.label}{hasPlanDates(plan) && " ·"}</span>}
      {hasPlanDates(plan) && planDates(plan)}
      <WsBadge tone={PLAN_STATUS_TONE[plan.status]}>{PLAN_STATUS_LABEL[plan.status]}</WsBadge>
    </span>
  );
}

function LineRow({ line }: { line: RequirementLine }): ReactElement {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", minHeight: 44, padding: "8px 14px 8px 44px" }}>
      <span style={{ flex: "0 1 160px", minWidth: 0, fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{line.itemCode}</span>
      <span style={{ flex: "2 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{line.name}</span>
        {line.remark && <span style={{ fontSize: 13, color: WS.text2, overflowWrap: "anywhere" }}>{line.remark}</span>}
      </span>
      <span style={{ flex: "0 0 auto", fontSize: 13, color: WS.text2, whiteSpace: "nowrap" }}>Qty {line.qty} {line.uom.toLowerCase()}</span>
      {line.onSiteBy && <span style={{ flex: "0 0 auto", fontSize: 13, color: WS.text2, whiteSpace: "nowrap" }}>On site by {dayMonth(line.onSiteBy)}</span>}
      <WsBadge tone={line.isOnPo ? TONE_ACCENT : TONE_QUIET}>{line.isOnPo ? "On PO" : "Not on PO"}</WsBadge>
    </div>
  );
}
