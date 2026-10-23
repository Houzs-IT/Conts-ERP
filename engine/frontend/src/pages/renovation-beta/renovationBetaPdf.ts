/* Several project files as one PDF, made in the browser: the 2D set ("Download set as PDF") and a site measure's files
   ("Download all"). Photos go in as they are; each page of a PDF is drawn by pdf.js and placed as an image, because
   jsPDF (already in the engine) cannot copy another PDF's pages. DWG and ZIP files cannot be shown on a page and are
   left out; the caller is told which. pdf.js and jsPDF load only when a download is asked for. */

import { api } from "../../api/client";
import { simpleApi } from "../projects/renovation/simpleApi";

export interface PdfPart { key: string; fileName: string; title?: string }

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

  const addPage = (canvas: HTMLCanvasElement): void => {
    // A page the size of the picture in points (72 per inch at 150 dpi), turned the way the picture is.
    const w = (canvas.width * 72) / 150;
    const h = (canvas.height * 72) / 150;
    const orientation = w > h ? "landscape" : "portrait";
    if (!doc) doc = new jsPDF({ orientation, unit: "pt", format: [w, h], compress: true });
    else doc.addPage([w, h], orientation);
    doc.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, w, h);
  };

  for (const part of parts) {
    const name = part.fileName || part.key;
    const isImage = IMAGE.test(part.key) || IMAGE.test(name);
    const isPdf = PDF.test(part.key) || PDF.test(name);
    if (!isImage && !isPdf) { skipped.push(name); continue; }
    try {
      const blob = await blobOf(projectId, part.key);
      if (isImage) { addPage(await imageCanvas(blob)); continue; }
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
          addPage(canvas);
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
