/* Click sweep wiring on the SO page (21 Nov 2026), read from the source because the page needs the whole app to mount.
   The behaviour itself was click-tested on the local system. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "SalesOrderDetail.tsx"), "utf8");
const between = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

describe("SalesOrderDetail save wiring", () => {
  test("F2: an existing line is not seeded with the Default leg height; a new line still is", () => {
    expect(between("const renderEditLine", "const renderStagedLine")).toMatch(/seedSofaLegDefault=\{false\}/);
    expect(between("const renderStagedLine", "What the sections show")).toMatch(/seedSofaLegDefault=\{true\}/);
  });

  test("F4/F5: Save is held from the click until that save settles, and the draft save is awaited", () => {
    const saveNow = between("const saveNow = () =>", "return (");
    expect(saveNow).toMatch(/if \(savePressRef\.current\) return;/);
    expect(saveNow).toMatch(/\.finally\(/);
    expect(src).toMatch(/const saveBusy = savePressed \|\|/);
    expect(between("const saveEdit = async", "const buildAmendmentLines")).toMatch(/await reserveHeader/);
  });

  test("F10: the rooms are told the layout the order was saved with", () => {
    expect(src).toMatch(/savedLayoutKey=\{renoSavedLayoutKey\}/);
  });

  test("F9: a renovation contract's room changes count as a save and are written after its VO", () => {
    const contract = between("const saveContractEdit = async", "const lineChangesAmount");
    expect(contract).toMatch(/const contractRoomsMoved = renoLines && renoRoomsDirty\.current;/);
    expect(contract).toMatch(/!contractRoomsMoved\) \{ finishEditWithoutVo\(\)/);
    expect(contract.indexOf("if (contractRoomsMoved) await saveRenoRooms();")).toBeGreaterThan(contract.indexOf("/line-edits"));
  });
});
