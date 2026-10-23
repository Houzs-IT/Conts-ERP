/* Beta workspace > Defects, laid out as the mockup's Defects view: "Report a problem", the board (To fix, Check it,
   Done) and the handover strip. Photos go up through the existing project file upload; the key is sent with the defect. */

import { useState, type CSSProperties, type FormEvent, type ReactElement, type ReactNode } from "react";
import { CalendarDays, MapPin, Plus, RotateCcw, Wrench } from "lucide-react";
import { useDialog } from "../../hooks/useDialog";
import { renovationApi } from "../projects/renovation/renovationApi";
import { errorText } from "../projects/renovation/renovationModel";
import { WS, WsBtn, WsDialog, WsField, WsPageHead, WsPhoto, btnStyle, inputStyle, textareaStyle } from "./BetaWsUi";
import { sendReminder, tradeLabel, useGuarded, TRADE_LABEL, type BetaTabProps } from "./betaShared";
import { BETA_TRADES, betaApi, type BetaDefect, type BetaTrade } from "./renovationBetaApi";
import { dayMonth, dayMonthYear, defectDaysLate, groupDefects, snagProgress, type DefectColumn } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

const COLUMNS: ReadonlyArray<{ key: DefectColumn; title: string; caption: string; dot: string; empty: string }> = [
  { key: "to_fix", title: "To fix", caption: "Contractor's turn", dot: WS.redDot, empty: "Nothing waiting to be fixed." },
  { key: "check", title: "Check it", caption: "Your turn", dot: WS.amberDot, empty: "Nothing waiting for a check." },
  { key: "done", title: "Done", caption: "Closed", dot: WS.green, empty: "No closed defects yet." },
];

type Step = { type: "fixed" | "redo"; defect: BetaDefect };

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

