/** "2 bed · 1 bath · Dual key" (functions/_lib/unitLayout.ts sends the parts). The layout is left off when the size
 *  already says it, so a studio reads "Studio · 1 bath", not "Studio · 1 bath · Studio". */
export const sizeLine = (size?: string | null, layout?: string | null) =>
  [size, layout && !(size ?? '').toLowerCase().includes(layout.toLowerCase()) ? layout : null].filter(Boolean).join(' · ');
