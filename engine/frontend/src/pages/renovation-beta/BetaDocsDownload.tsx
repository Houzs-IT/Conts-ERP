/* Download all on the project's DO and GR tabs: every document on one PDF, through the Print preview every batch print
   goes through (components/scm-v2/PrintPreviewModal.tsx). */

import type { ReactElement } from "react";
import { FileDown } from "lucide-react";
import { PrintPreviewBatchModal, usePrintPreview } from "../../components/scm-v2/PrintPreviewModal";
import type { PdfAction } from "../../vendor/scm/lib/pdf-common";
import { errorText } from "../projects/renovation/renovationModel";
import { btnStyle } from "./BetaWsUi";
import { docBundles, type ProjectDoc } from "./renovationBetaDocPdf";

export function DocsDownloadAll({ list, fileStem, onError }: { list: readonly ProjectDoc[]; fileStem: string; onError: (text: string) => void }): ReactElement {
  const isDo = list[0]?.type === "delivery_order";
  const deliver = async (action: PdfAction): Promise<void> => {
    try {
      const docs = await docBundles(list);
      const opts = { fileName: `${fileStem}.pdf`, action };
      if (isDo) {
        const { generateCombinedDeliveryOrderPdf } = await import("../../vendor/scm/lib/delivery-order-pdf");
        await generateCombinedDeliveryOrderPdf(docs as never, opts);
      } else {
        const { generateCombinedGrnPdf } = await import("../../vendor/scm/lib/grn-pdf");
        await generateCombinedGrnPdf(docs as never, opts);
      }
    } catch (e) { onError(errorText(e)); }
  };
  const batch = usePrintPreview(deliver);
  return (
    <>
      <button type="button" style={btnStyle("outline", "sm")} onClick={batch.openPreview}><FileDown size={14} aria-hidden="true" />Download all</button>
      <PrintPreviewBatchModal open={batch.open} onClose={batch.close} docTitle={isDo ? "Delivery Orders" : "Goods Received Notes"} docNos={list.map((d) => d.no)} {...batch.handlers} />
    </>
  );
}
