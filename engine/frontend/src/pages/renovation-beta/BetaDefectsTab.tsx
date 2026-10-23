/* Beta workspace > Defects (BRIEF-beta-oct24 section 6, owner 24 Oct 2026): a repair pipeline like a support ticket or
   the rental side's Maintenance. "Report a problem" on top, then three columns, To fix -> Check -> Done, each defect a
   card (photo, area, what is wrong, who fixes it, fix-by date with overdue in red). A card opens the ticket: its
   details and photos, who fixes it and by when, the after photo and "Mark complete" (to Check), then Close (to Done)
   or Redo (back to To fix). On a phone the columns scroll sideways, one column per screen. */

import { useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { CalendarDays, ChevronRight, MapPin, Plus, RotateCcw, User, Wrench } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { renovationApi } from "../projects/renovation/renovationApi";
import { errorText } from "../projects/renovation/renovationModel";
import { WS, WsBtn, WsDialog, WsEmpty, WsField, WsPageHead, WsPhoto, btnStyle, inputStyle, textareaStyle } from "./BetaWsUi";
import { sendReminder, tradeLabel, useGuarded, TRADE_LABEL, type BetaTabProps } from "./betaShared";
import { BETA_TRADES, betaApi, type BetaTrade } from "./renovationBetaApi";
import { dayMonth, dayMonthYear, defectColumn, defectDaysLate, mytDay, snagProgress, type DefectColumn } from "./renovationBetaModel";
import { betaSiteApi, type DefectPatch, type DefectTicket } from "./renovationBetaSiteApi";
import { dueLine, overdueCount, ticketColumns } from "./renovationBetaSiteModel";
import { BETA } from "./renovationBetaTheme";

/** Column header colours: amber for the contractor's turn, blue for the check, green for done. */
const COLUMNS: ReadonlyArray<{ key: DefectColumn; title: string; caption: string; ink: string; bg: string; bar: string; empty: string }> = [
  { key: "to_fix", title: "To fix", caption: "Contractor's turn", ink: "#8A4A00", bg: "#FDF1E2", bar: "#D98A1F", empty: "Nothing waiting to be fixed." },
  { key: "check", title: "Check", caption: "Fixed, your turn to check", ink: WS.blue, bg: "#E8F0FB", bar: "#3A7BD5", empty: "Nothing waiting for a check." },
  { key: "done", title: "Done", caption: "Checked and closed", ink: WS.green, bg: "#E5F3EA", bar: "#3E9B5F", empty: "No closed defects yet." },
];

const PIPE_CSS = `
.bws .bdp-wrap{container:bdp / inline-size}
.bws .bdp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
@container bdp (max-width:700px){.bws .bdp{grid-template-columns:repeat(3,minmax(47%,1fr));overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;-webkit-overflow-scrolling:touch}.bws .bdp>section{scroll-snap-align:start}}
@container bdp (max-width:560px){.bws .bdp{grid-template-columns:repeat(3,minmax(86%,1fr))}}
.bws .bdp-card{display:flex;flex-direction:column;width:100%;padding:0;border:1px solid ${BETA.line};border-radius:12px;background:${BETA.surface};text-align:left;font:inherit;color:inherit;cursor:pointer;overflow:hidden;box-shadow:0 1px 2px rgba(23,32,31,.04)}
.bws .bdp-card:hover{border-color:${BETA.border};box-shadow:0 2px 8px rgba(23,32,31,.08)}
`;

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
const whereOf = (t: DefectTicket): string => t.location ?? "No area given";

export function BetaDefectsTab(p: BetaTabProps): ReactElement {
  const { projectId, today, detail, canWrite } = p;
  const q = useQuery(["renovation-beta", "defects", projectId], () => betaSiteApi.defects(projectId), [projectId]);
  const site = useQuery(["renovation-beta", "site", projectId], () => betaSiteApi.site(projectId), [projectId]);
  const [reporting, setReporting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const tickets = q.data?.defects ?? [];
  const cols = ticketColumns(tickets, today);
  const late = overdueCount(tickets, today);
  const { closed, total } = snagProgress(tickets);
  const handoverOn = detail.project.handed_over_at ?? detail.project.planned_handover_date;
  const open = tickets.find((t) => t.id === openId) ?? null;
  const areas = site.data?.areas ?? [];

  return (
    <>
      <style>{PIPE_CSS}</style>
      <WsPageHead
        title="Defects"
        sub={<span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}><span>Found on site</span><span aria-hidden="true">→</span><span>contractor fixes</span><span aria-hidden="true">→</span><span>you check and close</span>{late > 0 && <span style={{ color: WS.red, fontWeight: 600 }}>· {plural(late, "defect")} overdue</span>}</span>}
        right={canWrite && !reporting ? (
          <button type="button" onClick={() => setReporting(true)} style={{ ...btnStyle("teal", "lg"), borderRadius: 10 }}>
            <Plus size={16} aria-hidden="true" />Report a problem
          </button>
        ) : undefined}
      />

      {reporting && <ReportForm p={p} areas={areas} onClose={() => setReporting(false)} />}

      {q.loading && !q.data ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading defects...</p>
        : q.error && !q.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The defects could not be loaded: {q.error}</p>
        : (
          <div className="bdp-wrap"><div className="bdp" aria-label="Defect pipeline" role="region">
            {COLUMNS.map((c) => (
              <section key={c.key} aria-label={`${c.title}, ${cols[c.key].length}`} style={{ background: WS.panel, border: `1px solid ${BETA.line}`, borderRadius: 14, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: c.bg, borderTop: `4px solid ${c.bar}` }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: c.ink }}>{c.title}</h3>
                  <span style={{ minWidth: 26, padding: "1px 8px", borderRadius: 12, background: c.bar, color: "#FFFFFF", fontSize: 13, fontWeight: 700, textAlign: "center" }}>{cols[c.key].length}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: c.ink, textAlign: "right" }}>{c.caption}</span>
                </div>
                {cols[c.key].length === 0 ? <p style={{ padding: 16, fontSize: 13, color: BETA.muted }}>{c.empty}</p> : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                    {cols[c.key].map((t) => <li key={t.id}><TicketCard t={t} p={p} onOpen={() => setOpenId(t.id)} /></li>)}
                  </ul>
                )}
              </section>
            ))}
          </div></div>
        )}

      <section aria-label="Handover" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px", padding: "16px 18px", background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Ready for handover{handoverOn ? ` on ${dayMonth(handoverOn)}` : ""}?</div>
          <div style={{ fontSize: 13, color: BETA.muted }}>Keys and final payment after every defect is closed and the client signs</div>
        </div>
        <div style={{ flex: "0 1 320px", minWidth: 200 }} data-testid="snag-progress">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span>{closed} of {total} closed</span>
            {total > 0 && (total - closed > 0 ? <span style={{ color: WS.red, fontWeight: 600 }}>{total - closed} open</span> : <span style={{ color: WS.green, fontWeight: 600 }}>All closed</span>)}
          </div>
          <div role="progressbar" aria-label="Snags closed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? Math.round((closed / total) * 100) : 0} style={{ marginTop: 6, height: 8, borderRadius: 4, background: WS.chip }}>
            <div style={{ width: `${total ? Math.round((closed / total) * 100) : 0}%`, height: 8, borderRadius: 4, background: WS.green }} />
          </div>
        </div>
      </section>

      {open && <TicketDialog key={open.id} t={open} p={p} areas={areas} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Info({ icon, color = BETA.muted, weight = 400, children }: { icon: ReactNode; color?: string; weight?: number; children: ReactNode }): ReactElement {
  return <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color, fontWeight: weight, minWidth: 0 }}><span aria-hidden="true" style={{ display: "inline-flex", flex: "none" }}>{icon}</span><span style={{ overflowWrap: "anywhere" }}>{children}</span></span>;
}

