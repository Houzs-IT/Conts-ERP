// Audit 2026-11-28, C4: Dream Crafter's "started projects" totals and the sales CSV
// filename used the UTC date (`new Date().toISOString().slice(0, 10)`). Workers run in
// UTC, so before 08:00 Malaysia time that is YESTERDAY: a project starting today was
// left out of "started", and the CSV was dated a day early. Both now use todayMyt().
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayMyt } from "../src/scm/lib/my-time";

const src = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("todayMyt before 08:00 MYT", () => {
  afterEach(() => vi.useRealTimers());
  it("is Malaysia's date, while the UTC date is still yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T23:30:00Z")); // 07:30 on 28 Nov in Malaysia
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-27"); // the old, wrong day
    expect(todayMyt()).toBe("2026-11-28");
  });
  it("agrees with UTC after 08:00 MYT", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T04:00:00Z")); // 12:00 MYT
    expect(todayMyt()).toBe("2026-11-28");
  });
});

describe("the routes use it", () => {
  it('projects.ts: both "started" scopes compare start_date with todayMyt()', () => {
    const projects = src("src/routes/projects.ts");
    const started = projects.split('if (scope === "started") {').slice(1).map((b) => b.slice(0, b.indexOf("}")));
    expect(started).toHaveLength(2);
    for (const block of started) {
      expect(block).toContain("binds.push(todayMyt());");
      expect(block).not.toContain("toISOString().slice(0, 10)");
    }
  });
  it("sales.ts: the CSV filename is dated with todayMyt()", () => {
    const sales = src("src/routes/sales.ts");
    const at = sales.indexOf("const filename = !isNaN(projectId)");
    const before = sales.slice(Math.max(0, at - 300), at);
    expect(before).toContain("const today = todayMyt();");
    expect(before).not.toContain("toISOString().slice(0, 10)");
    expect(sales).toMatch(/import \{ todayMyt \} from "\.\.\/scm\/lib\/my-time";/);
  });
});
