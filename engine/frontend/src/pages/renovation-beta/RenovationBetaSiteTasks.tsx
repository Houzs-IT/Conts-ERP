import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Camera, ChevronDown, ChevronRight, Search, User } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { BetaLoading } from "./BetaLoading";
import {
  BetaSkin, WS, WsBadge, WsEmpty, WsFilterPill, WsPageHead, WsStyle, inputStyle,
  TONE_ACCENT, TONE_ALERT, TONE_DONE, TONE_QUIET, TONE_WAIT,
} from "./BetaWsUi";
import { siteTasksApi, type SiteTask, type SiteTaskStatus } from "./renovationBetaSiteTasksApi";
import {
  EVERYONE, SITE_TASK_TABS, STATUS_LABEL, brandOptions, groupByProject, hasNoOneOnIt, isLate, matchesFilters, tabCounts, tasksOfTab, whoLine, whoOptions,
  type ProjectGroup, type SiteTaskTab,
} from "./renovationBetaSiteTasksModel";
import { onBrandList } from "./renovationBetaHomeModel";
import { dayMonth, mytDay } from "./renovationBetaModel";
import { BETA, type BetaTone } from "./renovationBetaTheme";

const projectSiteHref = (projectId: number): string => `/beta/projects/${projectId}?tab=site`;

const STATUS_TONE: Record<SiteTaskStatus, BetaTone> = {
  overdue: TONE_ALERT,
  late_start: TONE_ALERT,
  in_progress: TONE_ACCENT,
  planned: TONE_QUIET,
  unscheduled: TONE_WAIT,
  done: TONE_DONE,
  skipped: TONE_QUIET,
};

const EMPTY_BOARD = { open: [], history: [], isTruncated: false };

export function RenovationBetaSiteTasks(): ReactElement {
  return (
    <>
      <BetaSkin />
      <BoardScreen />
    </>
  );
}

function BoardScreen(): ReactElement {
  const query = useQuery(["renovation-beta", "site-tasks"], () => siteTasksApi.board(), []);
  const [tab, setTab] = useState<SiteTaskTab>("open");
  const [who, setWho] = useState<string>(EVERYONE);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const allBoard = query.data ?? EMPTY_BOARD;
  const brands = useMemo(() => brandOptions([...allBoard.open, ...allBoard.history]), [allBoard]);
  const board = useMemo(
    () => ({ ...allBoard, open: allBoard.open.filter((task) => onBrandList(task, brand)), history: allBoard.history.filter((task) => onBrandList(task, brand)) }),
    [allBoard, brand],
  );
  const counts = useMemo(() => tabCounts(board), [board]);
  const people = useMemo(() => whoOptions([...board.open, ...board.history]), [board]);
  const groups = useMemo(
    () => groupByProject(tasksOfTab(board, tab).filter((task) => matchesFilters(task, who, search))),
    [board, tab, who, search],
  );
  const hasNoTasks = board.open.length === 0 && board.history.length === 0;
  const isSearching = search.trim() !== "";
  const [toggledProjectIds, setToggledProjectIds] = useState<ReadonlySet<number>>(new Set());
  const isProjectOpen = (projectId: number): boolean => toggledProjectIds.has(projectId) !== isSearching;
  const toggleProject = (projectId: number): void => setToggledProjectIds((current) => {
    const next = new Set(current);
    if (!next.delete(projectId)) next.add(projectId);
    return next;
  });
  const changeSearch = (nextSearch: string): void => {
    if ((nextSearch.trim() !== "") !== isSearching) setToggledProjectIds(new Set());
    setSearch(nextSearch);
  };

  return (
    <div className="bws" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", minWidth: 0, paddingBottom: 40 }}>
      <WsStyle />
      <WsPageHead
        title="Renovation"
        sub={<>Every site task across projects{counts.late > 0 && <span style={{ color: WS.red, fontWeight: 600 }}> · {counts.late} late</span>}</>}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {SITE_TASK_TABS.map(([key, label]) => (
          <WsFilterPill key={key} on={tab === key} onClick={() => setTab(key)}>{label} · {counts[key]}</WsFilterPill>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <label style={{ flex: "1 1 160px", maxWidth: 220 }}>
          <span className="sr">Filter by brand</span>
          <select value={brand} style={{ ...inputStyle, fontSize: 16 }} onChange={(event) => setBrand(event.target.value)}>
            <option value="">All brands</option>
            {brands.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 200px", maxWidth: 280 }}>
          <span className="sr">Whose tasks</span>
          <select value={who} style={{ ...inputStyle, fontSize: 16 }} onChange={(event) => setWho(event.target.value)}>
            <option value={EVERYONE}>Everyone</option>
            {people.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label style={{ position: "relative", flex: "2 1 220px", maxWidth: 360 }}>
          <span className="sr">Search site tasks</span>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: BETA.muted }} />
          <input type="search" value={search} placeholder="Task, project, unit, who" style={{ ...inputStyle, fontSize: 16, paddingLeft: 32 }} onChange={(event) => changeSearch(event.target.value)} />
        </label>
      </div>
      {board.isTruncated && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: WS.amber }}>Only the first tasks are shown. Pick a person or search to narrow the list.</p>
      )}

      {query.loading && !query.data ? <BetaLoading label="Loading site tasks" size="inline" />
        : query.error && !query.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The site tasks could not be loaded: {query.error}</p>
        : groups.length === 0 ? <WsEmpty>{hasNoTasks ? "No site tasks yet. They appear when a contract has Works lines or a task is added on a project." : "Nothing matches."}</WsEmpty>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map((group) => (
              <ProjectSection key={group.projectId} group={group} isOpen={isProjectOpen(group.projectId)} onToggle={() => toggleProject(group.projectId)} />
            ))}
          </div>
        )}
    </div>
  );
}

