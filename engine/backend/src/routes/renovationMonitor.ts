/* GET /api/renovation/monitor?personId= : the Project Monitor hub page (one place
   instead of the team's Notion panels). Mounted inside routes/renovation.ts before
   its /:id routes.

   Set-based: the board-row load (about a dozen queries for any number of projects)
   plus three for design records, open quotations and open VOs, so the free Workers
   plan's 50 outside calls per request stay far away. Queue rules are the pure
   services/renovation/monitor.ts. personId narrows to "my" projects: sales person,
   designer, renovation PIC or crew on one of its site tasks. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import { financeHiddenForUser } from "../services/pmsAccess";
import { todayMyt } from "../scm/lib/my-time";
import { FLOW_STEP_KEYS, type FlowStepKey } from "../scm/shared/renovation-stages";
import { BOARD_CHECKLIST_KEYS, isMissingRelation, loadProjectRows, loadRenovationFacts, type Db } from "../services/renovation/load";
import { computeProjectView } from "../services/renovation/view";
import { boardRowOf, type BoardRowV2 } from "../services/renovation/boardRow";
import { activeSteps } from "../services/renovation/flow";
import { isTaskFlagged } from "../services/renovation/tradeTasks";
import { SUPPLY_CONDITION_LABEL } from "../services/renovation/conditions";
import {
  FLAG_LABEL, NO_SO_FLAG_DAYS, PAYMENT_NORM_PCT, QUEUES, involvesPerson, monitorFlags, monitorQueues,
  type FlagKey, type MonitorFacts, type QueueKey,
} from "../services/renovation/monitor";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();
const db = (c: Ctx) => c.env.DB as unknown as Db;
const ids = (xs: ReadonlyArray<string | number>) => JSON.stringify(xs.map(String));

interface DesignRow { project_id: number; measured: boolean; has2d: boolean; has3d: boolean }
interface OpenDoc { key: string; id: string; no: string; n: number }

async function optional<T>(p: Promise<{ results?: T[] }>): Promise<T[]> {
  try {
    return (await p).results ?? [];
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

export interface MonitorRow extends BoardRowV2 {
  createdAt: string | null;
  siteMeasured: boolean;
  has2d: boolean;
  has3d: boolean;
  scheduledTasks: number;
  overdueTasks: number;
  openTasks: number;
  /** the red flag's own text, e.g. "Works started before: ..." */
  worksBeforeGateText: string | null;
  crewIds: number[];
  openQuotation: { id: string; quoteNo: string; count: number } | null;
  openVo: { id: string; voNo: string; count: number } | null;
  queues: QueueKey[];
  flags: FlagKey[];
}

const truthy = (x: unknown) => x === true || x === "t" || String(x) === "true";

