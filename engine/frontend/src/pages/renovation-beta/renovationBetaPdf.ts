/* Several project files as one PDF, made in the browser: the 2D set ("Download set as PDF") and a site measure's files
   ("Download all"). Photos go in as they are; each page of a PDF is drawn by pdf.js and placed as an image, because
   jsPDF (already in the engine) cannot copy another PDF's pages. DWG and ZIP files cannot be shown on a page and are
   left out; the caller is told which. pdf.js and jsPDF load only when a download is asked for.
   The 2D set template (owner, 24 Oct 2026): a part given a title block gets a band under its drawing on every page,
   the same on every sheet: company, project, unit, sheet name, version, date and approval status. */

import { api } from "../../api/client";
import { simpleApi } from "../projects/renovation/simpleApi";

/** The title block printed under every page of a part. */
export interface TitleBlock {
  company: string;
  project: string;
  unit: string | null;
  sheet: string;
  /** e.g. "Set V3 · sheet V1" */
  version: string;
  date: string;
  status: string;
}

export interface PdfPart { key: string; fileName: string; title?: string; block?: TitleBlock }

/** The title block's cells, left to right, with their share of the page width. */
export function titleBlockCells(b: TitleBlock, page: { n: number; of: number }): Array<{ label: string; value: string; share: number }> {
  return [
    { label: "Company", value: b.company || "-", share: 0.13 },
    { label: "Project", value: b.project || "-", share: 0.19 },
    { label: "Unit", value: b.unit || "-", share: 0.11 },
    { label: "Sheet", value: page.of > 1 ? `${b.sheet} (page ${page.n} of ${page.of})` : b.sheet, share: 0.2 },
    { label: "Version", value: b.version, share: 0.1 },
    { label: "Date", value: b.date || "-", share: 0.1 },
    { label: "Status", value: b.status, share: 0.17 },
  ];
}

const IMAGE = /\.(jpe?g|png|webp)$/i;
const PDF = /\.pdf$/i;
/** Render scale for PDF pages: sharp enough to read dimensions on an A3 sheet, small enough to stay a few MB a page. */
const PDF_SCALE = 2;
const A4_LONG_SIDE_PX = 2400;

async function blobOf(projectId: number, key: string): Promise<Blob> {
  const url = await api.fetchBlobUrl(simpleApi.fileUrl(projectId, key));
  try { return await (await fetch(url)).blob(); } finally { URL.revokeObjectURL(url); }
}

async function imageCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
}

/** Builds and downloads the PDF. Answers the file names that could not go in (not a photo or PDF, or unreadable). */
export async function downloadAsPdf(projectId: number, parts: PdfPart[], outName: string): Promise<{ skipped: string[] }> {
  const { doc, skipped } = await drawParts(null, projectId, parts);
  doc?.save(outName);
  return { skipped };
}

type JsPdfDoc = import("jspdf").jsPDF;

/** The same pages after the last page of a PDF already made (a PO). */
export async function appendPartsToPdf(doc: JsPdfDoc, projectId: number, parts: PdfPart[]): Promise<{ skipped: string[] }> {
  return { skipped: (await drawParts(doc, projectId, parts, A4_PT)).skipped };
}

/** Portrait; a wider drawing turns it. Sheets behind a PO stay the PO's paper size: PDF viewers zoom to the widest page,
    so one full-size drawing shrank the PO on page 1 to under half its size (owner, 5 Nov 2026). */
const A4_PT = { w: 595.28, h: 841.89 };

export interface SheetLayout { pageW: number; pageH: number; band: number; imgX: number; imgY: number; imgW: number; imgH: number }

/** Where a picture of w x h points goes: on a page its own size, or fitted and centred on `paper`, the band along the foot. */
export function sheetLayout(w: number, h: number, hasBlock: boolean, paper?: { w: number; h: number }): SheetLayout {
  const bandFor = (width: number) => (hasBlock ? Math.max(60, Math.min(width, 2400) * 0.075) : 0);
  if (!paper) {
    const band = bandFor(w);
    return { pageW: w, pageH: h + band, band, imgX: 0, imgY: 0, imgW: w, imgH: h };
  }
  const wide = w > h;
  const pageW = wide ? paper.h : paper.w;
  const pageH = wide ? paper.w : paper.h;
  const band = bandFor(pageW);
  const scale = Math.min(pageW / w, (pageH - band) / h);
  const imgW = w * scale;
  const imgH = h * scale;
  return { pageW, pageH, band, imgX: (pageW - imgW) / 2, imgY: (pageH - band - imgH) / 2, imgW, imgH };
}

