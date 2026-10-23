/* Beta workspace header, as the mockup's project page opens: the name in capitals, the code line, the team chips
   with WhatsApp and Assign, and the stage stepper. */

import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { errorText } from "../projects/renovation/renovationModel";
import { PersonSelect, usePeople } from "../projects/renovation/PersonSelect";
import { simpleApi, type ProjectDetailV2 } from "../projects/renovation/simpleApi";
import { WS, WsAvatar, WsBadge, WsBtn, WsCheck, WsDialog, WsField, btnStyle, TONE_WAIT } from "./BetaWsUi";
import { dayMonthYear, initials, whatsappLink, type StepperItem } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

interface HeaderProps {
  d: ProjectDetailV2;
  canWrite: boolean;
  today: string;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}

const DAY_MS = 86_400_000;

/** "(25 days left)" in green, "(2 days late)" in red; null once the unit is handed over or when there is no planned date. */
function leftText(planned: string | null, today: string): { text: string; late: boolean } | null {
  if (!planned) return null;
  const n = Math.round((Date.parse(`${planned.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (Number.isNaN(n)) return null;
  const word = (k: number): string => `${k} day${k === 1 ? "" : "s"}`;
  return n >= 0 ? { text: `(${word(n)} left)`, late: false } : { text: `(${word(-n)} late)`, late: true };
}

interface Chip { key: string; role: string; name: string | null; lead?: boolean; id?: number | null }

export function BetaWsHeader({ d, canWrite, today, onDone, onError }: HeaderProps): ReactElement {
  const { project: p, people } = d;
  const [assigning, setAssigning] = useState(false);
  const peopleQ = usePeople();
  const handoverOn = p.handed_over_at ?? p.planned_handover_date;
  const left = p.handed_over_at ? null : leftText(p.planned_handover_date, today);
  const designer = people.designer.name;
  const chips: Chip[] = [
    { key: "lead", role: "Design lead", name: designer, lead: true, id: people.designer.id },
    { key: "3d", role: "3D", name: designer },
    { key: "2d", role: "2D", name: designer },
    { key: "site", role: "Site PIC · Handover lead", name: people.pic.name ?? people.renoPic.name },
  ];
  const phone = (peopleQ.data?.data ?? []).find((x) => x.id === people.designer.id)?.phone ?? null;
  const title = [p.name, p.customer_name].filter(Boolean).join(" · ").toUpperCase();
  const line = [p.code, d.type?.name, handoverOn ? `${p.handed_over_at ? "Handed over" : "Handover"} ${dayMonthYear(handoverOn)}` : "No handover date yet"].filter(Boolean).join(" · ");

  return (
    <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, flex: "1 1 320px" }}>
        <Link to="/beta/home" aria-label="Back to Beta home" style={{ ...btnStyle("outline", "lg"), width: 44, padding: 0, flex: "none" }}>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 className="h1" style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.01em", overflowWrap: "anywhere" }}>{title}</h1>
          <div style={{ marginTop: 4, color: BETA.muted, fontSize: 15 }}>
            {line}
            {left && <> <span style={{ color: left.late ? WS.red : WS.green, fontWeight: 600 }}>{left.text}</span></>}
          </div>
          <div role="group" aria-label="Project team" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
            {chips.map((c) => (
              <div
                key={c.key}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 6px", borderRadius: 10, background: c.lead ? "#E4F1EF" : BETA.surface, border: `1px solid ${c.lead ? "#A9D2CC" : BETA.line}` }}
              >
                <WsAvatar text={initials(c.name)} />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <span style={{ fontSize: 11, color: BETA.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{c.role}</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{c.name ?? "Not set"}</span>
                </span>
                {c.lead && designer && (
                  <a
                    href={whatsappLink(phone, `Hi ${designer}, about ${p.name}.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginLeft: 6, minHeight: 32, padding: "0 10px", borderRadius: 8, background: BETA.accent, color: "#FFFFFF", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                  >
                    WhatsApp<span className="sr"> {designer}</span>
                  </a>
                )}
              </div>
            ))}
            {canWrite && (
              <button type="button" onClick={() => setAssigning(true)} style={{ minHeight: 44, padding: "0 14px", border: `1.5px dashed ${BETA.accent}`, borderRadius: 10, background: BETA.surface, color: BETA.accentInk, font: "inherit", fontWeight: 700, cursor: "pointer" }}>
                Assign
              </button>
            )}
          </div>
        </div>
      </div>
      {assigning && <AssignDialog d={d} onClose={() => setAssigning(false)} onDone={onDone} onError={onError} />}
    </section>
  );
}

