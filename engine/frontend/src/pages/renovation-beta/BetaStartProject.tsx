/* Project start date (owner, 20 Nov 2026; replaces the 19 Nov Start project button). Sales order lines from a package
   carry SLA days (processing and delivery, days after the start). Setting or changing this date dates every such line
   still on its SLA; a date typed by hand on the SO tab is kept. Lines a VO adds later are dated when it is approved.
   Backend: routes/renovationProject.ts POST /:id/start (works_started_on = the date). */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi } from "../projects/renovation/simpleApi";
import { WS } from "./BetaWsUi";
import { invalidateBeta } from "./renovationBetaBoardApi";
import { dayMonthYear } from "./renovationBetaModel";

/** A whole date the picker or typing has finished (a year still being typed, e.g. 0002, is not one). */
export function isWholeDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const y = Number(v.slice(0, 4));
  return y >= 2000 && y <= 2100 && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function ProjectStartDate({ projectId, startedOn, canWrite, onDone, onError }: {
  projectId: number; startedOn: string | null; canWrite: boolean; onDone: (text: string) => void; onError: (text: string) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(startedOn ?? "");
  const [busy, setBusy] = useState(false);
  const saved = useRef(startedOn ?? "");
  useEffect(() => { setDate(startedOn ?? ""); saved.current = startedOn ?? ""; }, [startedOn]);

  useEffect(() => {
    if (!canWrite || date === saved.current || !isWholeDate(date)) return;
    const t = setTimeout(() => {
      setBusy(true);
      const before = saved.current;
      saved.current = date;
      simpleApi.startProject(projectId, date).then((r) => {
        onDone(r.dated
          ? `Project start ${dayMonthYear(date)}. ${r.dated} sales order line${r.dated === 1 ? "" : "s"} dated from their SLA days.`
          : `Project start ${dayMonthYear(date)}. No sales order line has SLA days yet.`);
        void invalidateBeta(queryClient);
      }).catch((e) => { saved.current = before; onError(errorText(e)); }).finally(() => setBusy(false));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the date is the trigger
  }, [date]);

  return (
    <label title="Lines with SLA days get their processing and delivery dates from this date"
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 12, background: WS.chip, fontSize: 13, fontWeight: 600 }}>
      <CalendarDays size={16} aria-hidden="true" />
      Project start date
      <input type="date" aria-label="Project start date" value={date} disabled={!canWrite || busy} onChange={(e) => setDate(e.target.value)}
        style={{ font: "inherit", fontWeight: 500, padding: "5px 8px", borderRadius: 8, border: `1px solid ${WS.rowLine}`, background: WS.panel, color: "inherit" }} />
      {busy && <span style={{ fontWeight: 500, color: WS.text2 }}>Saving...</span>}
    </label>
  );
}