async function drawParts(into: JsPdfDoc | null, projectId: number, parts: PdfPart[], paper?: { w: number; h: number }): Promise<{ doc: JsPdfDoc | null; skipped: string[] }> {
  const [{ jsPDF }, pdfjs, worker] = await Promise.all([import("jspdf"), import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc: JsPdfDoc | null = into;
  const skipped: string[] = [];

  const addPage = (canvas: HTMLCanvasElement, block?: TitleBlock, page = { n: 1, of: 1 }): void => {
    // A page the size of the picture in points (72 per inch at 150 dpi), turned the way the picture is, plus the band.
    const sheet = sheetLayout((canvas.width * 72) / 150, (canvas.height * 72) / 150, !!block, paper);
    const { band: bandPt } = sheet;
    // The layout is in points; a PO's document is in millimetres. Type sizes stay in points whatever the document uses.
    const u = doc ? 1 / (doc as JsPdfDoc).internal.scaleFactor : 1;
    const w = sheet.pageW * u;
    const total = sheet.pageH * u;
    const band = bandPt * u;
    const h = total - band;
    const orientation = w > total ? "landscape" : "portrait";
    if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: [w, total], compress: true });
    else doc.addPage([w, total], orientation);
    const d = doc as InstanceType<typeof jsPDF>;
    d.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", sheet.imgX * u, sheet.imgY * u, sheet.imgW * u, sheet.imgH * u);
    if (!block) return;
    const pad = band * 0.14;
    const line = Math.max(0.75, bandPt / 60) * u;
    d.setDrawColor(23, 32, 31);
    d.setLineWidth(line);
    d.setFillColor(255, 255, 255);
    d.rect(pad, h + pad * 0.5, w - pad * 2, band - pad, "FD");
    let x = pad;
    const inner = w - pad * 2;
    const labelSize = bandPt * 0.13;
    const valueSize = bandPt * 0.2;
    titleBlockCells(block, page).forEach((cell, i) => {
      const cw = inner * cell.share;
      if (i > 0) d.line(x, h + pad * 0.5, x, h + band - pad * 0.5);
      d.setFont("helvetica", "normal");
      d.setFontSize(labelSize);
      d.setTextColor(85, 96, 94);
      d.text(cell.label.toUpperCase(), x + pad * 0.6, h + pad * 0.5 + labelSize * 1.25 * u);
      d.setFont("helvetica", "bold");
      d.setFontSize(valueSize);
      // An approved set's status prints in the accent teal, everything else in ink.
      if (cell.label === "Status" && /^approved/i.test(cell.value)) d.setTextColor(26, 107, 102);
      else d.setTextColor(23, 32, 31);
      // A long value first gets smaller type, then a second line; only what still does not fit is cut.
      const room = cw - pad * 1.2;
      let size = valueSize;
      while (size > valueSize * 0.7 && d.getTextWidth(cell.value) > room) d.setFontSize((size *= 0.92));
      const lines = (d.splitTextToSize(cell.value, room) as string[]).slice(0, 2);
      const top = h + pad * 0.5 + (labelSize * 1.25 + size * 1.15) * u;
      lines.forEach((t, n) => d.text(t, x + pad * 0.6, top + n * size * 1.1 * u));
      x += cw;
    });
  };

  for (const part of parts) {
    const name = part.fileName || part.key;
    const isImage = IMAGE.test(part.key) || IMAGE.test(name);
    const isPdf = PDF.test(part.key) || PDF.test(name);
    if (!isImage && !isPdf) { skipped.push(name); continue; }
    try {
      const blob = await blobOf(projectId, part.key);
      if (isImage) { addPage(await imageCanvas(blob), part.block); continue; }
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      try {
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const page = await pdf.getPage(n);
          const natural = page.getViewport({ scale: 1 });
          // On A4 a sheet needs no more pixels than the paper can show, and a big drawing then draws in a fraction of the time.
          const vp = page.getViewport({ scale: paper ? Math.min(PDF_SCALE, A4_LONG_SIDE_PX / Math.max(natural.width, natural.height)) : PDF_SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no canvas");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          addPage(canvas, part.block, { n, of: pdf.numPages });
        }
      } finally {
        await pdf.destroy();
      }
    } catch {
      skipped.push(name);
    }
  }
  return { doc, skipped };
}
