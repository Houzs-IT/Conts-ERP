/* Renovation project stages, auto-skip rules and site trade order.

   ONE definition shared by the sales documents (phase 2: instalment stage_code)
   and the project module (phase 3). Mirrored byte-for-byte at
   frontend/src/vendor/shared/renovation-stages.ts. Stage keys are stored values:
   never rename one, only relabel it. */

import type { CatalogGroup, StageKey } from './renovation-catalog';

export type { StageKey };

export const RENO_STAGES: readonly StageKey[] = [
  'design',
  'key_permit',
  'defect_check',
  'shop_drawings',
  'hardware',
  'furniture',
  'appliances',
  'soft_furnishing',
  'handover',
  'warranty',
  'closed',
];

export const STAGE_LABEL: Readonly<Record<StageKey, string>> = {
  design: 'Design',
  key_permit: 'Key collection & permit',
  defect_check: 'Defect check',
  shop_drawings: 'Site measure & shop drawings',
  hardware: 'Hardware works',
  furniture: 'Furniture & built-in',
  appliances: 'Appliances',
  soft_furnishing: 'Soft furnishing / Airbnb setup',
  handover: 'Cleaning & handover',
  warranty: 'Warranty',
  closed: 'Closed',
};

/* These can never be skipped, by hand or automatically. */
export const UNSKIPPABLE: readonly StageKey[] = ['design', 'handover', 'closed'];

/* A stage whose rule is listed here is skipped automatically when the SO has no
   live line in any of these groups. Stages not listed are never auto-skipped. */
export const AUTO_SKIP_RULE: Readonly<Partial<Record<StageKey, readonly CatalogGroup[]>>> = {
  hardware: ['WORKS'],
  furniture: ['FURNITURE', 'BUILTIN'],
  appliances: ['APPLIANCE'],
  soft_furnishing: ['SOFT', 'SERVICE', 'AIRBNB'],
};

export interface TradeStep {
  trade: string;
  fix: 'single' | 'first' | 'second';
}

/* SUGGESTED site order of WORKS trade tasks inside the hardware stage, used to
   lay out new tasks. It is not enforced: real projects reorder and overlap trades
   (owner's Notion task boards), so tasks carry planned dates and only overdue
   dates raise a flag. ELECTRICAL appears twice (piping first, fittings after
   painting). CLEANING belongs to handover and PROJECT_MGMT gets no task. */
export const TRADE_ORDER: readonly TradeStep[] = [
  { trade: 'PROTECTION', fix: 'single' },
  { trade: 'HACKING', fix: 'single' },
  { trade: 'PLUMBING', fix: 'single' },
  { trade: 'WATERPROOFING', fix: 'single' },
  { trade: 'ELECTRICAL', fix: 'first' },
  { trade: 'MASONRY_TILING', fix: 'single' },
  { trade: 'PLASTER_CEILING', fix: 'single' },
  { trade: 'PARTITION', fix: 'single' },
  { trade: 'ALUMINIUM_GLASS', fix: 'single' },
  { trade: 'GRILL', fix: 'single' },
  { trade: 'PAINTING', fix: 'single' },
  { trade: 'TEXTURED_PAINTING', fix: 'single' },
  { trade: 'FEATURE_WALL', fix: 'single' },
  { trade: 'DOOR', fix: 'single' },
  { trade: 'ELECTRICAL', fix: 'second' },
  { trade: 'FLOORING', fix: 'single' },
  { trade: 'AIRCON_INSTALL', fix: 'single' },
];

export const NON_TASK_TRADES: Readonly<Record<string, StageKey | null>> = {
  CLEANING: 'handover',
  PROJECT_MGMT: null,
};

export function isStageKey(x: string | null | undefined): x is StageKey {
  return (RENO_STAGES as readonly string[]).includes(String(x ?? ''));
}

export function stageSeq(key: StageKey): number {
  return RENO_STAGES.indexOf(key);
}

export function isSkippable(key: StageKey): boolean {
  return !UNSKIPPABLE.includes(key);
}

export interface InternalTaskDef {
  key: string;
  label: string;
  stage: StageKey;
}

/* Tasks every project of a type gets from its template, not from SO lines
   (named as on the owner's Notion task boards). A task is fulfilled by a PO
   (subcontractor or supplier) or by our own people (in-house crew picked from
   the people list); there is no production order. */
