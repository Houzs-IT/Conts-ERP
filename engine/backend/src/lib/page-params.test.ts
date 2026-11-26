import { describe, expect, it } from "vitest";
import { DEFAULT_PER_PAGE, MAX_PER_PAGE, parsePageNumber, parsePerPage } from "./page-params";

describe("parsePageNumber", () => {
  it("falls back to 1 when missing", () => {
    expect(parsePageNumber(undefined)).toBe(1);
  });
  it("falls back to 1 for zero", () => {
    expect(parsePageNumber("0")).toBe(1);
  });
  it("falls back to 1 for negatives", () => {
    expect(parsePageNumber("-3")).toBe(1);
  });
  it("falls back to 1 for non-numeric input", () => {
    expect(parsePageNumber("abc")).toBe(1);
  });
  it("keeps a valid page", () => {
    expect(parsePageNumber("2")).toBe(2);
  });
});

describe("parsePerPage", () => {
  it("uses the default when missing", () => {
    expect(parsePerPage(undefined)).toBe(DEFAULT_PER_PAGE);
  });
  it("uses the default for non-numeric input", () => {
    expect(parsePerPage("abc")).toBe(DEFAULT_PER_PAGE);
  });
  it("uses the default for zero", () => {
    expect(parsePerPage("0")).toBe(DEFAULT_PER_PAGE);
  });
  it("uses the default for negatives", () => {
    expect(parsePerPage("-3")).toBe(DEFAULT_PER_PAGE);
  });
  it("clamps values over the max", () => {
    expect(parsePerPage("9999")).toBe(MAX_PER_PAGE);
  });
  it("keeps a valid value", () => {
    expect(parsePerPage("25")).toBe(25);
  });
});
