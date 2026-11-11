/* Calendar > Progress: the mockup's renderProg. One line per project with its condition, who does 3D, 2D and the
   handover, and the six steps (Measure, 3D, 2D, Carpentry, Site PIC, PO) with the current one marked. The whole team is
   one card per person that opens and closes, paged when long (feedback, 11 Nov 2026). */

import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { BETA, GLASS, TONES } from "./renovationBetaTheme";
import { currentStep, progressByPerson, progressList, status, STEPS, stepDone, type BoardModel, type DesignProject, type PersonRef, type Viewing } from "./renovationBetaBoard";
import { rememberLastProject } from "./renovationBetaBoardApi";
import { BTN, CondPill, INK_SOFT, MUTED } from "./BetaCalParts";

const LIST = { listStyle: "none", margin: 0, padding: 0 } as const;
const PAGE = 10;

export function BetaCalProgress({ m, who, viewingName }: { m: BoardModel; who: Viewing; viewingName: string | null }): ReactElement {
  const list = who === "All" ? [] : progressList(m, who);
  const groups = who === "All" ? progressByPerson(m) : [];
  return (
    <section aria-labelledby="betaProgHead" style={{ ...GLASS, borderRadius: 26, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
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
    </section>
  );
}

/** One person's projects as a toggle heading, closed until opened, ten rows a page. */
function PersonCard({ m, person, projects }: { m: BoardModel; person: PersonRef | null; projects: DesignProject[] }): ReactElement {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(projects.length / PAGE);
  const at = Math.min(page, pages - 1);
  return (
    <details style={{ borderTop: `1px solid ${BETA.lineSoft}` }}>
      <summary style={{ padding: "12px 0", cursor: "pointer", fontWeight: 600, color: BETA.ink }}>
        {person?.name ?? "Not assigned"} <span style={{ color: MUTED, fontWeight: 500 }}>· {projects.length}</span>
      </summary>
      <ol style={LIST}>{projects.slice(at * PAGE, at * PAGE + PAGE).map((p) => <ProgressRow key={p.id} m={m} p={p} hl={person?.id ?? "All"} />)}</ol>
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

/** A project's line; `hl` is the person whose chips are highlighted. */
function ProgressRow({ m, p, hl }: { m: BoardModel; p: DesignProject; hl: Viewing }): ReactElement {
  const st = status(m, p);
  const cur = currentStep(m, p);
  const chips: Array<[string, string | undefined, number[]]> = [
    ["3D", p.by["3"]?.name, p.team["3"].map((x) => x.id)],
    ["2D", p.by["2"]?.name, p.team["2"].map((x) => x.id)],
    ["Handover", p.site?.name, p.site ? [p.site.id] : []],
  ];
  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 20px", padding: "14px 0", borderTop: `1px solid ${BETA.lineSoft}` }}>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Link to={`/beta/projects/${p.id}`} onClick={() => rememberLastProject(p.id)} style={{ color: BETA.ink, fontWeight: 600, textDecoration: "none" }}>{p.name}</Link>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12 }}>
          <CondPill text={`${st[0]} - ${st[1]}`} words={st[1]} />
          {chips.map(([label, name, id]) => {
            const me = hl !== "All" && id.includes(hl);
            return (
              <span key={label} style={{ padding: "2px 8px", borderRadius: 999, ...(me ? { background: BETA.accentFill, color: "#FFFFFF", fontWeight: 700 } : { background: BETA.chip, color: INK_SOFT, fontWeight: 500 }) }}>
                {label} · {name ?? "Not chosen"}
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ flex: "2 1 380px", minWidth: 0, display: "flex" }}>
        {STEPS.map(([key, label], i) => {
          const done = stepDone(m, p, key);
          const on = i === cur;
          return (
            <div key={key} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}>
              {i > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 10, right: "50%", width: "100%", height: 2, background: done || on ? TONES.accent.dot : BETA.line }} />}
              <span
                role="img"
                aria-label={`${label}: ${done ? "done" : on ? "now" : "not yet"}`}
                style={{ position: "relative", width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: done ? BETA.accentFill : BETA.surface, border: `2px solid ${done || on ? TONES.accent.dot : BETA.border}`, boxSizing: "border-box" }}
              >
                {done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                )}
              </span>
              <span style={{ fontSize: 11, fontWeight: on ? 700 : 500, color: on ? BETA.accentInk : MUTED, whiteSpace: "nowrap" }}>{label}</span>
            </div>
          );
        })}
      </div>
    </li>
  );
}
