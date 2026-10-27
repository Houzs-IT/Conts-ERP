/* Beta polish run (owner, 24 Oct 2026): words on the Timeline, the Client PO area, and photos and videos without
   a document of their own. */
import { describe, expect, it } from "vitest";
import { activityText, plainEntry, plainWords, taskCodeLabel } from "./timeline";
import {
  MEDIA_VIDEO_MAX_BYTES, cleanMediaList, mediaActivityText, mediaCap, mediaKindOf, mediaRowsJson, metaOf, parseTarget, sortPhotos, targetCode,
  type ProjectPhoto,
} from "./betaMedia";
import { CLIENT_LINE_ROOM, loadClientItems } from "./betaVoPo";
import type { Db } from "./load";

/** Anything a person reads must not hold a stored code. */
const CODE = /INTERNAL:|CAT:|\b[a-z]+_[a-z0-9_]+\b/;

describe("Timeline words", () => {
  it("names a template site task instead of its stored code", () => {
    expect(taskCodeLabel("INTERNAL:pre_reno_delivery")).toBe("Pre-reno works & item delivery");
    expect(taskCodeLabel("CAT:CURTAIN")).toBe("Curtain installation");
    expect(taskCodeLabel("MASONRY_TILING")).toBe("Masonry tiling");
    const t = activityText({ action: "task_done", from_value: "INTERNAL:pre_reno_delivery", to_value: "done", note: null });
    expect(t).toEqual({ title: "Site task done", body: "Pre-reno works & item delivery" });
  });

  it("leaves no INTERNAL: or snake_case code in any activity line", () => {
    const actions = [
      "created", "so_linked", "task_added", "task_done", "task_skipped", "task_fulfilment", "beta_appointment_booked", "beta_appointment_done",
      "beta_reminder", "beta_event_added", "checklist_status", "some_new_action", "beta_media", "reno_pic_changed",
    ];
    for (const action of actions) {
      const raw = activityText({ action, from_value: "INTERNAL:qc", to_value: "site_measure", note: "Booked for site_briefing" });
      const e = plainEntry({ title: raw.title, body: raw.body });
      expect(`${e.title} ${e.body ?? ""}`, action).not.toMatch(CODE);
    }
  });

  it("keeps e-mail addresses, file keys and document numbers as they are", () => {
    expect(plainWords("Sent to jia_xin@conts.my")).toBe("Sent to jia_xin@conts.my");
    expect(plainWords("renovation/99/defect_photo.jpg")).toBe("renovation/99/defect_photo.jpg");
    expect(plainWords("TC-SO-2610-002 linked")).toBe("TC-SO-2610-002 linked");
    expect(plainWords("site_measure done")).toBe("site measure done");
    expect(plainWords(null)).toBeNull();
  });
});

describe("Client PO area", () => {
  it("reads the SO line's own room when the line has no renovation line, as the PO tab does", async () => {
    let sql = "";
    const db = {
      prepare(text: string) {
        sql += `${text}
`;
        return {
          bind: () => ({
            all: async () => ({
              results: [{
                id: "l1", doc_no: "TC-SO-2610-002", item_code: "CUS-DINING", description: "Dining set", qty: 1, uom: "SET", unit_cost_sen: 0, photo_urls: null,
                room: "Living hall", supply_by_owner: null, line_supplier_code: null, main_supplier_code: null, measure: null, measure_uom: null, vo_no: null,
                cat_label: null, cat_sort: null, sub_label: null, sub_sort: null, sku_photos: "[]",
              }],
            }),
          }),
        };
      },
    } as unknown as Db;
    const r = await loadClientItems(db, 99, 1);
    expect(sql).toContain(CLIENT_LINE_ROOM);
    expect(CLIENT_LINE_ROOM).toMatch(/to_jsonb\(i\)->>'room'/);
    expect(CLIENT_LINE_ROOM).toMatch(/i\.location/);
    expect(r.items[0]?.area).toBe("Living hall");
  });
});

describe("Photos and videos without a document", () => {
  it("round-trips what a file belongs to", () => {
    for (const code of ["progress", "task:12", "defect:7:before", "defect:7:after:2"]) expect(targetCode(parseTarget(code)!)).toBe(code);
    expect(parseTarget("defect:7")).toBeNull();
    expect(parseTarget("task:x")).toBeNull();
  });

  it("takes photos and short videos from this project's store only", () => {
    const ok = cleanMediaList([
      { key: "renovation/99/progress-1.jpg", name: "a.jpg", mime: "image/jpeg", size: 1000 },
      { key: "renovation/99/progress-2.mp4", name: "walk.mp4", mime: "video/mp4" },
      { key: "renovation/99/progress-1.jpg", name: "dup.jpg", mime: "image/jpeg" },
    ], 99, { area: " Kitchen ", note: "after hacking" });
    expect(ok.ok && ok.value.map((x) => [x.key, x.meta.area, x.meta.note])).toEqual([
      ["renovation/99/progress-1.jpg", "Kitchen", "after hacking"], ["renovation/99/progress-2.mp4", "Kitchen", "after hacking"],
    ]);
    expect(cleanMediaList([{ key: "renovation/98/x.jpg", mime: "image/jpeg" }], 99).ok).toBe(false);
    expect(cleanMediaList([{ key: "renovation/99/../x.jpg", mime: "image/jpeg" }], 99).ok).toBe(false);
    expect(cleanMediaList([{ key: "renovation/99/x.exe", mime: "application/x-msdownload" }], 99).ok).toBe(false);
    expect(cleanMediaList(Array.from({ length: 21 }, (_, i) => ({ key: `renovation/99/${i}.jpg`, mime: "image/jpeg" })), 99).ok).toBe(false);
    expect(mediaCap("video/quicktime")).toBe(MEDIA_VIDEO_MAX_BYTES);
    expect(mediaCap("application/pdf")).toBeNull();
  });

  it("reads back what was stored, and says on the Timeline what was added", () => {
    const ok = cleanMediaList([{ key: "renovation/99/v.mov", name: "door.mov", mime: "video/quicktime" }], 99, { area: "Kitchen" });
    if (!ok.ok) throw new Error("refused");
    const row = JSON.parse(mediaRowsJson(ok.value))[0] as { key: string; meta: string };
    expect(metaOf(row.meta, row.key)).toMatchObject({ name: "door.mov", mime: "video/quicktime", area: "Kitchen" });
    expect(mediaKindOf("video/quicktime")).toBe("video");
    expect(mediaKindOf(null, "renovation/99/a.JPG")).toBe("image");
    expect(mediaKindOf("application/pdf", "x.pdf")).toBe("file");
    expect(mediaActivityText("defect:7:after:0", row.meta)).toEqual({ title: "Video added to a defect (after the fix)", body: "Kitchen" });
    expect(metaOf("not json", "renovation/99/a.jpg").name).toBe("a.jpg");
  });

  it("sorts every photo by its time to the minute, newest first, undated last", () => {
    const p = (id: string, at: string | null): ProjectPhoto => ({
      id, path: "", kind: "image", name: id, at, area: null, category: "progress", label: null, group: { key: id, title: id }, note: null,
    });
    const out = sortPhotos([p("old", "2026-10-23T02:00:00Z"), p("none", null), p("late", "2026-10-24T07:42:00Z"), p("early", "2026-10-24T07:41:00Z")]);
    expect(out.map((x) => x.id)).toEqual(["late", "early", "old", "none"]);
  });
});