export const INTERNAL_TASKS: readonly InternalTaskDef[] = [
  { key: 'pre_reno_delivery', label: 'Pre-reno works & item delivery', stage: 'hardware' },
  { key: 'qc', label: 'QC', stage: 'hardware' },
  { key: 'post_reno_cleaning', label: 'Post reno cleaning', stage: 'handover' },
  { key: 'touch_up', label: 'Touch up', stage: 'handover' },
  { key: 'set_up_cleaning', label: 'Set up cleaning', stage: 'handover' },
  { key: 'joint_handover_inspection', label: 'Joint handover inspection', stage: 'handover' },
];

export interface TaskCategoryDef {
  code: string;
  /** Notion wording, shown as the task name. */
  label: string;
  stage: StageKey;
  /** WORKS sub-category this category is a task of, when it has one. */
  trade: string | null;
  fix: 'single' | 'first' | 'second';
  /** Template task key (INTERNAL_TASKS) this category is, when it is one. */
  internalKey: string | null;
  /** The category a task of (trade, fix) made from the contract gets. */
  tradeDefault: boolean;
  /** Sorted by the median start day in the owner's Notion schedules. */
  sort: number;
  /** false for the two trades Notion never names (protection, waterproofing). */
  notion: boolean;
}

/* Site task vocabulary: the owner's Notion "Renovation Task" categories (study
   10 Oct 2026, section 2.2), one row each, mapped onto a WORKS trade or a
   template task. A category with neither (carpentry, curtain, deliveries...) is
   a task by itself, stored with task code CAT:<code>. Migration 0084 seeds the
   same rows into public.project_task_categories (parity test). Codes are stored
   values: never rename one, only relabel it. */
