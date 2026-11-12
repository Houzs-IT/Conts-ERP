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

// Split permission areas, part 2c: Quality metrics, Defects, Handover checklists and Finances are their own boxes.
describe("Conts Projects and Service cases boxes", () => {
  it("each takes its parent's level when a sign-on leaves it out", () => {
    const access = parseContsAccess(all("none", { projects: "edit", serviceCases: "view" }))!;
    expect([access.projectDefects, access.projectHandover, access.projectFinances]).toEqual(["edit", "edit", "edit"]);
    expect(access.serviceMetrics).toBe("view");
  });

  it("sets its own page and leaves the parent's other pages alone", () => {
    const pages = contsPageAccess(parseContsAccess(all("none", { projects: "edit", projectDefects: "none", projectHandover: "full", serviceCases: "edit", serviceMetrics: "none" }))!);
    expect(pages["projects.defects"]).toBe("none");
    expect(pages["projects.handover"]).toBe("full");
    expect(pages["projects.list"]).toBe("edit");
    expect(pages["service_cases.metrics"]).toBe("none");
    expect(pages["service_cases.cases"]).toBe("edit");
  });

  it("alone opens the parent's screen at view, not the parent's other pages", () => {
    const pages = contsPageAccess(parseContsAccess(all("none", { projectDefects: "view", serviceMetrics: "view" }))!);
    expect(pages.projects).toBe("view");
    expect(pages["projects.defects"]).toBe("view");
    expect(pages["projects.list"]).toBe("none");
    expect(pages.service_cases).toBe("view");
    expect(pages["service_cases.cases"]).toBe("none");
    expect(pages["projects.finances"]).toBe("none");
  });

  it("Finances opens at Full only, on its own box", () => {
    const at = (projects: string, projectFinances: string) => {
      const access = parseContsAccess(all("none", { projects, projectFinances }))!;
      return { page: contsPageAccess(access)["projects.finances"], key: contsPermissions(access).includes("projects.finance.view") };
    };
    expect(at("full", "full")).toEqual({ page: "full", key: true });
    expect(at("full", "edit")).toEqual({ page: "none", key: false });
    expect(at("none", "full")).toEqual({ page: "full", key: true });
    expect(contsPermissions(parseContsAccess(all("none", { projects: "full", projectFinances: "none" }))!)).toContain("projects.manage");
  });

  it("day one: the same pages and keys as before for every parent level", () => {
    for (const level of ["none", "view", "edit", "full"]) {
      const pages = contsPageAccess(parseContsAccess(all(level))!);
      expect(pages["projects.defects"]).toBe(pages["projects.list"]);
      expect(pages["projects.handover"]).toBe(pages["projects.list"]);
      expect(pages["service_cases.metrics"]).toBe(pages["service_cases.cases"]);
      expect(pages["projects.finances"]).toBe(level === "full" ? "full" : "none");
    }
  });
});

// One box per menu item: Project settings, Case settings and My cases follow their own boxes.
describe("Conts settings and My cases boxes", () => {
  it("each takes its parent's level when a sign-on leaves it out", () => {
    const access = parseContsAccess(all("none", { projects: "full", serviceCases: "edit" }))!;
    expect([access.projectSettings, access.serviceSettings, access.serviceMyCases]).toEqual(["full", "edit", "edit"]);
  });

  it("sets its own page and leaves the parent's other pages alone", () => {
    const pages = contsPageAccess(parseContsAccess(all("none", { projects: "full", projectSettings: "none", serviceCases: "view", serviceSettings: "full", serviceMyCases: "none" }))!);
    expect(pages["projects.maintenance"]).toBe("none");
    expect(pages["projects.list"]).toBe("full");
    expect(pages["service_cases.settings"]).toBe("full");
    expect(pages["service_cases.my_cases"]).toBe("none");
    expect(pages["service_cases.cases"]).toBe("view");
  });

  it("alone opens the parent's screen at view, not the parent's other pages", () => {
    const pages = contsPageAccess(parseContsAccess(all("none", { projectSettings: "full", serviceMyCases: "view" }))!);
    expect(pages.projects).toBe("view");
    expect(pages["projects.maintenance"]).toBe("full");
    expect(pages["projects.list"]).toBe("none");
    expect(pages.service_cases).toBe("view");
    expect(pages["service_cases.my_cases"]).toBe("view");
    expect(pages["service_cases.cases"]).toBe("none");
  });

  it("day one: the same pages as before for every parent level", () => {
    for (const level of ["none", "view", "edit", "full"]) {
      const pages = contsPageAccess(parseContsAccess(all(level))!);
      expect(pages["projects.maintenance"]).toBe(level);
      expect(pages["service_cases.settings"]).toBe(level);
      expect(pages["service_cases.my_cases"]).toBe(level);
    }
  });
});
