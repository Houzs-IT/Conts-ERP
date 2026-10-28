/* Beta workspace header, as the mockup's project page opens: the name in capitals, the code line, the team chips
   with WhatsApp and Assign, and the stage stepper. */

import type { ReactElement } from "react";
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

export function BetaWsHeader({ d, p: board, people = [], canWrite, today, openDialog }: HeaderProps): ReactElement {
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
            const bg = c.lead ? BETA.pick : BETA.surface;
            const one = c.who.length === 1 ? infoOf(c.who[0].id) : "";
            const extra = one || (c.who.length > 1 ? c.who.map((x) => x.name).join(", ") : "");
            // The chip fits its text, as the design's pills do; the third line shows only when it has something to say.
            const body = (
              <>
                <AvatarStack who={c.who} ring={bg} />
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

export function BetaWsStepper({ items, hold }: { items: StepperItem[]; hold: string | null }): ReactElement {
  return (
    // .no-bar: it still scrolls sideways on a phone, without the grey bar and arrows inside the card.
    <div className="no-bar" style={{ ...GLASS, overflowX: "auto", overflowY: "hidden", borderRadius: 26, padding: "20px 8px 16px" }}>
      <ol aria-label="Project stages" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", minWidth: 560 }}>
        {items.map((s, i) => {
          const last = i === items.length - 1;
          const done = s.state === "done";
          const now = s.state === "current";
          const dot = { position: "relative", boxSizing: "border-box", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" } as const;
          return (
            <motion.li key={s.key} ref={now ? scrollIntoRow : undefined} aria-current={now ? "step" : undefined} initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 26, delay: 0.05 + i * 0.05 }} style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center" }}>
              {!last && <motion.div aria-hidden="true" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, ease: "easeOut", delay: 0.2 + i * 0.07 }} style={{ position: "absolute", top: 13, left: "50%", width: "100%", height: 6, borderRadius: 6, transformOrigin: "left center", background: done ? LINE_DONE : BETA.stepTrack, boxShadow: done ? "0 0 10px rgba(47,107,255,.4)" : undefined }} />}
              {done ? (
                <div style={{ ...dot, zIndex: 1, width: 30, height: 30, background: DOT_DONE, boxShadow: "inset 0 2px 3px rgba(255,255,255,.6),inset 0 -3px 6px rgba(10,40,140,.3),0 6px 12px -4px rgba(47,107,255,.5)" }}><WsCheck /></div>
              ) : now ? (
                <div style={{ ...dot, zIndex: 1, width: 34, height: 34, marginTop: -2, background: DOT_NOW, boxShadow: "0 0 0 6px rgba(238,92,120,.12),0 10px 24px -6px rgba(238,92,120,.55),inset 0 2px 3px rgba(255,255,255,.6),inset 0 -4px 8px rgba(170,40,70,.25)" }}>
                  <span className="ring" aria-hidden="true" />
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#FFFFFF,#FFE3EA)", boxShadow: "0 0 6px rgba(255,255,255,.9)" }} />
                </div>
              ) : (
                <div style={{ ...dot, zIndex: 1, width: 30, height: 30, background: BETA.stepNext, border: `1px solid ${BETA.stepNextEdge}`, boxShadow: BETA.stepNextShadow }} />
              )}
              <div style={{ marginTop: now ? 0 : undefined, fontSize: 13, fontWeight: now ? 700 : 600, color: now ? BETA.stepNow : done ? BETA.ink : BETA.muted }}>
                {s.label}<span className="sr">{done ? " (done)" : now ? " (current step)" : " (not yet)"}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: now ? 600 : 400, color: now ? BETA.stepNow : BETA.faint }}>{s.sub}</div>
              {now && hold && <WsBadge tone={TONE_WAIT} size={11}>{hold}</WsBadge>}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
