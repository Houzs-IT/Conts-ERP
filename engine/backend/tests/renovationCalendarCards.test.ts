import { describe, expect, test } from "vitest";
import { buildCalendarItems, itemDepartment, peopleOf, personDepartments, type CalendarPerson, type ItemSources } from "../src/services/renovation/calendarItems";

/* Notion-style calendar cards (owner, 16 Oct 2026): a heading, the people, a department colour, multi-day spans. */

const P = { project_id: 7, code: "RN-007", name: "Jernih Kajang B-28-09", building: "Jernih Kajang", unit_no: "B-28-09", brand: null, status: null, organizer: null };
const empty: ItemSources = { onsite: [], design: [], amendments: [], procurement: [], tasks: [], handover: [] };
const ying: CalendarPerson = { id: 1, name: "YING TZY", roles: ["designer"] };
const alex: CalendarPerson = { id: 2, name: "Alex", roles: ["sales"] };
const chai: CalendarPerson = { id: 3, name: "Chai", roles: ["reno_pic"] };
const crew: CalendarPerson = { id: 4, name: "Ah Seng", roles: ["site_crew"] };
const boss: CalendarPerson = { id: 5, name: "Boss", roles: ["boss", "designer"] };

describe("department of a card", () => {
  test("roles map to departments, most telling first", () => {
    expect(personDepartments(["sales"])).toEqual(["sales"]);
    expect(personDepartments(["boss", "designer"])).toEqual(["design", "management"]);
    expect(personDepartments(["admin"])).toEqual(["management"]);
    expect(personDepartments(["site_crew"])).toEqual(["site_crew"]);
    expect(personDepartments([])).toEqual([]);
  });
  test("the kind's own department wins when one of its people is in it", () => {
    expect(itemDepartment("design", [alex, ying])).toBe("design");
    expect(itemDepartment("design", [boss])).toBe("design");
  });
  test("otherwise the first person's department, else the kind's own", () => {
    expect(itemDepartment("renovation", [alex])).toBe("sales");
    expect(itemDepartment("renovation", [])).toBe("renovation");
    expect(itemDepartment("site_crew", [{ id: 9, name: "No role", roles: [] }])).toBe("site_crew");
  });
});

describe("people from the database", () => {
  test("arrays, one object, json text and Postgres array text all read", () => {
    expect(peopleOf([{ id: 1, name: "A", roles: ["sales"] }])).toEqual([{ id: 1, name: "A", roles: ["sales"] }]);
    expect(peopleOf('{"id":2,"name":"B","roles":["designer"]}')).toEqual([{ id: 2, name: "B", roles: ["designer"] }]);
    expect(peopleOf([{ id: 3, name: "C", roles: "{reno_pic,admin}" }])).toEqual([{ id: 3, name: "C", roles: ["reno_pic", "admin"] }]);
    expect(peopleOf(null)).toEqual([]);
    expect(peopleOf("not json")).toEqual([]);
    expect(peopleOf([{ id: 1, name: "A" }, { id: 1, name: "A" }])).toHaveLength(1);
  });
});

describe("calendar cards", () => {
  test("headings and departments by kind and people", () => {
    const items = buildCalendarItems({
      ...empty,
      onsite: [{ ...P, id: 1, done_on: "2026-10-05", people: [chai] }],
      design: [{ ...P, id: 2, kind: "3d", version: 1, on_day: "2026-10-06", people: [ying] }, { ...P, id: 3, kind: "2d", version: 2, on_day: "2026-10-06", people: [] }],
      amendments: [{ ...P, id: 4, kind: "2d", noted_on: "2026-10-07", closed: true, designer: ying }],
      tasks: [
        { ...P, id: 5, label: "Client meeting", state: "open", planned_start: "2026-10-08", planned_end: null, people: [alex], category_stage: "design", fulfilment_kind: "internal" },
        { ...P, id: 6, label: "Hacking", state: "open", planned_start: "2026-10-08", planned_end: "2026-10-12", people: [crew], fulfilment_kind: "internal" },
        { ...P, id: 7, label: "Plumbing work", state: "done", planned_start: "2026-10-09", planned_end: "2026-10-09", people: [], supplier_name: "Ah Kow Plumbing", fulfilment_kind: "subcon" },
      ],
      handover: [{ ...P, planned_handover_date: "2026-10-30", handed_over_at: null, reno_pic: chai }],
    }, "2026-10-01", "2026-10-31");
    const by = (k: string) => items.find((i) => i.key === k)!;
    expect(by("onsite-1")).toMatchObject({ title: "SITE MEASURE", department: "renovation", people: [chai], done: true });
    expect(by("design-2")).toMatchObject({ title: "3D 1ST SUBMISSION", department: "design" });
    expect(by("design-3")).toMatchObject({ title: "2D 2ND SUBMISSION", department: "design", people: [] });
    expect(by("amendment-4")).toMatchObject({ title: "2D AMENDMENT", department: "design", done: true, people: [ying] });
    expect(by("task-5")).toMatchObject({ title: "CLIENT MEETING", department: "sales", date: "2026-10-08", end: "2026-10-08" });
    expect(by("task-6")).toMatchObject({ department: "site_crew", date: "2026-10-08", end: "2026-10-12" });
    expect(by("task-7")).toMatchObject({ department: "renovation", supplier: "Ah Kow Plumbing", done: true });
    expect(by("handover-7")).toMatchObject({ title: "HANDOVER", department: "renovation", people: [chai] });
    expect(items.every((i) => i.projectCode === "RN-007" && i.short === "Jernih B-28-09")).toBe(true);
  });
  test("a task that only touches the window is kept with its real dates; one outside is dropped", () => {
    const items = buildCalendarItems({
      ...empty,
      tasks: [
        { ...P, id: 1, label: "Tiles", state: "open", planned_start: "2026-09-28", planned_end: "2026-10-02" },
        { ...P, id: 2, label: "Paint", state: "open", planned_start: "2026-11-02", planned_end: "2026-11-04" },
        { ...P, id: 3, label: "Backwards", state: "open", planned_start: "2026-10-10", planned_end: "2026-10-08" },
      ],
    }, "2026-10-01", "2026-10-31");
    expect(items.map((i) => [i.key, i.date, i.end])).toEqual([["task-1", "2026-09-28", "2026-10-02"], ["task-3", "2026-10-10", "2026-10-10"]]);
  });
});
