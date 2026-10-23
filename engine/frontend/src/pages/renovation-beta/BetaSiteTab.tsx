/* Beta workspace > Site & photos, laid out as the mockup's Site photos view: one card per day, newest first, with a
   filter by area. The feed is site receipt photos, onsite visit files and defect photos (before and after), with a
   filter by room where the room is known. */

import { useState, type ReactElement } from "react";
import { FileText } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { renovationApi } from "../projects/renovation/renovationApi";
import { WS, WsFilterPill, WsPageHead, WsPhoto, cardStyle } from "./BetaWsUi";
import { FileDialog, type BetaTabProps, type ViewedFile } from "./betaShared";
import { NO_ROOM, dayHeading, feedRooms, filterFeed, groupByDay, mytDay, siteFeed, type FeedItem, type FeedSource } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

const SOURCE_LABEL: Record<FeedSource, string> = {
  receipt: "Site receipt",
  onsite: "Onsite visit",
  defect_before: "Defect, before",
  defect_after: "Defect, after fix",
};

/** The tag on a photo: the room when it is known, with where the photo came from unless it is a plain receipt photo. */
function tagOf(i: FeedItem): string {
  if (i.source === "receipt") return i.room ?? SOURCE_LABEL.receipt;
  return [i.room, SOURCE_LABEL[i.source]].filter(Boolean).join(" · ");
}

export function BetaSiteTab({ projectId, records, workspace, today }: BetaTabProps): ReactElement {
  const pod = useQuery(["renovation-beta", "pod", projectId], () => renovationApi.pod(projectId), [projectId]);
  const [room, setRoom] = useState("");
  const [viewing, setViewing] = useState<ViewedFile | null>(null);

  const feed = siteFeed({ rooms: pod.data?.rooms ?? [], measures: records.measures, defects: workspace.defects });
  const rooms = feedRooms(feed);
  const shown = filterFeed(feed, room);
  const hasUnknownRoom = feed.some((i) => !i.room);
  const days = groupByDay(shown, (i) => (i.at ? mytDay(i.at) : null));

  return (
    <>
      <WsPageHead
        title="Site photos"
        sub="Posted by the site team · newest first · just for viewing"
        right={feed.length > 0 ? (
          <div role="group" aria-label="Filter by area" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <WsFilterPill on={room === ""} onClick={() => setRoom("")}>All</WsFilterPill>
            {rooms.map((r) => <WsFilterPill key={r} on={room === r} onClick={() => setRoom(r)}>{r}</WsFilterPill>)}
            {hasUnknownRoom && <WsFilterPill on={room === NO_ROOM} onClick={() => setRoom(NO_ROOM)}>{NO_ROOM}</WsFilterPill>}
          </div>
        ) : undefined}
      />
      {pod.error && <p role="alert" style={{ fontSize: 14, color: WS.red }}>The site receipt photos could not be loaded: {pod.error}</p>}
      {pod.loading && !pod.data && <p style={{ fontSize: 14, color: BETA.muted }}>Loading photos...</p>}
      {!pod.loading && shown.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: BETA.muted, background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>
          {feed.length === 0 ? "No photos yet. Site receipts, onsite visits and defects will show here." : "No photos for this area."}
        </div>
      )}
      {days.map((g) => (
        <section key={g.day ?? "undated"} aria-label={g.day ? dayHeading(g.day, today) : "No date"} style={{ ...cardStyle, padding: "16px 18px", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{g.day ? dayHeading(g.day, today) : "No date"}</h2>
            {g.day === today && <span style={{ padding: "2px 8px", borderRadius: 10, background: BETA.accent, color: "#FFFFFF", fontSize: 11, fontWeight: 700 }}>Today</span>}
            <span style={{ marginLeft: "auto", fontSize: 13, color: BETA.muted }}>{g.items.length} {g.items.length === 1 ? "item" : "items"}</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
            {g.items.map((i) => <FeedTile key={i.id} item={i} projectId={projectId} onView={setViewing} />)}
          </ul>
        </section>
      ))}
      {viewing && <FileDialog projectId={projectId} file={viewing} onClose={() => setViewing(null)} />}
    </>
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
      <span style={{ position: "absolute", left: 8, bottom: 8, maxWidth: "calc(100% - 16px)", padding: "2px 8px", borderRadius: 10, background: "rgba(23,32,31,.75)", color: "#FFFFFF", fontSize: 11, fontWeight: 600, pointerEvents: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tagOf(item)}
      </span>
    </li>
  );
}
