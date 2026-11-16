/* The letterhead's logo, faint and on a slant, behind every page of every document PDF (owner, 17 Nov 2026: "logo 浅浅在
   后面好像 watermark", the 45-degree mockup he picked; then "全部能看到 PDF ... 都是一样的格式"). The letterhead
   remembers the logo it drew on a document; the watermark is stamped on every page when the document is turned into a
   file (pdf-common deliverPdf and the few generators that take the bytes themselves). jsPDF fades and turns the image
   itself, so nothing waits on a canvas. */

import type { jsPDF } from 'jspdf';
import { brandLogoFor } from './brand-logos';
import { CONTS_LINES_BY_NAME } from '../../conts/flowRules';

type Logo = { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number };

/** The slant (degrees, rising left to right), the strength (0..1) and the share of the page width it spans. */
export const WATERMARK_ANGLE = 45;
export const WATERMARK_ALPHA = 0.1;
const WATERMARK_SHARE = 0.86;

/** The logo the letterhead prints for this name: The Conts' wide mark when its upload is square. */
export function letterheadLogoOf(name: string, logo: Logo | null | undefined): Logo {
  const squareConts = logo != null && logo.width / logo.height < 1.6 && /the\s*conts/i.test(name);
  return logo && !squareConts ? logo : brandLogoFor(name);
}

const logos = new WeakMap<object, Logo>();
const stamped = new WeakSet<object>();

/** Called by the letterhead with the logo it drew on this document. */
export function rememberLetterheadLogo(doc: object, logo: Logo): void {
  logos.set(doc, logo);
}

/** Stamps the remembered logo on every page, once per document. A document with no letterhead is left as it is. */
export function stampWatermark(doc: jsPDF): void {
  if (!CONTS_LINES_BY_NAME || stamped.has(doc)) return;
  const logo = logos.get(doc);
  if (!logo) return;
  stamped.add(doc);
  try {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const rad = (WATERMARK_ANGLE * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    /* The turned logo's box must fit the page. */
    const scale = Math.min((pageW * WATERMARK_SHARE) / (logo.width * c + logo.height * s), (pageH * 0.8) / (logo.width * s + logo.height * c));
    const w = logo.width * scale, h = logo.height * scale;
    /* jsPDF turns an image about its bottom-left corner, counter-clockwise; place that corner so the centre lands mid-page. */
    const px = pageW / 2 - (w / 2) * c + (h / 2) * s;
    const py = pageH / 2 + (w / 2) * s + (h / 2) * c;
    const current = doc.getCurrentPageInfo().pageNumber;
    for (let p = 1; p <= doc.getNumberOfPages(); p += 1) {
      doc.setPage(p);
      doc.saveGraphicsState();
      const GState = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
      doc.setGState(new GState({ opacity: WATERMARK_ALPHA }) as never);
      doc.addImage(logo.dataUrl, logo.format, px, py - h, w, h, undefined, 'FAST', WATERMARK_ANGLE);
      doc.restoreGraphicsState();
    }
    doc.setPage(current);
  } catch {
    /* A watermark that cannot be drawn never stops the document. */
  }
}
