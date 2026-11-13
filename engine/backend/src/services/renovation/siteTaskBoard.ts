import { tradeTaskStatus, type TaskStatus } from "./tradeTasks";

export const SITE_TASK_LIMIT = 3000;

export interface SiteTaskCrewMember {
  id: number;
  name: string;
}

export interface SiteTaskRow {
  id: number;
  project_id: number;
  project_code: string | null;
  project_name: string | null;
  building: string | null;
  unit_no: string | null;
  brand: string | null;
  label: string | null;
  fulfilment_kind: string;
  state: string;
  supplier_name: string | null;
  crew: SiteTaskCrewMember[] | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  po_fully_received: boolean | null;
  last_photo_at: string | null;
}

export interface SiteTask {
  id: number;
  projectId: number;
  projectCode: string | null;
  projectName: string | null;
  building: string | null;
  unitNo: string | null;
  brand: string | null;
  label: string;
  isSubcontracted: boolean;
  supplierName: string | null;
  crew: SiteTaskCrewMember[];
  plannedStart: string | null;
  plannedEnd: string | null;
  finishedOn: string | null;
  lastPhotoAt: string | null;
  status: TaskStatus;
}

export interface SiteTaskBoard {
  open: SiteTask[];
  history: SiteTask[];
  isTruncated: boolean;
}

const CLOSED_STATUSES: ReadonlySet<TaskStatus> = new Set(["done", "skipped"]);

const dayOf = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

export function siteTaskOf(row: SiteTaskRow, today: string): SiteTask {
  const isSubcontracted = row.fulfilment_kind === "po";
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    projectCode: row.project_code,
    projectName: row.project_name,
    building: row.building,
    unitNo: row.unit_no,
    brand: row.brand?.trim() || null,
    label: row.label ?? "Site task",
    isSubcontracted,
    supplierName: isSubcontracted ? row.supplier_name : null,
    crew: row.crew ?? [],
    plannedStart: dayOf(row.planned_start),
    plannedEnd: dayOf(row.planned_end),
    finishedOn: dayOf(row.actual_end),
    lastPhotoAt: row.last_photo_at,
    status: tradeTaskStatus({
      state: row.state,
      fulfilment_kind: row.fulfilment_kind,
      planned_start: row.planned_start,
      planned_end: row.planned_end,
      actual_start: row.actual_start,
      actual_end: row.actual_end,
      poFullyReceived: row.po_fully_received === true,
    }, today),
  };
}

const byPlannedDate = (a: SiteTask, b: SiteTask): number =>
  (a.plannedStart ?? a.plannedEnd ?? "9999").localeCompare(b.plannedStart ?? b.plannedEnd ?? "9999");

const byFinishedLatest = (a: SiteTask, b: SiteTask): number =>
  (b.finishedOn ?? "").localeCompare(a.finishedOn ?? "");

export function buildSiteTaskBoard(rows: readonly SiteTaskRow[], today: string): SiteTaskBoard {
  const tasks = rows.map((row) => siteTaskOf(row, today));
  return {
    open: tasks.filter((task) => !CLOSED_STATUSES.has(task.status)).sort(byPlannedDate),
    history: tasks.filter((task) => CLOSED_STATUSES.has(task.status)).sort(byFinishedLatest),
    isTruncated: rows.length >= SITE_TASK_LIMIT,
  };
}