app.get("/monitor", requirePageAccess("projects.list"), async (c) => {
  const rawPerson = c.req.query("personId");
  const personId = rawPerson ? Number(rawPerson) : null;
  if (rawPerson && !(Number.isInteger(personId) && personId! > 0)) return c.json({ error: "invalid_person" }, 400);
  try {
    const hideMoney = financeHiddenForUser(c.get("user"));
    const today = todayMyt();
    const projects = await loadProjectRows(db(c), activeCompanySql(c, "p.company_id"), {});
    const facts = await loadRenovationFacts(db(c), projects, { checklistKeys: BOARD_CHECKLIST_KEYS });
    const pids = projects.map((p) => p.id);
    const docNos = [...facts.values()].map((f) => f.so?.doc_no).filter((x): x is string => !!x);

    const [design, quotes, vos] = await Promise.all([
      pids.length
        ? optional(db(c).prepare(
            `SELECT p.id::int AS project_id,
                    EXISTS (SELECT 1 FROM project_design_records r WHERE r.project_id = p.id AND r.kind = 'site_measure') AS measured,
                    EXISTS (SELECT 1 FROM project_design_files f WHERE f.project_id = p.id AND f.kind = '2d') AS has2d,
                    EXISTS (SELECT 1 FROM project_design_files f WHERE f.project_id = p.id AND f.kind = '3d') AS has3d
               FROM projects p WHERE p.id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`,
          ).bind(ids(pids)).all<DesignRow>())
        : Promise.resolve([] as DesignRow[]),
      pids.length
        ? optional(db(c).prepare(
            `SELECT DISTINCT ON (project_id) project_id::text AS key, id::text AS id, quote_no AS no, count(*) OVER (PARTITION BY project_id)::int AS n
               FROM scm.reno_quotations
              WHERE project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)
                AND status IN ('DRAFT', 'SENT') AND converted_so_doc_no IS NULL
              ORDER BY project_id, updated_at DESC`,
          ).bind(ids(pids)).all<OpenDoc>())
        : Promise.resolve([] as OpenDoc[]),
      docNos.length
        ? optional(db(c).prepare(
            `SELECT DISTINCT ON (so_doc_no) so_doc_no AS key, id::text AS id, vo_no AS no, count(*) OVER (PARTITION BY so_doc_no)::int AS n
               FROM scm.reno_variation_orders
              WHERE so_doc_no IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND status IN ('DRAFT', 'SENT')
              ORDER BY so_doc_no, seq DESC`,
          ).bind(ids(docNos)).all<OpenDoc>())
        : Promise.resolve([] as OpenDoc[]),
    ]);
    const designBy = new Map(design.map((d) => [Number(d.project_id), d]));
    const quoteBy = new Map(quotes.map((q) => [String(q.key), q]));
    const voBy = new Map(vos.map((v) => [String(v.key), v]));

    let steps: Array<{ key: FlowStepKey; label: string }> = activeSteps([]).map((s) => ({ key: s.step_key, label: s.label }));
    const rows: MonitorRow[] = [];
    for (const p of projects) {
      const f = facts.get(p.id)!;
      const v = computeProjectView(f, today);
      steps = v.flow.steps;
      const crewIds = [...new Set(v.tasks.flatMap((t) => (t.assignees ?? []).map((a) => Number(a.id))))];
      if (!involvesPerson({
        salesPersonId: p.sales_person_id ?? null, designerPersonId: p.designer_person_id ?? null,
        renoPicPersonId: p.reno_pic_person_id ?? null, crewIds,
      }, personId)) continue;
      const board = boardRowOf(f, v, { hideMoney });
      const d = designBy.get(p.id);
      const quote = quoteBy.get(String(p.id)) ?? null;
      const vo = f.so ? (voBy.get(f.so.doc_no) ?? null) : null;
      const gateFlag = v.redFlags.find((x) => x.code === "gate_blocked_works") ?? null;
      const live = v.tasks.filter((t) => t.status !== "skipped");
      const mf: MonitorFacts = {
        step: v.flow.current,
        hold: v.hold?.flag ?? null,
        hasSo: !!f.so,
        createdAt: p.created_at ? String(p.created_at) : null,
        contractSen: board.contractSen,
        receivedSen: board.receivedSen,
        receivedPct: board.receivedPct,
        voOpen: vo ? Number(vo.n) : 0,
        quotationsOpen: quote ? Number(quote.n) : 0,
        siteMeasured: truthy(d?.measured),
        has2d: truthy(d?.has2d),
        has3d: truthy(d?.has3d),
        scheduledTasks: live.filter((t) => t.planned_start || t.planned_end).length,
        overdueTasks: v.tasks.filter((t) => isTaskFlagged(t.status)).length,
        furniture: board.furnitureArrival,
        renoItem: board.renoItemArrival,
        handedOver: !!f.handover || !!p.handed_over_at,
        plannedHandoverDate: p.planned_handover_date,
        worksBeforeGate: !!gateFlag,
      };
      rows.push({
        ...board,
        createdAt: mf.createdAt,
        siteMeasured: mf.siteMeasured,
        has2d: mf.has2d,
        has3d: mf.has3d,
        scheduledTasks: mf.scheduledTasks,
        overdueTasks: mf.overdueTasks,
        worksBeforeGateText: gateFlag?.text ?? null,
        openTasks: live.filter((t) => t.status !== "done").length,
        crewIds,
        openQuotation: quote ? { id: quote.id, quoteNo: quote.no, count: Number(quote.n) } : null,
        openVo: vo ? { id: vo.id, voNo: vo.no, count: Number(vo.n) } : null,
        queues: monitorQueues(mf, today),
        flags: monitorFlags(mf, today),
      });
    }

    const stepCounts = Object.fromEntries(FLOW_STEP_KEYS.map((k) => [k, rows.filter((r) => r.step.key === k).length])) as Record<FlowStepKey, number>;
    const byQueue = (k: QueueKey) => rows.filter((r) => r.queues.includes(k)).map((r) => r.id);
    const byFlag = (k: FlagKey) => rows.filter((r) => r.flags.includes(k)).map((r) => r.id);
    return c.json({
      today,
      personId,
      moneyHidden: hideMoney,
      steps,
      stepCounts,
      holdCounts: { in_defect: rows.filter((r) => r.hold?.flag === "in_defect").length, on_hold: rows.filter((r) => r.hold?.flag === "on_hold").length },
      queues: QUEUES.map((q) => { const list = byQueue(q.key); return { ...q, count: list.length, ids: list }; }),
      flags: (Object.keys(FLAG_LABEL) as FlagKey[]).map((k) => { const list = byFlag(k); return { key: k, label: FLAG_LABEL[k], count: list.length, ids: list }; }),
      paymentNormPct: PAYMENT_NORM_PCT,
      noSoFlagDays: NO_SO_FLAG_DAYS,
      arrivalLabels: SUPPLY_CONDITION_LABEL,
      rows,
    });
  } catch (e) {
    console.error("[renovation] monitor failed", e);
    return c.json({ error: "renovation_read_failed", message: "Project facts could not be read. Try again." }, 409);
  }
});

export default app;