export function BetaDefectsTab(p: BetaTabProps): ReactElement {
  const dialog = useDialog();
  const { workspace, canWrite, projectId, today, detail } = p;
  const [reporting, setReporting] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const { busy, run } = useGuarded();
  const groups = groupDefects(workspace.defects);
  const { closed, total } = snagProgress(workspace.defects);
  const handoverOn = detail.project.handed_over_at ?? detail.project.planned_handover_date;

  async function act(fn: () => Promise<unknown>, ok: string): Promise<void> {
    await run(async () => {
      try { await fn(); p.onDone(ok); } catch (e) { p.onError(errorText(e)); }
    });
  }
  async function close(d: BetaDefect): Promise<void> {
    const ok = await dialog.confirm({ title: "Close this defect?", message: `${d.location ?? "Defect"}: ${d.description ?? ""}`, confirmLabel: "OK, close" });
    if (ok) await act(() => betaApi.defectClose(d.id), "Defect closed.");
  }
  function remind(d: BetaDefect): void {
    const late = defectDaysLate(d, today);
    const where = d.location ?? "the unit";
    const text = `Defect to fix at ${where} (${detail.project.name}): ${d.description ?? "see the project"}.${d.dueDate ? ` Fix by ${dayMonthYear(d.dueDate)}${late > 0 ? `, now ${plural(late, "day")} late` : ""}.` : ""} Please fix it and tell us when it is done.`;
    void run(() => sendReminder(projectId, { kind: "defect", text, phone: null }, p.onDone, p.onError));
  }

  return (
    <>
      <WsPageHead
        title="Defects"
        sub={<span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}><span>Found on site</span><span aria-hidden="true">→</span><span>contractor fixes</span><span aria-hidden="true">→</span><span>you check</span></span>}
        right={canWrite && !reporting ? (
          <button type="button" onClick={() => setReporting(true)} style={{ ...btnStyle("teal", "lg"), borderRadius: 10 }}>
            <Plus size={16} aria-hidden="true" />Report a problem
          </button>
        ) : undefined}
      />

      {reporting && <ReportForm p={p} onClose={() => setReporting(false)} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
        {COLUMNS.map((c) => (
          <section key={c.key} aria-label={c.title} style={{ background: WS.chip, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 0" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: c.dot }} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{c.title}</h3>
              <span style={{ padding: "1px 8px", borderRadius: 10, background: BETA.surface, color: WS.text2, fontSize: 12, fontWeight: 700 }}>{groups[c.key].length}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: BETA.muted }}>{c.caption}</span>
            </div>
            {groups[c.key].length === 0 ? <p style={{ padding: "0 4px 4px", fontSize: 12, color: BETA.muted }}>{c.empty}</p> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {groups[c.key].map((d) => (
                  <DefectCard key={d.id} d={d} column={c.key} p={p} busy={busy}
                    onFixed={() => setStep({ type: "fixed", defect: d })} onRedo={() => setStep({ type: "redo", defect: d })}
                    onClose={() => void close(d)} onRemind={() => remind(d)} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <section aria-label="Handover" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px", padding: "16px 18px", background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ fontWeight: 700 }}>Ready for handover{handoverOn ? ` on ${dayMonth(handoverOn)}` : ""}?</div>
          <div style={{ fontSize: 13, color: BETA.muted }}>Keys and final payment after every defect is closed and the client signs</div>
        </div>
        <div style={{ flex: "0 1 260px", minWidth: 200 }} data-testid="snag-progress">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>{closed} of {total} closed</span>
            {total > 0 && (total - closed > 0 ? <span style={{ color: WS.red, fontWeight: 600 }}>{total - closed} open</span> : <span style={{ color: WS.green, fontWeight: 600 }}>All closed</span>)}
          </div>
          <div role="progressbar" aria-label="Snags closed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? Math.round((closed / total) * 100) : 0} style={{ marginTop: 6, height: 8, borderRadius: 4, background: WS.chip }}>
            <div style={{ width: `${total ? Math.round((closed / total) * 100) : 0}%`, height: 8, borderRadius: 4, background: WS.green }} />
          </div>
        </div>
      </section>

      {step?.type === "fixed" && <FixedDialog p={p} defect={step.defect} onClose={() => setStep(null)} />}
      {step?.type === "redo" && <RedoDialog p={p} defect={step.defect} onClose={() => setStep(null)} />}
    </>
  );
}

function InfoRow({ icon, color = BETA.muted, weight = 400, children }: { icon: ReactNode; color?: string; weight?: number; children: ReactNode }): ReactElement {
  return <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color, fontWeight: weight }}><span aria-hidden="true" style={{ display: "inline-flex", flex: "none" }}>{icon}</span>{children}</div>;
}

const photoTag = (bg: string): CSSProperties => ({ position: "absolute", left: 8, top: 8, padding: "2px 8px", borderRadius: 10, background: bg, color: "#FFFFFF", fontSize: 11, fontWeight: 600 });

function DefectCard({ d, column, p, busy, onFixed, onRedo, onClose, onRemind }: {
  d: BetaDefect; column: DefectColumn; p: BetaTabProps; busy: boolean; onFixed: () => void; onRedo: () => void; onClose: () => void; onRemind: () => void;
}): ReactElement {
  const late = defectDaysLate(d, p.today);
  const where = d.location ?? "the unit";
  const what = `${d.location ?? "Defect"}: ${d.description ?? ""}`;
  const trade = tradeLabel(d.trade);
  const before = d.photoKey ? renovationApi.fileUrl(p.projectId, d.photoKey) : null;
  const after = d.afterPhotoKey ? renovationApi.fileUrl(p.projectId, d.afterPhotoKey) : null;
  const shadow = "0 1px 2px rgba(23,32,31,.04)";
  // The card shows the problem photo; a closed defect shows the fixed result.
  const single = column === "done" ? (after ?? before) : (before ?? after);

  if (column === "done") {
    return (
      <li style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, padding: 10, display: "flex", gap: 10, alignItems: "center" }}>
        {single && <div style={{ flex: "none", width: 72, height: 54, borderRadius: 8, overflow: "hidden" }}><WsPhoto path={single} alt={`Photo of ${what}`} /></div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: WS.text2, overflowWrap: "anywhere" }}>{d.description ?? d.location ?? "Defect"}</div>
          <div style={{ fontSize: 12, color: BETA.muted }}>{[d.location, d.closedAt ? `closed ${dayMonth(d.closedAt)}` : null].filter(Boolean).join(" · ")}</div>
        </div>
      </li>
    );
  }

  return (
    <li style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, overflow: "hidden", boxShadow: shadow }}>
      {before && after && column === "check" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 2, height: 140 }}>
          <div style={{ position: "relative", overflow: "hidden" }}><WsPhoto path={before} alt={`Photo of the problem at ${where}`} /><span style={photoTag("rgba(23,32,31,.75)")}>Before</span></div>
          <div style={{ position: "relative", overflow: "hidden" }}><WsPhoto path={after} alt={`Photo after the fix at ${where}`} /><span style={photoTag(WS.green)}>After</span></div>
        </div>
      ) : single ? (
        <div style={{ height: 140, overflow: "hidden" }}><WsPhoto path={single} alt={`Photo of the problem at ${where}`} /></div>
      ) : null}
      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{d.description ?? "No description"}</div>
        <InfoRow icon={<MapPin size={14} />}>{d.location ?? "No area given"}</InfoRow>
        {trade && <InfoRow icon={<Wrench size={14} />}>{trade}</InfoRow>}
        {column === "to_fix" && d.dueDate && (late > 0
          ? <InfoRow icon={<CalendarDays size={14} />} color={WS.red} weight={600}>Was due {dayMonth(d.dueDate)} · {plural(late, "day")} late</InfoRow>
          : <InfoRow icon={<CalendarDays size={14} />}>Fix by {dayMonth(d.dueDate)}</InfoRow>)}
        {column === "check" && d.fixedAt && <InfoRow icon={<CalendarDays size={14} />}>Fixed {dayMonth(d.fixedAt)}</InfoRow>}
        {d.redoCount > 0 && <InfoRow icon={<RotateCcw size={14} />} color={WS.amber} weight={600}>Redone {plural(d.redoCount, "time")}</InfoRow>}
        <div style={{ fontSize: 12, color: BETA.muted }}>
          {d.reportedAt ? `Reported ${dayMonth(d.reportedAt)}` : "Reported"}{d.reportedByName && ` by ${d.reportedByName}`}
        </div>
        {p.canWrite && column === "to_fix" && (
          <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <WsBtn size="sm" style={{ minHeight: 38 }} disabled={busy} onClick={onRemind}>Remind{trade ? ` ${trade.toLowerCase()}` : ""}<span className="sr">: {what}</span></WsBtn>
            <WsBtn kind="teal" size="sm" style={{ minHeight: 38 }} disabled={busy} onClick={onFixed}>Fixed<span className="sr">: {what}</span></WsBtn>
          </div>
        )}
        {p.canWrite && column === "check" && (
          <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <WsBtn size="sm" style={{ minHeight: 38 }} disabled={busy} onClick={onRedo}>Redo<span className="sr">: {what}</span></WsBtn>
            <WsBtn kind="teal" size="sm" style={{ minHeight: 38 }} disabled={busy} onClick={onClose}>OK, close<span className="sr">: {what}</span></WsBtn>
          </div>
        )}
      </div>
    </li>
  );
}

