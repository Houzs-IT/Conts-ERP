/* The client's Client PO list as a PDF (owner, 24 Oct 2026): what the client buys, by category and sub-category,
   with area and quantity. No prices, suppliers or staff. Loaded on demand so jsPDF stays out of the workspace bundle. */

import { byCategory, type ClientItem } from "./renovationBetaVoPo";

export async function downloadClientPdf(opts: { projectName: string; clientName: string | null; items: readonly ClientItem[]; today: string }): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text("Items to buy (Client PO)", 40, 50);
  doc.setFontSize(10);
  doc.text([opts.projectName, opts.clientName ? `Client: ${opts.clientName}` : "", `Date: ${opts.today}`].filter(Boolean), 40, 68);
  const body: Array<Array<string | { content: string; colSpan: number; styles: Record<string, unknown> }>> = [];
  for (const c of byCategory(opts.items)) {
    body.push([{ content: c.label, colSpan: 5, styles: { fillColor: [225, 241, 238], fontStyle: "bold", textColor: [15, 74, 70] } }]);
    for (const s of c.subs) {
      body.push([{ content: `   ${s.label}`, colSpan: 5, styles: { fillColor: [243, 249, 248], fontStyle: "bold" } }]);
      for (const i of s.items) {
        body.push([
          `${i.description || "-"}${i.pending ? " (VO not approved yet)" : ""}`,
          i.itemCode ?? "-",
          i.area ?? "-",
          i.measure ?? String(i.qty),
          i.uom ?? "",
        ]);
      }
    }
  }
  autoTable(doc, {
    startY: 100,
    head: [["Item", "SKU", "Area", "Qty", "UOM"]],
    body,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [26, 107, 102] },
    columnStyles: { 0: { cellWidth: 220 }, 3: { halign: "right" } },
  });
  doc.save(`Client-PO-${opts.projectName.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
}
