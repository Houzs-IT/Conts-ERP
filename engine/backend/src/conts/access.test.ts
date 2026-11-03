import { describe, expect, it } from "vitest";
import { CONTS_AREAS, MAIL_AREA, contsPermissions, hasAnyAccess, parseContsAccess } from "./access";

const all = (level: string, extra: Record<string, string> = {}) => ({ ...Object.fromEntries(CONTS_AREAS.map((k) => [k, level])), ...extra });

// Mail Center (CONTS-0004): the Mail area on Property OS's chart opens the engine's inbox.
describe("Conts Mail area", () => {
  it("is none when a sign-on leaves it out, and refuses an unknown level", () => {
    expect(parseContsAccess(all("none"))?.[MAIL_AREA]).toBe("none");
    expect(parseContsAccess(all("none", { mail: "edit" }))?.[MAIL_AREA]).toBe("edit");
    expect(parseContsAccess(all("none", { mail: "owner" }))).toBeNull();
  });

  it("view and edit open the inbox; only full manages mailboxes", () => {
    const keys = (mail: string) => contsPermissions(parseContsAccess(all("none", { mail }))!);
    expect(keys("none")).not.toContain("mail_center.read");
    expect(keys("view")).toContain("mail_center.read");
    expect(keys("edit")).not.toContain("mail_center.manage");
    expect(keys("full")).toEqual(expect.arrayContaining(["mail_center.read", "mail_center.manage"]));
  });

  it("Mail alone is enough to be signed in", () => {
    expect(hasAnyAccess(parseContsAccess(all("none"))!)).toBe(false);
    expect(hasAnyAccess(parseContsAccess(all("none", { mail: "view" }))!)).toBe(true);
  });
});
