// Conts only: a Direct pay deposit as a share of the bill or quotation (My claims).
/** A deposit worked out as a share of the bill or quotation (chew, 17 Nov 2026: by percent, or the amount typed):
 *  the total times the percent, to the sen; null while either is missing or the percent is not 0–100. */
export function depositSen(totalSen: number | null, percent: string): number | null {
  const pct = Number(String(percent).trim());
  if (totalSen == null || totalSen <= 0 || !String(percent).trim() || !Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return Math.round((totalSen * pct) / 100);
}
