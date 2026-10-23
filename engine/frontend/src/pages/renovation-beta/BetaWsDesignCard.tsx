/* Beta Overview > Design progress, as the mockup's renderOv draws it: the condition pill, then Site measure, 3D, 2D,
   Carpentry measure, Site briefing, PO and Handover, each with its state and its buttons. It is built from the same board
   logic as Home and Calendar (renovationBetaBoard.ts), so the dates and the condition match them. The buttons need
   projects.write; the forms are the shared ones from BetaForms.tsx. */

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorText } from "../projects/renovation/renovationModel";
import { BTN, BTN_MAIN, CondPill, PoDoneButton } from "./BetaCalParts";
import type { BetaDialog } from "./BetaForms";
import { WS, WsCard } from "./BetaWsUi";
import type { BoardView } from "./betaShared";
import {
  add, adone, apptKindOf, apptWithDefault, conditionText, designKind, diff, ds, measured, ord, stage, status, type ApptKey, type Kind,
} from "./renovationBetaBoard";
import { approveNewest, boardApi } from "./renovationBetaBoardApi";
import { BETA, betaDueTone } from "./renovationBetaTheme";

interface Props {
  board: BoardView;
  canWrite: boolean;
  openDialog: (dialog: BetaDialog) => void;
  /** After a write: says what happened and reloads Beta. */
  onDone: (text: string) => void;
  onError: (text: string) => void;
}

interface Line { key: string; label: string; body: ReactNode; buttons: ReactNode }

const ok = (t: string): ReactElement => <span style={{ color: WS.green, fontWeight: 700 }}>{t}</span>;
const mut = (t: string): ReactElement => <span style={{ color: BETA.muted }}>{t}</span>;
const stack: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };

export function BetaWsDesignCard({ board, canWrite, openDialog, onDone, onError }: Props): ReactElement {
  const { m, p, raw } = board;
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, text: string): Promise<void> {
    setBusy(true);
    try {
      await fn();
      onDone(text);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = (label: string, onClick: () => void, main = false): ReactElement => (
    <button key={label} type="button" disabled={busy} onClick={onClick} style={main ? BTN_MAIN : BTN}>{label}</button>
  );

  const design = (k: Kind): { body: ReactNode; buttons: ReactNode } => {
    const g = stage(m, p, k);
    const n = p.design[k].am.length;
    const am = n ? ` · ${n} ${n > 1 ? "amendments" : "amendment"}` : "";
    const ok3 = p.design["3"].ok;
    if (g.st === "none") {
      const blocked = k === "2" && !ok3;
      return {
        body: mut(blocked ? "After 3D" : "Not started"),
        buttons: !blocked && canWrite ? btn(`Start ${k}D today`, () => void act(
          () => boardApi.saveDesign(p.id, k === "3" ? { start3dOn: m.today } : { start2dOn: m.today }),
          `${k}D started · due ${ds(add(m.today, m.sop[k]))}`,
        ), true) : null,
      };
    }
    if (g.st === "ok") return { body: <>{ok("Approved")}{mut(am)}</>, buttons: null };
    if (g.st === "wait") {
      return {
        body: <span style={{ color: WS.blue, fontWeight: 600 }}>Sent {g.r.done ? ds(g.r.done) : ""} · waiting client</span>,
        buttons: canWrite ? (
          <>
            {btn("+ Amendment", () => openDialog({ t: "amend", projectId: p.id, k }))}
            {btn("Approved", () => void act(
              () => approveNewest(raw, designKind(k), m.today, p.customer ?? "Client"),
              k === "3" ? "3D approved · 2D is ready to start" : "2D approved · now PO, carpentry measure and site briefing",
            ), true)}
          </>
        ) : null,
      };
    }
    const l = diff(g.due, m.today);
    const [ink] = betaDueTone(l);
    return {
      body: (
        <>
          <span style={{ color: ink, fontWeight: 700 }}>{g.r.n ? `${ord(g.r.n)} amendment · ` : ""}due {ds(g.due)} ({l < 0 ? `${-l}d late` : `${l}d left`})</span>
          <br />
          {mut("Marks itself sent when you upload it in Drawings")}
        </>
      ),
      buttons: null,
    };
  };

  const appt = (key: ApptKey, gate: boolean, gateText: string): { body: ReactNode; buttons: ReactNode } => {
    const a = p.appts[key];
    if (a && adone(m, a)) return { body: ok(`Done ${ds(a.d)}`), buttons: null };
    if (a?.d) {
      return {
        body: <span style={{ color: WS.blue, fontWeight: 600 }}>{ds(a.d)}{a.t ? ` ${a.t}` : ""} · with {a.with || apptWithDefault(p, key)}</span>,
        buttons: canWrite ? (
          <>
            {btn("Edit", () => openDialog({ t: "book", projectId: p.id, key }))}
            {btn("Done", () => void act(() => boardApi.appointmentDone(p.id, apptKindOf(key)), "Marked done"), true)}
          </>
        ) : null,
      };
    }
    if (!gate) return { body: mut(gateText), buttons: null };
    return { body: mut("Not booked"), buttons: canWrite ? btn("Book time", () => openDialog({ t: "book", projectId: p.id, key }), true) : null };
  };

  const d3 = design("3");
  const d2 = design("2");
  const cm = appt("cm", p.design["2"].ok, "After 2D approved");
  const sb = appt("sb", !!p.appts.cm?.d, "After carpentry measure");
  const siteName = p.site?.name ?? "Site PIC";
  const lines: Line[] = [
    { key: "msr", label: "Site measure", ...(measured(m, p) ? { body: ok("Done"), buttons: null } : appt("msr", true, "")) },
    { key: "3", label: `3D · by ${p.by["3"]?.name ?? "not set"}`, ...d3 },
    { key: "2", label: `2D · by ${p.by["2"]?.name ?? "not set"}`, ...d2 },
    { key: "cm", label: "Carpentry measure", ...cm },
    { key: "sb", label: `Site briefing · ${siteName}`, ...sb },
    {
      key: "po", label: "PO",
      ...(p.po ? { body: ok("Done"), buttons: null }
        : p.design["2"].ok ? { body: mut("Done by itself when Client PO is sent"), buttons: canWrite ? <PoDoneButton projectId={p.id} today={m.today} onDone={onDone} onError={onError} /> : null }
        : { body: mut("After 2D approved"), buttons: null }),
    },
  ];
  if (p.handover) {
    const hl = diff(p.handover, m.today);
    lines.push({ key: "handover", label: `Handover · ${siteName}`, body: mut(`${ds(p.handover)} · ${hl < 0 ? `${-hl} days ago` : `${hl} days left`}`), buttons: null });
  }

  return (
    <WsCard title="Design progress" gap={10} right={<Link to="/beta/calendar" style={{ fontSize: 13, fontWeight: 600 }}>Calendar →</Link>}>
      <div><CondPill text={conditionText(m, p)} words={status(m, p)[1]} /></div>
      <div>
        {lines.map((l) => (
          <div key={l.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "9px 0", borderTop: `1px solid ${BETA.lineSoft}` }}>
            <div style={{ flex: "1 1 160px", minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{l.label}</div>
              <div style={{ fontSize: 12 }}>{l.body}</div>
            </div>
            {l.buttons && <div style={stack}>{l.buttons}</div>}
          </div>
        ))}
      </div>
    </WsCard>
  );
}
