/* The brand's logo, faint and on a slant, behind every page of the sales order / quotation PDF (owner, 17 Nov 2026:
   "logo 浅浅在后面好像 watermark", the slanted mockup). The same logo the letterhead prints: a contract's brand, else
   the company's; The Conts' wide mark when its upload is square. The image is faded and turned on a canvas first, so
   the PDF needs no transparency or rotation support. */

import type { jsPDF } from 'jspdf';
import { brandLogoFor } from './brand-logos';

type Logo = { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number };

/** The watermark's slant (degrees, rising left to right) and strength (0..1 of the logo's own ink). */
export const WATERMARK_ANGLE = 45;
export const WATERMARK_ALPHA = 0.1;

/** The logo the letterhead prints for this name, as drawDocLetterheadAt picks it. */
export function letterheadLogoOf(name: string, logo: Logo | null | undefined): Logo {
  const squareConts = logo != null && logo.width / logo.height < 1.6 && /the\s*conts/i.test(name);
  return logo && !squareConts ? logo : brandLogoFor(name);
}

const cache = new Map<string, Promise<Logo | null>>();

/** The logo faded and turned, as a PNG; null where there is no canvas (tests) or the image does not load. */
export function watermarkImage(logo: Logo, angle = WATERMARK_ANGLE, alpha = WATERMARK_ALPHA): Promise<Logo | null> {
  const key = `${logo.dataUrl.length}:${logo.dataUrl.slice(-64)}:${angle}:${alpha}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = new Promise<Logo | null>((resolve) => {
      if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof navigator === 'undefined' || /jsdom/i.test(navigator.userAgent)) { resolve(null); return; }
      /* A logo that never loads must not hold the print up: without it the page prints with no watermark. */
      const timer = setTimeout(() => resolve(null), 3000);
      const img = new Image();
      img.onload = () => {
        try {
          const rad = (angle * Math.PI) / 180;
          const w = img.naturalWidth, h = img.naturalHeight;
          const bw = Math.ceil(w * Math.cos(rad) + h * Math.sin(rad));
          const bh = Math.ceil(w * Math.sin(rad) + h * Math.cos(rad));
          const canvas = document.createElement('canvas');
          canvas.width = bw; canvas.height = bh;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.globalAlpha = alpha;
          ctx.translate(bw / 2, bh / 2);
          ctx.rotate(-rad);
          ctx.drawImage(img, -w / 2, -h / 2);
          clearTimeout(timer);
          resolve({ dataUrl: canvas.toDataURL('image/png'), format: 'PNG', width: bw, height: bh });
        } catch { clearTimeout(timer); resolve(null); }
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = logo.dataUrl;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** Draws the prepared watermark in the middle of the current page, fitted to `share` of the page width. */
export function drawWatermark(doc: jsPDF, mark: Logo, share = 0.86): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const scale = Math.min((pageW * share) / mark.width, (pageH * 0.8) / mark.height);
  const w = mark.width * scale, h = mark.height * scale;
  doc.addImage(mark.dataUrl, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, 'FAST');
}
