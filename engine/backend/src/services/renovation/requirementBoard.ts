import { lineVisible, type CategoryScope } from "../categoryAccess";
import { MEDIA_ACTION, metaOf, parseTarget } from "./betaMedia";
import { todayMyt } from "../../scm/lib/my-time";
import { isMissingRelation, type Db } from "./load";
import { tradeTaskStatus, type TaskStatus } from "./tradeTasks";

export const REQUIREMENT_LINE_LIMIT = 5000;

export type RequirementGroup = "works" | "builtin";

const GROUP_OF_CATEGORY: Readonly<Partial<Record<string, RequirementGroup>>> = {
  WORKS: "works",
  BUILTIN: "builtin",
};

export const BOARD_CATEGORY_CODES: readonly string[] = Object.keys(GROUP_OF_CATEGORY);

export const BUILT_IN_PLAN_KEY = "BUILTIN";

export const BUILT_IN_TASK_CATEGORY = "CARPENTRY";

export const BOARD_CATEGORY_LIST = BOARD_CATEGORY_CODES.map((code) => `'${code}'`).join(", ");

export const SO_LINE_CATEGORY_JOIN =
  `LEFT JOIN LATERAL (SELECT pr.category_group, pr.sub_category FROM scm.mfg_products pr
                       WHERE pr.code = i.item_code AND pr.company_id = so.company_id ORDER BY (pr.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
   JOIN scm.product_category_groups cg ON cg.code = prod.category_group
   LEFT JOIN scm.product_sub_categories sc ON sc.group_code = cg.code AND sc.code = prod.sub_category`;

export const LIVE_BOARD_LINE =
  `so.status::text <> 'CANCELLED' AND NOT coalesce(i.cancelled, false) AND cg.code IN (${BOARD_CATEGORY_LIST})`;

export interface RequirementProjectRow {
  project_id: number;
  project_code: string | null;
  project_name: string | null;
  brand: string | null;
}

export interface RequirementLineRow {
  id: string;
  project_id: number;
  item_code: string | null;
  description: string | null;
  remark: string | null;
  qty: number | string;
  uom: string | null;
  room: string | null;
  cat_code: string;
  sub_code: string | null;
  sub_label: string | null;
  is_on_po: boolean;
  deliver_on: string | null;
}

export interface TradePlanRow {
  id: number;
  project_id: number;
  trade_code: string;
  category_code: string | null;
  label: string | null;
  state: string;
  fulfilment_kind: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  po_fully_received: boolean | null;
}

export interface LineTickRow {
  so_item_id: string;
  done_at: string;
  done_qty: number | string;
}

export interface LineProofRow {
  target: string;
  key: string;
  note: string | null;
  total: number | string;
}

export const PROOF_THUMBNAIL_LIMIT = 4;

export interface RequirementLine {
  id: string;
  itemCode: string;
  name: string;
  remark: string | null;
  qty: number;
  uom: string;
  room: string | null;
  group: RequirementGroup;
  isOnPo: boolean;
  planKey: string | null;
  tradeLabel: string | null;
  onSiteBy: string | null;
  doneQty: number;
  doneAt: string | null;
  isTradeClosed: boolean;
  photoCount: number;
  latestPhotoKeys: string[];
  latestPhotoBy: string | null;
}

export interface TradePlan {
  taskId: number;
  planKey: string;
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: TaskStatus;
}

export interface RequirementProject {
  id: number;
  code: string | null;
  name: string;
  brand: string | null;
  lines: RequirementLine[];
  plans: TradePlan[];
}

export interface RequirementBoard {
  projects: RequirementProject[];
  isTruncated: boolean;
  areTicksReady: boolean;
}

export interface RequirementBoardRows {
  projects: readonly RequirementProjectRow[];
  lines: readonly RequirementLineRow[];
  plans: readonly TradePlanRow[];
  ticks: readonly LineTickRow[] | null;
  proofs?: readonly LineProofRow[];
}

const trimmedOrNull = (value: string | null): string | null => value?.trim() || null;

const dayOf = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

export function requirementLineOf(row: RequirementLineRow, tick: LineTickRow | null = null, closedPlanKeys: ReadonlySet<string> = new Set(), proofs: readonly LineProofRow[] = []): RequirementLine | null {
  const group = GROUP_OF_CATEGORY[row.cat_code];
  if (!group) return null;
  const itemCode = row.item_code ?? "";
  const qty = Number(row.qty);
  const doneQty = Number(tick?.done_qty ?? 0);
  const planKey = group === "builtin" ? BUILT_IN_PLAN_KEY : row.sub_code;
  return {
    id: row.id,
    itemCode,
    name: trimmedOrNull(row.description) ?? itemCode,
    remark: trimmedOrNull(row.remark),
    qty,
    uom: row.uom ?? "UNIT",
    room: trimmedOrNull(row.room),
    group,
    isOnPo: row.is_on_po,
    planKey,
    tradeLabel: group === "works" ? trimmedOrNull(row.sub_label) : null,
    onSiteBy: dayOf(row.deliver_on),
    doneQty,
    doneAt: tick && doneQty >= qty ? tick.done_at : null,
    isTradeClosed: planKey !== null && closedPlanKeys.has(planKey),
    photoCount: Number(proofs[0]?.total ?? 0),
    latestPhotoKeys: proofs.map((proof) => proof.key),
    latestPhotoBy: proofs[0] ? metaOf(proofs[0].note, proofs[0].key).by ?? null : null,
  };
}

