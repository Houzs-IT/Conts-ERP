/* Board conditions derived from the purchase side (owner's Notion "Project" table):

   Furniture condition: lines in FURNITURE / BUILTIN / APPLIANCE / SOFT / LIGHTING.
   Reno item condition: WORKS lines, and the site-trade services filed under
   SERVICE (aircon install, cleaning, project management; see lineGroup).
     pending_purchased  some live line has no live PO line (and no delivery from stock)
     pending_arrived    every line is ordered, some are not fully received
                        (GRN, site receipt, or delivered from our warehouse by DO)
     all_arrived        everything received
     none               the contract has no such line
   Supply-by-owner goods are not bought by us, so they are left out of the
   furniture condition (their install labour is a WORKS line and still counts). */

import type { CatalogGroup } from "../../scm/shared/renovation-catalog";
import { lineGroup, type ContractLine } from "./stages";

export type SupplyCondition = "none" | "pending_purchased" | "pending_arrived" | "all_arrived";

export const SUPPLY_CONDITION_LABEL: Readonly<Record<SupplyCondition, string>> = {
  none: "No items",
  pending_purchased: "Pending purchased",
  pending_arrived: "Pending arrived",
  all_arrived: "All arrived",
};

export const FURNITURE_GROUPS: readonly CatalogGroup[] = ["FURNITURE", "BUILTIN", "APPLIANCE", "SOFT", "LIGHTING"];
export const RENO_ITEM_GROUPS: readonly CatalogGroup[] = ["WORKS"];

/** What the purchase and delivery side holds for one SO line. */
export interface LineSupply {
  /** sum of qty over live PO lines (PO not cancelled) with this so_item_id */
  orderedQty: number;
  /** sum of received_qty over those PO lines (GRN + site receipt) */
  receivedQty: number;
  /** qty delivered from our warehouse on a delivered/signed DO */
  deliveredQty: number;
}

export interface ConditionSummary {
  condition: SupplyCondition;
  total: number;
  unordered: number;
  notArrived: number;
}

export function supplyCondition(
  lines: readonly ContractLine[],
  supply: ReadonlyMap<string, LineSupply>,
  groups: readonly CatalogGroup[],
  opts: { excludeSupplyByOwner: boolean },
): ConditionSummary {
  const relevant = lines.filter((l) => {
    const g = lineGroup(l);
    if (!g || !groups.includes(g)) return false;
    if (opts.excludeSupplyByOwner && l.supplyByOwner) return false;
    return l.qty > 0;
  });
  if (relevant.length === 0) return { condition: "none", total: 0, unordered: 0, notArrived: 0 };
  let unordered = 0;
  let notArrived = 0;
  for (const l of relevant) {
    const s = supply.get(l.soItemId) ?? { orderedQty: 0, receivedQty: 0, deliveredQty: 0 };
    const arrived = s.deliveredQty >= l.qty || (s.orderedQty > 0 && s.receivedQty >= s.orderedQty);
    if (s.orderedQty <= 0 && s.deliveredQty <= 0) unordered++;
    else if (!arrived) notArrived++;
  }
  const condition: SupplyCondition = unordered > 0 ? "pending_purchased" : notArrived > 0 ? "pending_arrived" : "all_arrived";
  return { condition, total: relevant.length, unordered, notArrived };
}

export function boardConditions(lines: readonly ContractLine[] | null, supply: ReadonlyMap<string, LineSupply>) {
  if (lines === null) return { furniture: null, renoItem: null };
  return {
    furniture: supplyCondition(lines, supply, FURNITURE_GROUPS, { excludeSupplyByOwner: true }),
    renoItem: supplyCondition(lines, supply, RENO_ITEM_GROUPS, { excludeSupplyByOwner: false }),
  };
}

export type UnitKeyStatus = "not_collected" | "collected" | "returned" | "unknown";

export function unitKeyStatus(
  keysItem: { status?: string | null; skip_reason?: string | null } | null | undefined,
  handedOver: boolean,
  keysReturnedItem?: { status?: string | null } | null,
): UnitKeyStatus {
  if (handedOver || keysReturnedItem?.status === "done") return "returned";
  if (!keysItem) return "unknown";
  if (keysItem.status === "done") return "collected";
  return "not_collected";
}