function whoFixes(t: DefectTicket): string | null {
  const trade = tradeLabel(t.trade);
  return [t.assigneeName, trade].filter(Boolean).join(" · ") || null;
}

function TicketCard({ t, p, onOpen }: { t: DefectTicket; p: BetaTabProps; onOpen: () => void }): ReactElement {
  const col = defectColumn(t);
  const key = col === "done" ? (t.afterPhotoKey ?? t.photoKey) : col === "check" ? (t.afterPhotoKey ?? t.photoKey) : t.photoKey;
  const due = dueLine(t, p.today, dayMonth);
  const who = whoFixes(t);
  return (
    <button type="button" className="bdp-card" onClick={onOpen} aria-label={`Open defect: ${whereOf(t)}, ${t.description ?? ""}`}>
      {key && (
        <span style={{ position: "relative", display: "block", width: "100%", height: "clamp(132px, 11vw, 220px)", overflow: "hidden" }}>
          <WsPhoto path={renovationApi.fileUrl(p.projectId, key)} alt="" />
          {col !== "to_fix" && t.afterPhotoKey && <span style={{ position: "absolute", left: 8, top: 8, padding: "2px 8px", borderRadius: 10, background: WS.green, color: "#FFFFFF", fontSize: 12, fontWeight: 600 }}>After</span>}
        </span>
      )}
      <span style={{ display: "flex", gap: 8, padding: "12px 14px 14px", alignItems: "flex-start" }}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <Info icon={<MapPin size={14} />} color={BETA.ink} weight={600}>{whereOf(t)}</Info>
          <span style={{ fontSize: 14, color: col === "done" ? WS.text2 : BETA.ink, overflowWrap: "anywhere" }}>{t.description ?? "No description"}</span>
          <Info icon={<User size={14} />} color={who ? WS.text2 : WS.amber} weight={who ? 400 : 600}>{who ?? "No one named to fix it"}</Info>
          {due && <Info icon={<CalendarDays size={14} />} color={due.late ? WS.red : BETA.muted} weight={due.late ? 700 : 400}>{due.text}</Info>}
          {col === "check" && t.fixedAt && <Info icon={<CalendarDays size={14} />}>Fixed {dayMonth(mytDay(t.fixedAt))}</Info>}
          {col === "done" && t.closedAt && <Info icon={<CalendarDays size={14} />}>Closed {dayMonth(mytDay(t.closedAt))}</Info>}
          {t.redoCount > 0 && col !== "done" && <Info icon={<RotateCcw size={14} />} color={WS.amber} weight={600}>Redone {plural(t.redoCount, "time")}</Info>}
        </span>
        <ChevronRight size={20} aria-hidden="true" style={{ flex: "none", alignSelf: "center", color: BETA.muted }} />
      </span>
    </button>
  );
}

