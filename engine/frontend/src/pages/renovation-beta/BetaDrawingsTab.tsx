/* Beta workspace > Drawings: for 3D and 2D, the approved set, a newer version waiting for the client, and every version
   with its notes. Sending to the client and recording or removing an approval write through /api/beta. */

import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Ruler } from "lucide-react";
import { Button } from "../../components/Button";
import { useDialog } from "../../hooks/useDialog";
import { cn } from "../../lib/utils";
import { Card } from "../projects/renovation/ProjectRecords";
import { addDays, errorText, shortDate } from "../projects/renovation/renovationModel";
import { Dialog, Field, Pill, inputClass, smallBtn } from "../projects/renovation/renovationUi";
import type { DesignFile, DesignNote } from "../projects/renovation/simpleApi";
import { FileDialog, sendReminder, useGuarded, type BetaTabProps, type ViewedFile } from "./betaShared";
import { betaApi } from "./renovationBetaApi";
import { approvedSet, daysLeft, versionLabel, whatsappLink, type DesignKind, type VersionInfo } from "./renovationBetaModel";

type Editing = { type: "send" | "approve"; kind: DesignKind; v: VersionInfo };

const submittedOf = (f: DesignFile): string => f.submitted_on ?? f.uploaded_at;
const picNames = (f: DesignFile): string => (f.people?.length ? f.people.map((x) => x.name).join(", ") : f.person_name ?? "-");

