import { describe, expect, test } from "vitest";
import { MEDIA_IMAGE_MAX_BYTES, mediaActivityText, parseTarget, targetCode } from "../src/services/renovation/betaMedia";
import { isProofRefusal, parseProofPhotos } from "../src/services/renovation/lineProof";

const LINE_ID = "0b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a10";
const photo = { name: "a.jpg", mime: "image/jpeg", dataBase64: btoa("bytes") };

describe("line proof media target", () => {
  test("a line target round trips and accepts only a lower-case uuid", () => {
    expect(targetCode({ kind: "line", soItemId: LINE_ID })).toBe(`line:${LINE_ID}`);
    expect(parseTarget(`line:${LINE_ID}`)).toEqual({ kind: "line", soItemId: LINE_ID });
    expect(parseTarget(`line:${LINE_ID.toUpperCase()}`)).toBeNull();
    expect(parseTarget("line:12")).toBeNull();
    expect(parseTarget(`line:${LINE_ID}; drop table`)).toBeNull();
  });

  test("the timeline names it line proof", () => {
    expect(mediaActivityText(`line:${LINE_ID}`, null).title).toBe("Photo added as line proof");
  });
});

describe("proof photo list", () => {
  test("keeps the bytes, type and name of good photos", () => {
    const parsed = parseProofPhotos([photo, { ...photo, name: "", mime: "image/heic" }]);
    expect(isProofRefusal(parsed)).toBe(false);
    if (isProofRefusal(parsed)) return;
    expect(parsed.map((item) => [item.name, item.mime, item.bytes.byteLength])).toEqual([["a.jpg", "image/jpeg", 5], ["proof.heic", "image/heic", 5]]);
  });

  test("none, too many, other types and oversize photos are refused", () => {
    expect(parseProofPhotos([])).toMatchObject({ error: "photo_required" });
    expect(parseProofPhotos(undefined)).toMatchObject({ error: "photo_required" });
    expect(parseProofPhotos(Array.from({ length: 11 }, () => photo))).toMatchObject({ error: "photo_invalid" });
    expect(parseProofPhotos([{ ...photo, mime: "image/gif" }])).toMatchObject({ error: "photo_invalid" });
    expect(parseProofPhotos([{ ...photo, mime: "video/mp4" }])).toMatchObject({ error: "photo_invalid" });
    expect(parseProofPhotos([{ ...photo, dataBase64: "a".repeat(Math.ceil((MEDIA_IMAGE_MAX_BYTES * 4) / 3) + 8) }])).toMatchObject({ error: "photo_invalid" });
    expect(parseProofPhotos([{ ...photo, dataBase64: "" }])).toMatchObject({ error: "photo_invalid" });
  });
});
