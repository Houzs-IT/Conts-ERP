/* Calendar > Deadlines: the mockup's renderDeadlines. Late / Next 7 days / In 8-14 days / Later, Waiting for client,
   Ready to start, and the To book / to do box. */

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { BETA, GLASS, TONES, betaDueTone } from "./renovationBetaTheme";
import {
  APPT_LABEL, apptLeftText, apptWithDefault, dayWord, deadlineGroups, diff, ds, leftText, MONTHS, ord, todoText,
  type ApptItem, type BoardModel, type DesignProject, type DueItem, type Kind, type ApptKey, type PersonRef, type TodoItem, type Viewing,
} from "./renovationBetaBoard";
import { rememberLastProject } from "./renovationBetaBoardApi";
import { Badge, BTN, BTN_AMEND, BTN_CONFIRM, BTN_FILL, BTN_MAIN, EmptyBox, INK_SOFT, MUTED, PoDoneButton } from "./BetaCalParts";

const LI: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 0", borderTop: `1px solid ${BETA.lineSoft}` };
const LIST: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
const MID: CSSProperties = { flex: "1 1 220px", minWidth: 0 };
const META: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12, color: MUTED };
const CLIP: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export interface DeadlineActions {
  busy: boolean;
  onAddProject: () => void;
  onAssign: (projectId: number) => void;
  onBook: (projectId: number, key: ApptKey) => void;
  onAmend: (projectId: number, k: Kind) => void;
  onApprove: (p: DesignProject, k: Kind) => void;
  onStart: (p: DesignProject, k: Kind) => void;
  onEdit: (projectId: number) => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}

interface Props extends DeadlineActions {
  m: BoardModel;
  who: Viewing;
  canAssign: boolean;
  /** Names for the "Viewing" heading. */
  viewingName: string | null;
}

/** The padding and its negative margin give the one-line name a finger-sized tap area without moving the lines round it. */
function NameLink({ p }: { p: DesignProject }): ReactElement {
  return (
    <Link to={`/beta/projects/${p.id}`} onClick={() => rememberLastProject(p.id)}
      style={{ ...CLIP, display: "block", padding: "8px 0", margin: "-8px 0", color: BETA.ink, fontWeight: 600, textDecoration: "none" }}>
      {p.name}
    </Link>
  );
}

function DateBox({ due }: { due: string }): ReactElement {
  return (
    <div style={{ flex: "none", width: 52, textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{Number(due.slice(8))}</div>
      <div style={{ fontSize: 12, color: MUTED }}>{MONTHS[Number(due.slice(5, 7)) - 1]?.slice(0, 3)}</div>
    </div>
  );
}

function Pill({ ink, bg, children }: { ink: string; bg: string; children: ReactNode }): ReactElement {
  return <span style={{ flex: "none", padding: "4px 10px", borderRadius: 999, background: bg, color: ink, fontSize: 13, fontWeight: 600 }}>{children}</span>;
}

/** The viewer's own work needs no name on it; someone else's does. */
const showBy = (who: Viewing, by: PersonRef | null): by is PersonRef => by != null && !(who !== "All" && by.id === who);

function dueRow(m: BoardModel, who: Viewing, x: DueItem): ReactElement {
  const l = diff(x.due, m.today);
  const [ink, bg] = betaDueTone(l);
  const sub = x.from ? (x.n ? `Amendment started ${ds(x.from)} · ${x.days} ${dayWord(x.days ?? 0)}` : `Started ${ds(x.from)} · SOP ${m.sop[x.k === "2" ? "2" : "3"]} days`) : "";
  const byName = x.by?.name ?? "No site PIC";
  let byTxt = `${x.k === "h" ? "Handover lead " : `${x.k}D by `}${byName}`;
  if (x.k !== "h" && x.p.lead && !x.p.team[x.k].some((t) => t.id === x.p.lead?.id)) byTxt += ` · lead ${x.p.lead.name}`;
  const solo = x.k === "h" ? x.by != null : x.p.team[x.k].length === 1;
  const own = who !== "All" && solo && x.by != null && x.by.id === who && x.by.id === x.p.lead?.id;
  return (
    <li key={`${x.p.id}-${x.k}-${x.due}`} style={LI}>
      <DateBox due={x.due} />
      <div style={MID}>
        <div style={{ fontSize: 12, fontWeight: 700, color: x.k === "h" ? INK_SOFT : ink }}>{x.what}</div>
        <NameLink p={x.p} />
        <div style={META}>
          {!own && <>{x.by && <Badge name={x.by.name} />}<span style={{ color: BETA.ink, fontWeight: 600 }}>{byTxt}</span></>}
          {sub && <span>{own ? "" : "· "}{sub}</span>}
        </div>
      </div>
      <Pill ink={ink} bg={bg}>{leftText(l)}</Pill>
    </li>
  );
}

function apptRow(m: BoardModel, who: Viewing, x: ApptItem): ReactElement {
  const l = diff(x.due, m.today);
  const [ink, bg] = l < 0 ? [TONES.red.ink, TONES.red.soft] : [TONES.grey.ink, TONES.grey.soft];
  return (
    <li key={`${x.p.id}-${x.ak}`} style={LI}>
      <DateBox due={x.due} />
      <div style={MID}>
        <div style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT }}>{APPT_LABEL[x.ak]}{x.a.t ? ` · ${x.a.t}` : ""}</div>
        <NameLink p={x.p} />
        <div style={META}>
          {showBy(who, x.by) && <><Badge name={x.by.name} /><span style={{ color: BETA.ink, fontWeight: 600 }}>{x.by.name}</span></>}
          <span>with {x.a.with || apptWithDefault(x.p, x.ak)}</span>
        </div>
      </div>
      <Pill ink={ink} bg={bg}>{apptLeftText(l)}</Pill>
    </li>
  );
}

