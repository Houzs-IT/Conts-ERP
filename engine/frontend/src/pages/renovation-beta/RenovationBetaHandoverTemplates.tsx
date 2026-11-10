/* Projects > Handover checklists (TODO item 17, after Hookka's QC templates; migration 0296): the company's checklists
   for walking a unit before handover. Each is a list of things to check, under a room or area, with what good looks
   like. A project's Defects tab starts a check from one; the check keeps its own copy, so editing a checklist here never
   changes a check already started. Editing needs projects.manage (like Beta's settings); everyone with project list
   access can read them. */

import { useState, type ReactElement } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { errorText } from "../projects/renovation/renovationModel";
import { BetaLoading } from "./BetaLoading";
import { BetaSkin, WS, WsBadge, WsBtn, WsEmpty, WsField, WsNotice, WsPageHead, WsStyle, inputStyle, TONE_QUIET } from "./BetaWsUi";
import { useGuarded } from "./betaShared";
import { handoverApi, type HandoverTemplate, type TemplateItem } from "./renovationBetaHandoverApi";
import { cleanRows, moveRow } from "./renovationBetaHandoverModel";
import { BETA } from "./renovationBetaTheme";

export function RenovationBetaHandoverTemplates(): ReactElement {
  return (
    <>
      <BetaSkin />
      <TemplatesScreen />
    </>
  );
}

type Editing = { id: number | null; name: string; active: boolean; rows: TemplateItem[] };
/* One grid for the heading and every row; on a phone each row stacks and the heading goes. */
const ROW_CSS = `.bws .hct-row{display:grid;grid-template-columns:minmax(110px,1fr) minmax(160px,2fr) minmax(160px,2fr) 124px;gap:8px;align-items:center}
@media (max-width:700px){.bws .hct-row{grid-template-columns:1fr}.bws .hct-head{display:none}}`;

const blankRow = (): TemplateItem => ({ area: "", item: "", criteria: "" });
const editOf = (t: HandoverTemplate): Editing => ({ id: t.id, name: t.name, active: t.active, rows: t.items.map((i) => ({ area: i.area ?? "", item: i.item, criteria: i.criteria ?? "" })) });

