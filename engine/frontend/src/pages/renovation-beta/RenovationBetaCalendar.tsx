/* Beta > Calendar: the mockup's Calendar area (markup id="calendarArea"): the title, the SOP line, "Viewing", and the
   Deadlines / Progress / Calendar switch. Each view is its own file (BetaCalDeadlines, BetaCalProgress, BetaCalMonth);
   the forms are in BetaForms. Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useQuery } from "../../hooks/useQuery";
import { errorText } from "../projects/renovation/renovationModel";
import { BETA } from "./renovationBetaTheme";
import { add, buildModel, ds, rangeFor, SOP_LABEL, shiftMonth, type CalEvent, type Kind, type Viewing } from "./renovationBetaBoard";
import { approveNewest, boardApi, boardKey, invalidateBeta, type BetaBoardProject, type BoardRange } from "./renovationBetaBoardApi";
import { ErrorBanner, INK_SOFT, MUTED, useToast } from "./BetaCalParts";
import { BetaCalDeadlines } from "./BetaCalDeadlines";
import { BetaCalProgress } from "./BetaCalProgress";
import { BetaCalMonth } from "./BetaCalMonth";
import { BetaDialogs, type BetaDialog } from "./BetaForms";
import { BetaSkin } from "./BetaWsUi";

type CalTab = "design" | "prog" | "mine";
const TABS: ReadonlyArray<readonly [CalTab, string]> = [["design", "Deadlines"], ["prog", "Progress"], ["mine", "Calendar"]];

/** Where "+ Add project" goes: the Projects list with its New project form open (Projects.tsx reads ?new=1). */
export const ADD_PROJECT_PATH = "/projects?view=list&new=1";

/** The colours are set before anything else draws, so the loading line and an error already have them. */
export function RenovationBetaCalendar(): ReactElement {
  return (
    <>
      <BetaSkin />
      <CalendarScreen />
    </>
  );
}