function proofsByLine(rows: readonly LineProofRow[]): Map<string, LineProofRow[]> {
  const byLine = new Map<string, LineProofRow[]>();
  for (const row of rows) {
    const target = parseTarget(row.target);
    if (target?.kind !== "line") continue;
    const lineRows = byLine.get(target.soItemId) ?? [];
    lineRows.push(row);
    byLine.set(target.soItemId, lineRows);
  }
  return byLine;
}

export function planKeyOfTask(row: Pick<TradePlanRow, "trade_code" | "category_code">): string | null {
  if (row.category_code === BUILT_IN_TASK_CATEGORY) return BUILT_IN_PLAN_KEY;
  return row.trade_code.includes(":") ? null : row.trade_code;
}

export function tradePlanOf(row: TradePlanRow, today: string): TradePlan | null {
  const planKey = planKeyOfTask(row);
  if (!planKey) return null;
  return {
    taskId: Number(row.id),
    planKey,
    label: trimmedOrNull(row.label) ?? planKey,
    plannedStart: dayOf(row.planned_start),
    plannedEnd: dayOf(row.planned_end),
    status: tradeTaskStatus({ ...row, poFullyReceived: row.po_fully_received === true }, today),
  };
}

function groupByProject<T>(items: readonly T[], projectIdOf: (item: T) => number): Map<number, T[]> {
  const byProject = new Map<number, T[]>();
  for (const item of items) {
    const projectId = projectIdOf(item);
    const projectItems = byProject.get(projectId) ?? [];
    projectItems.push(item);
    byProject.set(projectId, projectItems);
  }
  return byProject;
}

export function buildRequirementBoard(rows: RequirementBoardRows, scope: CategoryScope | null, today: string): RequirementBoard {
  const visibleLines = rows.lines.filter((row) => lineVisible(scope, row.cat_code, row.sub_code));
  const linesByProject = groupByProject(visibleLines, (row) => Number(row.project_id));
  const plansByProject = groupByProject(rows.plans, (row) => Number(row.project_id));
  const proofByLine = proofsByLine(rows.proofs ?? []);
  const tickByLine = new Map((rows.ticks ?? []).map((tick) => [tick.so_item_id, tick] as const));
  const projects = rows.projects.map((row) => {
    const id = Number(row.project_id);
    const closedPlanKeys = new Set((plansByProject.get(id) ?? []).filter((plan) => plan.state === "done").map(planKeyOfTask).filter((key): key is string => key !== null));
    return {
      id,
      code: row.project_code,
      name: row.project_name ?? row.project_code ?? `Project ${id}`,
      brand: trimmedOrNull(row.brand),
      lines: (linesByProject.get(id) ?? []).map((line) => requirementLineOf(line, tickByLine.get(line.id) ?? null, closedPlanKeys, proofByLine.get(line.id))).filter((line): line is RequirementLine => line !== null),
      plans: (plansByProject.get(id) ?? []).map((plan) => tradePlanOf(plan, today)).filter((plan): plan is TradePlan => plan !== null),
    };
  });
  return {
    projects: [...projects.filter((project) => project.lines.length > 0), ...projects.filter((project) => project.lines.length === 0)],
    isTruncated: rows.lines.length >= REQUIREMENT_LINE_LIMIT,
    areTicksReady: rows.ticks !== null,
  };
}

export interface RequirementBoardFilter {
  companySql: string;
  categoryScope: CategoryScope | null | Promise<CategoryScope | null>;
  brandName: string | null;
}

const LIVE_RENOVATION_PROJECTS = (filter: RequirementBoardFilter): string =>
  `p.project_kind = 'renovation' AND p.archived_at IS NULL${filter.companySql}${filter.brandName === null ? "" : " AND lower(trim(p.brand)) = lower(trim(?))"}`;

const brandBindings = (filter: RequirementBoardFilter): string[] => (filter.brandName === null ? [] : [filter.brandName]);

const PROJECTS_SQL = (filter: RequirementBoardFilter): string =>
  `SELECT p.id::int AS project_id, p.code AS project_code, p.name AS project_name, p.brand
     FROM projects p
    WHERE ${LIVE_RENOVATION_PROJECTS(filter)}
    ORDER BY p.code`;

