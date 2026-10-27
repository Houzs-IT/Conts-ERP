/** Which owner statement takes a utility bill (spec docs/superpowers/specs/2026-10-27-utility-bills-design.md §3.2):
 *  its own month, or, when that month's statement is already final, the first month after it that is not.
 *  `finalMonths` are the YYYY-MM months final for the bill's owner. */
export function firstOpenMonth(billMonth: string, finalMonths: ReadonlySet<string>): string {
  let m = billMonth;
  while (finalMonths.has(m)) {
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return m;
}
