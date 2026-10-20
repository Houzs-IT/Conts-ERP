// Plain-text dry-run report of a mapped export: counts per entity, rows not imported and why, parse
// failures, names that match nobody on the people list, and Notion status conflicts.

export function reportText(r, chunks = []) {
  const o = r.output;
  const lines = [];
  const kv = (k, v) => lines.push(`  ${k.padEnd(34)} ${v}`);
  lines.push(`Notion import dry run (export ${r.exportDate})`, "");
  lines.push("Input rows");
  kv("Projects", r.input.projects);
  kv("Renovation tasks", r.input.renoTasks);
  kv("ID tasks", r.input.idTasks);
  kv("Unit key records", r.input.keyRecords ?? 0);
  lines.push("", "Will write (before upsert)");
  kv("People", o.people);
  kv("Projects", `${o.projects} (${o.projectsWithPageId} with a Notion page id, the rest keyed by title)`);
  kv("  step", Object.entries(o.steps).map(([k, v]) => `${k} ${v}`).join(", "));
  kv("  In defect flag", o.inDefect);
  kv("Site tasks", `${o.tasks} (${o.tasksDone} done; ${o.splitTasks ?? 0} Notion tasks split in two)`);
  kv("Task crew assignments", o.taskAssignees);
  kv("Site measures", o.siteMeasures);
  kv("Design files / links", `${o.designFiles} (${o.designFilesPendingUpload} PDFs pending upload, linked to their Notion page)`);
  kv("Order-list notes (in activity)", o.orderListNotes);
  kv("Unit key moves", `${o.keyMoves} holders at export, ${o.keyHistory ?? 0} dated passes`);
  kv("Step / hold history rows", o.flowLog);
  kv("Activity notes", o.activityNotes);
  kv("Rows keyed by hash (no page id)", r.taskRefFallbacks);
  const list = (title, xs, f) => {
    lines.push("", `${title} (${xs.length})`);
    for (const x of xs) lines.push(`  - ${f(x)}`);
  };
  list("Renovation task rows not imported", r.skipped.renoTasks, (x) => `row ${x.row}: ${x.reason}${x.project ? ` [${x.project}]` : ""}${x.category ? ` category ${x.category}` : ""}${x.date ? ` date ${x.date}` : ""}${x.contractor ? ` contractor ${x.contractor}` : ""}`);
  list("Unit key records not imported", r.skipped.keyRecords ?? [], (x) => `row ${x.row}: ${x.reason} (${x.name})${x.project ? ` [${x.project}]` : ""}`);
  list("ID task rows not imported", r.skipped.idTasks, (x) => `row ${x.row}: ${x.reason} (${x.task})${x.project ? ` [${x.project}]` : ""}`);
  list("Parse failures", r.parseFailures, (x) => `${x.entity}${x.row ? ` row ${x.row}` : ""}${x.name ? ` ${x.name}` : ""}: ${x.field} = ${x.value}`);
  list("Names not on the people list", Object.entries(r.unmappedNames), ([k, n]) => `${k} (${n})`);
  list("Status conflicts / judgement calls", r.conflicts, (x) => `${x.project}: ${x.issue} -> imported as ${x.imported}`);
  list("Drawing-only jobs (no design-only project type in the app)", r.drawingOnly, (x) => x);
  list("Subcontractor names kept as task text (no suppliers created)", Object.entries(r.subcontractorUse), ([k, n]) => `${k} (${n} tasks)`);
  list("Two categories sharing one trade on a project (occurrence counted per trade, as the app does)", r.occurrenceSharedTrade, (x) => `${x.project}: ${x.taskCode} <- ${x.categories.join(" + ")}`);
  lines.push("", `Files pending upload to R2: ${r.pendingFiles.so.reduce((n, x) => n + x.files.length, 0)} SO PDFs on ${r.pendingFiles.so.length} projects, ${r.pendingFiles.design.length} design PDFs (${r.pendingFiles.design.filter((x) => !x.inExport).length} named in Notion but not in the export zip)`);
  if (chunks.length) lines.push("", `SQL chunks: ${chunks.map((c) => `${c.name} (${Math.round(c.sql.length / 1024)} KB)`).join(", ")}`);
  return lines.join("\n");
}