export const TASK_CATEGORIES: readonly TaskCategoryDef[] = [
  { code: 'PRE_RENO_WORKS', label: 'PRE-RENO WORKS & ITEM DELIVERY', stage: 'hardware', trade: null, fix: 'single', internalKey: 'pre_reno_delivery', tradeDefault: false, sort: 10, notion: true },
  { code: 'PROTECTION', label: 'PROTECTION', stage: 'hardware', trade: 'PROTECTION', fix: 'single', internalKey: null, tradeDefault: true, sort: 20, notion: false },
  { code: 'WIRING_HACKING', label: 'WIRING & HACKING', stage: 'hardware', trade: 'ELECTRICAL', fix: 'first', internalKey: null, tradeDefault: true, sort: 30, notion: true },
  { code: 'DEMOLISH', label: 'DEMOLISH / DISMANTLE', stage: 'hardware', trade: 'HACKING', fix: 'single', internalKey: null, tradeDefault: true, sort: 40, notion: true },
  { code: 'REMOVING_OLD_SPC', label: 'REMOVING OLD SPC', stage: 'hardware', trade: 'HACKING', fix: 'single', internalKey: null, tradeDefault: false, sort: 45, notion: true },
  { code: 'PLUMBING', label: 'PLUMBING WORK', stage: 'hardware', trade: 'PLUMBING', fix: 'single', internalKey: null, tradeDefault: true, sort: 50, notion: true },
  { code: 'WATERPROOFING', label: 'WATERPROOFING', stage: 'hardware', trade: 'WATERPROOFING', fix: 'single', internalKey: null, tradeDefault: true, sort: 55, notion: false },
  { code: 'FLOOR_LEVELING', label: 'FLOOR LEVELING & WALL BUILDING', stage: 'hardware', trade: 'MASONRY_TILING', fix: 'single', internalKey: null, tradeDefault: false, sort: 60, notion: true },
  { code: 'TILES', label: 'TILES INSTALLATION', stage: 'hardware', trade: 'MASONRY_TILING', fix: 'single', internalKey: null, tradeDefault: true, sort: 65, notion: true },
  { code: 'LIGHTING_FAN', label: 'LIGHTING & FAN INSTALLATION', stage: 'hardware', trade: 'ELECTRICAL', fix: 'second', internalKey: null, tradeDefault: true, sort: 70, notion: true },
  { code: 'PLASTER_CEILING', label: 'PLASTER CEILING', stage: 'hardware', trade: 'PLASTER_CEILING', fix: 'single', internalKey: null, tradeDefault: true, sort: 80, notion: true },
  { code: 'PAINTING', label: 'PAINTING', stage: 'hardware', trade: 'PAINTING', fix: 'single', internalKey: null, tradeDefault: true, sort: 90, notion: true },
  { code: 'SPC_FLOORING', label: 'SPC FLOORING', stage: 'hardware', trade: 'FLOORING', fix: 'single', internalKey: null, tradeDefault: true, sort: 95, notion: true },
  { code: 'FEATURE_WALL', label: 'FEATURE WALL', stage: 'hardware', trade: 'FEATURE_WALL', fix: 'single', internalKey: null, tradeDefault: true, sort: 100, notion: true },
  { code: 'WINDOW', label: 'WINDOW', stage: 'hardware', trade: 'ALUMINIUM_GLASS', fix: 'single', internalKey: null, tradeDefault: true, sort: 110, notion: true },
  { code: 'PARTITION', label: 'PARTITION', stage: 'hardware', trade: 'PARTITION', fix: 'single', internalKey: null, tradeDefault: true, sort: 120, notion: true },
  { code: 'QC', label: 'QC', stage: 'hardware', trade: null, fix: 'single', internalKey: 'qc', tradeDefault: false, sort: 125, notion: true },
  { code: 'TEXTURED_PAINTING', label: 'TEXTURED PAINTING', stage: 'hardware', trade: 'TEXTURED_PAINTING', fix: 'single', internalKey: null, tradeDefault: true, sort: 130, notion: true },
  { code: 'CARPENTRY', label: 'CARPENTRY', stage: 'furniture', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 140, notion: true },
  { code: 'GRILL', label: 'GRILL', stage: 'hardware', trade: 'GRILL', fix: 'single', internalKey: null, tradeDefault: true, sort: 150, notion: true },
  { code: 'SLIDING_DOOR', label: 'SLIDING DOOR INSTALLATION', stage: 'hardware', trade: 'ALUMINIUM_GLASS', fix: 'single', internalKey: null, tradeDefault: false, sort: 155, notion: true },
  { code: 'AIRCON_INSTALL', label: 'AIR CON INSTALLATION', stage: 'hardware', trade: 'AIRCON_INSTALL', fix: 'single', internalKey: null, tradeDefault: true, sort: 160, notion: true },
  { code: 'AIRCON_RELOCATION', label: 'AIR CON RELOCATION', stage: 'hardware', trade: 'AIRCON_INSTALL', fix: 'single', internalKey: null, tradeDefault: false, sort: 165, notion: true },
  { code: 'POST_RENO_CLEANING', label: 'POST RENO CLEANING', stage: 'handover', trade: null, fix: 'single', internalKey: 'post_reno_cleaning', tradeDefault: false, sort: 170, notion: true },
  { code: 'DOOR', label: 'DOOR INSTALLATION', stage: 'hardware', trade: 'DOOR', fix: 'single', internalKey: null, tradeDefault: true, sort: 175, notion: true },
  { code: 'HIDDEN_DOOR', label: 'HIDDEN DOOR', stage: 'hardware', trade: 'DOOR', fix: 'single', internalKey: null, tradeDefault: false, sort: 180, notion: true },
  { code: 'FURNITURE_DELIVERY', label: 'FURNITURE DELIVERY', stage: 'furniture', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 190, notion: true },
  { code: 'CURTAIN', label: 'CURTAIN INSTALLATION', stage: 'soft_furnishing', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 195, notion: true },
  { code: 'FURNITURE_INSTALLATION', label: 'FURNITURE INSTALLATION', stage: 'furniture', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 200, notion: true },
  { code: 'ELECTRICAL_APPLIANCES_DELIVERY', label: 'ELECTRICAL APPLIANCES DELIVERY', stage: 'appliances', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 205, notion: true },
  { code: 'TOUCH_UP', label: 'TOUCH UP', stage: 'handover', trade: null, fix: 'single', internalKey: 'touch_up', tradeDefault: false, sort: 210, notion: true },
  { code: 'HANDOVER_QC', label: 'HANDOVER QC', stage: 'handover', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 220, notion: true },
  { code: 'KITCHEN_TOP', label: 'KITCHEN TOP INSTALLATION', stage: 'furniture', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 230, notion: true },
  { code: 'SET_UP_CLEANING', label: 'SET UP CLEANING', stage: 'handover', trade: null, fix: 'single', internalKey: 'set_up_cleaning', tradeDefault: false, sort: 240, notion: true },
  { code: 'JOINT_HANDOVER_INSPECTION', label: 'JOINT HANDOVER INSPECTION', stage: 'handover', trade: null, fix: 'single', internalKey: 'joint_handover_inspection', tradeDefault: false, sort: 250, notion: true },
  { code: 'SERVICE', label: 'SERVICE', stage: 'warranty', trade: null, fix: 'single', internalKey: null, tradeDefault: false, sort: 260, notion: true },
];