function ReportForm({ p, onClose }: { p: BetaTabProps; onClose: () => void }): ReactElement {
  const [photo, setPhoto] = useState<File | null>(null);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [trade, setTrade] = useState<BetaTrade | "">("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!photo) { setError("Add a photo of the problem."); return; }
    if (!description.trim()) { setError("Say what is wrong."); return; }
    setBusy(true);
    setError(null);
    try {
      const { key } = await renovationApi.upload(p.projectId, "defect", photo);
      await betaApi.reportDefect(p.projectId, {
        location: location.trim() || null,
        description: description.trim(),
        trade: trade || null,
        dueDate: dueDate || null,
        photoKey: key,
      });
      p.onDone("Defect reported.");
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Report a problem"
      style={{ background: BETA.surface, border: `2px solid ${BETA.accent}`, borderRadius: 12, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}
    >
      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 76, border: `1.5px dashed ${WS.dash}`, borderRadius: 10, textAlign: "center", cursor: "pointer", fontWeight: 600, fontSize: 13, padding: 6, position: "relative" }}>
        Photo of the problem
        <span style={{ fontSize: 12, fontWeight: 400, color: BETA.muted, overflowWrap: "anywhere" }}>{photo ? photo.name : "Required · take or upload"}</span>
        <input type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => setPhoto(e.target.files?.item(0) ?? null)} />
      </label>
      <WsField label="Where"><input style={inputStyle} value={location} maxLength={120} placeholder="e.g. Kitchen" onChange={(e) => setLocation(e.target.value)} /></WsField>
      <WsField label="What's wrong"><input style={inputStyle} value={description} maxLength={1000} placeholder="e.g. cabinet door not aligned" onChange={(e) => setDescription(e.target.value)} /></WsField>
      <WsField label="Who fixes it">
        <select style={inputStyle} value={trade} onChange={(e) => setTrade(BETA_TRADES.find((t) => t === e.target.value) ?? "")}>
          <option value="">Choose</option>
          {BETA_TRADES.map((t) => <option key={t} value={t}>{TRADE_LABEL[t]}</option>)}
        </select>
      </WsField>
      <WsField label="Fix by"><input type="date" style={inputStyle} value={dueDate} min={p.today} onChange={(e) => setDueDate(e.target.value)} /></WsField>
      <div style={{ display: "flex", gap: 8 }}>
        <WsBtn onClick={onClose} disabled={busy} style={{ minHeight: 42 }}>Cancel</WsBtn>
        <WsBtn kind="dark" type="submit" disabled={busy} style={{ minHeight: 42, flex: 1 }}>{busy ? "Saving..." : <>Add to “To fix”</>}</WsBtn>
      </div>
      {error && <p role="alert" style={{ gridColumn: "1 / -1", fontSize: 13, color: WS.red }}>{error}</p>}
    </form>
  );
}

