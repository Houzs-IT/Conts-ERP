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
  const [{ jsPDF }, pdfjs, worker] = await Promise.all([import("jspdf"), import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let doc: InstanceType<typeof jsPDF> | null = null;
  const skipped: string[] = [];

  const addPage = (canvas: HTMLCanvasElement, block?: TitleBlock, page = { n: 1, of: 1 }): void => {
    // A page the size of the picture in points (72 per inch at 150 dpi), turned the way the picture is, plus the band.
    const w = (canvas.width * 72) / 150;
    const h = (canvas.height * 72) / 150;
    const band = block ? Math.max(48, Math.min(w, 2400) * 0.05) : 0;
    const total = h + band;
    const orientation = w > total ? "landscape" : "portrait";
    if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: [w, total], compress: true });
    else doc.addPage([w, total], orientation);
    const d = doc as InstanceType<typeof jsPDF>;
    d.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, w, h);
    if (!block) return;
    const pad = band * 0.14;
    const line = Math.max(0.75, band / 60);
    d.setDrawColor(23, 32, 31);
    d.setLineWidth(line);
    d.setFillColor(255, 255, 255);
    d.rect(pad, h + pad * 0.5, w - pad * 2, band - pad, "FD");
    let x = pad;
    const inner = w - pad * 2;
    const labelSize = band * 0.16;
    const valueSize = band * 0.24;
    titleBlockCells(block, page).forEach((cell, i) => {
      const cw = inner * cell.share;
      if (i > 0) d.line(x, h + pad * 0.5, x, h + band - pad * 0.5);
      d.setFont("helvetica", "normal");
      d.setFontSize(labelSize);
      d.setTextColor(85, 96, 94);
      d.text(cell.label.toUpperCase(), x + pad * 0.6, h + pad * 0.5 + labelSize * 1.25);
      d.setFont("helvetica", "bold");
      d.setFontSize(valueSize);
      // An approved set's status prints in the accent teal, everything else in ink.
      if (cell.label === "Status" && /^approved/i.test(cell.value)) d.setTextColor(26, 107, 102);
      else d.setTextColor(23, 32, 31);
      const first = (d.splitTextToSize(cell.value, cw - pad * 1.2) as string[])[0] ?? "";
      d.text(first, x + pad * 0.6, h + band - pad * 1.1);
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
          const vp = page.getViewport({ scale: PDF_SCALE });
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
  const done = doc as InstanceType<typeof jsPDF> | null;
  if (!done) return { skipped };
  done.save(outName);
  return { skipped };
}
