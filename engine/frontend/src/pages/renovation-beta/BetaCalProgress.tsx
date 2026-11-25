/* Calendar > Progress: the mockup's renderProg. One line per project with its condition, who does 3D, 2D and the
   handover, and the six steps (Measure, 3D, 2D, Carpentry, Site PIC, PO) with the current one marked. The whole team is
   one card per person that opens and closes, paged when long (feedback, 11 Nov 2026). */

import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { BETA, GLASS, TONES } from "./renovationBetaTheme";
import { designLayer } from "./betaStageLayers";
import { currentStep, ds, progressByPerson, progressList, reportsOf, status, designSteps, stepDone, type BoardModel, type DesignProject, type PersonRef, type Viewing } from "./renovationBetaBoard";
import { rememberLastProject } from "./renovationBetaBoardApi";
import { BTN, CondPill, INK_SOFT, MUTED, TOGGLE, TOGGLE_HEAD, useIsPhone } from "./BetaCalParts";

const LIST = { listStyle: "none", margin: 0, padding: 0 } as const;
const PAGE = 10;

export function BetaCalProgress({ m, who, viewingName }: { m: BoardModel; who: Viewing; viewingName: string | null }): ReactElement {
  // Every step done, or handed over to the client: out of the person cards and into one Complete card at the end (owner, 24 Nov 2026).
  const finished = (p: DesignProject): boolean => p.handedOver != null || currentStep(m, p) === 99;
  const open = (ps: DesignProject[]): DesignProject[] => ps.filter((p) => !finished(p));
  const list = who === "All" ? [] : open(progressList(m, who));
  const groups = who === "All" ? progressByPerson(m).map((g) => ({ ...g, projects: open(g.projects) })) : [];
  const complete = progressList(m, who).filter(finished);
  const isPhone = useIsPhone();
  return (
    <section aria-labelledby="betaProgHead" style={{ ...GLASS, borderRadius: 26, padding: isPhone ? 16 : 20,display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <h2 id="betaProgHead" style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" }}>{viewingName ? `${viewingName}'s projects` : "Team design progress"}</h2>
        <div style={{ marginTop: 4, fontSize: 13, color: MUTED }}>Updates by itself from Drawings, Client PO and bookings. Your part is highlighted.</div>
      </div>
      {who === "All" ? (
        groups.length === 0 ? <div style={{ padding: "14px 0", color: MUTED }}>No projects.</div> : groups.map((g) => <PersonCard key={g.person?.id ?? "none"} m={m} person={g.person} projects={g.projects} />)
      ) : (
        <ol style={LIST}>
          {list.length === 0 && <li style={{ padding: "14px 0", color: MUTED }}>No projects.</li>}
          {list.map((p) => <ProgressRow key={p.id} m={m} p={p} hl={who} />)}
        </ol>
      )}
      {/* The people who report to the person viewed, one closed card each (YH, 23 Nov 2026). */}
      {who !== "All" && reportsOf(m, who).map((x) => <PersonCard key={x.id} m={m} person={x} projects={open(progressList(m, x.id))} />)}
      {complete.length > 0 && <PersonCard m={m} person={null} title="Complete" hl={who} projects={complete} />}
    </section>
  );
}

/** One person's projects as a toggle heading, closed until opened, ten rows a page. */
function PersonCard({ m, person, projects, title, hl }: { m: BoardModel; person: PersonRef | null; projects: DesignProject[]; title?: string; hl?: Viewing }): ReactElement {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(projects.length / PAGE);
  const at = Math.min(page, pages - 1);
  return (
    <details style={TOGGLE}>
      <summary style={TOGGLE_HEAD}>
        {title ?? person?.name ?? "Not assigned"} <span style={{ color: MUTED, fontWeight: 500 }}>· {projects.length}</span>
      </summary>
      <ol style={LIST}>{projects.slice(at * PAGE, at * PAGE + PAGE).map((p) => <ProgressRow key={p.id} m={m} p={p} hl={hl ?? person?.id ?? "All"} />)}</ol>
      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 14px", fontSize: 13, color: MUTED }}>
          <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} style={BTN}>Previous</button>
          <span>Page {at + 1} of {pages}</span>
          <button type="button" disabled={at === pages - 1} onClick={() => setPage(at + 1)} style={BTN}>Next</button>
        </div>
      )}
    </details>
  );
}