function Section({ title, color, children, count }: { title: string; color: string; count: number; children: ReactNode }): ReactElement | null {
  if (count === 0) return null;
  return (
    <section>
      <h3 style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color }}>{title} · {count}</h3>
      <ol className="stag" style={LIST}>{children}</ol>
    </section>
  );
}

export function BetaCalDeadlines({ m, who, canAssign, viewingName, ...act }: Props): ReactElement {
  const g = deadlineGroups(m, who, canAssign);
  const rowsOf = (arr: Array<DueItem | ApptItem>): ReactElement[] => arr.map((x) => (x.type === "appt" ? apptRow(m, who, x) : dueRow(m, who, x)));
  const hasLeft = g.late.length + g.week.length + g.two.length + g.later.length + g.waiting.length + g.ready.length > 0;

  return (
    <section aria-labelledby="betaDlHead" style={{ ...GLASS, borderRadius: 26, padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 id="betaDlHead" style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" }}>{viewingName ? `${viewingName}'s deadlines` : "Team deadlines"}</h2>
        {canAssign && <button type="button" onClick={act.onAddProject} style={{ ...BTN, minHeight: 40, padding: "0 16px", fontSize: 14 }}>+ Add project</button>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "999 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
            {hasLeft ? (
              <>
                <Section title="Late" color={TONES.red.ink} count={g.late.length}>{rowsOf(g.late)}</Section>
                <Section title="Next 7 days" color={TONES.amber.ink} count={g.week.length}>{rowsOf(g.week)}</Section>
                <Section title="In 8–14 days" color={TONES.accent.ink} count={g.two.length}>{rowsOf(g.two)}</Section>
                <Section title="Later" color={MUTED} count={g.later.length}>{rowsOf(g.later)}</Section>
                <Section title="Waiting for client" color={INK_SOFT} count={g.waiting.length}>
                  {g.waiting.map((x) => {
                    const ago = diff(m.today, x.sent);
                    return (
                      <li key={`${x.p.id}-${x.k}`} style={LI}>
                        <div style={MID}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT }}>
                            {x.k}D {x.n ? `${ord(x.n)} amendment ` : ""}sent {ds(x.sent)}{ago > 0 ? ` · ${ago} ${dayWord(ago)} ago` : ""}
                          </div>
                          <NameLink p={x.p} />
                          {x.p.by[x.k] && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12, fontWeight: 600, color: BETA.ink }}>
                              <Badge name={x.p.by[x.k]?.name ?? ""} />{x.k}D by {x.p.by[x.k]?.name}
                            </div>
                          )}
                        </div>
                        {canAssign && (
                          <div style={{ flex: "none", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button type="button" disabled={act.busy} onClick={() => act.onAmend(x.p.id, x.k)} style={BTN_AMEND}>+ Amendment</button>
                            <button type="button" disabled={act.busy} onClick={() => act.onApprove(x.p, x.k)} style={BTN_CONFIRM}>Client approved</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </Section>
                <Section title="Ready to start" color={MUTED} count={g.ready.length}>
                  {g.ready.map((x) => (
                    <li key={`${x.p.id}-${x.k}`} style={LI}>
                      <div style={MID}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{x.k === "3" ? "3D not started" : "3D approved · 2D not started"}</div>
                        <NameLink p={x.p} />
                        {x.p.by[x.k] && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12, fontWeight: 600, color: BETA.ink }}>
                            <Badge name={x.p.by[x.k]?.name ?? ""} />{x.k}D by {x.p.by[x.k]?.name}
                          </div>
                        )}
                      </div>
                      {canAssign && <button type="button" disabled={act.busy} onClick={() => act.onStart(x.p, x.k)} style={BTN_MAIN}>Start {x.k}D today</button>}
                      {canAssign && <button type="button" onClick={() => act.onEdit(x.p.id)} style={BTN}>Edit</button>}
                    </li>
                  ))}
                </Section>
              </>
            ) : (
              <EmptyBox>No deadlines.</EmptyBox>
            )}
          </div>
          {g.todo.length > 0 ? (
            <aside style={{ flex: "1 1 300px", minWidth: 0, background: BETA.tbPanel, border: `1px solid ${BETA.tbEdge}`, borderRadius: 26, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              <h3 style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: TONES.amber.ink }}>To book / to do · {g.todo.length}</h3>
              <ol className="stag" style={LIST}>{g.todo.map((x) => <TodoRow key={`${x.p.id}-${x.k}`} m={m} who={who} x={x} canAssign={canAssign} act={act} />)}</ol>
            </aside>
          ) : (
            <aside style={{ flex: "1 1 300px", minWidth: 0, background: TONES.accent.soft, border: `1px solid ${TONES.accent.line}`, borderRadius: 26, padding: "14px 16px", fontSize: 13, color: TONES.accent.ink, fontWeight: 600 }}>
              Nothing to book or do right now.
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}

function TodoRow({ m, who, x, canAssign, act }: { m: BoardModel; who: Viewing; x: TodoItem; canAssign: boolean; act: DeadlineActions }): ReactElement {
  const { p, k } = x;
  if (k === "as") {
    return (
      <li style={{ ...LI, background: TONES.amber.soft, margin: "0 -10px", paddingLeft: 10, paddingRight: 10, borderRadius: 12 }}>
        <div style={MID}>
          <div style={{ fontSize: 12, fontWeight: 700, color: TONES.amber.ink }}>{todoText(m, x)}</div>
          <NameLink p={p} />
          <div style={{ fontSize: 12, color: MUTED }}>From {p.salesName ?? "Sales"}{p.createdOn ? ` · ${ds(p.createdOn)}` : ""}</div>
        </div>
        {canAssign && <button type="button" onClick={() => act.onAssign(p.id)} style={BTN_FILL}>Assign</button>}
      </li>
    );
  }
  const isPo = k === "po";
  return (
    <li style={LI}>
      <div style={MID}>
        <div style={{ fontSize: 12, fontWeight: 700, color: TONES.amber.ink }}>{todoText(m, x)}</div>
        <NameLink p={p} />
        {p.lead && !(who !== "All" && p.lead.id === who) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12, fontWeight: 600, color: BETA.ink }}>
            <Badge name={p.lead.name} />{p.lead.name}
          </div>
        )}
      </div>
      {isPo ? (
        <>
          <span style={{ flex: "none", fontSize: 12, color: MUTED }}>Auto</span>
          {canAssign && <PoDoneButton projectId={p.id} today={m.today} onDone={act.onNotice} onError={act.onError} />}
        </>
      ) : canAssign && <button type="button" onClick={() => act.onBook(p.id, k)} style={BTN_MAIN}>Book time</button>}
    </li>
  );
}
