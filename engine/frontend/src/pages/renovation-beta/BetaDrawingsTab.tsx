/* Beta workspace > Drawings, laid out as the owner's mockup (24 Oct 2026): a row of upload actions, the three sections
   (2D, 3D, Site measure) with their status, and under them the one picked: the new revision waiting for the client
   with its three steps, what changed, the set as sheet pictures marked Changed / Same against the approved set, the
   "For site" bar and the two set uploads; the approved set; or the history. 3D is a set of named link cards. Sending
   and approval write through /api/beta; the upload boxes open the dialogs in BetaDrawingUploads.tsx. */

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useDialog } from "../../hooks/useDialog";
import { useQuery } from "../../hooks/useQuery";
import { addDays, errorText } from "../projects/renovation/renovationModel";
import { simpleApi, type DesignFile, type DesignNote, type SiteMeasure } from "../projects/renovation/simpleApi";
import {
  TONE_DONE, TONE_QUIET, TONE_WAIT, WS, WsBadge, WsBtn, WsCheck, WsDialog, WsField, WsPdfTile, WsPhoto, btnStyle, cardStyle, inputStyle, textareaStyle
} from "./BetaWsUi";
import { BetaUploadDialog, type UploadDialog } from "./BetaDrawingUploads";
import { FileDialog, sendReminder, useGuarded, type BetaTabProps, type ViewedFile } from "./betaShared";
import { betaApi } from "./renovationBetaApi";
import { approvedSet, dayMonth, dayMonthYear, daysLeft, versionLabel, whatsappLink, type ApprovedSet, type DesignKind, type VersionInfo } from "./renovationBetaModel";
import { downloadAsPdf, type PdfPart, type TitleBlock } from "./renovationBetaPdf";
import { changedAgainst, removedSheetsOf, sheetSetAt, sheetsApi, sizeText, type BetaSheet, type SetSheet } from "./renovationBetaSheets";
import { CompareDialog, LinkCards, RemovedList, SheetGrid, type SheetGridEdit } from "./BetaDrawingSheets";
import { getBrandingCache } from "../../lib/branding";
import { BETA } from "./renovationBetaTheme";

type DrawPick = "m" | DesignKind;
type View = "waiting" | "approved" | "history";
type Editing = { type: "send" | "approve"; kind: DesignKind; v: VersionInfo };

