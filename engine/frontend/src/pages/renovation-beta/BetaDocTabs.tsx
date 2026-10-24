/* Beta workspace > DO and GR (owner, 24 Oct 2026). One card per delivery order of the project's sales order(s), and
   one per goods receipt of its POs, newest first: the number, date, status, where it came from, the rooms of its
   lines, and every photo and video on it in the shared media grid (POD for a delivery order, the site team's receipt
   photos and files for a goods receipt). The cards share one height per row; "Add photos" attaches to that document. */

import { useState, type ReactElement } from "react";
import { Camera, PackageCheck, Truck } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { MediaGrid, MEDIA_RADIUS, type MediaItem } from "./BetaMedia";
import { PhotoUploadDialog, type UploadTarget } from "./BetaPhotoUpload";
import { TONE_DONE, TONE_QUIET, TONE_WAIT, WS, WsBadge, WsEmpty, WsPageHead, btnStyle, cardStyle } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonthYear, mytDay, mytTime } from "./renovationBetaModel";
import { betaMediaApi } from "./renovationBetaMediaApi";
import { betaSiteApi, type SiteDelivery, type SitePhoto } from "./renovationBetaSiteApi";
import { BETA } from "./renovationBetaTheme";
import { doStatusWords } from "../scm-v2/renovationDoStatus";
import { statusLabel } from "../../vendor/scm/lib/status-pill";

export function photoAsMedia(p: SitePhoto): MediaItem {
  return { id: p.id, path: p.path, kind: p.kind ?? (p.image ? "image" : "file"), name: p.name, label: p.source === "pod" ? "POD" : null, at: p.at, caption: p.area };
}

/* The words the DO and GR screens use for the same stored status (status-pill.ts via renovationDoStatus.ts), so a
   confirmed DO reads "Confirmed" here as on the DO list, not the raw "Loaded" value. */
export function statusTone(d: Pick<SiteDelivery, "type" | "status">): { tone: readonly [string, string]; text: string } {
  const s = d.status.toUpperCase();
  if (d.type === "delivery_order") {
    const w = doStatusWords(s);
    return { tone: w.tone === "success" ? TONE_DONE : w.tone === "error" || s === "DRAFT" ? TONE_QUIET : TONE_WAIT, text: w.label };
  }
  const text = statusLabel("grn", s);
  if (["RECEIVED", "POSTED", "CLOSED", "COMPLETED"].includes(s)) return { tone: TONE_DONE, text };
  if (s === "DRAFT" || s === "CANCELLED") return { tone: TONE_QUIET, text };
  return { tone: TONE_WAIT, text };
}

function when(d: SiteDelivery): string {
  if (!d.at) return "No date";
  const t = mytTime(d.at);
  return `${dayMonthYear(mytDay(d.at))}${t && t !== "00:00" ? ` ${t}` : ""}`;
}

function DocCard({ d, canWrite, onAdd }: { d: SiteDelivery; canWrite: boolean; onAdd: () => void }): ReactElement {
  const isDo = d.type === "delivery_order";
  const st = statusTone(d);
  const media = d.photos.map(photoAsMedia);
  const sub = isDo ? [when(d), d.from ? `from ${d.from}` : null] : [when(d), d.from, d.poNumber ? `PO ${d.poNumber}` : null];
  return (
    <li aria-label={`${isDo ? "Delivery order" : "Goods receipt"} ${d.no}`} style={{ ...cardStyle, padding: 16, gap: 12, height: "100%" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 20, background: isDo ? "#EEF2F1" : "#E4F1EF", color: isDo ? WS.blue : BETA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isDo ? <Truck size={18} /> : <PackageCheck size={18} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, overflowWrap: "anywhere" }}>{d.no}</h3>
          <div style={{ fontSize: 13, color: BETA.muted, overflowWrap: "anywhere" }}>{sub.filter(Boolean).join(" · ")}</div>
        </div>
        <WsBadge tone={st.tone}>{st.text}</WsBadge>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 22 }}>
        {d.areas.length > 0 ? d.areas.map((a) => <span key={a} style={{ padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: WS.chip, color: WS.text2 }}>{a}</span>)
          : <span style={{ fontSize: 12, color: BETA.muted }}>No rooms on its lines</span>}
      </div>
      <div style={{ marginTop: "auto" }}>
        {media.length > 0 ? <MediaGrid items={media} label={`Photos of ${d.no}`} /> : (
          <div style={{ aspectRatio: "4 / 3", borderRadius: MEDIA_RADIUS, border: `1.5px dashed ${WS.dash}`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 12, fontSize: 13, color: BETA.muted }}>
            {isDo ? "No proof of delivery photo yet" : "No photos on this receipt yet"}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: BETA.muted }}>{media.length} {media.length === 1 ? "photo or video" : "photos and videos"}</span>
        {canWrite && <button type="button" onClick={onAdd} style={btnStyle("outline", "sm")}><Camera size={14} aria-hidden="true" />Add photos</button>}
      </div>
    </li>
  );
}

function DocList({ p, type }: { p: BetaTabProps; type: SiteDelivery["type"] }): ReactElement {
  const site = useQuery(["renovation-beta", "site", p.projectId], () => betaSiteApi.site(p.projectId), [p.projectId]);
  const photos = useQuery(["renovation-beta", "photos", p.projectId], () => betaMediaApi.photos(p.projectId), [p.projectId]);
  const [adding, setAdding] = useState<UploadTarget | null>(null);
  const isDo = type === "delivery_order";
  const list = (site.data?.deliveries ?? []).filter((d) => d.type === type);
  const title = isDo ? "Delivery orders" : "Goods received";
  if (site.error && !site.data) return <p role="alert" style={{ fontSize: 14, color: WS.red }}>The {isDo ? "delivery orders" : "goods receipts"} could not be loaded: {site.error}</p>;
  return (
    <>
      <WsPageHead title={title} sub={isDo ? "Every DO of this project's sales order, with its proof of delivery photos and videos, newest first" : "Every goods receipt of this project's POs, with the photos taken on site, newest first"} />
      {!site.data ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading...</p>
        : !site.data.ready ? <WsEmpty>Deliveries are not switched on for this system yet.</WsEmpty>
        : list.length === 0 ? <WsEmpty>{isDo ? "No delivery orders yet. Each DO made from this project's sales order shows here with its POD." : "No goods receipts yet. Each GR of this project's POs shows here with its photos."}</WsEmpty>
        : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 16, alignItems: "stretch" }}>
            {list.map((d) => <DocCard key={d.id} d={d} canWrite={p.canWrite} onAdd={() => setAdding({ kind: isDo ? "do" : "gr", id: d.id })} />)}
          </ul>
        )}
      {adding && (
        <PhotoUploadDialog projectId={p.projectId} initial={adding} areas={site.data?.areas ?? []}
          docs={photos.data?.docs ?? { dos: list.filter(() => isDo).map((d) => ({ id: d.id, no: d.no })), grs: list.filter(() => !isDo).map((d) => ({ id: d.id, no: d.no })), pos: [] }}
          tasks={photos.data?.tasks ?? []}
          onClose={() => setAdding(null)} onDone={(t) => { setAdding(null); p.onDone(t); site.reload(); photos.reload(); }} />
      )}
    </>
  );
}

export function BetaDoTab(p: BetaTabProps): ReactElement {
  return <DocList p={p} type="delivery_order" />;
}

export function BetaGrTab(p: BetaTabProps): ReactElement {
  return <DocList p={p} type="goods_received" />;
}
