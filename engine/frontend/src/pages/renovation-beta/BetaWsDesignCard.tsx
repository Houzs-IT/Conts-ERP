/* Beta Overview > Design progress, as the mockup's renderOv draws it: the condition pill, then Site measure, 3D, 2D,
   Carpentry measure, Site briefing, PO and Handover, each with its state and its buttons. It is built from the same board
   logic as Home and Calendar (renovationBetaBoard.ts), so the dates and the condition match them. The buttons need
   projects.write; the forms are the shared ones from BetaForms.tsx. */

import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorText } from "../projects/renovation/renovationModel";
import { BTN, BTN_AMEND, BTN_CONFIRM, BTN_MAIN, CondPill, PoDoneButton } from "./BetaCalParts";
import type { BetaDialog } from "./BetaForms";
import { WS, WsCard } from "./BetaWsUi";
import type { BoardView } from "./betaShared";
import {
  add, adone, APPT_LABEL, apptKindOf, apptWithDefault, conditionText, designKind, designSteps, diff, ds, measured, ord, projectBookings, stage, status, stepDone, whoName,
  type ApptKey, type CalEvent, type Kind,
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

  const btn = (label: string, onClick: () => void, style: CSSProperties = BTN): ReactElement => (
    <button key={label} type="button" disabled={busy} onClick={onClick} style={style}>{label}</button>
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
        ), BTN_MAIN) : null,
      };
    }
    if (g.st === "ok") return { body: <>{ok("Approved")}{mut(am)}</>, buttons: null };
    if (g.st === "wait") {
      return {
        body: <span style={{ color: WS.blue, fontWeight: 600 }}>Sent {g.r.done ? ds(g.r.done) : ""} · waiting client</span>,
        buttons: canWrite ? (
          <>
            {btn("+ Amendment", () => openDialog({ t: "amend", projectId: p.id, k }), BTN_AMEND)}
            {btn("Approved", () => void act(
              () => approveNewest(raw, designKind(k), m.today, p.customer ?? "Client"),
              k === "3" ? "3D approved · 2D is ready to start" : "2D approved · now PO, carpentry measure and site briefing",
            ), BTN_CONFIRM)}
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
    // Done once its booked day has passed (owner, 19 Nov 2026), the site measure too; that day is the one shown.
    if (a && adone(m, a)) return { body: ok(`Done ${ds(a.d)}`), buttons: null };
    if (a?.d) {
      return {
        body: <span style={{ color: WS.blue, fontWeight: 600 }}>{ds(a.d)}{a.t ? ` ${a.t}` : ""} · with {a.with || apptWithDefault(p, key)}</span>,
        buttons: canWrite ? (
          <>
            {btn("Edit", () => openDialog({ t: "book", projectId: p.id, key }))}
            {btn("Done", () => void act(() => boardApi.appointmentDone(p.id, apptKindOf(key)), "Marked done"), BTN_MAIN)}
          </>
        ) : null,
      };
    }
    if (!gate) return { body: mut(gateText), buttons: null };
    return {
      body: mut("Not booked"),
      buttons: canWrite ? (
        <>
          {btn("Book time", () => openDialog({ t: "book", projectId: p.id, key }), BTN_MAIN)}
        </>
      ) : null,
    };
  };

  const siteName = p.site?.name ?? "Site PIC";
  /* The rows follow Design work in Project Maintenance (owner, 19 Nov 2026), then Variants. */
  const workOf = new Map(m.workTypes.map((w) => [w.code, w] as const));
  const custom = (code: string): { body: ReactNode; buttons: ReactNode } => {
    const w = p.works[code];
    const wt = workOf.get(code);
    if (stepDone(m, p, code)) return { body: ok(`Done ${w ? ds(w.d) : ""}`), buttons: null };
    if (w) {
      // The booking itself, so it can be moved from here as the appointment rows can (before, only the calendar could).
      const ev = canWrite ? m.events.find((e) => e.projectId === p.id && e.type === code && e.d === w.d) : undefined;
      return {
        body: <span style={{ color: WS.blue, fontWeight: 600 }}>{ds(w.d)}{w.t ? ` ${w.t}` : ""}</span>,
        buttons: ev ? btn("Edit", () => openDialog({ t: "work", ev, day: ev.d })) : null,
      };
    }
    if (!canWrite) return { body: mut(wt?.bookable === false ? "Not done" : "Not booked"), buttons: null };
    if (wt?.bookable === false) {
      return {
        body: mut("Not done"),
        buttons: btn("Done", () => void act(async () => {
          const r = await boardApi.addEvent({ projectId: p.id, onDate: m.today, atTime: null, type: code, note: null, personId: null });
          await boardApi.saveEvent(r.id, { done: true });
        }, `${wt.label} done`), BTN_MAIN),
      };
    }
    return { body: mut("Not booked"), buttons: btn("Book time", () => openDialog({ t: "work", ev: null, day: m.today, preset: { projectId: p.id, type: code } }), BTN_MAIN) };
  };
  const row = (code: string, label: string): Line => {
    switch (code) {
      case "measure": return { key: code, label: workOf.get(code)?.label ?? label, ...(measured(m, p) ? { body: ok(`Done${p.measuredOn ? ` ${ds(p.measuredOn)}` : ""}`), buttons: null } : appt("msr", true, "")) };
      case "w3d": return { key: code, label: `${workOf.get(code)?.label ?? "3D"} · by ${p.by["3"]?.name ?? "not set"}`, ...design("3") };
      case "w2d": return { key: code, label: `${workOf.get(code)?.label ?? "2D"} · by ${p.by["2"]?.name ?? "not set"}`, ...design("2") };
      case "payment_2": return {
        key: code, label: workOf.get(code)?.label ?? "Second payment",
        body: p.paid == null ? mut(p.payment ?? "No SO yet") : (p.paid >= 2 ? ok("Received") : mut(p.payment ?? "Not received")), buttons: null,
      };
      case "carpentry": return { key: code, label: workOf.get(code)?.label ?? "Carpentry measure", ...appt("cm", p.design["2"].ok, "After 2D approved") };
      case "briefing": return { key: code, label: `${workOf.get(code)?.label ?? "Site briefing"} · ${siteName}`, ...appt("sb", !!p.appts.cm?.d, "After carpentry measure") };
      case "variants": return {
        key: code, label: "Variants",
        body: p.variants.lines === 0 ? mut("No sales order lines yet")
          : p.variants.missing === 0 ? ok(`All ${p.variants.lines} lines picked`)
          : (
            <>
              <span style={{ color: WS.amber, fontWeight: 700 }}>{p.variants.missing} of {p.variants.lines} lines still need a variant</span>
              {p.variants.pending.map((x, i) => (
                <span key={`${x.itemCode}-${i}`} style={{ display: "block", color: BETA.muted }}>{x.itemCode} · {x.missing.join(", ")}</span>
              ))}
              {p.variants.missing > p.variants.pending.length && mut(`+${p.variants.missing - p.variants.pending.length} more`)}
            </>
          ),
        buttons: p.variants.missing > 0 ? <Link to={`/beta/projects/${p.id}?tab=po`} className="link" style={{ fontSize: 13, fontWeight: 600 }}>Pick on the SO tab →</Link> : null,
      };
      default: return { key: code, label: workOf.get(code)?.label ?? label, ...custom(code) };
    }
  };
  const lines: Line[] = designSteps(m).map(([code, label]) => row(code, label));
  if (p.handover) {
    const hl = diff(p.handover, m.today);
    lines.push({ key: "handover", label: `Handover · ${siteName}`, body: mut(`${ds(p.handover)} · ${hl < 0 ? `${-hl} days ago` : `${hl} days left`}`), buttons: null });
  }

  /* Book appointment (owner, 20 Nov 2026): any bookable work of the list, as often as needed (a second site visit, an
     internal meeting), with a date, a time and who goes; the person picked sees it on their own calendar. The step
     buttons above stay as they are. */
  const firstType = m.workTypes.find((w) => w.active && w.bookable && !w.inDesign)?.code ?? m.workTypes.find((w) => w.active && w.bookable)?.code ?? "client";
  const bookings = projectBookings(m, p.id);
  const typeLabel = (e: CalEvent): string => (e.appt ? APPT_LABEL[e.appt.key] : workOf.get(e.type)?.label ?? e.type);

  return (
    <WsCard title="Design progress" gap={10} right={
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        {canWrite && btn("+ Book appointment", () => openDialog({ t: "work", ev: null, day: m.today, preset: { projectId: p.id, type: firstType } }), BTN_MAIN)}
        <Link to="/beta/calendar" className="link">Calendar →</Link>
      </span>
    }>
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
      <div style={{ borderTop: `1px solid ${BETA.line}`, paddingTop: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Appointments <span style={{ color: BETA.muted, fontWeight: 600 }}>{bookings.length}</span></div>
        {bookings.length === 0 && <div style={{ fontSize: 13, color: BETA.muted, padding: "6px 0" }}>Nothing booked yet.</div>}
        {bookings.map((e) => {
          const who = whoName(e);
          const past = e.d < m.today;
          return (
            <div key={e.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", padding: "8px 0", borderTop: `1px solid ${BETA.lineSoft}`, opacity: past ? 0.7 : 1 }}>
              <div style={{ flex: "0 0 92px", fontSize: 13, fontWeight: 700, color: past ? BETA.muted : WS.blue }}>{ds(e.d)}{e.t ? ` ${e.t}` : ""}</div>
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{typeLabel(e)}{e.done ? <span style={{ color: WS.green, fontWeight: 700, fontSize: 12 }}> · Done</span> : null}</div>
                <div style={{ fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{[who ?? "Nobody", e.appt ? null : e.note || null].filter(Boolean).join(" · ")}</div>
              </div>
              {canWrite && btn("Edit", () => openDialog(e.appt ? { t: "book", projectId: p.id, key: e.appt.key } : { t: "work", ev: e, day: e.d }))}
            </div>
          );
        })}
      </div>
    </WsCard>
  );
}
