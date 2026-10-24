/* Owner live check on project 99 "TESTING" (24 Oct 2026): one DO status wording on every screen, and the Site & photos
   timeline grouped per source document or defect within a day. */
import { describe, expect, it } from "vitest";
import { doDeliveredDay, doStatusWords } from "../scm-v2/renovationDoStatus";
import { statusTone } from "./BetaDocTabs";
import { cardMeta, photoTimeline } from "./renovationBetaPhotosModel";
import type { ProjectPhoto } from "./renovationBetaMediaApi";

describe("one DO status wording", () => {
  it("the DO list's words, plus Delivered", () => {
    expect(doStatusWords("LOADED").label).toBe("Confirmed");
    expect(doStatusWords("DISPATCHED").label).toBe("Loaded");
    expect(doStatusWords("DELIVERED")).toEqual({ label: "Delivered", tone: "success", delivered: true });
    expect(doStatusWords("delivered", "shipped").label).toBe("Delivered");
    expect(doStatusWords("DELIVERED", "invoiced").label).toBe("Invoiced");
    expect(doStatusWords("CANCELLED").tone).toBe("error");
  });
  it("the Beta DO tab says the same as the DO screens, not the raw stored value", () => {
    expect(statusTone({ type: "delivery_order", status: "LOADED" }).text).toBe("Confirmed");
    expect(statusTone({ type: "delivery_order", status: "DELIVERED" }).text).toBe("Delivered");
    expect(statusTone({ type: "goods_received", status: "POSTED" }).text).toBe("Submitted");
  });
  it("the delivered day is the day recorded, else the delivered moment in Malaysia", () => {
    expect(doDeliveredDay({ customer_delivered_date: "2026-10-22", delivered_at: "2026-10-24T05:40:59Z" })).toBe("2026-10-22");
    expect(doDeliveredDay({ customer_delivered_date: null, delivered_at: "2026-10-23T17:00:00Z" })).toBe("2026-10-24");
    expect(doDeliveredDay({})).toBeNull();
  });
});

describe("Site & photos groups a day's photos per document or defect", () => {
  const ph = (id: string, at: string, key: string, label: string): ProjectPhoto => ({
    id, path: "", kind: "image", name: id, at, area: null, category: "defect", label, group: { key, title: `Defect ${key}` }, note: null,
  });
  it("interleaved defect photos of one day make one card per defect, newest first", () => {
    const days = photoTimeline([
      ph("a", "2026-10-24T09:00:00Z", "defect:1", "After"),
      ph("b", "2026-10-24T08:00:00Z", "defect:2", "Before"),
      ph("c", "2026-10-24T07:00:00Z", "defect:1", "Before"),
      ph("d", "2026-10-24T06:00:00Z", "defect:2", "After"),
      ph("e", "2026-10-23T06:00:00Z", "defect:1", "Before"),
    ]);
    expect(days.map((d) => d.cards.map((c) => [c.key, c.items.map((i) => i.id).join("")]))).toEqual([
      [["defect:1", "ac"], ["defect:2", "bd"]],
      [["defect:1", "e"]],
    ]);
    expect(cardMeta(days[0]!.cards[0]!)).toBe("5:00 pm · After / Before · 2 photos");
  });
});
