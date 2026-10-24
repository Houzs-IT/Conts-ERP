/* Conts switches read by shared (vendor) code. No imports, so a vendor module can read them without a cycle.
   See flowRules.ts and backend/src/scm/lib/renovation-flow-rules.ts. */

/** Houzs: a sofa may not share an order with a bedframe or mattress. A renovation SO mixes them. */
export const CONTS_SOFA_MIX_RULE_ON = false as boolean;
/** Houzs caps an address line at AutoCount's 40 characters. Conts has no AutoCount. */
export const CONTS_ADDRESS_LINE_CAP = false as boolean;
