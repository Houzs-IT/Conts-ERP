import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Service-case CSVs open in Excel, which reads a file without a UTF-8 BOM in
 * the PC's codepage: Chinese notes and names come out garbled. Both CSV routes
 * in assr.ts (the case list and one case's timeline) must start the body with
 * the mark.
 */
const ASSR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src/routes/assr.ts");

const routeBody = (src: string, route: string) => {
  const start = src.indexOf(`app.get("${route}"`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n});", start));
};

describe("service-case CSV exports start with the UTF-8 BOM", () => {
  const src = fs.readFileSync(ASSR, "utf8");

  test("one case's timeline.csv", () => {
    expect(routeBody(src, "/:id/timeline.csv")).toContain('new Response("\\uFEFF" + lines.join(');
  });

  test("the case list export.csv", () => {
    expect(routeBody(src, "/export.csv")).toContain('"\\uFEFF" + lines.join(');
  });
});
