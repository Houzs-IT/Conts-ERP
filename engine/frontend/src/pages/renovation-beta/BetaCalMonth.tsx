/* Calendar > Calendar: the mockup's renderCal. A month grid with deadline and event chips, the legend, "+ Add work"
   and the side list ("Coming up", or the picked day). */

import type { CSSProperties, ReactElement } from "react";
import { BETA, BETA_CHIP, GLASS, PILL_GLASS, PILL_MAIN, TONES } from "./renovationBetaTheme";
import {
  dayKey, dueOn, ds, eventsOn, groupOf, initials, listFor, monthCells, MONTHS, typeLabel,
  type BoardModel, type CalEvent, type DueItem, type Viewing,
} from "./renovationBetaBoard";
import { Badge, BTN, INK_SOFT, MUTED, useIsPhone } from "./BetaCalParts";

const CLAMP: CSSProperties = { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.25, wordBreak: "break-word" };
const CHIP: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 4, padding: "3px 5px", borderRadius: 5, fontSize: 11, minWidth: 0 };

interface Props {
  m: BoardModel;
  who: Viewing;
  view: { y: number; m: number };
  selDay: string | null;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (day: string) => void;
  canWrite: boolean;
  onAddWork: () => void;
  onEditEvent: (e: CalEvent) => void;
}

const projectTitle = (m: BoardModel, id: number | null): string => (id == null ? "" : m.byId.get(id)?.title ?? "");

function DeadlineChip({ x, who }: { x: DueItem; who: Viewing }): ReactElement {
  return (
    <div style={{ ...CHIP, borderLeft: `3px solid ${TONES.red.dot}`, background: TONES.red.strong, color: TONES.red.ink, fontWeight: 700 }}>
      {who === "All" && x.by && <Badge name={x.by.name} />}
      <span style={CLAMP}>{x.k === "h" ? "Handover" : `${x.k}D${x.n ? ` A${x.n}` : ""} due`} · {x.p.title}</span>
    </div>
  );
}

function EventChip({ e, who }: { e: CalEvent; who: Viewing }): ReactElement {
  const [ink, bg] = BETA_CHIP[groupOf(e.type)];
  return (
    <div style={{ ...CHIP, borderLeft: `3px solid ${ink}`, background: bg, color: ink, fontWeight: 600, opacity: e.done ? 0.5 : 1 }}>
      {who === "All" && e.who && <Badge name={e.who.name} />}
      <span style={{ ...CLAMP, textDecoration: e.done ? "line-through" : undefined }}>{e.t ? `${e.t} ` : ""}{e.note || typeLabel(e.type)}</span>
    </div>
  );
}

