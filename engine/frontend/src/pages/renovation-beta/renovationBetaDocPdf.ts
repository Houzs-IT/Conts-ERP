/* The DO and GR PDFs on the project's tabs (owner, 7 Nov 2026): each the document its own page prints. */

import { fetchPrintBundle, renderPrintBundle, renoInfoFor } from "../../lib/printDocumentPdf";
import type { PrintTarget } from "../../lib/printChain";
import type { SiteDelivery } from "./renovationBetaSiteApi";

export type ProjectDoc = Pick<SiteDelivery, "type" | "id" | "no">;

const targetOf = (d: ProjectDoc): PrintTarget => ({ doc: d.type === "delivery_order" ? "do" : "grn", docNo: d.no, key: d.id });

export async function downloadDocPdf(d: ProjectDoc): Promise<void> {
  const target = targetOf(d);
  await renderPrintBundle(target, await fetchPrintBundle(target), "save");
}

/** What a combined PDF of these documents draws, each with its own renovation details. */
export function docBundles(list: readonly ProjectDoc[]) {
  return Promise.all(list.map(async (d) => {
    const t = targetOf(d);
    const [bundle, renovation] = await Promise.all([fetchPrintBundle(t), renoInfoFor(d.type === "delivery_order" ? "do" : "grn", d.id)]);
    return { header: bundle.header, items: bundle.items, renovation };
  }));
}
