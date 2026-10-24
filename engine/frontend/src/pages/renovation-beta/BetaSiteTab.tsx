/* Beta workspace > Site & photos (owner, 24 Oct 2026): one timeline of every photo and video of the project, newest
   first to the minute. Each day is a node on a vertical line; under it one card per event ("3:42 pm · DO
   TC-DO-2610-003 · POD · 2 photos") with its media in a row. Each card carries its category: Progress (the site
   team's own photos and site steps), DO (proof of delivery), GR, PO, Measure (site measure) and Defect (before and
   after). Category chips with counts filter it, and an area filter narrows it further. Deliveries by document live
   in the DO and GR tabs. "Add photos" uploads progress photos, a site step's photos, or photos onto a DO, GR or PO. */

import { useMemo, useState, type ReactElement } from "react";
import { Camera } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { MediaRow } from "./BetaMedia";
import { PhotoUploadDialog } from "./BetaPhotoUpload";
import { WS, WsEmpty, WsFilterPill, WsPageHead, btnStyle, cardStyle, inputStyle } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { asMedia, betaMediaApi, type PhotoCategory } from "./renovationBetaMediaApi";
import {
  CATEGORY_CHIP, cardLine, countBy, dayTitle, filterPhotos, photoAreas, photoFilters, photoTimeline, type PhotoCard, type PhotoFilter,
} from "./renovationBetaPhotosModel";
import { BETA, type BetaTone } from "./renovationBetaTheme";

/* One accent per category, from the Beta palette: teal for the site team, blue for deliveries, amber for defects. */
export const CATEGORY_TONE: Readonly<Record<PhotoCategory, BetaTone>> = {
  progress: [BETA.accent, "#E4F1EF"],
  do: [WS.blue, "#EEF2F1"],
  gr: [WS.blue, "#EEF2F1"],
  po: [WS.text2, WS.chip],
  measure: [WS.text2, WS.chip],
  defect: [WS.amber, "#FDF1E2"],
};

function CategoryChip({ c }: { c: PhotoCategory }): ReactElement {
  const [ink, bg] = CATEGORY_TONE[c];
  return <span style={{ flex: "none", padding: "2px 8px", borderRadius: 6, background: bg, color: ink, fontSize: 12, fontWeight: 700 }}>{CATEGORY_CHIP[c]}</span>;
}

function EventCard({ c }: { c: PhotoCard }): ReactElement {
  const area = [...new Set(c.items.map((i) => i.area).filter(Boolean))].join(", ");
  const note = c.items.find((i) => i.note)?.note ?? null;
  return (
    <li style={{ ...cardStyle, padding: 14, gap: 10 }} aria-label={cardLine(c)}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px" }}>
        <CategoryChip c={c.category} />
        <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflowWrap: "anywhere" }}>{cardLine(c)}</span>
      </div>
      {(area || note) && <div style={{ fontSize: 13, color: BETA.muted, overflowWrap: "anywhere" }}>{[area, note].filter(Boolean).join(" · ")}</div>}
      <MediaRow items={c.items.map(asMedia)} label={`Photos: ${c.title}`} />
    </li>
  );
}

export function BetaSiteTab({ projectId, today, canWrite, onDone }: BetaTabProps): ReactElement {
  const q = useQuery(["renovation-beta", "photos", projectId], () => betaMediaApi.photos(projectId), [projectId]);
  const [filter, setFilter] = useState<PhotoFilter>("all");
  const [area, setArea] = useState("");
  const [adding, setAdding] = useState(false);
  const photos = useMemo(() => q.data?.photos ?? [], [q.data]);
  const counts = countBy(photos);
  const areas = photoAreas(q.data?.areas ?? [], photos);
  const shown = filterPhotos(photos, filter, area);
  const days = photoTimeline(shown);

  return (
    <>
      <WsPageHead
        title="Site & photos"
        sub="Every photo and video of the project, newest first: the site team's progress, deliveries, receipts, the site measure and defects"
        right={canWrite ? <button type="button" onClick={() => setAdding(true)} style={btnStyle("teal", "lg")}><Camera size={16} aria-hidden="true" />Add photos</button> : undefined}
      />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div role="group" aria-label="Show" style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: "1 1 320px", minWidth: 0 }}>
          {photoFilters(photos).map((f) => (
            <WsFilterPill key={f} on={filter === f} onClick={() => setFilter(f)}>
              <span style={{ whiteSpace: "nowrap" }}>{f === "all" ? "All" : CATEGORY_CHIP[f]} <span style={{ opacity: 0.7 }}>{counts[f]}</span></span>
            </WsFilterPill>
          ))}
        </div>
        {areas.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: BETA.muted, flex: "0 1 240px" }}>
            Area
            <select aria-label="Filter by area" style={{ ...inputStyle, minHeight: 36 }} value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All areas</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}
      </div>

      {q.loading && !q.data ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading photos...</p>
        : q.error && !q.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The photos could not be loaded: {q.error}</p>
        : shown.length === 0 ? (
          <WsEmpty>{photos.length === 0 ? "No photos yet. Progress photos, PODs, goods receipts, the site measure and defects all show here." : "No photos match this filter."}</WsEmpty>
        ) : (
          <ol aria-label="Photo timeline" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 18 }}>
            {days.map((d) => (
              <li key={d.day ?? "undated"} style={{ position: "relative", paddingLeft: 26 }}>
                <span aria-hidden="true" style={{ position: "absolute", left: 7, top: 22, bottom: -18, width: 2, background: BETA.line }} />
                <span aria-hidden="true" style={{ position: "absolute", left: 1, top: 6, width: 14, height: 14, borderRadius: 7, background: d.day === today ? BETA.accent : BETA.surface, border: `2px solid ${BETA.accent}` }} />
                <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700 }}>{d.day ? dayTitle(d.day, today) : "No date"}</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {d.cards.map((c, i) => <EventCard key={`${c.key}-${i}`} c={c} />)}
                </ul>
              </li>
            ))}
          </ol>
        )}

      {adding && q.data && (
        <PhotoUploadDialog projectId={projectId} docs={q.data.docs} tasks={q.data.tasks} areas={q.data.areas}
          onClose={() => setAdding(false)} onDone={(t) => { setAdding(false); onDone(t); q.reload(); }} />
      )}
    </>
  );
}