/* A contract CLEANING line is the post-reno clean (it has no trade category of its own). */
const TRADE_CATEGORY_ALIAS: Readonly<Record<string, string>> = { CLEANING: 'POST_RENO_CLEANING' };

export function taskCategoryDef(code: string | null | undefined): TaskCategoryDef | null {
  return TASK_CATEGORIES.find((c) => c.code === String(code ?? '').toUpperCase()) ?? null;
}

/** The task code a new task of this category is stored with. */
export function taskCodeOfCategory(c: TaskCategoryDef): string {
  if (c.internalKey) return `INTERNAL:${c.internalKey}`;
  if (c.trade) return c.trade;
  return `CAT:${c.code}`;
}

/** The category of a stored task (trade_code + fix_phase), for tasks made before categories existed. */
export function categoryOfTask(tradeCode: string | null | undefined, fix: string | null | undefined): TaskCategoryDef | null {
  const code = String(tradeCode ?? '').toUpperCase();
  if (code.startsWith('INTERNAL:')) {
    const key = String(tradeCode).slice('INTERNAL:'.length);
    return TASK_CATEGORIES.find((c) => c.internalKey === key) ?? null;
  }
  if (code.startsWith('CAT:')) return taskCategoryDef(code.slice(4));
  const alias = TRADE_CATEGORY_ALIAS[code];
  if (alias) return taskCategoryDef(alias);
  const f = String(fix ?? 'single');
  return TASK_CATEGORIES.find((c) => c.trade === code && c.fix === f && c.tradeDefault)
    ?? TASK_CATEGORIES.find((c) => c.trade === code && c.tradeDefault)
    ?? null;
}

/* The simplified main flow (owner decisions 11 Oct 2026): six steps derived
   from module data. Keys are fixed (each names the rule that derives it); the
   label, order and active flag live in public.project_flow_steps per company,
   seeded by migration 0083 with these defaults. */
export type FlowStepKey = 'design' | 'signed' | 'ordering' | 'renovation' | 'handover' | 'closed';

export const FLOW_STEP_KEYS: readonly FlowStepKey[] = ['design', 'signed', 'ordering', 'renovation', 'handover', 'closed'];

export const FLOW_STEP_DEFAULT_LABEL: Readonly<Record<FlowStepKey, string>> = {
  design: 'Design',
  signed: 'Signed',
  ordering: 'Ordering',
  renovation: 'Renovation',
  handover: 'Handover',
  closed: 'Closed',
};

export function isFlowStepKey(x: string | null | undefined): x is FlowStepKey {
  return (FLOW_STEP_KEYS as readonly string[]).includes(String(x ?? ''));
}

export type HoldFlag = 'in_defect' | 'on_hold';

export const HOLD_FLAG_LABEL: Readonly<Record<HoldFlag, string>> = {
  in_defect: 'IN DEFECT',
  on_hold: 'ON HOLD',
};

export type PersonRole = 'sales' | 'designer' | 'reno_pic' | 'admin' | 'boss' | 'site_crew';

export const PERSON_ROLES: readonly PersonRole[] = ['sales', 'designer', 'reno_pic', 'admin', 'boss', 'site_crew'];

export const PERSON_ROLE_LABEL: Readonly<Record<PersonRole, string>> = {
  sales: 'Sales',
  designer: 'Designer',
  reno_pic: 'Renovation PIC',
  admin: 'Admin',
  boss: 'Boss',
  site_crew: 'Site crew / contractor',
};
