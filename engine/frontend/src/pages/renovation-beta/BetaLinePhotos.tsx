/* A line's photos in one small strip for the PO and Client PO tabs (owner, 24 Oct 2026): up to three thumbnails, then
   "+N", which opens every photo of the line. A thumbnail opens the full-size viewer. Three sources, in this order: the
   photos uploaded on the sales order line, the photos uploaded on its PO line, and the SKU's catalog photos.
   The order and PO line photos need the staff login, so they keep SoLinePhotoStrip (its MediaLightbox); the catalog
   photos are plain links (PlainPhotoStrip). */

import { useState, type ReactElement } from "react";
import { SoLinePhotoStrip } from "../../components/scm-v2/SoLinePhotoStrip";
import { resolveApiAssetUrl } from "../../components/scm-v2/PhotoGallery";
import { PlainPhotoStrip, type PlainPhoto } from "./BetaClientPhotos";
import { WsDialog } from "./BetaWsUi";
import { metaStyle } from "./BetaVoPoUi";
import { BETA } from "./renovationBetaTheme";
import { skuPhotoPath } from "./renovationBetaVoPo";

export interface LinePhotoSet {
  so: { docNo: string; itemId: string; keys: readonly string[] } | null;
  po: ReadonlyArray<{ poId: string; poLineId: string; poNumber: string; keys: readonly string[] }>;
  sku: ReadonlyArray<{ productId: string; key: string; thumbKey: string | null }>;
}

export function photoCount(s: LinePhotoSet): number {
  return (s.so?.keys.length ?? 0) + s.po.reduce((n, p) => n + p.keys.length, 0) + s.sku.length;
}

/** How many of each source the strip shows when it may show `max` in all: order line first, then PO, then SKU. */
export function photoSlots(s: LinePhotoSet, max: number): { so: number; po: number[]; sku: number } {
  let left = max;
  const take = (n: number): number => { const t = Math.min(n, left); left -= t; return t; };
  const so = take(s.so?.keys.length ?? 0);
  const po = s.po.map((p) => take(p.keys.length));
  return { so, po, sku: take(s.sku.length) };
}

function skuPlain(s: LinePhotoSet, label: string): PlainPhoto[] {
  return s.sku.map((ph) => ({
    thumb: resolveApiAssetUrl(skuPhotoPath(ph.productId, ph.thumbKey ?? ph.key)),
    full: resolveApiAssetUrl(skuPhotoPath(ph.productId, ph.key)),
    label: `SKU photo of ${label}`,
  }));
}

function Strips({ s, label, slots }: { s: LinePhotoSet; label: string; slots: ReturnType<typeof photoSlots> | null }): ReactElement {
  const sku = skuPlain(s, label);
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      {s.so && (slots ? slots.so : s.so.keys.length) > 0 && (
        <SoLinePhotoStrip source="so" docId={s.so.docNo} itemId={s.so.itemId} photoKeys={[...s.so.keys].slice(0, slots ? slots.so : undefined)} edit={null} />
      )}
      {s.po.map((p, i) => ((slots ? slots.po[i] : p.keys.length) > 0 ? (
        <SoLinePhotoStrip key={p.poLineId} source="po" docId={p.poId} itemId={p.poLineId} photoKeys={[...p.keys].slice(0, slots ? slots.po[i] : undefined)} edit={null} />
      ) : null))}
      {(slots ? slots.sku : sku.length) > 0 && <PlainPhotoStrip photos={sku.slice(0, slots ? slots.sku : undefined)} label={`SKU photos of ${label}`} />}
    </span>
  );
}

export function LinePhotoThumbs({ photos, label, max = 3 }: { photos: LinePhotoSet; label: string; max?: number }): ReactElement | null {
  const [all, setAll] = useState(false);
  const total = photoCount(photos);
  if (total === 0) return null;
  const more = total - max;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      <Strips s={photos} label={label} slots={photoSlots(photos, max)} />
      {more > 0 && (
        <button type="button" onClick={() => setAll(true)} aria-label={`Show all ${total} photos of ${label}`}
          style={{ height: 32, minWidth: 32, padding: "0 6px", borderRadius: 4, border: `1px solid ${BETA.border}`, background: BETA.surface, font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          +{more}
        </button>
      )}
      {all && (
        <WsDialog title={`Photos of ${label}`} sub={`${total} photos. Open one to see it full size.`} onClose={() => setAll(false)} wide>
          {photos.so && photos.so.keys.length > 0 && <Group title="Sales order line"><Strips s={{ so: photos.so, po: [], sku: [] }} label={label} slots={null} /></Group>}
          {photos.po.filter((p) => p.keys.length > 0).map((p) => (
            <Group key={p.poLineId} title={`PO ${p.poNumber}`}><Strips s={{ so: null, po: [p], sku: [] }} label={label} slots={null} /></Group>
          ))}
          {photos.sku.length > 0 && <Group title="SKU"><Strips s={{ so: null, po: [], sku: photos.sku }} label={label} slots={null} /></Group>}
        </WsDialog>
      )}
    </span>
  );
}

function Group({ title, children }: { title: string; children: ReactElement }): ReactElement {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={metaStyle}>{title}</span>{children}</div>;
}
