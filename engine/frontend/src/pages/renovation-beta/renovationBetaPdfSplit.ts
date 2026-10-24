/* A multi-page 2D PDF as one picture per page, so each page becomes its own sheet (owner, 24 Oct 2026: "each sheet is
   its own picture"). Pages are drawn by pdf.js, which loads only when a PDF is picked. A page is kept sharp enough to
   read dimensions (up to 3000 px on its long side) and saved as PNG. */

const LONG_SIDE = 3000;

async function load(file: File) {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

export const isPdf = (f: File): boolean => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** The number of pages, or 1 when the file cannot be read (it then goes up whole, as before). */
export async function pdfPageCount(file: File): Promise<number> {
  try {
    const doc = await load(file);
    try { return doc.numPages; } finally { await doc.destroy(); }
  } catch {
    return 1;
  }
}

/** One PNG file per page, named "<base> p<n>.png". */
export async function splitPdf(file: File, base: string): Promise<File[]> {
  const doc = await load(file);
  const out: File[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(4, LONG_SIDE / Math.max(vp1.width, vp1.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
      if (!blob) throw new Error("page could not be drawn");
      out.push(new File([blob], `${base} p${n}.png`, { type: "image/png" }));
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