/** "3D sent · waiting client" on a phone is just "Waiting client": the stepper under it already names the step. */
function phoneCondition(words: string): string {
  const tail = words.split(" · ")[1] ?? words;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** A project's line; `hl` is the person whose chips are highlighted. */
function ProgressRow({ m, p, hl }: { m: BoardModel; p: DesignProject; hl: Viewing }): ReactElement {
  const isPhone = useIsPhone();
  const st = status(m, p);
  const cur = currentStep(m, p);
  const steps = designSteps(m);
  // The same words as the project page's Design layer, so both read alike (owner, 25 Nov 2026).
  const stepTexts = new Map(designLayer(m, p).map((s) => [s.key, s.sub]));
  const chips: Array<[string, string | undefined, number[]]> = [
    ["3D", p.by["3"]?.name, p.team["3"].map((x) => x.id)],
    ["2D", p.by["2"]?.name, p.team["2"].map((x) => x.id)],
    ["Handover", p.site?.name, p.site ? [p.site.id] : []],
  ];
  const isMine = (ids: number[]): boolean => hl !== "All" && ids.includes(hl);
  const myStages = chips.filter(([, , ids]) => isMine(ids)).map(([label]) => label);
  const ownership = [
    ...(myStages.length > 0 ? [`Your stages: ${myStages.join(", ")}`] : []),
    ...chips.filter(([, , ids]) => !isMine(ids)).map(([label, name]) => `${label}: ${name ?? "Not chosen"}`),
  ].join(" · ");
  const title = <Link to={`/beta/projects/${p.id}`} onClick={() => rememberLastProject(p.id)} style={{ color: BETA.ink, fontWeight: 600, textDecoration: "none" }}>{p.name}</Link>;
  // A handed-over job says so instead of its last design condition (owner, 24 Nov 2026).
  const pill = p.handedOver
    ? <CondPill text={`Handed over ${ds(p.handedOver)}`} words="Handed over" />
    : <CondPill text={isPhone ? phoneCondition(st[1]) : `${st[0]} - ${st[1]}`} words={st[1]} />;
  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: isPhone ? 10 : "14px 20px", padding: "14px 0", borderTop: `1px solid ${BETA.lineSoft}` }}>
      {isPhone ? (
        <div style={{ flex: "1 1 100%", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{title}</div>
            {pill}
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ownership}</div>
        </div>
      ) : (
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12 }}>
            {pill}
            {chips.map(([label, name, ids]) => (
              <span key={label} style={{ padding: "2px 8px", borderRadius: 999, ...(isMine(ids) ? { background: BETA.accentFill, color: "#FFFFFF", fontWeight: 700 } : { background: BETA.chip, color: INK_SOFT, fontWeight: 500 }) }}>
                {label} · {name ?? "Not chosen"}
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ flex: "2 1 380px", minWidth: 0, display: "flex" }}>
        {steps.map(([key, label], i) => {
          const done = stepDone(m, p, key);
          const on = i === cur;
          // The line into a step is lit only when every step before it is done, or both ends are done (a step can finish out of order).
          const lit = i <= cur || (done && stepDone(m, p, steps[i - 1]![0]));
          const stepText = stepTexts.get(key) ?? "";
          return (
            <div key={key} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative" }}>
              {i > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 10, right: "calc(50% + 11px)", width: "calc(100% - 22px)", height: 2, borderRadius: 1, background: lit ? BETA.accentFill : TONES.grey.line }} />}
              <span
                role="img"
                aria-label={`${label}: ${done ? "done" : on ? "now" : "not yet"}. ${stepText}`}
                style={{ width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", background: done ? BETA.accentFill : BETA.surface, border: `2px solid ${done || on ? BETA.accentFill : TONES.grey.line}`, boxShadow: on && !done ? `0 0 0 4px ${TONES.accent.soft}` : "none" }}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                ) : on ? (
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: BETA.accentFill }} />
                ) : null}
              </span>
              {!isPhone ? (
                <>
                  <span style={{ marginTop: 3, fontSize: 11, fontWeight: on ? 700 : 500, color: on ? BETA.accentInk : done ? INK_SOFT : MUTED, whiteSpace: "nowrap" }}>{label}</span>
                  <span style={{ fontSize: 10, lineHeight: 1.25, color: MUTED, textAlign: "center" }}>{stepText}</span>
                </>
              ) : on ? (
                // Six columns are too narrow for their words on a phone: only the current step is written, under its own dot; the end steps hug the card edge.
                <span aria-hidden="true" style={{ marginTop: 5, alignSelf: i === 0 ? "flex-start" : i === steps.length - 1 ? "flex-end" : "center", whiteSpace: "nowrap", fontSize: 12, color: MUTED }}>
                  <span style={{ fontWeight: 700, color: BETA.accentInk }}>{label}</span>{stepText ? ` · ${stepText}` : ""}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </li>
  );
}