const LINES_SQL = (filter: RequirementBoardFilter): string =>
  `SELECT i.id::text AS id, p.id::int AS project_id, i.item_code, i.description, i.remark, i.qty, i.uom,
          coalesce(nullif(trim(to_jsonb(i)->>'room'), ''), nullif(trim((SELECT l.room FROM scm.reno_doc_lines l WHERE l.so_item_id = i.id LIMIT 1)), ''), nullif(trim(i.location), '')) AS room,
          cg.code AS cat_code, sc.code AS sub_code, sc.label AS sub_label,
          EXISTS (SELECT 1 FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                   WHERE pi.so_item_id = i.id AND po.status::text <> 'CANCELLED') AS is_on_po,
          plan.deliver_on::text AS deliver_on
     FROM scm.mfg_sales_order_items i
     JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
     JOIN projects p ON p.id = so.project_id
     LEFT JOIN scm.reno_beta_line_plans plan ON plan.so_item_id = i.id
     ${SO_LINE_CATEGORY_JOIN}
    WHERE ${LIVE_RENOVATION_PROJECTS(filter)} AND ${LIVE_BOARD_LINE}
    ORDER BY p.code, so.so_date NULLS LAST, i.doc_no, i.line_no NULLS LAST
    LIMIT ${REQUIREMENT_LINE_LIMIT}`;

const PLANS_SQL = (filter: RequirementBoardFilter): string =>
  `SELECT t.id::int AS id, t.project_id::int AS project_id, t.trade_code, t.category_code, t.label, t.state, t.fulfilment_kind,
          t.planned_start::text AS planned_start, t.planned_end::text AS planned_end,
          t.actual_start::text AS actual_start, t.actual_end::text AS actual_end,
          (EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id AND l.purchase_order_item_id IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM project_trade_task_lines l JOIN scm.purchase_order_items poi ON poi.id = l.purchase_order_item_id
                             WHERE l.task_id = t.id AND poi.received_qty < poi.qty)) AS po_fully_received
     FROM project_trade_tasks t
     JOIN projects p ON p.id = t.project_id
    WHERE ${LIVE_RENOVATION_PROJECTS(filter)} AND t.state <> 'skipped' AND t.trade_code NOT LIKE 'INTERNAL:%'
    ORDER BY t.project_id, t.seq`;

const TICKS_SQL = (filter: RequirementBoardFilter): string =>
  `SELECT lp.so_item_id::text AS so_item_id, lp.done_at::text AS done_at, lp.done_qty
     FROM project_line_progress lp
     JOIN projects p ON p.id = lp.project_id
    WHERE ${LIVE_RENOVATION_PROJECTS(filter)}`;

const PROOFS_SQL = (filter: RequirementBoardFilter): string =>
  `SELECT ranked.target, ranked.key, ranked.note, ranked.total
     FROM (SELECT a.from_value AS target, a.to_value AS key, a.note,
                  count(*) OVER (PARTITION BY a.from_value)::int AS total,
                  row_number() OVER (PARTITION BY a.from_value ORDER BY a.id DESC) AS proof_rank
             FROM project_activity a
             JOIN projects p ON p.id = a.project_id
            WHERE a.action = '${MEDIA_ACTION}' AND a.from_value LIKE 'line:%' AND a.archived_at IS NULL AND a.to_value IS NOT NULL
              AND ${LIVE_RENOVATION_PROJECTS(filter)}) ranked
    WHERE ranked.proof_rank <= ${PROOF_THUMBNAIL_LIMIT}
    ORDER BY ranked.target, ranked.proof_rank`;

export const isMissingColumn = (error: unknown): boolean => (error as { code?: string } | null)?.code === "42703";

async function readTicks(db: Db, filter: RequirementBoardFilter): Promise<LineTickRow[] | null> {
  try {
    return (await db.prepare(TICKS_SQL(filter)).bind(...brandBindings(filter)).all<LineTickRow>()).results ?? [];
  } catch (error) {
    if (isMissingRelation(error) || isMissingColumn(error)) return null;
    throw error;
  }
}

export async function loadRequirementBoard(db: Db, filter: RequirementBoardFilter): Promise<RequirementBoard> {
  const bindings = brandBindings(filter);
  const [scope, projects, lines, plans, ticks, proofs] = await Promise.all([
    filter.categoryScope,
    db.prepare(PROJECTS_SQL(filter)).bind(...bindings).all<RequirementProjectRow>(),
    db.prepare(LINES_SQL(filter)).bind(...bindings).all<RequirementLineRow>(),
    db.prepare(PLANS_SQL(filter)).bind(...bindings).all<TradePlanRow>(),
    readTicks(db, filter),
    db.prepare(PROOFS_SQL(filter)).bind(...bindings).all<LineProofRow>(),
  ]);
  const rows = { projects: projects.results ?? [], lines: lines.results ?? [], plans: plans.results ?? [], ticks, proofs: proofs.results ?? [] };
  return buildRequirementBoard(rows, scope, todayMyt());
}