/** Assign opens the three people the project page already lets staff change; only the ones that changed are sent. */
export function AssignDialog({ d, onClose, onDone, onError }: { d: ProjectDetailV2; onClose: () => void; onDone: (t: string) => void; onError: (t: string) => void }): ReactElement {
  const { people } = d;
  const [designer, setDesigner] = useState<number | null>(people.designer.id);
  const [sales, setSales] = useState<number | null>(people.sales.id);
  const [pic, setPic] = useState<number | null>(people.pic.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const body: Parameters<typeof simpleApi.setPeople>[1] = {};
    if (designer !== people.designer.id) body.designerPersonId = designer;
    if (sales !== people.sales.id) body.salesPersonId = sales;
    if (pic !== people.pic.id) body.picPersonId = pic;
    if (Object.keys(body).length === 0) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await simpleApi.setPeople(d.project.id, body);
      onDone("Team saved.");
      onClose();
    } catch (e) {
      const text = errorText(e);
      setError(text);
      onError(text);
      setBusy(false);
    }
  }

  return (
    <WsDialog
      title="Assign"
      sub={d.project.name}
      onClose={onClose}
      footer={
        <>
          <WsBtn onClick={onClose} disabled={busy}>Cancel</WsBtn>
          <WsBtn kind="teal" onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Save"}</WsBtn>
        </>
      }
    >
      <WsField label="Design lead (3D and 2D)"><PersonSelect label="Design lead" role="designer" value={designer} onChange={setDesigner} placeholder="Not set" className="ws-input" /></WsField>
      <WsField label="Sales"><PersonSelect label="Sales" role="sales" value={sales} onChange={setSales} placeholder="Not set" className="ws-input" /></WsField>
      <WsField label="Site PIC (handover lead)"><PersonSelect label="Site PIC" value={pic} onChange={setPic} placeholder="Not set" className="ws-input" /></WsField>
      {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}

/* ---------- The stepper ---------- */

export function BetaWsStepper({ items, hold }: { items: StepperItem[]; hold: string | null }): ReactElement {
  return (
    <div style={{ overflowX: "auto", background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, padding: "20px 8px 16px" }}>
      <ol aria-label="Project stages" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", minWidth: 680 }}>
        {items.map((s, i) => {
          const last = i === items.length - 1;
          const done = s.state === "done";
          const now = s.state === "current";
          return (
            <li key={s.key} aria-current={now ? "step" : undefined} style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center" }}>
              {!last && <div aria-hidden="true" style={{ position: "absolute", top: 13, left: "50%", width: "100%", height: done ? 2 : 0, background: done ? BETA.accent : undefined, borderTop: done ? undefined : "2px dashed #C3CCCA" }} />}
              {done ? (
                <div style={{ position: "relative", width: 28, height: 28, borderRadius: 14, background: BETA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><WsCheck /></div>
              ) : now ? (
                <div style={{ position: "relative", width: 28, height: 28, borderRadius: 14, background: BETA.surface, border: `2px solid ${BETA.accent}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 7, background: BETA.accent }} />
                </div>
              ) : (
                <div style={{ position: "relative", width: 28, height: 28, borderRadius: 14, background: BETA.surface, border: `2px solid ${BETA.border}` }} />
              )}
              <div style={{ fontSize: 13, fontWeight: now ? 700 : 600, color: now ? BETA.accentInk : done ? BETA.ink : BETA.muted }}>
                {s.label}<span className="sr">{done ? " (done)" : now ? " (current step)" : " (not yet)"}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: now ? 600 : 400, color: now ? BETA.accentInk : BETA.muted }}>{s.sub}</div>
              {now && hold && <WsBadge tone={TONE_WAIT} size={11}>{hold}</WsBadge>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
