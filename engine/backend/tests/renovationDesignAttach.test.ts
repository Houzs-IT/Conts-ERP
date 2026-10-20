import { describe, expect, test } from "vitest";
import { DESIGN_ATTACH_MAX, designAttachRefusal } from "../src/services/renovation/records";

describe("Attach a file to a link-only design version (imported Notion PDFs up to 55 MB)", () => {
  test("a PDF with its size is accepted up to the limit", () => {
    expect(designAttachRefusal("application/pdf", "57490000")).toBeNull();
    expect(designAttachRefusal("application/pdf; charset=binary", String(DESIGN_ATTACH_MAX))).toBeNull();
  });
  test("refused: unknown type, no size, empty, over the limit", () => {
    expect(designAttachRefusal("text/html", "100")?.status).toBe(415);
    expect(designAttachRefusal("application/pdf", null)?.status).toBe(411);
    expect(designAttachRefusal("application/pdf", "12abc")?.status).toBe(411);
    expect(designAttachRefusal("application/pdf", "0")?.status).toBe(400);
    expect(designAttachRefusal("application/pdf", String(DESIGN_ATTACH_MAX + 1))?.status).toBe(413);
  });
});
