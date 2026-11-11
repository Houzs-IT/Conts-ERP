import { describe, expect, test } from "vitest";
import { chainTimeline, statusWords } from "./betaTimelineChain";
import type { TimelineEntry } from "./timeline";

const e = (id: string, at: string, by: string | null = null): TimelineEntry => ({ id, at, dateOnly: false, category: "system", title: id, body: null, by });

describe("beta timeline chain", () => {
  test("a stored status reads as words", () => {
    expect(statusWords("RENO_CONFIRMED")).toBe("Confirmed");
    expect(statusWords("PARTIALLY_PAID")).toBe("Partially paid");
    expect(statusWords("cash")).toBe("Cash");
    expect(statusWords("")).toBeNull();
  });

  test("the chain reads in order inside one minute, newest first", () => {
    const same = "2026-11-06T18:29:2";
    const out = chainTimeline([
      e("prod:1:done", `${same}1Z`), e("gr:1", `${same}0Z`), e("do:1", `${same}1Z`), e("prod:1:start", `${same}0Z`),
      e("si:1", "2026-11-06T18:31:43Z"), e("pay:1", "2026-11-06T18:32:14Z"), e("po:1", "2026-11-06T18:27:47Z"),
      e("so:1", "2026-11-06T18:24:18Z"), e("quotation:1", "2026-11-06T18:22:00Z"), e("act:7", `${same}5Z`),
    ]);
    expect(out.map((x) => x.id)).toEqual(["pay:1", "si:1", "do:1", "gr:1", "prod:1:done", "prod:1:start", "act:7", "po:1", "so:1", "quotation:1"]);
  });

  test("a DO made and delivered the same day is one entry and keeps who made it", () => {
    const out = chainTimeline([e("do:1", "2026-11-06T18:29:21Z", "Lee"), e("deliv:1", "2026-11-06T18:29:22Z")]);
    expect(out.map((x) => [x.id, x.by])).toEqual([["deliv:1", "Lee"]]);
  });

  test("a DO made on Monday and delivered on Friday keeps both days", () => {
    expect(chainTimeline([e("do:1", "2026-11-02T04:00:00Z"), e("deliv:1", "2026-11-06T04:00:00Z")]).map((x) => x.id)).toEqual(["deliv:1", "do:1"]);
  });

  test("a site receipt replaces its goods receipt line the same day", () => {
    expect(chainTimeline([e("gr:1", "2026-11-06T04:00:00Z"), e("grsite:1", "2026-11-06T04:00:01Z")]).map((x) => x.id)).toEqual(["grsite:1"]);
  });
});