const submittedOf = (f: DesignFile): string => f.submitted_on ?? f.uploaded_at;
const picNames = (f: DesignFile): string => (f.people?.length ? f.people.map((x) => x.name).join(", ") : f.person_name ?? f.uploaded_by_name ?? "-");
const IMAGE = /\.(png|jpe?g|webp|gif|heic)$/i;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export function BetaDrawingsTab(p: BetaTabProps): ReactElement {
  const { records, workspace } = p;
  const sets = { "3d": approvedSet(records.files, workspace.reviews, "3d"), "2d": approvedSet(records.files, workspace.reviews, "2d") };
  const [pick, setPick] = useState<DrawPick>(() => (sets["2d"].waiting ? "2d" : sets["3d"].waiting ? "3d" : sets["2d"].versions.length > 0 ? "2d" : sets["3d"].versions.length > 0 ? "3d" : "m"));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  const [uploading, setUploading] = useState<UploadDialog | null>(null);
  const sheetsQ = useQuery(["renovation-beta", "sheets", p.projectId], () => sheetsApi.list(p.projectId), [p.projectId]);
  // Only a server that says so falls back to one-file 2D; while the list loads the 2D set upload is offered, or a click
  // in that moment opened the one-file form and kept just the first of several sheets.
  const sheetsReady = sheetsQ.data?.ready ?? true;
  const canLink = sheetsQ.data?.canLink ?? false;
  const sheets = sheetsQ.data?.sheets ?? [];
  const openFile = (f: DesignFile): void => {
    if (f.external_url) window.open(f.external_url, "_blank", "noopener");
    else if (f.r2_key) setViewing({ key: f.r2_key, name: f.file_name });
  };
  // The card speaks for the newest measure, the same one shown first below.
  const measureDone = records.measures.filter((m) => m.done_on).sort((a, b) => (b.done_on ?? "").localeCompare(a.done_on ?? "") || b.id - a.id);
  const measureFiles = measureDone[0]?.files?.length ?? 0;
  const upload = p.canWrite ? setUploading : null;
  const uploaded = (text: string, failed?: string): void => {
    const d = uploading;
    setUploading(null);
    setPick(d?.t === "file" ? d.kind : d?.t === "link" || d?.t === "links" ? "3d" : d?.t === "sheets" ? "2d" : "m");
    sheetsQ.reload();
    p.onDone(text);
    if (failed) p.onError(`${text} ${failed}`);
  };
  const countOf = (kind: DesignKind): string => {
    const v = sets[kind].waiting ?? sets[kind].approved;
    if (!v) return "";
    const n = sheetSetAt(records.files, sheets, v.file.version, kind).length;
    return n ? ` · ${plural(n, kind === "2d" ? "sheet" : "link")}` : "";
  };
  const actions: UploadLink[] = upload ? [
    { label: "Upload PDF / photos", onClick: () => upload({ t: "measure" }) },
    { label: "Upload 3D PDF", onClick: () => upload({ t: "file", kind: "3d" }) },
    { label: "Add 3D link", onClick: () => upload(canLink ? { t: "links" } : { t: "link" }) },
    { label: "Upload 2D PDF", onClick: () => upload(sheetsReady ? { t: "sheets", mode: "full" } : { t: "file", kind: "2d" }) },
  ] : [];

  return (
    <>
      {actions.length > 0 && <UploadRow uploads={actions} />}
      <div role="group" aria-label="Drawing type" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {(["2d", "3d"] as const).map((kind) => (
          <TypeCard
            key={kind} on={pick === kind} onPick={() => setPick(kind)} icon={kind} title={kind === "2d" ? "2D drawings" : "3D design"}
            badge={kindBadge(sets[kind])} sub={`${kindSub(kind, sets[kind])}${countOf(kind)}`}
          />
        ))}
        <TypeCard
          on={pick === "m"} onPick={() => setPick("m")} icon="m" title="Site measure"
          badge={measureDone.length > 0 ? <WsBadge tone={TONE_DONE}>Done</WsBadge> : <WsBadge tone={TONE_QUIET}>Not measured</WsBadge>}
          sub={measureDone.length > 0 ? `Measured ${dayMonth(measureDone[0]?.done_on)} · ${plural(measureFiles, "file")}` : "No site measure recorded yet"}
        />
      </div>

      {pick === "m" ? <MeasureDetail measures={records.measures} projectId={p.projectId} onView={setViewing} onUpload={upload} onError={p.onError} />
        // Keyed on the version count too, so a new upload opens on its own "New revision" view.
        : <KindDetail key={`${pick}-${sets[pick].versions.length}`} kind={pick} p={p} set={sets[pick]} onEdit={(type, v) => setEditing({ type, kind: pick, v })} onOpen={openFile} onUpload={upload}
          sheets={sheets} sheetsReady={sheetsReady} canRemoveSheets={sheetsQ.data?.canRemove ?? false} canLink={canLink} onSheetsChanged={sheetsQ.reload} onView={setViewing} />}

      {editing?.type === "send" && <SendDialog p={p} editing={editing} onClose={() => setEditing(null)} />}
      {editing?.type === "approve" && <ApproveDialog p={p} editing={editing} onClose={() => setEditing(null)} />}
      {viewing && <FileDialog projectId={p.projectId} file={viewing} onClose={() => setViewing(null)} />}
      {uploading && <BetaUploadDialog p={p} dialog={uploading} sheets={sheets} onClose={() => setUploading(null)} onSaved={uploaded} />}
    </>
  );
}

/* ---------- The section cards ---------- */

function kindBadge(set: ApprovedSet): ReactElement {
  if (set.waiting) return <WsBadge tone={TONE_WAIT}>{set.waiting.review?.sentOn ? "Sent · waiting" : "Draft"}</WsBadge>;
  if (set.approved) return <WsBadge tone={TONE_DONE}>Approved</WsBadge>;
  return <WsBadge tone={TONE_QUIET}>No version</WsBadge>;
}

function kindSub(kind: DesignKind, set: ApprovedSet): string {
  if (set.versions.length === 0) return `No ${kind.toUpperCase()} version uploaded yet`;
  const parts: string[] = [];
  if (set.waiting) {
    const sentOn = set.waiting.review?.sentOn;
    parts.push(sentOn ? `${versionLabel(kind, set.waiting.file)} sent ${dayMonth(sentOn)}` : `${versionLabel(kind, set.waiting.file)} uploaded ${dayMonth(submittedOf(set.waiting.file))}`);
  }
  if (set.approved) parts.push(`${set.waiting ? "site uses" : "Approved"} ${versionLabel(kind, set.approved.file)} (${dayMonth(set.approved.review?.approvedOn)})`);
  return parts.join(" · ");
}

interface UploadLink { label: string; onClick: () => void }

function UploadRow({ uploads }: { uploads: UploadLink[] }): ReactElement {
  return (
    <div role="group" aria-label="Upload" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      {uploads.map((u) => (
        <button
          key={u.label}
          type="button"
          onClick={u.onClick}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, padding: "0 12px", borderRadius: 10, border: `1.5px dashed ${BETA.focus}`, background: WS.tealSoft, color: BETA.accentInk, font: "inherit", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
        >
          {/link/i.test(u.label)
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" /></svg>}
          {u.label}
        </button>
      ))}
    </div>
  );
}

function TypeCard({ on, onPick, icon, title, badge, sub }: { on: boolean; onPick: () => void; icon: DrawPick; title: string; badge: ReactElement; sub: string }): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      style={{ display: "flex", flexDirection: "column", gap: 6, padding: on ? 13 : 14, borderRadius: 12, border: on ? `2px solid ${BETA.accent}` : `1px solid ${BETA.line}`, background: on ? WS.tealSoft : BETA.surface, font: "inherit", textAlign: "left", cursor: "pointer", color: BETA.ink }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ flex: "none", width: 34, height: 34, borderRadius: 8, background: WS.chip, display: "flex", alignItems: "center", justifyContent: "center" }}><TypeIcon kind={icon} /></span>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
        </span>
        {badge}
      </span>
      <span style={{ fontSize: 13, color: BETA.muted }}>{sub}</span>
    </button>
  );
}

