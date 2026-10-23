/* Beta workspace > Site & photos (BRIEF-beta-oct24 section 5). Two ways to look at the same site:
   - By delivery: every delivery order and goods receipt of the project (through its sales order and POs), each with
     its proof-of-delivery photos, filtered by the sales order's areas (rooms).
   - By day: the site team's own photos (site receipts, onsite visits, defect before and after), newest first, one card
     per day, each photo tagged with its area. */

import { useEffect, useState, type ReactElement } from "react";
import { FileText, Truck, PackageCheck } from "lucide-react";
import { api } from "../../api/client";
import { useQuery } from "../../hooks/useQuery";
import { renovationApi } from "../projects/renovation/renovationApi";
import { errorText } from "../projects/renovation/renovationModel";
import { TONE_DONE, TONE_QUIET, TONE_WAIT, WS, WsBadge, WsDialog, WsEmpty, WsFilterPill, WsPageHead, WsPhoto, cardStyle } from "./BetaWsUi";
import { FileDialog, type BetaTabProps, type ViewedFile } from "./betaShared";
import { dayHeading, dayMonthYear, groupByDay, mytDay, mytTime, siteFeed, type FeedItem, type FeedSource } from "./renovationBetaModel";
import { betaSiteApi, type SiteDelivery, type SitePhoto } from "./renovationBetaSiteApi";
import { DELIVERY_LABEL, PHOTO_SOURCE, areaChips, filterDeliveries, photoCount } from "./renovationBetaSiteModel";
import { BETA } from "./renovationBetaTheme";

const SOURCE_LABEL: Record<FeedSource, string> = {
  receipt: "Site receipt",
  onsite: "Onsite visit",
  defect_before: "Defect, before",
  defect_after: "Defect, after fix",
};

type Mode = "delivery" | "day";

function tagOf(i: FeedItem): string {
  if (i.source === "receipt") return i.room ?? SOURCE_LABEL.receipt;
  return [i.room, SOURCE_LABEL[i.source]].filter(Boolean).join(" · ");
}

const sameArea = (a: string | null, b: string): boolean => a != null && a.trim().toLowerCase() === b.trim().toLowerCase();

