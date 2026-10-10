import { describe, expect, it, vi } from "vitest";
import { HEIC_ACCEPT, HeicConversionError, isHeicFile, toUploadableImage } from "./heicToJpeg";

const heic = (name = "IMG_0001.HEIC", type = "image/heic") => new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], name, { type, lastModified: 1_700_000_000_000 });
const jpegBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

describe("isHeicFile", () => {
  it("knows HEIC / HEIF by type, and by extension when the browser gives no type", () => {
    expect(isHeicFile(heic())).toBe(true);
    expect(isHeicFile(heic("a.heif", "image/heif"))).toBe(true);
    expect(isHeicFile(heic("IMG_2.heic", ""))).toBe(true);
    expect(isHeicFile(heic("IMG_2.HEIF", "application/octet-stream"))).toBe(true);
    expect(isHeicFile(new File([""], "a.jpg", { type: "image/jpeg" }))).toBe(false);
    expect(isHeicFile(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });
  it("the file pickers' accept list names HEIC and HEIF", () => {
    expect(HEIC_ACCEPT).toContain(".heic");
    expect(HEIC_ACCEPT).toContain("image/heif");
  });
});

describe("toUploadableImage", () => {
  it("passes every other file through untouched, without loading a converter", async () => {
    const native = vi.fn();
    const library = vi.fn();
    const f = new File(["x"], "a.png", { type: "image/png" });
    expect(await toUploadableImage(f, { native, library })).toBe(f);
    expect(native).not.toHaveBeenCalled();
    expect(library).not.toHaveBeenCalled();
  });

  it("uses the browser's own decoder first (Safari) and names the result .jpg", async () => {
    const library = vi.fn();
    const out = await toUploadableImage(heic(), { native: async () => jpegBlob(), library });
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_0001.jpg");
    expect(out.lastModified).toBe(1_700_000_000_000);
    expect(library).not.toHaveBeenCalled();
  });

  it("falls back to the library when the browser cannot decode HEIC", async () => {
    const library = vi.fn(async () => jpegBlob());
    const out = await toUploadableImage(heic("IMG_9.heif", ""), { native: async () => null, library });
    expect(library).toHaveBeenCalledOnce();
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_9.jpg");
  });

  it("refuses with a clear message when nothing can convert it", async () => {
    const err = await toUploadableImage(heic(), { native: async () => null, library: async () => { throw new Error("ERR_LIBHEIF format not supported"); } }).catch((e) => e);
    expect(err).toBeInstanceOf(HeicConversionError);
    expect(err.message).toMatch(/IMG_0001\.HEIC/);
    expect(err.message).toMatch(/Most Compatible/);
  });

  it("refuses when the library answers with something that is not a JPEG", async () => {
    const err = await toUploadableImage(heic(), { native: async () => null, library: async () => new Blob(["x"], { type: "image/png" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(HeicConversionError);
  });
});