interface ProjectSectionProps {
  group: ProjectGroup;
  isOpen: boolean;
  onToggle: () => void;
}

function ProjectSection({ group, isOpen, onToggle }: ProjectSectionProps): ReactElement {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const lateCount = group.tasks.filter(isLate).length;
  const listId = `site-tasks-project-${group.projectId}`;
  return (
    <section aria-label={group.label} style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "stretch", background: WS.panel }}>
        <button type="button" aria-expanded={isOpen} aria-controls={listId} onClick={onToggle}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, minHeight: 48, padding: "10px 8px 10px 12px", border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
          <Chevron size={18} aria-hidden="true" style={{ flexShrink: 0, color: BETA.muted }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>
            {group.label}
            {group.brand && <span style={{ fontSize: 13, fontWeight: 400, color: BETA.muted }}> · {group.brand}</span>}
          </span>
          <span style={{ flexShrink: 0, fontSize: 13, color: BETA.muted, whiteSpace: "nowrap" }}>
            {group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}
            {lateCount > 0 && <span style={{ color: WS.red, fontWeight: 600 }}> · {lateCount} late</span>}
          </span>
        </button>
        <Link to={projectSiteHref(group.projectId)} aria-label={`Open ${group.label}`} title="Open project"
          style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 48, color: BETA.muted, borderLeft: `1px solid ${BETA.line}` }}>
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </div>
      {isOpen && (
        <ul id={listId} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {group.tasks.map((task) => <li key={task.id} style={{ borderTop: `1px solid ${BETA.line}` }}><TaskRow task={task} /></li>)}
        </ul>
      )}
    </section>
  );
}

function plannedLine(task: SiteTask): string {
  if (task.finishedOn) return `Finished ${dayMonth(task.finishedOn)}`;
  if (!task.plannedStart && !task.plannedEnd) return "No dates";
  if (task.plannedStart && task.plannedEnd && task.plannedStart !== task.plannedEnd) return `${dayMonth(task.plannedStart)} to ${dayMonth(task.plannedEnd)}`;
  return dayMonth(task.plannedStart ?? task.plannedEnd);
}

function TaskRow({ task }: { task: SiteTask }): ReactElement {
  const isNobody = hasNoOneOnIt(task);
  const isLateTask = isLate(task);
  return (
    <Link to={projectSiteHref(task.projectId)} aria-label={`Open ${task.label}, ${STATUS_LABEL[task.status]}`}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", minHeight: 44, padding: "10px 14px", color: "inherit", textDecoration: "none" }}>
      <span style={{ flex: "2 1 220px", minWidth: 0, fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{task.label}</span>
      <span style={{ flex: "1 1 180px", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: isNobody ? WS.amber : WS.text2, fontWeight: isNobody ? 600 : 400 }}>
        <User size={13} aria-hidden="true" />{whoLine(task)}
      </span>
      <span style={{ flex: "1 1 150px", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: isLateTask ? WS.red : BETA.muted, fontWeight: isLateTask ? 700 : 400 }}>
        <CalendarDays size={13} aria-hidden="true" />{plannedLine(task)}
      </span>
      <span style={{ flex: "0 1 110px", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: BETA.muted }}>
        {task.lastPhotoAt && <><Camera size={13} aria-hidden="true" />{dayMonth(mytDay(task.lastPhotoAt))}</>}
      </span>
      <WsBadge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</WsBadge>
    </Link>
  );
}