export function BetaSiteTab({ projectId, records, workspace, today }: BetaTabProps): ReactElement {
  const site = useQuery(["renovation-beta", "site", projectId], () => betaSiteApi.site(projectId), [projectId]);
  const pod = useQuery(["renovation-beta", "pod", projectId], () => renovationApi.pod(projectId), [projectId]);
  const [mode, setMode] = useState<Mode>("delivery");
  const [area, setArea] = useState("");
  const [viewing, setViewing] = useState<SitePhoto | null>(null);
  const [viewingFile, setViewingFile] = useState<ViewedFile | null>(null);

  const deliveries = site.data?.deliveries ?? [];
  const feed = siteFeed({ rooms: pod.data?.rooms ?? [], measures: records.measures, defects: workspace.defects });
  const chips = areaChips(site.data?.areas ?? [], deliveries);
  for (const i of feed) if (i.room && !chips.some((c) => sameArea(c, i.room as string))) chips.push(i.room);
  const shownDeliveries = filterDeliveries(deliveries, area);
  const shownFeed = area ? feed.filter((i) => sameArea(i.room, area)) : feed;
  const days = groupByDay(shownFeed, (i) => (i.at ? mytDay(i.at) : null));
  const countFor = (a: string): number => (mode === "delivery" ? photoCount(filterDeliveries(deliveries, a)) : (a ? feed.filter((i) => sameArea(i.room, a)) : feed).length);

  return (
    <>
      <WsPageHead
        title="Site & photos"
        sub="Deliveries from the sales order with their proof of delivery, and the site team's photos"
        right={
          <div role="group" aria-label="Show photos" style={{ display: "inline-flex", border: `1px solid ${BETA.border}`, borderRadius: 10, overflow: "hidden", background: BETA.surface }}>
            {(["delivery", "day"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                style={{ minHeight: 40, padding: "0 16px", border: 0, background: mode === m ? BETA.ink : "transparent", color: mode === m ? "#FFFFFF" : BETA.ink, font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {m === "delivery" ? "By delivery" : "By day"}
              </button>
            ))}
          </div>
        }
      />

      {chips.length > 0 && (
        <div role="group" aria-label="Filter by area" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "thin" }}>
          <WsFilterPill on={area === ""} onClick={() => setArea("")}>All <span style={{ opacity: 0.7 }}>{countFor("")}</span></WsFilterPill>
          {chips.map((a) => (
            <WsFilterPill key={a} on={sameArea(area, a)} onClick={() => setArea(a)}>
              <span style={{ whiteSpace: "nowrap" }}>{a} <span style={{ opacity: 0.7 }}>{countFor(a)}</span></span>
            </WsFilterPill>
          ))}
        </div>
      )}

      {mode === "delivery" ? (
        site.loading && !site.data ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading deliveries...</p>
          : site.error && !site.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The deliveries could not be loaded: {site.error}</p>
          : site.data && !site.data.ready ? <WsEmpty>Deliveries are not switched on for this system yet.</WsEmpty>
          : shownDeliveries.length === 0 ? (
            <WsEmpty>{deliveries.length === 0 ? "No deliveries yet. Delivery orders and goods receipts from this project's sales order and POs show here with their proof of delivery." : `Nothing delivered for ${area} yet.`}</WsEmpty>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start" }}>
              {shownDeliveries.map((d) => <DeliveryCard key={`${d.type}-${d.id}`} d={d} area={area} onView={setViewing} />)}
            </ul>
          )
      ) : (
        <>
          {pod.error && <p role="alert" style={{ fontSize: 14, color: WS.red }}>The site receipt photos could not be loaded: {pod.error}</p>}
          {pod.loading && !pod.data && <p style={{ fontSize: 14, color: BETA.muted }}>Loading photos...</p>}
          {!pod.loading && shownFeed.length === 0 && (
            <WsEmpty>{feed.length === 0 ? "No photos yet. Site receipts, onsite visits and defects will show here." : `No photos for ${area}.`}</WsEmpty>
          )}
          {days.map((g) => (
            <section key={g.day ?? "undated"} aria-label={g.day ? dayHeading(g.day, today) : "No date"} style={{ ...cardStyle, padding: "16px 18px", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{g.day ? dayHeading(g.day, today) : "No date"}</h3>
                {g.day === today && <span style={{ padding: "2px 8px", borderRadius: 10, background: BETA.accent, color: "#FFFFFF", fontSize: 12, fontWeight: 700 }}>Today</span>}
                <span style={{ marginLeft: "auto", fontSize: 13, color: BETA.muted }}>{g.items.length} {g.items.length === 1 ? "photo" : "photos"}</span>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(46%, 180px), 1fr))", gap: 10 }}>
                {g.items.map((i) => <FeedTile key={i.id} item={i} projectId={projectId} onView={setViewingFile} />)}
              </ul>
            </section>
          ))}
        </>
      )}

      {viewing && <PhotoDialog photo={viewing} onClose={() => setViewing(null)} />}
      {viewingFile && <FileDialog projectId={projectId} file={viewingFile} onClose={() => setViewingFile(null)} />}
    </>
  );
}

