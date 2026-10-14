/* Conts, renovation mode: the phone Calendar tab's Week view shows the same dated items per day as the desktop
   Calendar's Week view (onsite, 3D / 2D submissions, PO and delivery dates, site tasks, planned handover), not
   project bars. Same feed (GET /api/projects/calendar/events?items=1), same filters and the same day list the
   desktop shows at phone width (renovationWeekGrid). Month view keeps the bars. */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { filterRenoItems, itemsByDate, type RenoCalendarItem } from "../pages/projects/renovation/renovationCalendarItems";
import { RenovationItemLegend, RenovationWeekGrid } from "../pages/projects/renovation/renovationWeekGrid";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The seven days (Monday first) of the week holding `day`, as YYYY-MM-DD. */
export function renoWeekDays(day: Date): string[] {
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => isoOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
}

export function MobileRenovationWeek({ day, brand, organizer, showHolidays, enabled, onOpen }: {
  /** Any day of the week to show. */
  day: Date;
  /** The Calendar tab's filters; "" for all. */
  brand: string;
  organizer: string;
  showHolidays: boolean;
  enabled: boolean;
  onOpen?: (projectId: number) => void;
}) {
  const days = useMemo(() => renoWeekDays(day), [day]);
  const from = days[0]!;
  const to = days[6]!;
  const q = useQuery({
    queryKey: ["mobile-calendar-reno-week", from, to],
    queryFn: () => api.get<{ renoItems?: RenoCalendarItem[] }>(`/api/projects/calendar/events?from=${from}&to=${to}&items=1`),
    staleTime: 30_000,
    enabled,
  });
  const byDate = useMemo(
    () => itemsByDate(filterRenoItems(q.data?.renoItems ?? [], { brand, status: "", organizer, q: "" })),
    [q.data, brand, organizer],
  );

  if (q.error) {
    return (
      <div role="alert" style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: "var(--red)" }}>
        Couldn't load the week.{" "}
        <button type="button" onClick={() => void q.refetch()} style={{ fontFamily: "inherit", fontWeight: 700, textDecoration: "underline", background: "none", border: "none", color: "inherit" }}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div>
      <RenovationItemLegend />
      <RenovationWeekGrid
        days={days}
        byDate={byDate}
        today={isoOf(new Date())}
        showHolidays={showHolidays}
        loading={q.isLoading}
        onOpen={(id) => onOpen?.(id)}
      />
    </div>
  );
}
