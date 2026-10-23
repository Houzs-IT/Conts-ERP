/* Beta workspace header, as the mockup's project page opens: the name in capitals, the code line, the team chips
   with WhatsApp and Assign, and the stage stepper. */

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usePeople } from "../projects/renovation/PersonSelect";
import type { ProjectDetailV2 } from "../projects/renovation/simpleApi";
import type { BetaDialog } from "./BetaForms";
import { WS, WsAvatar, WsBadge, WsCheck, btnStyle, TONE_WAIT } from "./BetaWsUi";
import type { DesignProject } from "./renovationBetaBoard";
import { dayMonthYear, initials, whatsappLink, type StepperItem } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

interface HeaderProps {
  d: ProjectDetailV2;
  /** The project as Home and Calendar see it: the people on the chips come from here. */
  p: DesignProject;
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

interface Chip { key: string; role: string; name: string | null; lead?: boolean }

export function BetaWsHeader({ d, p: board, canWrite, today, openDialog }: HeaderProps): ReactElement {
  const { project: p } = d;
  const peopleQ = usePeople();
  const handoverOn = p.handed_over_at ?? p.planned_handover_date;
  const left = p.handed_over_at ? null : leftText(p.planned_handover_date, today);
  // 3D and 2D fall back to the design lead, as the mockup's o3 and o2 do.
  const designer = board.lead?.name ?? null;
  const chips: Chip[] = [
    { key: "lead", role: "Design lead", name: designer, lead: true },
    { key: "3d", role: "3D", name: board.by["3"]?.name ?? null },
    { key: "2d", role: "2D", name: board.by["2"]?.name ?? null },
    { key: "site", role: "Site PIC · Handover lead", name: board.site?.name ?? null },
  ];
  const phone = (peopleQ.data?.data ?? []).find((x) => x.id === board.lead?.id)?.phone ?? null;
  // Project names usually already end with the customer ("... MR WAYNE"); add it only when missing.
  const customer = p.customer_name?.trim() ?? "";
  const withCustomer = customer && !p.name.toUpperCase().includes(customer.toUpperCase());
  const title = (withCustomer ? `${p.name} · ${customer}` : p.name).toUpperCase();
  const line = [p.code, d.type?.name, handoverOn ? `${p.handed_over_at ? "Handed over" : "Handover"} ${dayMonthYear(handoverOn)}` : "No handover date yet"].filter(Boolean).join(" · ");

  return (
    <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, flex: "1 1 320px" }}>
        <Link to="/beta/projects" aria-label="Back to the project list" style={{ ...btnStyle("outline", "lg"), width: 44, padding: 0, flex: "none" }}>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 className="h1" style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-.01em", overflowWrap: "anywhere" }}>{title}</h1>
          <div style={{ marginTop: 4, color: BETA.muted, fontSize: 14 }}>
            {line}
            {left && <> <span style={{ color: left.late ? WS.red : WS.green, fontWeight: 600 }}>{left.text}</span></>}
          </div>
          <div role="group" aria-label="Project team" className="chips" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
            {chips.map((c) => (
              <div
                key={c.key}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 6px", borderRadius: 10, background: c.lead ? "#E4F1EF" : BETA.surface, border: `1px solid ${c.lead ? "#A9D2CC" : BETA.line}` }}
              >
                <WsAvatar text={initials(c.name)} />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0, overflowWrap: "anywhere" }}>
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
              <button type="button" onClick={() => openDialog({ t: "assign", projectId: p.id })} style={{ minHeight: 44, padding: "0 14px", border: `1.5px dashed ${BETA.accent}`, borderRadius: 10, background: BETA.surface, color: BETA.accentInk, font: "inherit", fontWeight: 700, cursor: "pointer" }}>
                Assign
              </button>
            )}
          </div>
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

export function BetaWsStepper({ items, hold }: { items: StepperItem[]; hold: string | null }): ReactElement {
  return (
    <div style={{ overflowX: "auto", background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, padding: "20px 8px 16px" }}>
      <ol aria-label="Project stages" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", minWidth: 560 }}>
        {items.map((s, i) => {
          const last = i === items.length - 1;
          const done = s.state === "done";
          const now = s.state === "current";
          return (
            <li key={s.key} ref={now ? scrollIntoRow : undefined} aria-current={now ? "step" : undefined} style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center" }}>
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