function FixedDialog({ p, defect, onClose }: { p: BetaTabProps; defect: BetaDefect; onClose: () => void }): ReactElement {
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const key = photo ? (await renovationApi.upload(p.projectId, "defect", photo)).key : null;
      await betaApi.defectFixed(defect.id, key);
      p.onDone("Marked as fixed. It now waits for a check.");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <WsDialog title="Mark as fixed" sub={`${defect.location ?? "Defect"}: ${defect.description ?? ""}`} onClose={onClose} footer={
      <>
        <WsBtn onClick={onClose} disabled={busy}>Cancel</WsBtn>
        <WsBtn kind="teal" onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Mark as fixed"}</WsBtn>
      </>
    }>
      <WsField label="Photo after the fix (optional)"><input type="file" accept="image/*" style={inputStyle} onChange={(e) => setPhoto(e.target.files?.item(0) ?? null)} /></WsField>
      {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}

function RedoDialog({ p, defect, onClose }: { p: BetaTabProps; defect: BetaDefect; onClose: () => void }): ReactElement {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await betaApi.defectRedo(defect.id, note.trim() || null);
      p.onDone("Sent back to To fix.");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <WsDialog title="Redo this fix" sub={`${defect.location ?? "Defect"}: ${defect.description ?? ""}`} onClose={onClose} footer={
      <>
        <WsBtn onClick={onClose} disabled={busy}>Cancel</WsBtn>
        <WsBtn kind="teal" onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Send back to To fix"}</WsBtn>
      </>
    }>
      <WsField label="What is still wrong (optional)"><textarea style={textareaStyle} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></WsField>
      {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}
