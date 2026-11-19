/* Beta workspace header, as the mockup's project page opens: the name in capitals, the code line, the team chips
   with WhatsApp and Assign, and the stage stepper. */

import { useState, type ReactElement, type ReactNode } from "react";
import type { StageLayer } from "./betaStageLayers";
import { Link } from "react-router-dom";
import { ArrowLeft, MessageCircle, Pencil } from "lucide-react";
import { motion } from "motion/react";
import { usePeople } from "../projects/renovation/PersonSelect";
import type { ProjectDetailV2 } from "../projects/renovation/simpleApi";
import type { AssignRole, BetaDialog } from "./BetaForms";
import { WS, WsAvatar, WsBadge, WsCheck, btnStyle, TONE_WAIT } from "./BetaWsUi";
import { personInfo, type BoardPerson, type DesignProject, type PersonRef } from "./renovationBetaBoard";
import { dayMonthYear, initials, whatsappLink, type StepperItem } from "./renovationBetaModel";
import { BETA, GLASS } from "./renovationBetaTheme";

interface HeaderProps {
  d: ProjectDetailV2;
  /** The project as Home and Calendar see it: the people on the chips come from here. */
  p: DesignProject;
  /** Every person of the company (board), for each chip's position and department. */
  people?: readonly BoardPerson[];
  canWrite: boolean;
  today: string;
  openDialog: (dialog: BetaDialog) => void;
  /** Shown at the header's right: Delete project, for those who manage projects. */
  actions?: ReactNode;
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

interface Chip { key: AssignRole; role: string; who: PersonRef[]; lead?: boolean }

/** First name plus "+N others": "Jia Xin", "Jia Xin +1 other", "Jia Xin +4 others". */
export function peopleLine(who: readonly PersonRef[]): string {
  if (who.length === 0) return "Not set";
  const rest = who.length - 1;
  return rest === 0 ? who[0].name : `${who[0].name} +${rest} other${rest === 1 ? "" : "s"}`;
}

/** Up to three overlapping avatars, then "+N". */
function AvatarStack({ who, ring }: { who: readonly PersonRef[]; ring: string }): ReactElement {
  const shown = who.slice(0, 3);
  const more = who.length - shown.length;
  return (
    <span aria-hidden="true" style={{ display: "flex", flex: "none" }}>
      {(shown.length ? shown : [null]).map((x, i) => (
        <span key={x?.id ?? "none"} style={{ marginLeft: i ? -6 : 0, borderRadius: 999, boxShadow: i ? `0 0 0 2px ${ring}` : undefined, display: "inline-flex" }}>
          <WsAvatar text={x ? initials(x.name) : "?"} size={28} bg={x ? BETA.avatar : BETA.border} />
        </span>
      ))}
      {more > 0 && (
        <span style={{ marginLeft: -6, boxShadow: `0 0 0 2px ${ring}`, borderRadius: 999, display: "inline-flex" }}>
          <WsAvatar text={`+${more}`} size={28} bg={WS.chip} color={WS.text2} />
        </span>
      )}
    </span>
  );
}

/** The chips' least height: the design's pill, and a full touch target. */
const CARD_H = 44;

export function BetaWsHeader({ d, p: board, people = [], canWrite, today, openDialog, actions }: HeaderProps): ReactElement {
  const { project: p } = d;
  const peopleQ = usePeople();
  const handoverOn = p.handed_over_at ?? p.planned_handover_date;
  const left = p.handed_over_at ? null : leftText(p.planned_handover_date, today);
  // 3D and 2D fall back to the design lead, as the mockup's o3 and o2 do.
  const designer = board.lead?.name ?? null;
  const chips: Chip[] = [
    { key: "lead", role: "Design lead", who: board.lead ? [board.lead] : [], lead: true },
    { key: "3", role: "3D", who: board.team["3"] },
    { key: "2", role: "2D", who: board.team["2"] },
    { key: "site", role: "Site PIC · Handover lead", who: board.site ? [board.site] : [] },
  ];
  const byId = new Map(people.map((x) => [x.id, x] as const));
  const infoOf = (id: number): string => personInfo(byId.get(id));
  const phone = (peopleQ.data?.data ?? []).find((x) => x.id === board.lead?.id)?.phone ?? null;
  // Project names usually already end with the customer ("... MR WAYNE"); add it only when missing.
  const customer = p.customer_name?.trim() ?? "";
  const withCustomer = customer && !p.name.toUpperCase().includes(customer.toUpperCase());
  const title = (withCustomer ? `${p.name} · ${customer}` : p.name).toUpperCase();
  const line = [p.code, d.type?.name, handoverOn ? `${p.handed_over_at ? "Handed over" : "Handover"} ${dayMonthYear(handoverOn)}` : "No handover date yet"].filter(Boolean).join(" · ");

  return (
    <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
      {/* A grid: the team chips sit under the title on a wide screen, and take the full width under it on a phone
          (.ws-head in BetaWsUi.tsx), where the column beside the back button was too narrow for them. */}
      <div className="ws-head" style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr)", columnGap: 12, alignItems: "start", minWidth: 0, flex: "1 1 320px" }}>
        <Link to="/beta/projects" aria-label="Back to the project list" style={{ ...btnStyle("outline", "lg"), width: 44, padding: 0 }}>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 className="h1" style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-.02em", overflowWrap: "anywhere" }}>{title}</h1>
          <div style={{ marginTop: 4, color: BETA.muted, fontSize: 14 }}>
            {line}
            {left && <> <span style={{ color: left.late ? WS.red : WS.green, fontWeight: 600 }}>{left.text}</span></>}
          </div>
        </div>
        <div role="group" aria-label="Project team" className="chips" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
          {chips.map((c) => {
            // The lead's tint is see-through, so it sits on a solid surface: the page's colour wash must not show through.
            const bg = c.lead ? `linear-gradient(${BETA.pick}, ${BETA.pick}), ${BETA.surface}` : BETA.surface;
            const one = c.who.length === 1 ? infoOf(c.who[0].id) : "";
            const extra = one || (c.who.length > 1 ? c.who.map((x) => x.name).join(", ") : "");
            // The chip fits its text, as the design's pills do; the third line shows only when it has something to say.
            const body = (
              <>
                <AvatarStack who={c.who} ring={BETA.surface} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.2, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: BETA.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.role}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{peopleLine(c.who)}</span>
                  {extra && <span style={{ fontSize: 12, color: BETA.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{extra}</span>}
                </span>
              </>
            );
            const box = { display: "flex", alignItems: "center", gap: 10, minHeight: CARD_H, maxWidth: 300, minWidth: 0, padding: "6px 14px 6px 8px", borderRadius: 32, background: bg, border: `1px solid ${c.lead ? BETA.border : BETA.glassEdge}`, boxSizing: "border-box" } as const;
            return (
              <div key={c.key} className={c.lead ? "chip-lead" : undefined} title={c.who.map((x) => x.name).join(", ") || undefined} style={{ ...box, padding: 0, gap: 0, overflow: "hidden" }}>
                {canWrite ? (
                  <button type="button" onClick={() => openDialog({ t: "assign", projectId: p.id, role: c.key })} aria-label={`${c.role}: ${c.who.map((x) => x.name).join(", ") || "not set"}. Change`}
                    style={{ ...box, border: 0, borderRadius: 0, flex: 1, background: "transparent", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}>
                    {body}
                    <Pencil size={14} aria-hidden="true" style={{ flex: "none", marginLeft: 2, color: BETA.muted }} />
                  </button>
                ) : <div style={{ ...box, border: 0, flex: 1, background: "transparent" }}>{body}</div>}
                {c.lead && designer && (
                  <a
                    href={whatsappLink(phone, `Hi ${designer}, about ${p.name}.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: "none", marginRight: 8, minHeight: 32, padding: "0 12px", borderRadius: 999, background: BETA.accentFill, color: "#FFFFFF", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                  >
                    <MessageCircle size={14} aria-hidden="true" />WhatsApp<span className="sr"> {designer}</span>
                  </a>
                )}
              </div>
            );
          })}
          {canWrite && (
            <button type="button" onClick={() => openDialog({ t: "assign", projectId: p.id })} style={{ minHeight: CARD_H, padding: "0 20px", border: `1.5px dashed ${BETA.dash}`, borderRadius: 999, background: "transparent", color: BETA.ink, font: "inherit", fontWeight: 600, cursor: "pointer" }}>
              Assign
            </button>
          )}
        </div>
      </div>
      {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: "none" }}>{actions}</div>}
    </section>
  );
}

/* ---------- The stepper ---------- */

/** On a narrow screen the stepper scrolls sideways; start it at the current step rather than at Sales order. */
function scrollIntoRow(el: HTMLLIElement | null): void {
  const box = el?.parentElement?.parentElement;
  if (!el || !box || box.scrollWidth <= box.clientWidth) return;
  const at = el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
  box.scrollLeft = Math.max(0, at - (box.clientWidth - el.offsetWidth) / 2);
}

/* The stepper's dots, as the designs draw them. The blue of a finished step and the red glow of the current one read the same on
   both skins; only the track and the steps still to come change with the skin (BETA.stepTrack, stepNext). */
const DOT_DONE = "radial-gradient(circle at 30% 25%,#FFFFFF 0%,#C9D6FF 30%,#8BA8FF 62%,#3F6FF0 100%)";
const DOT_NOW = "radial-gradient(circle at 32% 26%,#FFD0DA 0%,#F7889E 55%,#EE5C78 100%)";
const LINE_DONE = "linear-gradient(90deg,#6E9BFF,#C9A6F2,#F6A9C4)";

/** Press a stage to see its own steps underneath (owner, 19 Nov 2026): Design and Renovation have a second layer, the
    other stages one line saying when they complete. It opens on the current stage. */
export function BetaWsStepper({ items, hold, layers }: { items: StepperItem[]; hold: string | null; layers?: Readonly<Record<string, StageLayer>> }): ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  const openKey = picked ?? items.find((s) => s.state === "current")?.key ?? items[0]?.key ?? null;
  const layer = openKey && layers ? layers[openKey] : undefined;
  // On a phone (.step-cap) the dots fit the width and only the current step is written out under them.
  const capAt = Math.max(items.findIndex((s) => s.state === "current"), items.map((s) => s.state).lastIndexOf("done"), 0);
  const cap = items[capAt];
  return (
    // .no-bar: a tablet still scrolls sideways, without the grey bar and arrows inside the card.
    <div className="no-bar" style={{ ...GLASS, overflowX: "auto", overflowY: "hidden", borderRadius: 26, padding: "20px 8px 16px" }}>
      <ol aria-label="Project stages" className="steps" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", minWidth: 560 }}>
        {items.map((s, i) => {
          const last = i === items.length - 1;
          const done = s.state === "done";
          const now = s.state === "current";
          const dot = { position: "relative", boxSizing: "border-box", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" } as const;
          return (
            <motion.li key={s.key} ref={now ? scrollIntoRow : undefined} aria-current={now ? "step" : undefined} onClick={layers ? () => setPicked(s.key) : undefined} initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 26, delay: 0.05 + i * 0.05 }} style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", cursor: layers ? "pointer" : undefined }}>
              {!last && <motion.div aria-hidden="true" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, ease: "easeOut", delay: 0.2 + i * 0.07 }} style={{ position: "absolute", top: 13, left: "50%", width: "100%", height: 6, borderRadius: 6, transformOrigin: "left center", background: done ? LINE_DONE : BETA.stepTrack, boxShadow: done ? "0 0 10px rgba(47,107,255,.4)" : undefined }} />}
              {done ? (
                <div style={{ ...dot, zIndex: 1, width: 30, height: 30, background: DOT_DONE, boxShadow: "inset 0 2px 3px rgba(255,255,255,.6),inset 0 -3px 6px rgba(10,40,140,.3),0 6px 12px -4px rgba(47,107,255,.5)" }}><WsCheck /></div>
              ) : now ? (
                <div style={{ ...dot, zIndex: 1, width: 34, height: 34, marginTop: -2, background: DOT_NOW, boxShadow: "0 0 0 6px rgba(238,92,120,.12),0 10px 24px -6px rgba(238,92,120,.55),inset 0 2px 3px rgba(255,255,255,.6),inset 0 -4px 8px rgba(170,40,70,.25)" }}>
                  <span className="ring" aria-hidden="true" />
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#FFFFFF,#FFE3EA)", boxShadow: "0 0 6px rgba(255,255,255,.9)" }} />
                </div>
              ) : (
                <div aria-hidden="true" style={{ ...dot, zIndex: 1, width: 30, height: 30, background: BETA.stepNext, border: `1.5px solid ${BETA.stepNextEdge}`, boxShadow: BETA.stepNextShadow, color: BETA.muted, fontSize: 12, fontWeight: 600 }}>{i + 1}</div>
              )}
              <div className="step-text" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: now ? 700 : 600, color: now || done ? BETA.ink : BETA.muted }}>
                  {s.label}<span className="sr">{done ? " (done)" : now ? " (current step)" : " (not yet)"}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: now ? 600 : 400, color: now ? BETA.stepNow : BETA.faint }}>{s.sub}</div>
                {now && hold && <WsBadge tone={TONE_WAIT} size={11}>{hold}</WsBadge>}
                {layers && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setPicked(s.key); }} aria-pressed={openKey === s.key} aria-label={`Show the ${s.label} steps`}
                    style={{ marginTop: 2, width: 0, height: 0, padding: 0, border: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderBottom: `7px solid ${openKey === s.key ? "rgba(110,130,190,.45)" : "transparent"}`, background: "transparent", cursor: "pointer" }} />
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {layers && openKey && <SecondLayer label={items.find((s) => s.key === openKey)?.label ?? ""} layer={layer ?? { rule: "", steps: null }} />}
      {cap && (
        <div className="step-cap" aria-hidden="true" style={{ flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "4px 8px", marginTop: 12, padding: "0 8px", textAlign: "center", fontSize: 13 }}>
          <span style={{ fontWeight: 700, color: BETA.ink }}>{cap.label}</span>
          {cap.sub !== "-" && <span style={{ fontWeight: 600, color: cap.state === "current" ? BETA.stepNow : BETA.muted }}>{cap.sub}</span>}
          {cap.state === "current" && hold && <WsBadge tone={TONE_WAIT} size={11}>{hold}</WsBadge>}
          <span style={{ width: "100%", fontSize: 12, color: BETA.faint }}>Step {capAt + 1} of {items.length}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- The second layer ---------- */

const SUB_TRACK = "linear-gradient(90deg,#6E9BFF,#C9A6F2,#F6A9C4)";

function SecondLayer({ label, layer }: { label: string; layer: StageLayer }): ReactElement {
  const steps = layer.steps;
  const live = steps?.filter((t) => t.state !== "off") ?? [];
  const done = live.filter((t) => t.state === "done").length;
  const [focus, setFocus] = useState<string | null>(null);
  const shown = steps?.find((t) => t.key === focus) ?? steps?.find((t) => t.state === "current") ?? null;
  return (
    <div style={{ margin: "14px 8px 0", padding: "16px 8px 10px", borderRadius: 20, background: "linear-gradient(180deg,rgba(244,246,252,.85),rgba(255,255,255,.4))", border: "1px solid rgba(120,130,170,.12)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: "4px 12px", padding: "0 8px", marginBottom: steps ? 14 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: BETA.ink }}>{label}{steps && <span style={{ fontWeight: 400, color: BETA.muted }}> · {done} of {live.length} done{live.length < steps.length ? ` · ${steps.length - live.length} not on this project` : ""}</span>}</span>
        <span style={{ fontSize: 12.5, color: BETA.muted }}>{layer.rule}</span>
      </div>
      {steps && (
        <div className="no-bar" style={{ overflowX: "auto" }}>
          <ol aria-label={`${label} steps`} style={{ listStyle: "none", margin: "0 auto", padding: 0, display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(84px, 1fr))`, maxWidth: Math.max(360, steps.length * 150) }}>
            {steps.map((t, i) => {
              const now = t.state === "current";
              const size = now ? 24 : 20;
              const dot = t.state === "done"
                ? { background: DOT_DONE, boxShadow: "inset 0 1px 2px rgba(255,255,255,.6),0 3px 9px -3px rgba(47,107,255,.6)", color: "#FFFFFF" }
                : now ? { background: DOT_NOW, boxShadow: "0 0 0 5px rgba(238,92,120,.13),0 4px 12px -3px rgba(238,92,120,.6)", color: "transparent" }
                : t.state === "off" ? { background: "#EEF0F4", border: "1.5px dashed #CDD1D9", color: "transparent" }
                : { background: BETA.stepNext, border: `1.5px solid ${BETA.stepNextEdge}`, color: BETA.muted };
              return (
                <li key={t.key} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                  {i > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 10, right: "50%", width: "100%", height: 3, borderRadius: 2, background: t.state === "done" || now ? SUB_TRACK : BETA.stepTrack }} />}
                  <button type="button" onClick={() => setFocus(t.key)} aria-label={`${t.label}: ${t.state === "done" ? "done" : now ? "current" : t.state === "off" ? "not on this project" : "not yet"}. ${t.sub}`}
                    style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0, padding: 0, border: 0, background: "transparent", cursor: "pointer", font: "inherit" }}>
                    <span style={{ boxSizing: "border-box", width: size, height: size, marginTop: now ? 0 : 2, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, transform: shown?.key === t.key ? "scale(1.12)" : undefined, ...dot }}>
                      {t.state === "done" ? <WsCheck /> : t.state === "later" ? i + 1 : ""}
                    </span>
                    <span style={{ marginTop: 8, fontSize: 12.5, fontWeight: now || shown?.key === t.key ? 700 : 500, color: t.state === "off" ? BETA.faint : BETA.ink, whiteSpace: "nowrap" }}>{t.label}</span>
                    <span style={{ marginTop: 2, fontSize: 11.5, color: BETA.faint, whiteSpace: "nowrap" }}>{t.sub}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {shown && (
        <div style={{ margin: "14px 8px 2px", padding: "10px 14px", borderRadius: 14, background: "rgba(255,255,255,.85)", border: "1px solid rgba(120,130,170,.14)", fontSize: 12.5, color: BETA.muted }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: BETA.ink }}>{shown.label}</span>
          <span style={{ marginLeft: 8, fontWeight: 600, color: shown.state === "done" ? WS.blue : shown.state === "current" ? BETA.stepNow : BETA.muted }}>{shown.sub}</span>
          <div style={{ marginTop: 2 }}>{shown.rule}</div>
        </div>
      )}
    </div>
  );
}
