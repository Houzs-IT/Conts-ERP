/** A PDF's pages as JPEGs, in the browser, for "Scan bills" (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md
 *  Task 5): each page is read on its own, so a 40-page TNB PDF becomes 40 images of about 2,000 px on the long edge.
 *  Pages are handed out one by one as they are drawn. pdf.js loads only when a PDF is picked, so it never weighs on the
 *  rest of the app. */
export async function* pdfToJpegs(file: File, longEdge = 2000, quality = 0.85): AsyncGenerator<Blob> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: longEdge / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      page.cleanup();
      if (blob) yield blob;
    }
  } finally {
    await task.destroy();
  }
}