function PeopleSelect({ p, value, onChange }: { p: BetaTabProps; value: number | null; onChange: (id: number | null) => void }): ReactElement {
  const people = p.board.m.people;
  return (
    <select style={inputStyle} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">No one yet</option>
      {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
}

function AreaInput({ id, value, areas, onChange }: { id: string; value: string; areas: readonly string[]; onChange: (v: string) => void }): ReactElement {
  return (
    <>
      <input style={inputStyle} value={value} maxLength={120} placeholder="e.g. Kitchen" list={id} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>{areas.map((a) => <option key={a} value={a} />)}</datalist>
    </>
  );
}

function ReportForm({ p, areas, onClose }: { p: BetaTabProps; areas: readonly string[]; onClose: () => void }): ReactElement {
  const [photo, setPhoto] = useState<File | null>(null);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [trade, setTrade] = useState<BetaTrade | "">("");
  const [assignee, setAssignee] = useState<number | null>(null);
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
      await betaSiteApi.report(p.projectId, {
        location: location.trim() || null, description: description.trim(), trade: trade || null, dueDate: dueDate || null, photoKey: key, assigneePersonId: assignee,
      });
      p.onDone("Defect reported. It is in To fix.");
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
      style={{ background: BETA.surface, border: `2px solid ${BETA.accent}`, borderRadius: 12, padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, alignItems: "end" }}
    >
      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 76, border: `1.5px dashed ${WS.dash}`, borderRadius: 10, textAlign: "center", cursor: "pointer", fontWeight: 600, fontSize: 14, padding: 6, position: "relative" }}>
        Photo of the problem
        <span style={{ fontSize: 12, fontWeight: 400, color: BETA.muted, overflowWrap: "anywhere" }}>{photo ? photo.name : "Required · take or upload"}</span>
        <input type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => setPhoto(e.target.files?.item(0) ?? null)} />
      </label>
      <WsField label="Area"><AreaInput id="beta-defect-areas" value={location} areas={areas} onChange={setLocation} /></WsField>
      <WsField label="What's wrong"><input style={inputStyle} value={description} maxLength={1000} placeholder="e.g. cabinet door not aligned" onChange={(e) => setDescription(e.target.value)} /></WsField>
      <WsField label="Who fixes it"><PeopleSelect p={p} value={assignee} onChange={setAssignee} /></WsField>
      <WsField label="Kind of work">
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

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: BETA.muted }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}

