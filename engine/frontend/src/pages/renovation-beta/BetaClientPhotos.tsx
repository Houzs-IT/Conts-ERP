/* Photos of a Client PO line as plain <img> thumbnails with a full-size viewer: the SKU's catalog photos on the staff
   tab (served without login by /api/scm/mfg-products/:id/photo/:key) and every photo on the client's read-only link
   (served through the link's own token, /api/public/beta-client/:token/photos/:ref). The line photos on the staff tab
   keep SoLinePhotoStrip, which needs the staff login. */

import { useEffect, useState, type ReactElement } from "react";
import { BETA } from "./renovationBetaTheme";

export interface PlainPhoto { thumb: string; full: string; label: string }

export function PlainPhotoStrip({ photos, size = 32, label }: { photos: readonly PlainPhoto[]; size?: number; label: string }): ReactElement | null {
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <span role="list" aria-label={label} style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
        {photos.map((ph, i) => (
          <span role="listitem" key={ph.full}>
            <button type="button" title="Open full size" onClick={() => setOpenAt(i)}
              style={{ width: size, height: size, padding: 0, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 4, overflow: "hidden", cursor: "zoom-in", background: BETA.chip }}>
              <img src={ph.thumb} alt={ph.label} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => { if (e.currentTarget.src !== ph.full) e.currentTarget.src = ph.full; }} />
            </button>
          </span>
        ))}
      </span>
      {openAt != null && photos[openAt] && <Viewer photos={photos} at={openAt} onMove={setOpenAt} onClose={() => setOpenAt(null)} />}
    </>
  );
}

function Viewer({ photos, at, onMove, onClose }: { photos: readonly PlainPhoto[]; at: number; onMove: (i: number) => void; onClose: () => void }): ReactElement {
  const n = photos.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && n > 1) onMove((at + 1) % n);
      else if (e.key === "ArrowLeft" && n > 1) onMove((at - 1 + n) % n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, n, onClose, onMove]);
  const ph = photos[at]!;
  const nav = { padding: "10px 14px", borderRadius: 8, border: "none", background: "rgba(255,255,255,0.9)", color: BETA.ink, fontSize: 15, fontWeight: 600, cursor: "pointer" } as const;
  return (
    <div role="dialog" aria-modal="true" aria-label={ph.label} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,20,18,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
      <img src={ph.full} alt={ph.label} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "calc(100vh - 110px)", objectFit: "contain", borderRadius: 6, background: "#FFFFFF" }} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 10 }} onClick={(e) => e.stopPropagation()}>
        {n > 1 && <button type="button" style={nav} onClick={() => onMove((at - 1 + n) % n)}>Previous</button>}
        <span style={{ color: "#FFFFFF", fontSize: 14 }}>{ph.label}{n > 1 ? ` · ${at + 1} of ${n}` : ""}</span>
        {n > 1 && <button type="button" style={nav} onClick={() => onMove((at + 1) % n)}>Next</button>}
        <button type="button" style={nav} onClick={onClose} autoFocus>Close</button>
      </div>
    </div>
  );
}
