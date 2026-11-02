import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { safe } from './statementPdf';
import { date, fileStamp, time } from './format';

/**
 * A job's photos as one A4 PDF, two to a page, each with the day and time it was added. Load it with a dynamic
 * import: pdf-lib stays out of the first download (the entry-bundle check). Photos are shrunk before they go in,
 * so a hundred phone photos make a file small enough to send on WhatsApp. Videos cannot go in a PDF and are counted.
 */

export interface PdfPhoto { url: string; kind: string; at: string | null; label?: string | null }

const MM = 72 / 25.4, W = 210 * MM, H = 297 * MM, M = 12 * MM;
const INK = rgb(0.1, 0.1, 0.1), MUTED = rgb(0.42, 0.41, 0.39), LINE = rgb(0.85, 0.84, 0.81);
/** Long edge in pixels: sharp on an A4 half page, about 200 KB a photo. */
const EDGE = 1600;

/** One photo fetched and redrawn as a JPEG no larger than EDGE, the right way up. Null when the browser cannot read it. */
async function shrink(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
    const scale = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/jpeg', 0.82));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function photosPdf(o: { title: string; sub: string; photos: PdfPhoto[]; onProgress?: (done: number, total: number) => void }): Promise<Uint8Array> {
  const photos = o.photos.filter(p => p.kind !== 'video');
  const videos = o.photos.length - photos.length;
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`${o.title} photos`));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Four at a time: quicker than one by one, and a phone's memory never holds a hundred full-size photos at once.
  const shrunk: (Uint8Array | null)[] = [];
  for (let i = 0; i < photos.length; i += 4) {
    shrunk.push(...await Promise.all(photos.slice(i, i + 4).map(p => shrink(p.url))));
    o.onProgress?.(Math.min(i + 4, photos.length), photos.length);
  }
  const unread = shrunk.filter(b => !b).length;
  const notes = [videos ? `${videos} ${videos === 1 ? 'video is' : 'videos are'} not included` : '', unread ? `${unread} ${unread === 1 ? 'photo' : 'photos'} could not be read` : ''].filter(Boolean);

  const kept = photos.map((p, i) => ({ p, bytes: shrunk[i] })).filter((x): x is { p: PdfPhoto; bytes: Uint8Array } => !!x.bytes);
  const pages = Math.max(1, Math.ceil(kept.length / 2));
  const head = 22 * MM, cap = 7 * MM, slotH = (H - 2 * M - head - 2 * cap - 6 * MM) / 2, slotW = W - 2 * M;

  for (let n = 0; n < pages; n++) {
    const page = doc.addPage([W, H]);
    const t = (s: string, x: number, y: number, size: number, f = font, color = INK, right = false) => {
      const txt = safe(s);
      page.drawText(txt, { x: right ? x - f.widthOfTextAtSize(txt, size) : x, y, size, font: f, color });
    };
    t(o.title, M, H - M - 12, 13, bold);
    t(`Page ${n + 1} of ${pages}`, W - M, H - M - 12, 8.5, font, MUTED, true);
    t([o.sub, `${kept.length} ${kept.length === 1 ? 'photo' : 'photos'}`, ...(n === 0 ? notes : [])].join('  |  '), M, H - M - 27, 8.5, font, MUTED);
    page.drawLine({ start: { x: M, y: H - M - head + 6 * MM }, end: { x: W - M, y: H - M - head + 6 * MM }, thickness: 0.6, color: LINE });

    for (let k = 0; k < 2; k++) {
      const item = kept[n * 2 + k];
      if (!item) break;
      const img = await doc.embedJpg(item.bytes);
      const top = H - M - head - k * (slotH + cap + 6 * MM);
      const s = Math.min(slotW / img.width, slotH / img.height);
      const w = img.width * s, h = img.height * s;
      page.drawImage(img, { x: M + (slotW - w) / 2, y: top - slotH + (slotH - h) / 2, width: w, height: h });
      const when = item.p.at ? `${date(item.p.at)}  ${time(item.p.at)}` : 'Time not recorded';
      t([item.p.label, when].filter(Boolean).join('  |  '), M, top - slotH - 12, 9.5);
      t(`${n * 2 + k + 1}`, W - M, top - slotH - 12, 9.5, font, MUTED, true);
    }
  }
  return doc.save();
}

/** Builds the PDF and hands it to the browser as a download. */
export async function downloadPhotosPdf(o: Parameters<typeof photosPdf>[0] & { fileStem: string }): Promise<void> {
  const bytes = await photosPdf(o);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${o.fileStem.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'photos'}-photos-${fileStamp()}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
