/* The client's Client PO list as a PDF (owner, 24 Oct 2026): what the client buys, by category and sub-category,
   with its supplier code, area, quantity and the dates it is needed by (the PO tab's processing and delivery dates, the
   same columns the Client PO tab shows). No prices or staff. The shared letterhead every document prints (mockup B, owner
   6 Nov 2026), the project block, and a page footer. Loaded on demand so jsPDF stays out of the workspace bundle. */

import { dayMonthYear } from "./renovationBetaModel";
import { byCategory, type ClientItem } from "./renovationBetaVoPo";
import { drawHeader, ensurePdfCjkFont, fmtDocDate } from "../../vendor/scm/lib/pdf-common";
import { loadDocLetterhead } from "../../lib/renovation/api";
import { ensureBrandingLogoLoaded } from "../../lib/branding";

const TEAL: [number, number, number] = [26, 107, 102];
const TEAL_INK: [number, number, number] = [15, 74, 70];
const MUTED: [number, number, number] = [96, 108, 106];

export async function downloadClientPdf(opts: { projectName: string; clientName: string | null; items: readonly ClientItem[]; today: string }): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadDocLetterhead(), ensureBrandingLogoLoaded()]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await ensurePdfCjkFont(doc, [opts.projectName, opts.clientName, opts.items]);
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  let y = drawHeader(doc, { docTitle: "Client PO", rightMeta: [{ label: "", value: fmtDocDate(opts.today) }] }) + 4;
  doc.setTextColor(30, 33, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(opts.projectName, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const meta = [opts.clientName ? `Client: ${opts.clientName}` : null, `${opts.items.length} item${opts.items.length === 1 ? "" : "s"}`].filter(Boolean).join("   ·   ");
  doc.text(meta, M, (y += 5.5));
  doc.text("Please buy each item by its date and have it on site by the delivery date.", M, (y += 5.5));

  type Cell = string | { content: string; colSpan: number; styles: Record<string, unknown> };
  const body: Cell[][] = [];
  for (const c of byCategory(opts.items)) {
    body.push([{ content: c.label, colSpan: 7, styles: { fillColor: [225, 241, 238], fontStyle: "bold", textColor: TEAL_INK } }]);
    for (const s of c.subs) {
      body.push([{ content: `   ${s.label}`, colSpan: 7, styles: { fillColor: [243, 249, 248], fontStyle: "bold", textColor: [60, 70, 68] } }]);
      for (const i of s.items) {
        body.push([
          i.description || "-",
          i.itemCode ?? "-",
          i.supplierCode ?? "-",
          i.area ?? "-",
          i.measure ?? `${i.qty}${i.uom ? ` ${i.uom}` : ""}`,
          i.orderOn ? dayMonthYear(i.orderOn) : "-",
          i.deliverOn ? dayMonthYear(i.deliverOn) : "-",
        ]);
      }
    }
  }
  autoTable(doc, {
    startY: y + 4,
    margin: { left: M, right: M, bottom: 18 },
    head: [["Item", "SKU", "Supplier code", "Area", "Qty", "Buy by", "On site by"]],
    body,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 1.8, lineColor: [226, 230, 228], lineWidth: 0.2, textColor: [30, 33, 29] },
    headStyles: { fillColor: TEAL, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 26 }, 2: { cellWidth: 26 }, 4: { halign: "right", cellWidth: 16 }, 5: { cellWidth: 20 }, 6: { cellWidth: 20 } },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`${opts.projectName} · Client PO`, M, H - 9);
      doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 9, { align: "right" });
    },
  });
  doc.save(`Client-PO-${opts.projectName.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
}
