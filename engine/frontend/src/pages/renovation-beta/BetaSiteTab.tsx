/* Beta workspace > Site & photos (owner, 24 Oct 2026): one vertical timeline of every photo and video of the project,
   newest first to the minute, drawn like the Overview's Site progress card: the day and time on the left, a dot on a
   line, and on the right the event (one DO's POD, one GR's receipt photos, one defect's before / after, one upload of
   progress photos, one production order's photos of one day) with its category chip and its media as one strip of equal
   tiles. Production Order photos, DO PODs and GR photos come in by themselves from those documents (GET /photos), nothing
   is uploaded twice. Category chips with counts filter it, and an area filter narrows it further. A document with no
   photo yet is named by source under the list. "Add photos" opens on Progress. */

import { useMemo, useState, type ReactElement } from "react";
import { Camera } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { MediaStrip } from "./BetaMedia";
import { PhotoUploadDialog } from "./BetaPhotoUpload";
import { WS, WsEmpty, WsFilterPill, WsPageHead, btnStyle, inputStyle } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { asMedia, betaMediaApi, type EmptySources, type PhotoCategory } from "./renovationBetaMediaApi";
import {
  CATEGORY_CHIP, cardLine, clockOf, countBy, dayTitle, emptyMessage, emptySourceLines, mediaCount, filterPhotos, photoAreas, photoFilters, photoTimeline, type PhotoCard, type PhotoFilter,
} from "./renovationBetaPhotosModel";
import { BETA, TONES, type BetaTone } from "./renovationBetaTheme";
import { BetaLoading } from "./BetaLoading";

/* One accent per category, from the Beta palette: teal for the site team, blue for deliveries, amber for defects. */
export const CATEGORY_TONE: Readonly<Record<PhotoCategory, BetaTone>> = {
  progress: [BETA.accent, TONES.accent.soft],
  production: [WS.amber, TONES.amber.soft],
  do: [WS.blue, TONES.grey.soft],
  gr: [WS.blue, TONES.grey.soft],
  po: [WS.text2, WS.chip],
  measure: [WS.text2, WS.chip],
  defect: [WS.amber, TONES.amber.soft],
};

function CategoryChip({ c }: { c: PhotoCategory }): ReactElement {
  const [ink, bg] = CATEGORY_TONE[c];
  return <span style={{ flex: "none", padding: "2px 8px", borderRadius: 6, background: bg, color: ink, fontSize: 12, fontWeight: 700 }}>{CATEGORY_CHIP[c]}</span>;
}

/** The left column: the day on the first event of each day, then the time of every event. */
function EventRow({ c, day, today, last }: { c: PhotoCard; day: string | null | undefined; today: string; last: boolean }): ReactElement {
  const area = [...new Set(c.items.map((i) => i.area).filter(Boolean))].join(", ");
  const note = c.items.find((i) => i.note)?.note ?? null;
  const isToday = day === today;
  return (
    <li aria-label={cardLine(c)} style={{ display: "grid", gridTemplateColumns: "72px 18px minmax(0, 1fr)", columnGap: 10 }}>
      <div style={{ padding: last ? "0" : "0 0 18px", fontSize: 13, color: BETA.muted, lineHeight: 1.35 }}>
        {day !== undefined && (day ? dayTitle(day, today).split(" · ") : ["No date"]).map((t) => <div key={t} style={{ fontWeight: 700, color: isToday ? BETA.accentInk : BETA.ink }}>{t}</div>)}
        <div>{clockOf(c.at) ?? ""}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span aria-hidden="true" style={{ flex: "none", marginTop: 3, width: 12, height: 12, borderRadius: 6, background: day !== undefined ? BETA.accent : BETA.surface, border: `2px solid ${BETA.accent}` }} />
        {!last && <span aria-hidden="true" style={{ flex: 1, width: 2, background: BETA.line }} />}
      </div>
      <div style={{ padding: last ? 0 : "0 0 18px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <CategoryChip c={c.category} />
          <span style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere", minWidth: 0 }}>{c.title}</span>
        </div>
        <div style={{ fontSize: 13, color: BETA.muted, overflowWrap: "anywhere" }}>{[c.label, mediaCount(c.items), area, note].filter(Boolean).join(" · ")}</div>
        <MediaStrip items={c.items.map(asMedia)} label={`Photos: ${c.title}`} size={88} max={8} />
      </div>
    </li>
  );
}

/** The documents still without a photo, one short line per source. */
function NoPhotoNote({ lines }: { lines: readonly string[] }): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <div style={{ fontSize: 13, color: BETA.muted, lineHeight: 1.5, overflowWrap: "anywhere" }}>
      <div style={{ fontWeight: 700 }}>No photos yet on</div>
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>
  );
}

const NO_EMPTY: EmptySources = { production: [], do: [], gr: [], po: [] };

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
  // undefined day = same day as the event above, so the left column names each day once.
  const events = days.flatMap((d) => d.cards.map((c, i) => ({ c, day: i === 0 ? d.day : undefined })));
  const empty = q.data?.empty ?? NO_EMPTY;
  const noPhoto = emptySourceLines(empty, filter);
  const addButton = canWrite ? <button type="button" onClick={() => setAdding(true)} style={btnStyle("teal", "lg")}><Camera size={16} aria-hidden="true" />Add photos</button> : null;

  return (
    <>
      <WsPageHead
        title="Site & photos"
        sub="Every photo and video of the project, newest first: the site team's progress, production, deliveries, receipts, the site measure and defects"
        right={addButton ?? undefined}
      />

      {photos.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div role="group" aria-label="Show" style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: "1 1 320px", minWidth: 0 }}>
          {photoFilters(photos, empty).map((f) => (
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
      </div>}

      {q.loading && !q.data ? <BetaLoading label="Loading photos" size="inline" />
        : q.error && !q.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The photos could not be loaded: {q.error}</p>
        : shown.length === 0 ? (
          <WsEmpty>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <span>{emptyMessage(filter, area, photos.length > 0)}</span>
              {area ? <button type="button" onClick={() => setArea("")} style={btnStyle("outline", "md")}>Show all areas</button>
                : (filter === "all" || filter === "progress") && addButton}
              <NoPhotoNote lines={area ? [] : noPhoto} />
            </div>
          </WsEmpty>
        ) : (
          <>
            <ol className="stag" aria-label="Photo timeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {events.map((e, i) => <EventRow key={`${e.c.key}-${i}`} c={e.c} day={e.day} today={today} last={i === events.length - 1} />)}
            </ol>
            <NoPhotoNote lines={noPhoto} />
          </>
        )}

      {adding && q.data && (
        <PhotoUploadDialog projectId={projectId} initial={{ kind: "progress" }} docs={q.data.docs} tasks={q.data.tasks} areas={q.data.areas}
          onClose={() => setAdding(false)} onDone={(t) => { setAdding(false); onDone(t); q.reload(); }} />
      )}
    </>
  );
}
