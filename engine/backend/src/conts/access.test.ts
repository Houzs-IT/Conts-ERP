import { describe, expect, it } from "vitest";
import { CONTS_AREAS, MAIL_AREA, contsPageAccess, contsPermissions, hasAnyAccess, isFullEverywhere, parseContsAccess } from "./access";

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

  it("full opens the Mailboxes tab of the Team page and the people list it needs", () => {
    const of = (mail: string) => parseContsAccess(all("none", { mail }))!;
    expect(contsPageAccess(of("edit")).team).toBe("none");
    expect(contsPageAccess(of("full")).team).toBe("view");
    expect(contsPermissions(of("edit"))).not.toContain("users.read");
    expect(contsPermissions(of("full"))).toContain("users.read");
  });

  it("Mail alone is enough to be signed in", () => {
    expect(hasAnyAccess(parseContsAccess(all("none"))!)).toBe(false);
    expect(hasAnyAccess(parseContsAccess(all("none", { mail: "view" }))!)).toBe(true);
  });
});

// Production (split permission areas, part 2b): its own box, split off Procurement.
describe("Conts Production area", () => {
  it("takes Procurement's level when a sign-on leaves it out", () => {
    expect(parseContsAccess(all("none", { scProcurement: "edit" }))?.scProduction).toBe("edit");
    expect(parseContsAccess(all("none", { scProcurement: "edit", scProduction: "none" }))?.scProduction).toBe("none");
    expect(parseContsAccess(all("none", { scProduction: "owner" }))).toBeNull();
  });

  it("sets the Production orders page only", () => {
    const pages = contsPageAccess(parseContsAccess(all("none", { scProcurement: "edit", scProduction: "view" }))!);
    expect(pages["scm.procurement.production"]).toBe("view");
    expect(pages["scm.procurement.po"]).toBe("edit");
  });

  it("alone opens the supply chain and signs the person in", () => {
    const access = parseContsAccess(all("none", { scProduction: "edit" }))!;
    expect(contsPermissions(access)).toContain("scm.access");
    expect(hasAnyAccess(access)).toBe(true);
    expect(contsPageAccess(access).scm).toBe("view");
  });

  it("must be Full too for Full everywhere", () => {
    expect(isFullEverywhere(parseContsAccess(all("full"))!)).toBe(true);
    expect(isFullEverywhere(parseContsAccess(all("full", { scProduction: "edit" }))!)).toBe(false);
  });
});
