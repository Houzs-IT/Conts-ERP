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
  soft_furnishing: ['SOFT', 'SERVICE'],
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
  { trade: 'ALUMINIUM_GLASS', fix: 'single' },
  { trade: 'GRILL', fix: 'single' },
  { trade: 'PAINTING', fix: 'single' },
  { trade: 'TEXTURED_PAINTING', fix: 'single' },
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
   (named as on the owner's Notion task boards). Today every task is fulfilled by
   a PO or done by staff; a later Production module adds production orders as a
   second way to fulfil a trade task. */
export const INTERNAL_TASKS: readonly InternalTaskDef[] = [
  { key: 'pre_reno_delivery', label: 'Pre-reno works & item delivery', stage: 'hardware' },
  { key: 'qc', label: 'QC', stage: 'hardware' },
  { key: 'post_reno_cleaning', label: 'Post reno cleaning', stage: 'handover' },
  { key: 'touch_up', label: 'Touch up', stage: 'handover' },
  { key: 'set_up_cleaning', label: 'Set up cleaning', stage: 'handover' },
  { key: 'joint_handover_inspection', label: 'Joint handover inspection', stage: 'handover' },
];
