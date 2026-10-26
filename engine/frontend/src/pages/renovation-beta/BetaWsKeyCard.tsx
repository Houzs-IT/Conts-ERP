/* Beta Overview > Unit key, as the mockup draws it: who holds the key now and for how many days, "+ Key passed",
   and the history. Same calls as the project page's key card (key log, add, edit, delete), so a key pass recorded here
   shows there too. A message shows inside the card: the page notice can be out of sight when this card is in view. */

import { useState, type ReactElement } from "react";
import { useDialog } from "../../hooks/useDialog";
import { useQuery } from "../../hooks/useQuery";
import { daysBetween, keyDraftRefusal, keyLogRows, type KeyDraft } from "../projects/renovation/keyLog";
import { PersonSelect } from "../projects/renovation/PersonSelect";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi, type KeyMove, type ProjectDetailV2 } from "../projects/renovation/simpleApi";
import { WS, WsBtn, WsCard, WsField, btnStyle, inputStyle } from "./BetaWsUi";
import { dayMonth, dayMonthYear } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

interface Props { d: ProjectDetailV2; canWrite: boolean; today: string; onDone: (text: string) => void }

const days = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;

export function BetaWsKeyCard({ d, canWrite, today, onDone }: Props): ReactElement {
  const id = d.project.id;
  const q = useQuery(["renovation", "keys", id], () => simpleApi.keyLog(id), [id]);
  const dialog = useDialog();
  const holder = d.keyHolder;
  const fresh = (): KeyDraft => ({ on: today, from: holder?.personId ?? null, to: null });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<KeyDraft>(fresh);
  const [editing, setEditing] = useState<{ moveId: number; draft: KeyDraft } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const rows = keyLogRows(q.data?.data ?? [], today);
  const loaded = !q.loading || q.data != null;
  const formOpen = canWrite && (adding || (loaded && rows.length === 0));
  const shown = showAll ? rows : rows.slice(0, 3);

  async function save(fn: () => Promise<unknown>, ok: string, after?: () => void): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      after?.();
      q.reload();
      setMsg({ tone: "ok", text: ok });
      onDone(ok);
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }
  function submitNew(): void {
    const refusal = keyDraftRefusal(draft, today);
    if (refusal) { setMsg({ tone: "err", text: refusal }); return; }
    void save(() => simpleApi.addKeyMove(id, { movedOn: draft.on, fromPersonId: draft.from, toPersonId: draft.to }), "Key pass recorded.",
      () => { setAdding(false); setDraft({ on: today, from: draft.to, to: null }); });
  }
  function submitEdit(): void {
    if (!editing) return;
    const refusal = keyDraftRefusal(editing.draft, today);
    if (refusal) { setMsg({ tone: "err", text: refusal }); return; }
    const e = editing;
    void save(() => simpleApi.editKeyMove(e.moveId, { movedOn: e.draft.on, fromPersonId: e.draft.from, toPersonId: e.draft.to }), "Key pass updated.", () => setEditing(null));
  }
  async function remove(r: KeyMove): Promise<void> {
    const text = `${dayMonthYear(r.moved_on)}: ${r.from_person_name ?? "-"} to ${r.to_person_name ?? "-"}`;
    const ok = await dialog.confirm({ title: "Delete this key pass?", message: text, confirmLabel: "Delete", danger: true });
    if (ok) void save(() => simpleApi.deleteKeyMove(r.id), "Key pass deleted.");
  }

  return (
    <WsCard
      title="Unit key"
      gap={12}
      right={canWrite && !formOpen ? (
        <button
          type="button"
          onClick={() => { setMsg(null); setDraft(fresh()); setAdding(true); }}
          style={btnStyle("outline", "sm")}
        >
          + Key passed
        </button>
      ) : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 14, background: "transparent" }}>
        {holder ? (
          <>
            <div>
              <div style={{ fontSize: 12, color: BETA.muted }}>Now with</div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{holder.name ?? "Someone not in the list"}</div>
              <div style={{ fontSize: 12, color: BETA.muted }}>since {dayMonthYear(holder.movedOn)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, letterSpacing: "-.02em" }}>{daysBetween(holder.movedOn, today)}</div>
              <div style={{ fontSize: 12, color: BETA.muted }}>days</div>
            </div>
          </>
        ) : <div style={{ fontSize: 14, color: BETA.muted }}>No key pass recorded.</div>}
      </div>

      {formOpen && (
        <div role={adding ? "group" : undefined} aria-label={adding ? "Record key pass" : undefined} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: `1.5px solid ${BETA.blue}`, borderRadius: 14 }}>
          <KeyFields draft={draft} onChange={setDraft} today={today} prefix="New key pass" />
          <div style={{ display: "flex", gap: 8 }}>
            {adding && <WsBtn style={{ flex: 1 }} disabled={busy} onClick={() => { setAdding(false); setMsg(null); }}>Cancel</WsBtn>}
            <WsBtn kind="teal" style={{ flex: 2 }} disabled={busy} onClick={submitNew}>{busy ? "Saving..." : "Save key pass"}</WsBtn>
          </div>
          {msg?.tone === "err" && !editing && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{msg.text}</p>}
        </div>
      )}
      {msg && (msg.tone === "ok" || editing != null || !formOpen) && (
        <p role={msg.tone === "err" ? "alert" : "status"} style={{ fontSize: 13, color: msg.tone === "err" ? WS.red : WS.green }}>{msg.text}</p>
      )}
      {q.loading && rows.length === 0 && <p style={{ fontSize: 13, color: BETA.muted }}>Loading key log...</p>}
      {q.error && rows.length === 0 && <p role="alert" style={{ fontSize: 13, color: WS.red }}>The key log could not be loaded: {q.error}</p>}

      {rows.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: BETA.muted, fontWeight: 600, marginBottom: 4 }}>History</div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
            {shown.map((r) => editing?.moveId === r.id ? (
              <li key={r.id} style={{ padding: "8px 0", borderTop: `1px solid ${WS.rowLine}`, display: "flex", flexDirection: "column", gap: 8 }}>
                <KeyFields draft={editing.draft} onChange={(x) => setEditing({ moveId: r.id, draft: x })} today={today} prefix="Edit key pass" />
                <div style={{ display: "flex", gap: 8 }}>
                  <WsBtn style={{ flex: 1 }} disabled={busy} onClick={() => setEditing(null)}>Cancel</WsBtn>
                  <WsBtn kind="teal" style={{ flex: 1 }} disabled={busy} onClick={submitEdit}>Save</WsBtn>
                </div>
              </li>
            ) : (
              <li key={r.id} style={{ display: "grid", gridTemplateColumns: canWrite ? "80px 1fr auto auto" : "80px 1fr auto", gap: 8, padding: "8px 0", borderTop: `1px solid ${WS.rowLine}`, alignItems: "center" }}>
                <span style={{ color: BETA.muted }}>{dayMonth(r.moved_on)}</span>
                <span style={{ overflowWrap: "anywhere" }}>{r.from_person_name ?? "–"} → <b>{r.to_person_name ?? "–"}</b></span>
                <span style={{ color: BETA.muted }}>{days(r.daysHeld)}</span>
                {canWrite && (
                  <span style={{ display: "flex", gap: 10 }}>
                    <button type="button" className="link" disabled={busy} aria-label={`Edit key pass of ${dayMonthYear(r.moved_on)}`}
                      onClick={() => { setMsg(null); setEditing({ moveId: r.id, draft: { on: r.moved_on, from: r.from_person_id, to: r.to_person_id } }); }}>Edit</button>
                    <button type="button" className="link" disabled={busy} aria-label={`Delete key pass of ${dayMonthYear(r.moved_on)}`} style={{ color: WS.red }}
                      onClick={() => void remove(r)}>Delete</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {rows.length > 3 && (
            <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => setShowAll((x) => !x)}>
              {showAll ? "Show latest 3" : `Show all ${rows.length} moves`}
            </button>
          )}
        </div>
      )}
    </WsCard>
  );
}

/** From, To, Date: the mockup's key pass form. */
function KeyFields({ draft, onChange, today, prefix }: { draft: KeyDraft; onChange: (d: KeyDraft) => void; today: string; prefix: string }): ReactElement {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <WsField label="From"><PersonSelect label={`${prefix} from`} placeholder="Optional" value={draft.from} onChange={(v) => onChange({ ...draft, from: v })} className="ws-input-sm" /></WsField>
        <WsField label="To"><PersonSelect label={`${prefix} to`} placeholder="Choose person" value={draft.to} onChange={(v) => onChange({ ...draft, to: v })} className="ws-input-sm" /></WsField>
      </div>
      <WsField label="Date">
        <input type="date" aria-label={`${prefix} date`} style={{ ...inputStyle, minHeight: 38 }} value={draft.on} max={today} onChange={(e) => onChange({ ...draft, on: e.target.value })} />
      </WsField>
    </>
  );
}
