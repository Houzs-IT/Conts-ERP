import { describe, expect, it } from "vitest";
import { mailboxDomains } from "./mail-domains";

describe("mailboxDomains", () => {
  it("is the Branding domain alone when no extra domain is set", () => {
    expect(mailboxDomains("help@theconts.com", undefined)).toEqual(["theconts.com"]);
    expect(mailboxDomains("help@theconts.com", "")).toEqual(["theconts.com"]);
  });

  it("adds the extra domains, trimmed, lower case, without @ and without repeats", () => {
    expect(mailboxDomains("help@theconts.com", " @DreamCrafter.example , theconts.com,,")).toEqual([
      "theconts.com",
      "dreamcrafter.example",
    ]);
  });

  it("still allows the extra domains when Branding has no email", () => {
    expect(mailboxDomains("", "dreamcrafter.example")).toEqual(["dreamcrafter.example"]);
    expect(mailboxDomains(null, undefined)).toEqual([]);
  });
});
