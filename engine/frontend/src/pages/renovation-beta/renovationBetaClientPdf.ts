/* The client's Client PO list as a PDF (owner, 24 Oct 2026): what the client buys, by category and sub-category,
   with area, quantity and the dates it is needed by (the PO tab's processing and delivery dates, the same columns the
   Client PO tab shows). No prices, suppliers or staff. A teal title band, the project block, and a page footer.
   Loaded on demand so jsPDF stays out of the workspace bundle. */

import { dayMonthYear } from "./renovationBetaModel";
import { byCategory, type ClientItem } from "./renovationBetaVoPo";

const TEAL: [number, number, number] = [26, 107, 102];
const TEAL_INK: [number, number, number] = [15, 74, 70];
const MUTED: [number, number, number] = [96, 108, 106];

export async function downloadClientPdf(opts: { projectName: string; clientName: string | null; items: readonly ClientItem[]; today: string }): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  doc.setFillColor(...TEAL);
  doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Items to buy", M, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Client PO", W - M, 40, { align: "right" });

  doc.setTextColor(30, 33, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(opts.projectName, M, 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const meta = [opts.clientName ? `Client: ${opts.clientName}` : null, `Date: ${dayMonthYear(opts.today)}`, `${opts.items.length} item${opts.items.length === 1 ? "" : "s"}`].filter(Boolean).join("   ·   ");
  doc.text(meta, M, 106);
  doc.text("Please buy each item by its date and have it on site by the delivery date.", M, 122);

  type Cell = string | { content: string; colSpan: number; styles: Record<string, unknown> };
  const body: Cell[][] = [];
  for (const c of byCategory(opts.items)) {
    body.push([{ content: c.label, colSpan: 6, styles: { fillColor: [225, 241, 238], fontStyle: "bold", textColor: TEAL_INK } }]);
    for (const s of c.subs) {
      body.push([{ content: `   ${s.label}`, colSpan: 6, styles: { fillColor: [243, 249, 248], fontStyle: "bold", textColor: [60, 70, 68] } }]);
      for (const i of s.items) {
        body.push([
          `${i.description || "-"}${i.pending ? "\n(not confirmed yet)" : ""}`,
          i.itemCode ?? "-",
          i.area ?? "-",
          i.measure ?? `${i.qty}${i.uom ? ` ${i.uom}` : ""}`,
          i.orderOn ? dayMonthYear(i.orderOn) : "-",
          i.deliverOn ? dayMonthYear(i.deliverOn) : "-",
        ]);
      }
    }
  }
  autoTable(doc, {
    startY: 138,
    margin: { left: M, right: M, bottom: 50 },
    head: [["Item", "SKU", "Area", "Qty", "Buy by", "On site by"]],
    body,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, lineColor: [226, 230, 228], lineWidth: 0.5, textColor: [30, 33, 29] },
    headStyles: { fillColor: TEAL, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 170 }, 1: { cellWidth: 80 }, 3: { halign: "right", cellWidth: 50 }, 4: { cellWidth: 62 }, 5: { cellWidth: 62 } },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`${opts.projectName} · Items to buy`, M, H - 24);
      doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 24, { align: "right" });
    },
  });
  doc.save(`Client-PO-${opts.projectName.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
}