/** The ticket: details and photos, who fixes it and by when, and the next move for its column. */
function TicketDialog({ t, p, areas, onClose }: { t: DefectTicket; p: BetaTabProps; areas: readonly string[]; onClose: () => void }): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useGuarded();
  const col = defectColumn(t);
  const editable = p.canWrite && col !== "done";
  const [assignee, setAssignee] = useState<number | null>(t.assigneeId);
  const [trade, setTrade] = useState<BetaTrade | "">(BETA_TRADES.find((x) => x === t.trade) ?? "");
  const [dueDate, setDueDate] = useState(t.dueDate ?? "");
  const [location, setLocation] = useState(t.location ?? "");
  const [after, setAfter] = useState<File | null>(null);
  const [redoNote, setRedoNote] = useState("");
  const [redoing, setRedoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = defectDaysLate(t, p.today);
  const due = dueLine(t, p.today, dayMonthYear);

  const patch: DefectPatch = {};
  if (assignee !== t.assigneeId) patch.assigneePersonId = assignee;
  if ((trade || null) !== (t.trade ?? null)) patch.trade = trade || null;
  if ((dueDate || null) !== (t.dueDate ?? null)) patch.dueDate = dueDate || null;
  if ((location.trim() || null) !== (t.location ?? null)) patch.location = location.trim() || null;
  const changed = Object.keys(patch).length > 0;

  async function act(fn: () => Promise<unknown>, ok: string, close = true): Promise<void> {
    setError(null);
    await run(async () => {
      try { await fn(); p.onDone(ok); if (close) onClose(); } catch (e) { setError(errorText(e)); }
    });
  }
  const save = (): Promise<void> => act(() => betaSiteApi.patchDefect(t.id, patch), "Defect updated.", false);
  async function complete(): Promise<void> {
    if (!after) { setError("Add the photo after the fix first."); return; }
    await act(async () => {
      if (changed) await betaSiteApi.patchDefect(t.id, patch);
      const { key } = await renovationApi.upload(p.projectId, "defect", after);
      await betaApi.defectFixed(t.id, key);
    }, "Marked complete. It is now in Check.");
  }
  // The confirm is asked inside the ticket: a second dialog would open behind this one.
  const closeIt = (): Promise<void> => act(() => betaApi.defectClose(t.id), "Defect closed. It is now in Done.");
  function remind(): void {
    const text = `Defect to fix at ${whereOf(t)} (${p.detail.project.name}): ${t.description ?? "see the project"}.${t.dueDate ? ` Fix by ${dayMonthYear(t.dueDate)}${late > 0 ? `, now ${plural(late, "day")} late` : ""}.` : ""} Please fix it and send a photo when it is done.`;
    void run(() => sendReminder(p.projectId, { kind: "defect", text, phone: t.assigneePhone }, p.onDone, p.onError));
  }

  const photo = (key: string | null, label: string, tone: string): ReactElement => (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <div style={{ position: "relative", aspectRatio: "4 / 3", borderRadius: 10, overflow: "hidden", background: WS.chip }}>
        {key ? <WsPhoto path={renovationApi.fileUrl(p.projectId, key)} alt={`${label}: ${whereOf(t)}`} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 13, color: BETA.muted }}>No photo yet</div>}
        <span style={{ position: "absolute", left: 8, top: 8, padding: "2px 8px", borderRadius: 10, background: tone, color: "#FFFFFF", fontSize: 12, fontWeight: 600 }}>{label}</span>
      </div>
    </figure>
  );

  const status = col === "to_fix" ? (late > 0 ? "To fix · overdue" : "To fix") : col === "check" ? "Fixed, waiting for check" : "Done";
  return (
    <WsDialog title={t.description ?? "Defect"} sub={`${whereOf(t)} · ${status}`} onClose={onClose} wide>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {photo(t.photoKey, "Before", "rgba(23,32,31,.75)")}
        {photo(t.afterPhotoKey, "After", WS.green)}
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: 0 }}>
        <Fact label="Reported">{t.reportedAt ? dayMonthYear(mytDay(t.reportedAt)) : "-"}{t.reportedByName ? ` by ${t.reportedByName}` : ""}</Fact>
        <Fact label="Fix by">{due ? <span style={{ color: due.late ? WS.red : undefined, fontWeight: due.late ? 700 : 400 }}>{t.dueDate ? dayMonthYear(t.dueDate) : "-"}{due.late ? ` (${plural(late, "day")} late)` : ""}</span> : t.dueDate ? dayMonthYear(t.dueDate) : "No date"}</Fact>
        <Fact label="Who fixes it">{whoFixes(t) ?? "No one yet"}</Fact>
        {t.fixedAt && <Fact label="Marked complete">{dayMonthYear(mytDay(t.fixedAt))}{t.fixedByName ? ` by ${t.fixedByName}` : ""}</Fact>}
        {t.closedAt && <Fact label="Closed">{dayMonthYear(mytDay(t.closedAt))}{t.closedByName ? ` by ${t.closedByName}` : ""}</Fact>}
        {t.redoCount > 0 && <Fact label="Sent back">{plural(t.redoCount, "time")}{t.lastRedoNote ? `: ${t.lastRedoNote}` : ""}</Fact>}
      </dl>

      {editable && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, padding: 12, borderRadius: 10, background: WS.panel }}>
          <WsField label="Who fixes it"><PeopleSelect p={p} value={assignee} onChange={setAssignee} /></WsField>
          <WsField label="Kind of work">
            <select style={inputStyle} value={trade} onChange={(e) => setTrade(BETA_TRADES.find((x) => x === e.target.value) ?? "")}>
              <option value="">Not set</option>
              {BETA_TRADES.map((x) => <option key={x} value={x}>{TRADE_LABEL[x]}</option>)}
            </select>
          </WsField>
          <WsField label="Fix by"><input type="date" style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></WsField>
          <WsField label="Area"><AreaInput id={`beta-defect-areas-${t.id}`} value={location} areas={areas} onChange={setLocation} /></WsField>
          {changed && <WsBtn kind="dark" disabled={busy} onClick={() => void save()} style={{ alignSelf: "end" }}>Save changes</WsBtn>}
        </div>
      )}

      {p.canWrite && col === "to_fix" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${BETA.line}` }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Fix done?</div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, padding: "8px 12px", border: `1.5px dashed ${WS.dash}`, borderRadius: 10, cursor: "pointer", fontSize: 14 }}>
            <Wrench size={16} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{after ? after.name : "Photo after the fix (required)"}</span>
            <span style={{ ...btnStyle("outline", "sm") }}>{after ? "Change" : "Add photo"}</span>
            <input type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => setAfter(e.target.files?.item(0) ?? null)} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <WsBtn disabled={busy} onClick={remind}>Remind {t.assigneeName ?? "on WhatsApp"}</WsBtn>
            <WsBtn kind="teal" disabled={busy || !after} onClick={() => void complete()}>Mark complete</WsBtn>
          </div>
        </div>
      )}

      {p.canWrite && col === "check" && (
        redoing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <WsField label="What is still wrong (optional)"><textarea style={textareaStyle} rows={2} maxLength={500} value={redoNote} onChange={(e) => setRedoNote(e.target.value)} /></WsField>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <WsBtn disabled={busy} onClick={() => setRedoing(false)}>Cancel</WsBtn>
              <WsBtn kind="amber" disabled={busy} onClick={() => void act(() => betaApi.defectRedo(t.id, redoNote.trim() || null), "Sent back to To fix.")}>Send back to To fix</WsBtn>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <WsBtn disabled={busy} onClick={() => setRedoing(true)}><RotateCcw size={14} aria-hidden="true" />Redo</WsBtn>
            {confirming ? (
              <>
                <span style={{ alignSelf: "center", fontSize: 14, fontWeight: 600 }}>Checked on site and good?</span>
                <WsBtn disabled={busy} onClick={() => setConfirming(false)}>Not yet</WsBtn>
                <WsBtn kind="teal" disabled={busy} onClick={() => void closeIt()}>Yes, close it</WsBtn>
              </>
            ) : <WsBtn kind="teal" disabled={busy} onClick={() => setConfirming(true)}>Close defect</WsBtn>}
          </div>
        )
      )}

      {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
      {!p.canWrite && <WsEmpty>You can look at this defect. Changing it needs project write access.</WsEmpty>}
    </WsDialog>
  );
}
