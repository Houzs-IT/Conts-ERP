// Conts only. A cell a spreadsheet would run as a formula leaves the engine's CSV as text; numbers and phones stay as they are.
import { describe, expect, it } from "vitest";
import { toCSV } from "../lib/csv";

const cell = (v: unknown) => toCSV([{ v }], [{ key: "v", label: "V", getValue: (r) => r.v as string | number }]).split("\r\n")[1];

describe("engine CSV formula guard", () => {
  it("neutralises formula text", () => {
    expect(cell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(cell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(cell("-cmd")).toBe("'-cmd");
  });
  it("leaves numbers, phones and plain text alone", () => {
    expect(cell(-12.5)).toBe("-12.5");
    expect(cell("+60 12-345 6789")).toBe("+60 12-345 6789");
    expect(cell("Aaron Lee")).toBe("Aaron Lee");
  });
});