export function BetaDrawingsTab(p: BetaTabProps): ReactElement {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewing, setViewing] = useState<ViewedFile | null>(null);
  const openFile = (f: DesignFile) => {
    if (f.external_url) window.open(f.external_url, "_blank", "noopener");
    else if (f.r2_key) setViewing({ key: f.r2_key, name: f.file_name });
  };
  return (
    <div className="space-y-4">
      {(["3d", "2d"] as const).map((kind) => (
        <KindCard key={kind} kind={kind} p={p} onEdit={(type, v) => setEditing({ type, kind, v })} onOpen={openFile} />
      ))}
      {editing?.type === "send" && <SendDialog p={p} editing={editing} onClose={() => setEditing(null)} />}
      {editing?.type === "approve" && <ApproveDialog p={p} editing={editing} onClose={() => setEditing(null)} />}
      {viewing && <FileDialog projectId={p.projectId} file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function KindCard({ kind, p, onEdit, onOpen }: { kind: DesignKind; p: BetaTabProps; onEdit: (type: "send" | "approve", v: VersionInfo) => void; onOpen: (f: DesignFile) => void }) {
  const dialog = useDialog();
  const { busy, run } = useGuarded();
  const { workspace, records, canWrite, today, projectId, detail } = p;
  const set = approvedSet(records.files, workspace.reviews, kind);
  const notes = records.notes.filter((n) => n.kind === kind).sort((a, b) => b.noted_on.localeCompare(a.noted_on) || b.id - a.id);
  const { approved, waiting } = set;

  async function removeApproval(v: VersionInfo) {
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

  const sentOn = waiting?.review?.sentOn ?? null;
  const dueOn = waiting?.review?.dueOn ?? null;
  const left = daysLeft(dueOn, today);
  const waitingLabel = waiting ? versionLabel(kind, waiting.file) : "";

  return (
    <Card title={`${kind.toUpperCase()} drawings`} icon={<Ruler size={14} />}>
      {set.versions.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          No {kind.toUpperCase()} version has been uploaded yet.{" "}
          <Link className="text-primary" to={`/projects/${projectId}`}>Upload it on the current project page.</Link>
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label={`Approved ${kind.toUpperCase()}`} className="rounded-md border border-border p-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Approved set</h4>
            {approved ? (
              <div className="mt-1 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{versionLabel(kind, approved.file)}</span><Pill tone="ok">Approved</Pill></div>
                <div className="text-ink-secondary">
                  {shortDate(approved.review?.approvedOn)}{approved.review?.approvedByName && <> by {approved.review.approvedByName}</>}
                </div>
                {approved.review?.approvalNote && <p className="text-ink [overflow-wrap:anywhere]">{approved.review.approvalNote}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="secondary" className={smallBtn} onClick={() => onOpen(approved.file)}>Open</Button>
                  {canWrite && <Button variant="danger" className={smallBtn} disabled={busy} onClick={() => void run(() => removeApproval(approved))}>Remove approval</Button>}
                </div>
              </div>
            ) : <p className="mt-1 text-sm text-ink-secondary">Nothing approved yet.</p>}
          </section>

          <section aria-label={`Waiting ${kind.toUpperCase()}`} className="rounded-md border border-border p-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Waiting for the client</h4>
            {waiting ? (
              <div className="mt-1 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{waitingLabel}</span>
                  <Pill tone={sentOn ? (left != null && left < 0 ? "err" : "warn") : "muted"}>{sentOn ? "Sent" : "Not sent yet"}</Pill>
                </div>
                {sentOn ? (
                  <div className={cn("text-ink-secondary", left != null && left < 0 && "text-err")}>
                    Sent {shortDate(sentOn)}{dueOn && <> · answer due {shortDate(dueOn)}{left != null && left < 0 && ` (${-left} day${left === -1 ? "" : "s"} late)`}</>}
                  </div>
                ) : <div className="text-ink-secondary">Uploaded {shortDate(submittedOf(waiting.file))}. Not sent to the client.</div>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="secondary" className={smallBtn} onClick={() => onOpen(waiting.file)}>Open</Button>
                  {canWrite && <Button className={smallBtn} disabled={busy} onClick={() => onEdit("send", waiting)}>{sentOn ? "Send again" : "Send to client"}</Button>}
                  {canWrite && <Button variant="secondary" className={smallBtn} disabled={busy} onClick={() => onEdit("approve", waiting)}>Record approval</Button>}
                  {canWrite && sentOn && (
                    <Button variant="secondary" className={smallBtn} disabled={busy} onClick={() => void run(() => sendReminder(projectId, {
                      kind: "client_approval",
                      phone: detail.project.customer_phone,
                      text: `Hi${detail.project.customer_name ? ` ${detail.project.customer_name}` : ""}, a gentle reminder about the ${waitingLabel} drawing for ${detail.project.name}, sent on ${shortDate(sentOn)}. Please let us know if you approve it${dueOn ? ` by ${shortDate(dueOn)}` : ""}. Thank you.`,
                    }, p.onDone, p.onError))}>Remind client</Button>
                  )}
                </div>
              </div>
            ) : <p className="mt-1 text-sm text-ink-secondary">No newer version is waiting.</p>}
          </section>
        </div>
      )}

      {set.versions.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">All versions</h4>
          <ul className="mt-1 divide-y divide-border">
            {set.versions.map((v) => {
              const state = v === approved ? "Approved" : v === waiting ? (v.review?.sentOn ? "Sent, waiting" : "Not sent") : "Older";
              return (
                <li key={v.file.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{versionLabel(kind, v.file)}</span>
                    <span className="text-ink-secondary"> · {shortDate(submittedOf(v.file))} · {picNames(v.file)}</span>
                    {v.file.note && <span className="block text-xs text-ink-secondary [overflow-wrap:anywhere]">{v.file.note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone={v === approved ? "ok" : v === waiting ? "warn" : "muted"}>{state}</Pill>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => onOpen(v.file)}>Open</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {notes.length > 0 && <NotesList kind={kind} notes={notes} files={records.files} />}
    </Card>
  );
}

function NotesList({ kind, notes, files }: { kind: DesignKind; notes: DesignNote[]; files: DesignFile[] }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{kind.toUpperCase()} notes</h4>
      <ul className="mt-1 space-y-2">
        {notes.map((n) => {
          const answeredBy = files.find((f) => f.id === n.closed_by_file_id);
          return (
            <li key={n.id} className="rounded-md bg-surface-dim p-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-secondary">
                <span>{shortDate(n.noted_on)}</span>
                {(n.requested_by_person_name ?? n.requested_by_text) && <span>from {n.requested_by_person_name ?? n.requested_by_text}</span>}
                <Pill tone={answeredBy ? "ok" : "warn"}>{answeredBy ? `Answered in ${versionLabel(kind, answeredBy)}` : "Open"}</Pill>
              </div>
              <p className="mt-0.5 text-ink [overflow-wrap:anywhere]">{n.note}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SendDialog({ p, editing, onClose }: { p: BetaTabProps; editing: Editing; onClose: () => void }) {
  const { kind, v } = editing;
  const label = versionLabel(kind, v.file);
  const [sentOn, setSentOn] = useState(v.review?.sentOn ?? p.today);
  const [dueOn, setDueOn] = useState(v.review?.dueOn ?? addDays(p.today, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const customer = p.detail.project.customer_name;
  const text = `Hi${customer ? ` ${customer}` : ""}, we have sent you the ${label} drawing for ${p.detail.project.name}. Please review it and let us know if you approve${dueOn ? ` by ${shortDate(dueOn)}` : ""}. Thank you.`;

  async function save() {
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
    <Dialog
      title={`Send ${label} to the client`}
      onClose={onClose}
      footer={saved ? <Button onClick={onClose}>Done</Button> : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Record as sent"}</Button>
        </>
      )}
    >
      {saved ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink">Saved. The sent and answer dates are recorded.</p>
          <p className="text-ink-secondary">Now send the drawing to the customer. This opens WhatsApp with a message ready to send.</p>
          <a className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-primary hover:bg-surface-dim"
            href={whatsappLink(p.detail.project.customer_phone, text)} target="_blank" rel="noopener">
            Open WhatsApp{p.detail.project.customer_phone ? "" : " (no phone on file, pick the contact)"}
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-secondary">Record when the drawing went to the customer and the date you expect an answer by.</p>
          <Field label="Sent on"><input type="date" className={inputClass} value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></Field>
          <Field label="Answer due on"><input type="date" className={inputClass} value={dueOn} min={sentOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-err">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

function ApproveDialog({ p, editing, onClose }: { p: BetaTabProps; editing: Editing; onClose: () => void }) {
  const { kind, v } = editing;
  const label = versionLabel(kind, v.file);
  const [approvedOn, setApprovedOn] = useState(p.today);
  const [name, setName] = useState(p.detail.project.customer_name ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
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
    <Dialog
      title={`Record approval of ${label}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Record approval"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {kind === "2d" && <p className="text-sm text-ink-secondary">Approving a 2D version also ticks "shop drawings signed" on the project checklist.</p>}
        <Field label="Approved on"><input type="date" className={inputClass} value={approvedOn} max={p.today} onChange={(e) => setApprovedOn(e.target.value)} /></Field>
        <Field label="Approved by"><input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Note (optional)"><textarea className={inputClass} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
      </div>
    </Dialog>
  );
}
