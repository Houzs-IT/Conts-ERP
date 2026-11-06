/* The DO and GR download on the project's tabs (owner, 7 Nov 2026): one document, or every one on a single PDF, each the
   document its own page prints. */

import { fetchPrintBundle, renderPrintBundle, renoInfoFor } from "../../lib/printDocumentPdf";
import type { PrintTarget } from "../../lib/printChain";
import type { SiteDelivery } from "./renovationBetaSiteApi";

type Doc = Pick<SiteDelivery, "type" | "id" | "no">;

const targetOf = (d: Doc): PrintTarget => ({ doc: d.type === "delivery_order" ? "do" : "grn", docNo: d.no, key: d.id });

export async function downloadDocPdf(d: Doc): Promise<void> {
  const target = targetOf(d);
  await renderPrintBundle(target, await fetchPrintBundle(target), "save");
}

/** Every document of the tab on one PDF, in the order listed. */
export async function downloadAllDocPdfs(list: readonly Doc[], fileStem: string): Promise<void> {
  const first = list[0];
  if (!first) return;
  if (list.length === 1) { await downloadDocPdf(first); return; }
  const isDo = first.type === "delivery_order";
  const docs = await Promise.all(list.map(async (d) => {
    const t = targetOf(d);
    const [bundle, renovation] = await Promise.all([fetchPrintBundle(t), renoInfoFor(isDo ? "do" : "grn", d.id)]);
    return { header: bundle.header, items: bundle.items, renovation };
  }));
  const fileName = `${fileStem}.pdf`;
  if (isDo) {
    const { generateCombinedDeliveryOrderPdf } = await import("../../vendor/scm/lib/delivery-order-pdf");
    await generateCombinedDeliveryOrderPdf(docs as never, { fileName, action: "save" });
  } else {
    const { generateCombinedGrnPdf } = await import("../../vendor/scm/lib/grn-pdf");
    await generateCombinedGrnPdf(docs as never, { fileName, action: "save" });
  }
}