function TemplatesScreen(): ReactElement {
  const { can } = useAuth();
  const canManage = can("projects.manage");
  const q = useQuery(["renovation-beta", "handover-templates", "all"], () => handoverApi.templates(true), []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const templates = q.data && q.data.ready ? q.data.templates : [];
  return (
    <div className="bws" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", minWidth: 0, paddingBottom: 40 }}>
      <WsStyle />
      <style>{ROW_CSS}</style>
      <WsPageHead
        title="Handover checklists"
        sub="What to check in each room before the client signs. A project's Defects tab starts a check from one."
        right={canManage && !editing && q.data?.ready ? (
          <WsBtn kind="dark" onClick={() => { setNotice(null); setEditing({ id: null, name: "", active: true, rows: [blankRow()] }); }}><Plus size={16} aria-hidden="true" />New checklist</WsBtn>
        ) : undefined}
      />
      <div aria-live="polite">{notice && <WsNotice tone={notice.tone}>{notice.text}</WsNotice>}</div>

      {q.loading && !q.data ? <BetaLoading label="Loading checklists" size="inline" />
        : q.error && !q.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The checklists could not be loaded: {q.error}</p>
        : q.data && !q.data.ready ? <WsEmpty>Handover checklists are not switched on yet.</WsEmpty>
        : editing ? (
          <Editor key={editing.id ?? "new"} start={editing} onCancel={() => setEditing(null)}
            onSaved={(text) => { setEditing(null); setNotice({ tone: "ok", text }); q.reload(); }} />
        ) : templates.length === 0 ? <WsEmpty>No checklist yet.</WsEmpty>
        : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {templates.map((t) => (
              <li key={t.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", padding: "12px 16px", background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{t.name}</div>
                  <div style={{ fontSize: 13, color: BETA.muted }}>{t.items.length} thing{t.items.length === 1 ? "" : "s"} to check · {[...new Set(t.items.map((i) => i.area ?? "General"))].length} areas</div>
                </div>
                {!t.active && <WsBadge tone={TONE_QUIET}>Switched off</WsBadge>}
                <WsBtn size="sm" onClick={() => { setNotice(null); setEditing(editOf(t)); }}>{canManage ? "Edit" : "View"}</WsBtn>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function Editor({ start, onCancel, onSaved }: { start: Editing; onCancel: () => void; onSaved: (text: string) => void }): ReactElement {
  const { can } = useAuth();
  const canManage = can("projects.manage");
  const [name, setName] = useState(start.name);
  const [active, setActive] = useState(start.active);
  const [rows, setRows] = useState<TemplateItem[]>(start.rows);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useGuarded();
  const set = (i: number, patch: Partial<TemplateItem>): void => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = (): Promise<void> => run(async () => {
    setError(null);
    const items = cleanRows(rows);
    try {
      if (start.id == null) await handoverApi.createTemplate({ name, active, items });
      else await handoverApi.saveTemplate(start.id, { name, active, items });
      onSaved(start.id == null ? "Checklist added." : "Checklist saved. Checks already started keep their own list.");
    } catch (e) {
      setError(errorText(e));
    }
  });

  return (
    <section aria-label={start.id == null ? "New checklist" : `Edit ${start.name}`} style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <WsField label="Name" style={{ flex: "1 1 260px" }}>
          <input style={inputStyle} value={name} maxLength={120} disabled={!canManage} placeholder="e.g. Condo handover" onChange={(e) => setName(e.target.value)} />
        </WsField>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, minHeight: 40 }}>
          <input type="checkbox" checked={active} disabled={!canManage} onChange={(e) => setActive(e.target.checked)} />
          In use (offered when starting a check)
        </label>
      </div>

      <div role="table" aria-label="Things to check" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div role="row" className="hct-row hct-head" style={{ fontSize: 12, color: BETA.muted, padding: "0 8px" }}>
          <span role="columnheader">Room or area</span><span role="columnheader">What to check</span><span role="columnheader">What good looks like</span><span role="columnheader" className="sr">Move or remove</span>
        </div>
        {rows.map((r, i) => (
          <div role="row" key={i} className="hct-row" style={{ padding: 8, borderRadius: 10, background: WS.panel }}>
            <input aria-label={`Area, row ${i + 1}`} style={inputStyle} value={r.area ?? ""} maxLength={120} disabled={!canManage} placeholder="Kitchen" onChange={(e) => set(i, { area: e.target.value })} />
            <input aria-label={`What to check, row ${i + 1}`} style={inputStyle} value={r.item} maxLength={300} disabled={!canManage} placeholder="Cabinet doors" onChange={(e) => set(i, { item: e.target.value })} />
            <input aria-label={`What good looks like, row ${i + 1}`} style={inputStyle} value={r.criteria ?? ""} maxLength={500} disabled={!canManage} placeholder="Aligned, soft-close" onChange={(e) => set(i, { criteria: e.target.value })} />
            {canManage && (
              <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <WsBtn size="sm" disabled={i === 0} onClick={() => setRows((x) => moveRow(x, i, -1))} style={{ minWidth: 36, padding: 0 }}><ArrowUp size={14} aria-label="Move up" /></WsBtn>
                <WsBtn size="sm" disabled={i === rows.length - 1} onClick={() => setRows((x) => moveRow(x, i, 1))} style={{ minWidth: 36, padding: 0 }}><ArrowDown size={14} aria-label="Move down" /></WsBtn>
                <WsBtn size="sm" kind="danger" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} style={{ minWidth: 36, padding: 0 }}><Trash2 size={14} aria-label="Remove row" /></WsBtn>
              </span>
            )}
          </div>
        ))}
        {canManage && <WsBtn size="sm" onClick={() => setRows((x) => [...x, { area: x[x.length - 1]?.area ?? "", item: "", criteria: "" }])} style={{ alignSelf: "flex-start" }}><Plus size={14} aria-hidden="true" />Add a row</WsBtn>}
      </div>

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: WS.red }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <WsBtn disabled={busy} onClick={onCancel}>{canManage ? "Cancel" : "Back"}</WsBtn>
        {canManage && <WsBtn kind="dark" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save checklist"}</WsBtn>}
      </div>
    </section>
  );
}