export function BetaCalMonth({ m, who, view, selDay, onPrev, onNext, onToday, onPick, canWrite, onAddWork, onEditEvent }: Props): ReactElement {
  const cells = monthCells(view.y, view.m);
  const list = listFor(m, who, selDay);
  const monthName = MONTHS[view.m];
  const arrow: CSSProperties = { ...PILL_GLASS, width: 40, height: 40, cursor: "pointer", fontSize: 16 };
  const first = m.people[0];
  /* A phone fits the seven days on the screen: each day shows coloured dots, and a tap lists that day below the month. */
  const phone = useIsPhone();
  const cellH = phone ? 52 : 118;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
      <section aria-label="Month" style={{ ...GLASS, flex: "999 1 640px", minWidth: 0, borderRadius: 26, padding: phone ? 12 : 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <button type="button" aria-label="Previous month" onClick={onPrev} style={arrow}>‹</button>
            <h2 aria-live="polite" style={{ margin: 0, fontSize: 17, fontWeight: 600, minWidth: phone ? 0 : 150, textAlign: "center", letterSpacing: "-.02em", whiteSpace: "nowrap" }}>{monthName} {view.y}</h2>
            <button type="button" aria-label="Next month" onClick={onNext} style={arrow}>›</button>
            <button type="button" onClick={onToday} style={{ ...BTN, minHeight: 40, fontSize: 14 }}>Today</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: INK_SOFT }}>
            {([[TONES.red.dot, "Deadline"], [TONES.grey.dot, "Meeting / site"], [TONES.accent.dot, "Design work"], [TONES.amber.dot, "Drawing update"]] as const).map(([c, label]) => (
              <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{label}
              </span>
            ))}
            {who === "All" && first && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ minWidth: 22, height: 17, padding: "0 3px", borderRadius: 4, background: BETA.avatar, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(first.name)}</span>
                Who does it
              </span>
            )}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: phone ? 0 : 640, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
              <div key={w} style={{ padding: phone ? "6px 0" : "6px 8px", textAlign: phone ? "center" : undefined, fontSize: 12, fontWeight: 600, color: MUTED }}>{phone ? w.slice(0, 1) : w}</div>
            ))}
            {cells.map((d, i) => {
              if (d == null) return <div key={`b${i}`} style={{ minHeight: cellH, background: BETA.head, borderTop: `1px solid ${BETA.lineSoft}` }} />;
              const day = dayKey(view.y, view.m, d);
              const dues = dueOn(m, who, day);
              const evs = eventsOn(m, who, day);
              const chips = [
                ...dues.map((x) => <DeadlineChip key={`d${x.p.id}${x.k}`} x={x} who={who} />),
                ...evs.map((e) => <EventChip key={e.id} e={e} who={who} />),
              ];
              const dots = [...dues.map(() => TONES.red.dot), ...evs.map((e) => BETA_CHIP[groupOf(e.type)][0])];
              const isToday = day === m.today;
              const isSel = day === selDay;
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`${d} ${monthName}${dots.length ? `, ${dots.length} planned` : ""}`}
                  aria-pressed={isSel}
                  onClick={() => onPick(day)}
                  style={{
                    minHeight: cellH, textAlign: "left", display: "flex", flexDirection: "column", alignItems: phone ? "center" : undefined, gap: 3, padding: phone ? "4px 2px" : 6, border: 0, borderTop: `1px solid ${BETA.lineSoft}`,
                    background: isSel ? BETA.pick : BETA.row, outline: isSel ? `2px solid ${BETA.selInk}` : "none", outlineOffset: -2, font: "inherit", cursor: "pointer", minWidth: 0, color: BETA.ink,
                  }}
                >
                  <span style={{ alignSelf: phone ? "center" : "flex-start", minWidth: 24, height: 24, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: isToday ? 700 : 500, background: isToday ? BETA.accentFill : "transparent", color: isToday ? "#FFFFFF" : BETA.ink }}>{d}</span>
                  {phone ? (
                    dots.length > 0 && (
                      <span aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 3 }}>
                        {dots.slice(0, 4).map((c, k) => <span key={k} style={{ width: 6, height: 6, borderRadius: 3, background: c }} />)}
                      </span>
                    )
                  ) : (
                    <>
                      {chips.slice(0, 3)}
                      {chips.length > 3 && <span style={{ fontSize: 11, color: MUTED }}>+{chips.length - 3} more</span>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside style={{ flex: "1 1 260px", maxWidth: "100%", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {canWrite && <button type="button" onClick={onAddWork} style={{ ...PILL_MAIN, minHeight: 46, font: "inherit", fontWeight: 600, cursor: "pointer" }}>+ Add work</button>}
        <section aria-labelledby="betaCalListTitle" style={{ ...GLASS, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 id="betaCalListTitle" style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" }}>{list.title}</h2>
          <ol className="stag" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {list.due.map((x) => (
              <li key={`${x.p.id}${x.k}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${BETA.lineSoft}` }}>
                <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 3, background: TONES.red.dot }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{x.what}</div>
                  <div style={{ fontSize: 12, color: MUTED }}>{who === "All" && x.by && <><b style={{ color: BETA.ink }}>{x.by.name}</b> · </>}{x.p.name}</div>
                </div>
              </li>
            ))}
            {list.events.map((e) => {
              const [ink] = BETA_CHIP[groupOf(e.type)];
              const proj = projectTitle(m, e.projectId);
              const body = (
                <>
                  <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, marginTop: 5, borderRadius: 3, background: ink }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600 }}>{e.note || typeLabel(e.type)}{e.done ? " · done" : ""}</span>
                    <span style={{ display: "block", fontSize: 12, color: MUTED }}>
                      {who === "All" && e.who && <><b style={{ color: BETA.ink }}>{e.who.name}</b> · </>}{ds(e.d)}{e.t ? ` · ${e.t}` : ""}{proj ? ` · ${proj}` : ""}
                    </span>
                  </span>
                  {canWrite && <span style={{ fontSize: 12, color: BETA.accent, fontWeight: 600 }}>Edit</span>}
                </>
              );
              const row: CSSProperties = { width: "100%", display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", border: 0, background: "transparent", textAlign: "left", font: "inherit", opacity: e.done ? 0.55 : 1, color: BETA.ink };
              return (
                <li key={e.id} style={{ borderTop: `1px solid ${BETA.lineSoft}` }}>
                  {canWrite ? <button type="button" onClick={() => onEditEvent(e)} style={{ ...row, cursor: "pointer" }}>{body}</button> : <div style={row}>{body}</div>}
                </li>
              );
            })}
            {list.due.length + list.events.length === 0 && (
              <li style={{ padding: "12px 0", color: MUTED, fontSize: 13 }}>Nothing planned{selDay ? " on this day." : "."}</li>
            )}
          </ol>
        </section>
      </aside>
    </div>
  );
}