function DeliveryCard({ d, area, onView }: { d: SiteDelivery; area: string; onView: (p: SitePhoto) => void }): ReactElement {
  const isDo = d.type === "delivery_order";
  const hasPod = d.photos.some((p) => p.source === "pod" || p.source === "site");
  const time = d.at ? mytTime(d.at) : null;
  const arrived = !isDo || ["DELIVERED", "SIGNED", "INVOICED"].includes(d.status.toUpperCase());
  const badge = hasPod ? { tone: TONE_DONE, text: "POD" } : arrived ? { tone: TONE_WAIT, text: "No POD photo" } : { tone: TONE_QUIET, text: "Not delivered yet" };
  return (
    <li style={{ ...cardStyle, padding: 0, gap: 0, overflow: "hidden" }} aria-label={`${DELIVERY_LABEL[d.type]} ${d.no}`}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px" }}>
        <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 20, background: isDo ? "#E8F0FB" : "#E4F1EF", color: isDo ? WS.blue : BETA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isDo ? <Truck size={18} /> : <PackageCheck size={18} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 8px" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, overflowWrap: "anywhere" }}>{d.no}</h3>
            <span style={{ fontSize: 13, color: BETA.muted }}>{DELIVERY_LABEL[d.type]}</span>
          </div>
          <div style={{ fontSize: 13, color: BETA.muted, overflowWrap: "anywhere" }}>
            {[d.at ? `${dayMonthYear(mytDay(d.at))}${time && time !== "00:00" ? ` ${time}` : ""}` : "No date", isDo ? (d.from ? `from ${d.from}` : null) : d.from, d.poNumber].filter(Boolean).join(" · ")}
          </div>
        </div>
        <WsBadge tone={badge.tone}>{badge.text}</WsBadge>
      </div>
      {d.areas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 16px 12px" }}>
          {d.areas.map((a) => (
            <span key={a} style={{ padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: sameArea(area, a) ? BETA.ink : WS.chip, color: sameArea(area, a) ? "#FFFFFF" : WS.text2 }}>{a}</span>
          ))}
        </div>
      )}
      {d.photos.length === 0 ? (
        <p style={{ margin: "0 16px 16px", padding: "14px 12px", borderRadius: 10, border: `1.5px dashed ${WS.dash}`, fontSize: 13, color: BETA.muted, textAlign: "center" }}>No proof of delivery photo yet</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          {d.photos.map((p) => (
            <li key={p.id} title={p.name} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", background: WS.chip }}>
              {p.image ? <WsPhoto path={p.path} alt={`${d.no}: ${p.name}${p.area ? `, ${p.area}` : ""}`} onClick={() => onView(p)} /> : (
                <button type="button" onClick={() => onView(p)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%", border: 0, background: "transparent", fontSize: 12, color: BETA.muted, cursor: "pointer" }}>
                  <FileText size={18} aria-hidden="true" /><span style={{ maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                </button>
              )}
              <span style={{ position: "absolute", left: 6, bottom: 6, maxWidth: "calc(100% - 12px)", padding: "1px 6px", borderRadius: 8, background: "rgba(23,32,31,.75)", color: "#FFFFFF", fontSize: 11, fontWeight: 600, pointerEvents: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.area ?? PHOTO_SOURCE[p.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One delivery photo or file, large. A file that is not a photo is fetched and offered as a link. */
function PhotoDialog({ photo, onClose }: { photo: SitePhoto; onClose: () => void }): ReactElement {
  const [href, setHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (photo.image) return;
    let live = true;
    let made: string | null = null;
    api.fetchBlobUrl(photo.path)
      .then((u) => { made = u; if (live) setHref(u); else URL.revokeObjectURL(u); })
      .catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [photo]);
  return (
    <WsDialog title={photo.name} sub={[photo.area, photo.at ? dayMonthYear(mytDay(photo.at)) : null].filter(Boolean).join(" · ") || undefined} onClose={onClose} wide>
      {photo.image ? <div style={{ maxHeight: "72vh", overflow: "auto" }}><WsPhoto path={photo.path} alt={photo.name} style={{ height: "auto", objectFit: "contain" }} /></div>
        : error ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The file could not be loaded: {error}</p>
        : !href ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading the file...</p>
        : <p style={{ fontSize: 14 }}><a href={href} target="_blank" rel="noopener" download={photo.name}>Open the file</a></p>}
    </WsDialog>
  );
}

function FeedTile({ item, projectId, onView }: { item: FeedItem; projectId: number; onView: (f: ViewedFile) => void }): ReactElement {
  const path = renovationApi.fileUrl(projectId, item.key);
  const alt = `${SOURCE_LABEL[item.source]}${item.room ? `, ${item.room}` : ""}: ${item.caption}`;
  const open = (): void => onView({ key: item.key, name: item.caption });
  return (
    <li title={item.caption} style={{ position: "relative", aspectRatio: "4 / 3", borderRadius: 10, overflow: "hidden", background: WS.chip }}>
      {item.image ? (
        <WsPhoto path={path} alt={alt} onClick={open} />
      ) : (
        <button type="button" onClick={open} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", height: "100%", border: 0, background: "transparent", fontSize: 12, color: BETA.muted, cursor: "pointer" }}>
          <FileText size={20} aria-hidden="true" />
          <span>Open file</span>
          <span className="sr">{alt}</span>
        </button>
      )}
      <span style={{ position: "absolute", left: 8, bottom: 8, maxWidth: "calc(100% - 16px)", padding: "2px 8px", borderRadius: 10, background: "rgba(23,32,31,.75)", color: "#FFFFFF", fontSize: 12, fontWeight: 600, pointerEvents: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tagOf(item)}
      </span>
    </li>
  );
}
