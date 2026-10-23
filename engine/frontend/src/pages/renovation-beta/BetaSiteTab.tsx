/* Beta workspace > Site & photos: one feed, newest first, of site receipt photos, onsite visit files and defect
   photos (before and after), with a filter by room where the room is known. */

import { useState, type ReactElement } from "react";
import { Camera, FileText } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { Card } from "../projects/renovation/ProjectRecords";
import { renovationApi } from "../projects/renovation/renovationApi";
import { shortDate } from "../projects/renovation/renovationModel";
import { AuthImage, Pill, inputClass } from "../projects/renovation/renovationUi";
import { FileDialog, type BetaTabProps, type ViewedFile } from "./betaShared";
import { NO_ROOM, feedRooms, filterFeed, siteFeed, type FeedItem, type FeedSource } from "./renovationBetaModel";

const SOURCE_LABEL: Record<FeedSource, string> = {
  receipt: "Site receipt",
  onsite: "Onsite visit",
  defect_before: "Defect, before",
  defect_after: "Defect, after fix",
};

export function BetaSiteTab({ projectId, records, workspace }: BetaTabProps): ReactElement {
  const pod = useQuery(["renovation-beta", "pod", projectId], () => renovationApi.pod(projectId), [projectId]);
  const [room, setRoom] = useState("");
  const [viewing, setViewing] = useState<ViewedFile | null>(null);

  const feed = siteFeed({ rooms: pod.data?.rooms ?? [], measures: records.measures, defects: workspace.defects });
  const rooms = feedRooms(feed);
  const shown = filterFeed(feed, room);
  const hasUnknownRoom = feed.some((i) => !i.room);

  return (
    <Card
      title="Site & photos"
      icon={<Camera size={14} />}
      actions={feed.length > 0 ? (
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          Room
          <select className={`${inputClass} !w-auto !py-1 text-xs`} value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">All rooms</option>
            {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
            {hasUnknownRoom && <option value={NO_ROOM}>{NO_ROOM}</option>}
          </select>
        </label>
      ) : undefined}
    >
      {pod.error && <p role="alert" className="mb-2 text-sm text-err">The site receipt photos could not be loaded: {pod.error}</p>}
      {pod.loading && !pod.data && <p className="text-sm text-ink-secondary">Loading photos...</p>}
      {!pod.loading && shown.length === 0 && (
        <p className="text-sm text-ink-secondary">{feed.length === 0 ? "No photos yet. Site receipts, onsite visits and defects will show here." : "No photos for this room."}</p>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((i) => <FeedTile key={i.id} item={i} projectId={projectId} onView={setViewing} />)}
        </ul>
      )}
      {viewing && <FileDialog projectId={projectId} file={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}

function FeedTile({ item, projectId, onView }: { item: FeedItem; projectId: number; onView: (f: ViewedFile) => void }) {
  const path = renovationApi.fileUrl(projectId, item.key);
  const alt = `${SOURCE_LABEL[item.source]}${item.room ? `, ${item.room}` : ""}: ${item.caption}`;
  return (
    <li className="min-w-0 rounded-md border border-border bg-surface">
      {item.image ? (
        <AuthImage path={path} alt={alt} className="aspect-square w-full rounded-t-md" onClick={() => onView({ key: item.key, name: item.caption })} />
      ) : (
        <button type="button" onClick={() => onView({ key: item.key, name: item.caption })} className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-t-md bg-surface-dim text-xs text-ink-secondary hover:text-ink">
          <FileText size={20} aria-hidden />
          <span>Open file</span>
        </button>
      )}
      <div className="space-y-1 p-2 text-xs">
        <Pill tone={item.source === "defect_before" ? "err" : item.source === "defect_after" ? "ok" : "muted"}>{SOURCE_LABEL[item.source]}</Pill>
        <div className="text-ink [overflow-wrap:anywhere]">{item.caption}</div>
        <div className="text-ink-secondary">{[item.room, item.at ? shortDate(item.at) : null].filter(Boolean).join(" · ") || "No room or date"}</div>
      </div>
    </li>
  );
}