function TypeIcon({ kind }: { kind: DrawPick }): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BETA.ink} strokeWidth="1.8" aria-hidden="true">
      {kind === "m" ? <><path d="M3 17L17 3l4 4L7 21H3z" /><path d="M14 6l2 2M11 9l2 2M8 12l2 2" /></>
        : kind === "3d" ? <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>
        : <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 10h8v11M11 14h10" /></>}
    </svg>
  );
}

/* ---------- Site measurement ---------- */

const sectionStyle: CSSProperties = { ...cardStyle, gap: 18 };
const eyebrow: CSSProperties = { fontSize: 12, color: BETA.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" };
const boxStyle: CSSProperties = { border: `1px solid ${BETA.line}`, borderRadius: 10, overflow: "hidden" };

function MeasureDetail({ measures, projectId, onView, onUpload, onError }: {
  measures: SiteMeasure[]; projectId: number; onView: (f: ViewedFile) => void; onUpload: ((d: UploadDialog) => void) | null; onError: (t: string) => void;
}): ReactElement {
  const list = [...measures].sort((a, b) => (b.done_on ?? "").localeCompare(a.done_on ?? "") || b.id - a.id);
  if (list.length === 0) {
    return (
      <section style={sectionStyle}>
        <div style={eyebrow}>Site measurement</div>
        <p style={{ fontSize: 14, color: BETA.muted }}>No site measure has been recorded yet.</p>
        {onUpload && <WsBtn kind="teal" style={{ alignSelf: "flex-start" }} onClick={() => onUpload({ t: "measure" })}>Record site measure</WsBtn>}
      </section>
    );
  }
  return (
    <>
      {list.map((m) => {
        const files = m.files ?? [];
        const isPhoto = (f: (typeof files)[number]): boolean => IMAGE.test(f.r2_key) || (f.content_type ?? "").startsWith("image/");
        const photos = files.filter(isPhoto);
        const docs = files.filter((f) => !isPhoto(f));
        const names = m.people?.length ? m.people.map((x) => x.name).join(", ") : m.person_name;
        return (
          <section key={m.id} aria-label={`Site measurement ${dayMonthYear(m.done_on)}`} style={sectionStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={eyebrow}>Site measurement</div>
                <h2 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700 }}>
                  {m.done_on ? dayMonthYear(m.done_on) : "Not dated"} <span style={{ fontSize: 14, fontWeight: 600, color: m.done_on ? WS.green : WS.amber }}>· {m.done_on ? "done" : "not done yet"}</span>
                </h2>
                <div style={{ color: BETA.muted, fontSize: 14 }}>{names ? `Measured by ${names} · ` : ""}{plural(files.length, "file")}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {files.length > 0 && (
                  <PdfButton projectId={projectId} onError={onError} outName={`Site measure ${m.done_on ?? m.id}.pdf`} label="Download all"
                    parts={files.map((f) => ({ key: f.r2_key, fileName: f.file_name }))} />
                )}
                {onUpload && <WsBtn size="sm" onClick={() => onUpload({ t: "measure-files", measure: m })}>Add files<span className="sr"> to the site measure of {dayMonthYear(m.done_on)}</span></WsBtn>}
              </div>
            </div>
            {docs.length > 0 && (
              <div style={boxStyle}>
                <div style={{ padding: "12px 16px", background: WS.head, fontWeight: 600 }}>Measurement files</div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {docs.map((f) => (
                    <li key={f.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: `1px solid ${WS.rowLine}` }}>
                      <WsPdfTile />
                      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{f.file_name}</div>
                        <div style={{ fontSize: 12, color: BETA.muted }}>{f.content_type ?? "File"}</div>
                      </div>
                      <WsBtn kind="teal" size="sm" onClick={() => onView({ key: f.r2_key, name: f.file_name })}>Open<span className="sr"> {f.file_name}</span></WsBtn>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {photos.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: BETA.muted, fontWeight: 600, marginBottom: 8 }}>Site photos</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                  {photos.map((f) => (
                    <div key={f.id} style={{ aspectRatio: "4 / 3", borderRadius: 8, overflow: "hidden", position: "relative" }}>
                      <WsPhoto path={simpleApi.fileUrl(projectId, f.r2_key)} alt={`Site measure photo ${f.file_name}`} onClick={() => onView({ key: f.r2_key, name: f.file_name })} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {m.note && (
              <div style={{ background: WS.panel, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: BETA.muted, fontWeight: 600, marginBottom: 4 }}>Site notes</div>
                <div style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{m.note}</div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

/* ---------- 3D and 2D ---------- */

function KindDetail({ kind, p, set, onEdit, onOpen, onUpload, sheets, sheetsReady, canRemoveSheets, canLink, onSheetsChanged, onView }: {
  kind: DesignKind; p: BetaTabProps; set: ApprovedSet; onEdit: (type: "send" | "approve", v: VersionInfo) => void; onOpen: (f: DesignFile) => void; onUpload: ((d: UploadDialog) => void) | null;
  sheets: readonly BetaSheet[]; sheetsReady: boolean; canRemoveSheets: boolean; canLink: boolean; onSheetsChanged: () => void; onView: (f: ViewedFile) => void;
}): ReactElement {
  const dialog = useDialog();
  const { busy, run } = useGuarded();
  const { records, canWrite, projectId, detail } = p;
  const { approved, waiting } = set;
  const [picked, setView] = useState<View>(waiting ? "waiting" : approved ? "approved" : "history");
  const [comparing, setComparing] = useState(false);
  // After a save the picked view can be gone (the waiting version was just approved), so fall back to what exists.
  const view: View = picked === "waiting" && !waiting ? (approved ? "approved" : "history") : picked === "approved" && !approved ? (waiting ? "waiting" : "history") : picked;
  const notes = records.notes.filter((n) => n.kind === kind).sort((a, b) => b.noted_on.localeCompare(a.noted_on) || b.id - a.id);
  const K = kind.toUpperCase();
  const is2d = kind === "2d";
  const setOf = (v: VersionInfo | null): SetSheet[] => (v ? sheetSetAt(records.files, sheets, v.file.version, kind) : []);
  const approvedSet = setOf(approved);
  const editOf = (): SheetGridEdit | null => (canWrite && canRemoveSheets && onUpload
    ? { kind, onReplace: (name) => onUpload({ t: "sheets", mode: "replace", sheet: name }), onChanged: onSheetsChanged, onDone: p.onDone }
    : null);
  const unit = [detail.project.building, detail.project.unit_no].filter(Boolean).join(" ") || null;
  const versionDate = new Map(records.files.filter((f) => f.kind === kind).map((f) => [f.version, dayMonthYear(submittedOf(f))]));
  const statusOf = (v: VersionInfo): string => (v.review?.approvedOn
    ? `Approved by client ${dayMonthYear(v.review.approvedOn)}`
    : v.review?.sentOn ? `Sent ${dayMonthYear(v.review.sentOn)}, waiting for approval` : "Not sent to client yet");
  const partsOf = (v: VersionInfo): PdfPart[] => setOf(v).filter((x) => x.key).map((x) => ({
    key: x.key ?? "", fileName: x.fileName,
    block: {
      company: getBrandingCache().companyName, project: detail.project.name, unit, sheet: x.name,
      version: x.version === v.file.version ? `V${x.version}` : `Set V${v.file.version} · sheet V${x.version}`,
      date: versionDate.get(x.version) ?? "", status: statusOf(v),
    },
  }));
  const pdfName = (v: VersionInfo): string => `${detail.project.name} ${K} V${v.file.version}.pdf`;
  const setSize = (v: VersionInfo): string | null => sizeText(setOf(v).reduce((n, x) => n + (x.size ?? 0), 0));

  async function removeApproval(v: VersionInfo): Promise<void> {
    const label = versionLabel(kind, v.file);
    const ok = await dialog.confirm({ title: `Remove the approval of ${label}?`, message: "The version goes back to waiting for the client. The checklist item stays as it is.", confirmLabel: "Remove approval", danger: true });
    if (!ok) return;
    try {
      await betaApi.removeApproval(v.file.id);
      p.onDone(`Approval of ${label} removed.`);
    } catch (e) {
      p.onError(errorText(e));
    }
  }

  if (set.versions.length === 0) {
    return (
      <section style={sectionStyle}>
        <div style={eyebrow}>{K} drawings</div>
        <p style={{ fontSize: 14, color: BETA.muted }}>No {K} version has been uploaded yet.</p>
        {onUpload && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {kind === "3d" && <WsBtn kind="teal" onClick={() => onUpload(canLink ? { t: "links" } : { t: "link" })}>Add 3D links</WsBtn>}
            {kind === "3d" && <WsBtn onClick={() => onUpload({ t: "file", kind })}>Upload 3D PDF</WsBtn>}
            {is2d && (sheetsReady
              ? <WsBtn kind="teal" onClick={() => onUpload({ t: "sheets", mode: "full" })}>Upload 2D set</WsBtn>
              : <WsBtn kind="teal" onClick={() => onUpload({ t: "file", kind })}>Upload 2D PDF</WsBtn>)}
          </div>
        )}
      </section>
    );
  }

  const shown = view === "waiting" && waiting ? waiting : view === "approved" && approved ? approved : null;
  const sentOn = waiting?.review?.sentOn ?? null;
  const head = view === "history" || !shown ? "All versions" : view === "waiting" ? "New revision" : "Approved set";
  const suffix = view === "waiting" ? (sentOn ? "· waiting for client" : "· not sent yet") : view === "approved" ? `· client approved ${dayMonth(approved?.review?.approvedOn)}` : "";
  const suffixColor = view === "waiting" ? WS.amber : WS.green;
  const shownSet = setOf(shown);
  const changed = view === "waiting" && approved ? changedAgainst(shownSet, approvedSet) : null;
  const word = is2d ? "sheet" : "link";
  const shownSize = shown ? setSize(shown) : null;
  const shareSite = (): void => {
    if (!approved) return;
    const link = `${window.location.origin}/beta/projects/${projectId}?tab=drawings`;
    const text = `${detail.project.name}: the 2D set to build from is ${versionLabel("2d", approved.file)} (client approved ${dayMonthYear(approved.review?.approvedOn)}, ${plural(approvedSet.length, "sheet")}). Open it here: ${link}`;
    window.open(whatsappLink(null, text), "_blank", "noopener");
  };
  const grid = (v: VersionInfo, marks: Map<string, boolean> | null): ReactElement => (is2d
    ? <SheetGrid projectId={projectId} sheets={setOf(v)} changed={marks} onView={onView} onError={p.onError} edit={editOf()} />
    : <LinkCards projectId={projectId} links={setOf(v)} changed={marks} onView={onView} onError={p.onError} edit={editOf()} />);

  return (
    <section aria-label={`${K} drawings`} style={sectionStyle}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrow}>{is2d ? "2D drawings" : "3D design"}</div>
          <h2 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 700 }}>{head} {suffix && <span style={{ fontSize: 15, fontWeight: 600, color: suffixColor }}>{suffix}</span>}</h2>
          {shown && (
            <div style={{ color: BETA.muted }}>
              Uploaded {dayMonthYear(submittedOf(shown.file))}{picNames(shown.file) !== "-" ? ` by ${picNames(shown.file)}` : ""} · {plural(shownSet.length, word)}{shownSize ? ` · ${shownSize}` : ""}
            </div>
          )}
          {!shown && <div style={{ color: BETA.muted }}>{plural(set.versions.length, "version")}</div>}
        </div>
        {shown && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {view === "waiting" && approved && <WsBtn size="sm" onClick={() => setComparing(true)}>Compare with approved set</WsBtn>}
            {partsOf(shown).length > 0 && <PdfButton projectId={projectId} parts={partsOf(shown)} outName={pdfName(shown)} label="Download" onError={p.onError} />}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ color: BETA.muted }}>Show:</span>
        {waiting && <ShowPill on={view === "waiting"} onClick={() => setView("waiting")}>{`New revision · ${sentOn ? "waiting client" : "not sent"}`}</ShowPill>}
        {approved && <ShowPill on={view === "approved"} onClick={() => setView("approved")}>{is2d ? "Approved set · site uses this" : "Approved set"}</ShowPill>}
        <ShowPill on={view === "history"} onClick={() => setView("history")} quiet>History</ShowPill>
      </div>

      {view === "waiting" && waiting && (
        <WaitingView kind={kind} v={waiting} p={p} busy={busy} onEdit={onEdit} newSet={shownSet} hasApproved={approved != null}
          onRemind={() => void run(() => sendReminder(projectId, {
            kind: "client_approval",
            phone: detail.project.customer_phone,
            text: `Hi${detail.project.customer_name ? ` ${detail.project.customer_name}` : ""}, a gentle reminder about the ${versionLabel(kind, waiting.file)} drawing for ${detail.project.name}, sent on ${dayMonthYear(sentOn)}. Please let us know if you approve it${waiting.review?.dueOn ? ` by ${dayMonthYear(waiting.review.dueOn)}` : ""}. Thank you.`,
          }, p.onDone, p.onError))} />
      )}
      {view === "waiting" && waiting && grid(waiting, changed)}

      {view === "approved" && approved && (
        <>
          <div style={{ border: "1.5px solid #B7DCC3", background: "#F1F8F3", borderRadius: 10, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: WS.green }}>Client approved · {dayMonth(approved.review?.approvedOn)}</div>
              <div style={{ fontSize: 13, color: WS.text2 }}>{approved.review?.approvedByName ? `Approved by ${approved.review.approvedByName}` : "Approval recorded"}</div>
              {approved.review?.approvalNote && <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>{approved.review.approvalNote}</div>}
            </div>
            {canWrite && <WsBtn kind="danger" size="sm" disabled={busy} onClick={() => void run(() => removeApproval(approved))}>Remove approval<span className="sr"> of {versionLabel(kind, approved.file)}</span></WsBtn>}
          </div>
          {grid(approved, null)}
        </>
      )}

      {(view === "waiting" || view === "approved") && approved && is2d && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: WS.tealSoft, border: `1.5px solid ${WS.tealLine}` }}>
          <span style={{ padding: "4px 10px", borderRadius: 6, background: BETA.accent, color: "#FFFFFF", fontSize: 12, fontWeight: 600 }}>For site</span>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{pdfName(approved)}</div>
            <div style={{ fontSize: 13, color: WS.text2 }}>
              Site is using this set now · client signed {dayMonthYear(approved.review?.approvedOn)} · {plural(approvedSet.length, "sheet")}{setSize(approved) ? ` · ${setSize(approved)}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <WsBtn size="sm" onClick={shareSite}>Share with site team</WsBtn>
            {partsOf(approved).length > 0 && <PdfButton projectId={projectId} parts={partsOf(approved)} outName={pdfName(approved)} label="Download" onError={p.onError} />}
          </div>
        </div>
      )}

      {view === "history" && (
        <div style={boxStyle}>
          <div style={{ padding: "12px 16px", background: WS.head, fontWeight: 600 }}>All versions</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {set.versions.map((v) => {
              const state = v === approved ? "Approved" : v === waiting ? (v.review?.sentOn ? "Sent, waiting" : "Not sent") : "Older";
              const own = sheets.filter((s) => s.fileId === v.file.id);
              return (
                <li key={v.file.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: `1px solid ${WS.rowLine}` }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{versionLabel(kind, v.file)} <span style={{ fontWeight: 400, color: BETA.muted }}>· {dayMonth(submittedOf(v.file))} · {picNames(v.file)}</span></div>
                    {own.length > 0 && <div style={{ fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{own.map((s) => s.name).join(", ")}</div>}
                    {v.file.note && <div style={{ fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{v.file.note}</div>}
                  </div>
                  <WsBadge tone={v === approved ? TONE_DONE : v === waiting ? TONE_WAIT : TONE_QUIET}>{state}</WsBadge>
                  {own.length === 0 && <WsBtn size="sm" onClick={() => onOpen(v.file)}>Open<span className="sr"> {versionLabel(kind, v.file)}</span></WsBtn>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canWrite && canRemoveSheets && (
        <RemovedList projectId={projectId} removed={removedSheetsOf(records.files, sheets, kind)} kind={kind} onView={onView}
          onChanged={onSheetsChanged} onDone={p.onDone} onError={p.onError} />
      )}

      {onUpload && is2d && sheetsReady && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <BigUpload title="Replace changed pages" sub="Upload only the pages you changed. The rest are kept from the set." onClick={() => onUpload({ t: "sheets", mode: "replace" })} strong />
          <BigUpload title="Upload full set" sub="First time, or when the whole set is redrawn." onClick={() => onUpload({ t: "sheets", mode: "full" })} />
        </div>
      )}
      {onUpload && !is2d && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <BigUpload title="Add 3D links" sub="One or more named links. A link with the same name replaces the old one." onClick={() => onUpload(canLink ? { t: "links" } : { t: "link" })} strong />
          <BigUpload title="Upload 3D PDF / render" sub="A rendered image or PDF of the 3D." onClick={() => onUpload({ t: "file", kind })} />
        </div>
      )}
      {notes.length > 0 && <NotesList kind={kind} notes={notes} files={records.files} />}
      {comparing && <CompareDialog projectId={projectId} next={shownSet} approved={approvedSet} onClose={() => setComparing(false)} />}
    </section>
  );
}

function BigUpload({ title, sub, onClick, strong = false }: { title: string; sub: string; onClick: () => void; strong?: boolean }): ReactElement {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "14px 16px", borderRadius: 10, border: `1.5px dashed ${strong ? BETA.accent : BETA.border}`,
        background: strong ? WS.tealSoft : BETA.surface, font: "inherit", textAlign: "left", cursor: "pointer", color: BETA.ink }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: strong ? BETA.accentInk : BETA.ink }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" /></svg>
        {title}
      </span>
      <span style={{ fontSize: 13, color: WS.text2 }}>{sub}</span>
    </button>
  );
}

function ShowPill({ on, onClick, quiet = false, children }: { on: boolean; onClick: () => void; quiet?: boolean; children: ReactNode }): ReactElement {
  const style: CSSProperties = on
    ? { padding: "6px 10px", borderRadius: 6, border: `2px solid ${BETA.accent}`, background: WS.tealSoft, color: BETA.accentInk, fontWeight: 700 }
    : quiet ? { padding: "6px 10px", border: "2px solid transparent", background: "transparent", color: BETA.muted, textDecoration: "underline" }
    : { padding: "6px 10px", borderRadius: 6, border: `1px solid ${BETA.line}`, background: BETA.surface, color: BETA.ink };
  return <button type="button" aria-pressed={on} onClick={onClick} style={{ ...style, font: "inherit", fontSize: 13, cursor: "pointer" }}>{children}</button>;
}

function WaitingView({ kind, v, p, busy, onEdit, onRemind, newSet, hasApproved }: {
  kind: DesignKind; v: VersionInfo; p: BetaTabProps; busy: boolean; onEdit: (type: "send" | "approve", v: VersionInfo) => void; onRemind: () => void;
  newSet: SetSheet[]; hasApproved: boolean;
}): ReactElement {
  const { canWrite, today, detail } = p;
  const sentOn = v.review?.sentOn ?? null;
  const dueOn = v.review?.dueOn ?? null;
  const left = daysLeft(dueOn, today);
  const late = left != null && left < 0;
  const is2d = kind === "2d";
  const word = is2d ? "page" : "link";
  // What this version itself brought: its own sheets or links (a one-file version is one).
  const own = newSet.filter((s) => s.version === v.file.version);
  const ownText = own.length ? `${plural(own.length, word)}: ${own.map((s) => s.name).join(", ")}` : versionLabel(kind, v.file);
  const card = (border: string, bg: string, pad: number): CSSProperties => ({ position: "relative", border, background: bg, borderRadius: 10, padding: pad, display: "flex", flexDirection: "column", gap: 8 });
  const dot = (bg: string, children: ReactNode, ring?: string): ReactElement => (
    <span style={{ width: 24, height: 24, borderRadius: 12, background: bg, border: ring, color: "#FFFFFF", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{children}</span>
  );
  return (
    <>
      <ol aria-label={`How a ${kind.toUpperCase()} revision works`} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <li style={card("1px solid #CFE3D6", "#F3F9F5", 14)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{dot(WS.green, <WsCheck size={12} />)}<span style={{ fontWeight: 700 }}>1. {hasApproved ? `Changed ${word}s uploaded` : "Uploaded"}</span></div>
          <div style={{ fontSize: 13, color: WS.text2, overflowWrap: "anywhere" }}>{dayMonth(submittedOf(v.file))} · {ownText}</div>
        </li>
        <li aria-current="step" style={card("2px solid #E0A955", "#FFF6EA", 13)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {dot(WS.amberBtn, "2")}<span style={{ fontWeight: 700 }}>Client approves</span>
            <span style={{ marginLeft: "auto" }}><WsBadge tone={[WS.amber, "#FBE3C2"]}>Now</WsBadge></span>
          </div>
          <div style={{ fontSize: 13, color: late ? WS.red : WS.text2, fontWeight: late ? 600 : 400 }}>
            {sentOn
              ? `Sent to ${detail.project.customer_name ?? "the client"} ${dayMonth(sentOn)}${dueOn ? ` · due ${dayMonth(dueOn)}` : ""}${late ? ` (${plural(-left, "day")} late)` : ""}`
              : `Uploaded ${dayMonth(submittedOf(v.file))}. Not sent to the client yet.`}
          </div>
          {canWrite && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sentOn ? (
                <>
                  <WsBtn size="sm" disabled={busy} onClick={onRemind}>Remind client</WsBtn>
                  <WsBtn kind="amber" size="sm" disabled={busy} onClick={() => onEdit("approve", v)}>Record approval</WsBtn>
                  <WsBtn size="sm" disabled={busy} onClick={() => onEdit("send", v)}>Send again</WsBtn>
                </>
              ) : (
                <>
                  <WsBtn kind="amber" size="sm" disabled={busy} onClick={() => onEdit("send", v)}>Send to client</WsBtn>
                  <WsBtn size="sm" disabled={busy} onClick={() => onEdit("approve", v)}>Record approval</WsBtn>
                </>
              )}
            </div>
          )}
        </li>
        <li style={card(`1px solid ${BETA.line}`, "#FAFBFB", 14)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{dot("transparent", "3", `2px solid ${BETA.border}`)}<span style={{ fontWeight: 700, color: WS.text2 }}>{is2d ? "Becomes the site set" : "Becomes the approved set"}</span></div>
          <div style={{ fontSize: 13, color: BETA.muted }}>
            {hasApproved && own.length
              ? `The ${plural(own.length, `new ${word}`)} replace${own.length === 1 ? "s" : ""} the old ${own.length === 1 ? "one" : "ones"} in the set below. Nothing to upload again.`
              : is2d ? "When the client approves, the site works from this set." : "When the client approves, these links are the approved 3D set."}
          </div>
        </li>
      </ol>
      {v.file.note && (
        <div style={{ background: WS.panel, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: BETA.muted, fontWeight: 600, marginBottom: 4 }}>What changed in this revision</div>
          <div style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{v.file.note}</div>
        </div>
      )}
    </>
  );
}

/** One PDF of several files (2D set, site measure), built in the browser. */
function PdfButton({ projectId, parts, outName, label, onError }: { projectId: number; parts: PdfPart[]; outName: string; label: string; onError: (t: string) => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function go(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      const r = await downloadAsPdf(projectId, parts, outName.replace(/[\\/:*?"<>|]+/g, " "));
      if (r.skipped.length) setNote(`Not in the PDF (not a PDF or photo): ${r.skipped.join(", ")}`);
    } catch (e) {
      onError(`The PDF could not be made: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <WsBtn size="sm" disabled={busy} onClick={() => void go()}>{busy ? "Making PDF..." : label}</WsBtn>
      {note && <span role="status" style={{ fontSize: 12, color: WS.amber, maxWidth: 260 }}>{note}</span>}
    </span>
  );
}

/** Every 3D submission, newest first: links open in a new tab, and Copy puts the link on the clipboard to send the client. */
function NotesList({ kind, notes, files }: { kind: DesignKind; notes: DesignNote[]; files: DesignFile[] }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 12, color: BETA.muted, fontWeight: 600, marginBottom: 8 }}>{kind.toUpperCase()} notes</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {notes.map((n) => {
          const answeredBy = files.find((f) => f.id === n.closed_by_file_id);
          return (
            <li key={n.id} style={{ background: WS.panel, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", fontSize: 12, color: BETA.muted }}>
                <span>{dayMonth(n.noted_on)}</span>
                {(n.requested_by_person_name ?? n.requested_by_text) && <span>from {n.requested_by_person_name ?? n.requested_by_text}</span>}
                <WsBadge tone={answeredBy ? TONE_DONE : TONE_WAIT}>{answeredBy ? `Answered in ${versionLabel(kind, answeredBy)}` : "Open"}</WsBadge>
              </div>
              <p style={{ marginTop: 2, overflowWrap: "anywhere" }}>{n.note}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Dialogs ---------- */

function SendDialog({ p, editing, onClose }: { p: BetaTabProps; editing: Editing; onClose: () => void }): ReactElement {
  const { kind, v } = editing;
  const label = versionLabel(kind, v.file);
  const [sentOn, setSentOn] = useState(v.review?.sentOn ?? p.today);
  const [dueOn, setDueOn] = useState(v.review?.dueOn ?? addDays(p.today, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const customer = p.detail.project.customer_name;
  const text = `Hi${customer ? ` ${customer}` : ""}, we have sent you the ${label} drawing for ${p.detail.project.name}. Please review it and let us know if you approve${dueOn ? ` by ${dayMonthYear(dueOn)}` : ""}. Thank you.`;

  async function save(): Promise<void> {
    if (!sentOn || !dueOn) { setError("Give both the sent date and the answer date."); return; }
    if (dueOn < sentOn) { setError("The answer date is before the sent date."); return; }
    setBusy(true);
    setError(null);
    try {
      await betaApi.designSent(v.file.id, { sentOn, dueOn });
      setSaved(true);
      p.onDone(`${label} marked as sent to the client.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WsDialog
      title={`Send ${label} to the client`}
      sub={p.detail.project.name}
      onClose={onClose}
      footer={saved ? <WsBtn kind="teal" onClick={onClose}>Done</WsBtn> : (
        <>
          <WsBtn onClick={onClose} disabled={busy}>Cancel</WsBtn>
          <WsBtn kind="teal" onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Record as sent"}</WsBtn>
        </>
      )}
    >
      {saved ? (
        <>
          <p style={{ fontSize: 14 }}>Saved. The sent and answer dates are recorded.</p>
          <p style={{ fontSize: 14, color: BETA.muted }}>Now send the drawing to the customer. This opens WhatsApp with a message ready to send.</p>
          <a style={{ ...btnStyle("outline", "md"), alignSelf: "flex-start", color: BETA.accent }} href={whatsappLink(p.detail.project.customer_phone, text)} target="_blank" rel="noopener noreferrer">
            Open WhatsApp{p.detail.project.customer_phone ? "" : " (no phone on file, pick the contact)"}
          </a>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, color: BETA.muted }}>Record when the drawing went to the customer and the date you expect an answer by.</p>
          <WsField label="Sent on"><input type="date" style={inputStyle} value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></WsField>
          <WsField label="Answer due on"><input type="date" style={inputStyle} value={dueOn} min={sentOn} onChange={(e) => setDueOn(e.target.value)} /></WsField>
          {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
        </>
      )}
    </WsDialog>
  );
}

function ApproveDialog({ p, editing, onClose }: { p: BetaTabProps; editing: Editing; onClose: () => void }): ReactElement {
  const { kind, v } = editing;
  const label = versionLabel(kind, v.file);
  const [approvedOn, setApprovedOn] = useState(p.today);
  const [name, setName] = useState(p.detail.project.customer_name ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (!approvedOn) { setError("Give the date of the approval."); return; }
    if (!name.trim()) { setError("Give the name of the person who approved."); return; }
    setBusy(true);
    setError(null);
    try {
      await betaApi.designApproval(v.file.id, { approvedOn, approvedByName: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
      p.onDone(`${label} approved.`);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <WsDialog
      title={`Record approval of ${label}`}
      sub={p.detail.project.name}
      onClose={onClose}
      footer={
        <>
          <WsBtn onClick={onClose} disabled={busy}>Cancel</WsBtn>
          <WsBtn kind="teal" onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Record approval"}</WsBtn>
        </>
      }
    >
      {kind === "2d" && <p style={{ fontSize: 14, color: BETA.muted }}>Approving a 2D version also ticks "shop drawings signed" on the project checklist.</p>}
      <WsField label="Approved on"><input type="date" style={inputStyle} value={approvedOn} max={p.today} onChange={(e) => setApprovedOn(e.target.value)} /></WsField>
      <WsField label="Approved by"><input style={inputStyle} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></WsField>
      <WsField label="Note (optional)"><textarea style={textareaStyle} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></WsField>
      {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}
