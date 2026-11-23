/* What the sales invoice page says about a cancelled or paid invoice (click sweep 2, G6). */

/** The hero's heading. A cancelled invoice keeps its receipts on the row (they became customer credit), so outstanding
    reads 0 and the page said "Paid in full" on a dead invoice. */
export const siHeroLabel = (status: string | null | undefined, outstandingSen: number): "Cancelled" | "Paid in full" | "Outstanding" =>
  String(status ?? "").toUpperCase() === "CANCELLED" ? "Cancelled" : outstandingSen === 0 ? "Paid in full" : "Outstanding";

/** The Cancel invoice question. Money already received does not vanish: the server turns it into the customer's credit,
    which the operator must know before saying yes. */
export const siCancelBody = (paidSen: number, money: (sen: number) => string, customer: string | null | undefined): string =>
  paidSen > 0
    ? `${money(paidSen)} already received on this invoice becomes customer credit${customer ? ` for ${customer}` : ""}: it shows on the sales order and can be applied to another invoice. Any posted revenue is reversed by a contra JE. You can reopen it later.`
    : "This reverses any posted revenue via a contra JE. You can reopen it later.";
