/* Calendar > Progress: the mockup's renderProg. One line per project with its condition, who does 3D, 2D and the
   handover, and the six steps (Measure, 3D, 2D, Carpentry, Site PIC, PO) with the current one marked. */

import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { BETA } from "./renovationBetaTheme";
import { currentStep, progressList, status, STEPS, stepDone, type BoardModel, type Viewing } from "./renovationBetaBoard";
import { CondPill, MUTED, rememberProject } from "./BetaCalParts";

export function BetaCalProgress({ m, who, viewingName }: { m: BoardModel; who: Viewing; viewingName: string | null }): ReactElement {
  const list = progressList(m, who);
  return (
    <section aria-labelledby="betaProgHead" style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <h2 id="betaProgHead" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{viewingName ? `${viewingName}'s projects` : "Team design progress"}</h2>
        <div style={{ marginTop: 4, fontSize: 13, color: MUTED }}>Updates by itself from Drawings, Client PO and bookings. Your part is highlighted.</div>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {list.length === 0 && <li style={{ padding: "14px 0", color: MUTED }}>No projects.</li>}
        {list.map((p) => {
          const st = status(m, p);
          const cur = currentStep(m, p);
          const chips: Array<[string, string | undefined, number | undefined]> = [
            ["3D", p.by["3"]?.name, p.by["3"]?.id],
            ["2D", p.by["2"]?.name, p.by["2"]?.id],
            ["Handover", p.site?.name, p.site?.id],
          ];
          return (
            <li key={p.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 20px", padding: "14px 0", borderTop: `1px solid ${BETA.lineSoft}` }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Link to={`/beta/projects/${p.id}`} onClick={() => rememberProject(p.id)} style={{ color: BETA.ink, fontWeight: 600, textDecoration: "none" }}>{p.name}</Link>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12 }}>
                  <CondPill text={`${st[0]} - ${st[1]}`} words={st[1]} />
                  {chips.map(([label, name, id]) => {
                    const me = who !== "All" && id === who;
                    return (
                      <span key={label} style={{ padding: "2px 8px", borderRadius: 6, ...(me ? { background: BETA.accent, color: "#FFFFFF", fontWeight: 700 } : { background: "#F2F5F4", color: "#3F4947", fontWeight: 500 }) }}>
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
                      {i > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 10, right: "50%", width: "100%", height: 2, background: done || on ? BETA.accent : "#DCE2E1" }} />}
                      <span
                        role="img"
                        aria-label={`${label}: ${done ? "done" : on ? "now" : "not yet"}`}
                        style={{ position: "relative", width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: done ? BETA.accent : "#FFFFFF", border: `2px solid ${done || on ? BETA.accent : BETA.border}`, boxSizing: "border-box" }}
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
        })}
      </ol>
    </section>
  );
}
