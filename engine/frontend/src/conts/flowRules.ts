/* Conts switches for the supply-chain screens (owner run on project 99 "TESTING", 24 Oct 2026). The server's twins
   live in backend/src/scm/lib/renovation-flow-rules.ts; each flag set the other way gives back Houzs's screens. */
import { missingVariantAxes } from "../vendor/shared/so-variant-rule";

export { CONTS_SOFA_MIX_RULE_ON, CONTS_ADDRESS_LINE_CAP } from "./flowFlags";
/** A PO line taken from an SO line asks only for the options that SO line has. */
export const CONTS_PO_VARIANTS_FOLLOW_SO = true as boolean;
/** SO lines are read by name (the code under it); Houzs reads them by code. */
export const CONTS_LINES_BY_NAME = true as boolean;

/** The option labels a PO line still lacks. `soVariants` undefined = not taken from an SO line: Houzs rule. */
export function poMissingOptionLabels(
  itemGroup: string | null | undefined,
  variants: Record<string, unknown> | null | undefined,
  itemCode: string | null,
  soVariants: Record<string, unknown> | null | undefined,
): string[] {
  const missing = missingVariantAxes(itemGroup, variants, itemCode);
  if (!CONTS_PO_VARIANTS_FOLLOW_SO || soVariants === undefined) return missing.map((a) => a.label);
  const has = (k: string) => {
    const v = (soVariants ?? {})[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  };
  return missing.filter((a) => has(a.key)).map((a) => a.label);
}

/** An order line's two lines of identity, Conts reading: the product NAME first, the code (and options) under it.
    Falls back to the code when the line has no name. */
export function contsLineIdentity(input: { code?: string | null; description?: string | null; variant?: string | null }): {
  primary: string;
  secondary: string | null;
} {
  const code = String(input.code ?? "").trim();
  const name = String(input.description ?? "").trim();
  const variant = String(input.variant ?? "").trim();
  const primary = name || code;
  const sub = [name && code && name !== code ? code : "", variant && variant !== primary ? variant : ""].filter(Boolean).join(" · ");
  return { primary, secondary: sub || null };
}
