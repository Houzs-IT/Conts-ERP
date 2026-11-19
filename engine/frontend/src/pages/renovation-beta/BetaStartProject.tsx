/* Start project (owner, 19 Nov 2026): the works start date. Sales order lines from a package template carry SLA days
   (processing and delivery, days after the start); setting or moving this date dates every such line still on its SLA.
   A date typed by hand on the SO tab is kept. Backend: routes/renovationProject.ts POST /:id/start. */

import { useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { useToast } from "../../hooks/useToast";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi } from "../projects/renovation/simpleApi";
import { btnStyle, WS } from "./BetaWsUi";
import { invalidateBeta } from "./renovationBetaBoardApi";
import { dayMonthYear } from "./renovationBetaModel";

export function StartProjectButton({ projectId, startedOn, today, onError }: {
  projectId: number; startedOn: string | null; today: string; onError: (text: string) => void;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(startedOn ?? today);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const r = await simpleApi.startProject(projectId, date);
      toast.success(r.dated
        ? `Works start ${dayMonthYear(date)}. ${r.dated} sales order line${r.dated === 1 ? "" : "s"} dated from the template SLA.`
        : `Works start ${dayMonthYear(date)}. No sales order line has template SLA days yet.`);
      setOpen(false);
      void invalidateBeta(queryClient);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setDate(startedOn ?? today); setOpen(true); }} style={btnStyle(startedOn ? "outline" : "teal")}
        title="The works start date: sales order lines from a package template are dated from it">
        <PlayCircle size={16} aria-hidden="true" />
        {startedOn ? `Started ${dayMonthYear(startedOn)}` : "Start project"}
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderRadius: 12, background: WS.chip }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
        Works start
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ font: "inherit", padding: "6px 8px", borderRadius: 8, border: `1px solid ${WS.rowLine}` }} />
      </label>
      <button type="button" disabled={busy || !date} onClick={() => void save()} style={btnStyle("teal", "sm")}>{busy ? "Saving..." : startedOn ? "Move start" : "Start"}</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} style={btnStyle("outline", "sm")}>Cancel</button>
    </span>
  );
}