function CalendarScreen(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can("projects.write");
  const [range, setRange] = useState<BoardRange | undefined>(undefined);
  const queryClient = useQueryClient();
  const q = useQuery(boardKey(range), () => boardApi.board(range), [], { keepPreviousData: true });
  const { toast, show } = useToast();
  const [tab, setTab] = useState<CalTab>("design");
  const [pick, setPick] = useState<Viewing | null>(null);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [selDay, setSelDay] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BetaDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const m = useMemo(() => (q.data ? buildModel(q.data) : null), [q.data]);

  if (q.error && !m) return <ErrorBanner text={`The calendar could not be loaded: ${q.error}`} onRetry={q.reload} />;
  if (!m) return <p style={{ padding: "40px 0", textAlign: "center", color: MUTED, fontSize: 14 }}>Loading calendar...</p>;

  const who: Viewing = pick ?? m.mePersonId ?? "All";
  const viewingName = who === "All" ? null : m.everyone.find((x) => x.id === who)?.name ?? null;
  const shown = month ?? { y: Number(m.today.slice(0, 4)), m: Number(m.today.slice(5, 7)) - 1 };

  function goMonth(y: number, mo: number): void {
    if (!m) return;
    setMonth({ y, m: mo });
    setRange(rangeFor(m.today, y, mo));
  }

  /* One write from a row button: busy while it runs, the board reloaded after, a failure shown above the view. */
  async function act(fn: () => Promise<void>, okText: string): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await invalidateBeta(queryClient);
      show(okText);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const today = m.today;
  const sop = m.sop;
  const raw = (id: number): BetaBoardProject | undefined => q.data?.projects.find((p) => p.id === id);

  const switchBtn = (on: boolean): CSSProperties => ({
    minHeight: 36, padding: "0 14px", border: `2px solid ${on ? BETA.blue : "transparent"}`, borderRadius: 999, font: "inherit", fontWeight: 600, cursor: "pointer",
    background: on ? BETA.surface : "transparent", color: on ? BETA.ink : INK_SOFT,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: BETA.ink }}>
      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-.02em" }}>Calendar</h1>
          <div style={{ marginTop: 4, color: MUTED, fontSize: 14 }}>{SOP_LABEL(m)}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: INK_SOFT }}>
            Viewing
            <select
              value={String(who)}
              onChange={(e) => setPick(e.target.value === "All" ? "All" : Number(e.target.value))}
              style={{ minHeight: 40, border: `1px solid ${BETA.glassEdge}`, borderRadius: 999, padding: "0 12px", font: "inherit", fontWeight: 600, background: BETA.field, boxShadow: BETA.btnGlassShadow, color: BETA.ink }}
            >
              <option value="All">Whole team</option>
              {m.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              {who !== "All" && !m.people.some((x) => x.id === who) && viewingName && <option value={who}>{viewingName}</option>}
            </select>
          </label>
          <div role="tablist" aria-label="Calendar views" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 999, background: BETA.head }}>
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={switchBtn(tab === key)}>{label}</button>
            ))}
          </div>
        </div>
      </section>

      {q.error && <ErrorBanner text={`The calendar could not be refreshed: ${q.error}`} onRetry={q.reload} />}
      {actionError && <ErrorBanner text={actionError} />}

      {tab === "design" && (
        <BetaCalDeadlines
          m={m}
          who={who}
          canAssign={canWrite}
          viewingName={viewingName}
          busy={busy}
          onNotice={show}
          onError={setActionError}
          onAddProject={() => navigate(ADD_PROJECT_PATH)}
          onAssign={(id) => setDialog({ t: "assign", projectId: id })}
          onBook={(id, key) => setDialog({ t: "book", projectId: id, key })}
          onAmend={(id, k) => setDialog({ t: "amend", projectId: id, k })}
          onEdit={(id) => setDialog({ t: "dates", projectId: id })}
          onApprove={(p, k: Kind) => {
            const full = raw(p.id);
            if (!full) return;
            void act(
              () => approveNewest(full, k === "3" ? "3d" : "2d", today, p.customer ?? "Client"),
              k === "3" ? "3D approved · 2D is ready to start" : "2D approved · now PO, carpentry measure and site briefing",
            );
          }}
          onStart={(p, k: Kind) => {
            void act(
              () => boardApi.saveDesign(p.id, k === "3" ? { start3dOn: today } : { start2dOn: today }).then(() => undefined),
              `${k}D started · due ${ds(add(today, sop[k]))}`,
            );
          }}
        />
      )}
      {tab === "prog" && <BetaCalProgress m={m} who={who} viewingName={viewingName} />}
      {tab === "mine" && (
        <BetaCalMonth
          m={m}
          who={who}
          view={shown}
          selDay={selDay}
          onPrev={() => { const n = shiftMonth(shown.y, shown.m, -1); goMonth(n.y, n.m); }}
          onNext={() => { const n = shiftMonth(shown.y, shown.m, 1); goMonth(n.y, n.m); }}
          onToday={() => { goMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1); setSelDay(today); }}
          onPick={(day) => setSelDay((cur) => (cur === day ? null : day))}
          canWrite={canWrite}
          onAddWork={() => setDialog({ t: "work", ev: null, day: selDay ?? today })}
          onEditEvent={(e: CalEvent) => setDialog(e.appt ? { t: "book", projectId: e.appt.projectId, key: e.appt.key } : { t: "work", ev: e, day: e.d })}
        />
      )}

      <BetaDialogs
        dialog={dialog}
        env={{
          m, who,
          onClose: () => setDialog(null),
          onSaved: (text, jumpTo) => {
            setDialog(null);
            if (jumpTo) {
              goMonth(Number(jumpTo.slice(0, 4)), Number(jumpTo.slice(5, 7)) - 1);
              setSelDay(jumpTo);
            }
            void invalidateBeta(queryClient);
            show(text);
          },
        }}
      />
      {toast}
    </div>
  );
}
