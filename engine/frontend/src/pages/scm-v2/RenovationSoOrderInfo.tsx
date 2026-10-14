/* Renovation mode (Conts, 14 Oct 2026; mig 0112): the read-only "Order
   information" of a sales order on its detail page, in place of Houzs's Order
   info (building type, fair, dates). Project, its dates, building, unit,
   property type, layout and built-up area, read from
   /api/scm/renovation-so-info/so/:docNo. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "../../lib/utils";
import { soInfoApi } from "../projects/renovation/customerPropertyApi";
import { showDate } from "../projects/renovation/customerPropertyModel";

function Cell({ label, value, muted, span }: { label: string; value: ReactNode; muted?: boolean; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : undefined}>
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{label}</div>
      <div className={cn("mt-1 text-[14px] font-semibold leading-snug", muted ? "text-ink-muted" : "text-ink")}>{value}</div>
    </div>
  );
}

export function RenovationSoOrderInfo({ docNo, payment }: { docNo: string; payment: string | null }) {
  const q = useQuery({ queryKey: ["reno", "so-info", "so", docNo], queryFn: () => soInfoApi.so(docNo), staleTime: 30_000 });
  if (q.isLoading) return <div className="h-24 animate-pulse rounded-md bg-surface-dim" aria-busy="true" />;
  if (q.isError || !q.data) return <p role="alert" className="text-[13px] text-err">The order information could not be loaded. Reload the page.</p>;
  const { info, project } = q.data;
  const layout = info.layoutLabel
    || (info.bedrooms !== "" || info.bathrooms !== "" ? `${info.bedrooms || "?"} bed ${info.bathrooms || "?"} bath` : "");
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
      <Cell
        label="Project"
        span
        value={project
          ? <Link to={`/projects/${project.id}`} className="text-primary hover:underline">{project.code ?? `#${project.id}`} · {project.name}</Link>
          : "No project"}
        muted={!project}
      />
      <Cell label="Start date" value={project ? showDate(project.startDate) : "—"} muted={!project?.startDate} />
      <Cell label="End date" value={project ? showDate(project.endDate) : "—"} muted={!project?.endDate} />
      <Cell label="Building" span value={info.building || "—"} muted={!info.building} />
      <Cell label="Unit" value={info.unitNo || "—"} muted={!info.unitNo} />
      <Cell label="Property type" value={info.propertyType || "—"} muted={!info.propertyType} />
      <Cell label="Layout" span value={layout ? `${layout}${info.layoutLabel && info.bedrooms !== "" && !/bed/i.test(info.layoutLabel) ? ` (${info.bedrooms} bed, ${info.bathrooms} bath)` : ""}` : "—"} muted={!layout} />
      <Cell label="Built-up" value={info.builtUpSqft ? `${Number(info.builtUpSqft).toLocaleString("en-MY")} sq ft` : "—"} muted={!info.builtUpSqft} />
      <Cell label="Payment" value={payment || "—"} muted={!payment} />
    </div>
  );
}
