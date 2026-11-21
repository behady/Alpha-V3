import assert from "node:assert/strict";
import {
  cleanTaskInput,
  compareTasks,
  datesInOrder,
  isDayOrEmpty,
  isDueSoon,
  isOverdue,
  STARTER_TASKS,
  taskFromDoc,
  type PlatformTask,
} from "../src/lib/platformTasks";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log("ok -", name); };

const base: PlatformTask = {
  id: "x", title: "T", notes: "", clinic: "", status: "todo", priority: "normal",
  startDate: "", deadline: "", createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "", liveAt: "",
};
const task = (p: Partial<PlatformTask>): PlatformTask => ({ ...base, ...p });

test("calendar days: real days pass, impossible ones and junk fail, empty clears", () => {
  assert.equal(isDayOrEmpty("2026-11-21"), true);
  assert.equal(isDayOrEmpty(""), true);
  assert.equal(isDayOrEmpty("2026-02-31"), false);
  assert.equal(isDayOrEmpty("21/11/2026"), false);
  assert.equal(isDayOrEmpty(20261121), false);
});

test("a new task needs a title; an edit does not", () => {
  assert.equal(cleanTaskInput({ notes: "x" }, false).ok, false);
  assert.equal(cleanTaskInput({ title: "   " }, false).ok, false);
  const edit = cleanTaskInput({ status: "live" }, true);
  assert.deepEqual(edit, { ok: true, value: { status: "live" } });
});

test("input is trimmed and only known fields survive", () => {
  const r = cleanTaskInput({ title: "  Fix scan  ", clinic: " DENT INN ", createdBy: "evil", liveAt: "x" }, false);
  assert.deepEqual(r, { ok: true, value: { title: "Fix scan", clinic: "DENT INN" } });
});

test("bad status, priority or date is refused", () => {
  assert.equal(cleanTaskInput({ title: "a", status: "done" }, false).ok, false);
  assert.equal(cleanTaskInput({ title: "a", priority: "urgent" }, false).ok, false);
  assert.equal(cleanTaskInput({ title: "a", deadline: "tomorrow" }, false).ok, false);
});

test("deadline may not come before the start; either may be empty", () => {
  assert.equal(datesInOrder("2026-11-21", "2026-11-20"), false);
  assert.equal(datesInOrder("2026-11-21", "2026-11-21"), true);
  assert.equal(datesInOrder("", "2026-11-01"), true);
  assert.equal(datesInOrder("2026-11-21", ""), true);
});

test("late means the deadline day is over and it is not live", () => {
  assert.equal(isOverdue(task({ deadline: "2026-11-20" }), "2026-11-21"), true);
  assert.equal(isOverdue(task({ deadline: "2026-11-21" }), "2026-11-21"), false);
  assert.equal(isOverdue(task({ deadline: "2026-11-20", status: "live" }), "2026-11-21"), false);
  assert.equal(isOverdue(task({ deadline: "" }), "2026-11-21"), false);
});

test("due soon: today up to three days ahead, across a month end", () => {
  assert.equal(isDueSoon(task({ deadline: "2026-11-21" }), "2026-11-21"), true);
  assert.equal(isDueSoon(task({ deadline: "2026-12-02" }), "2026-11-29"), true);
  assert.equal(isDueSoon(task({ deadline: "2026-12-03" }), "2026-11-29"), false);
  assert.equal(isDueSoon(task({ deadline: "2026-11-20" }), "2026-11-21"), false);
});

test("order: late first, then high priority, then nearest deadline, undated last", () => {
  const today = "2026-11-21";
  const rows = [
    task({ id: "undated" }),
    task({ id: "far", deadline: "2026-12-30" }),
    task({ id: "near", deadline: "2026-11-25" }),
    task({ id: "high", priority: "high", deadline: "2026-12-31" }),
    task({ id: "late", deadline: "2026-11-01", priority: "low" }),
  ];
  assert.deepEqual(rows.sort((a, b) => compareTasks(a, b, today)).map((t) => t.id), ["late", "high", "near", "far", "undated"]);
});

test("a hand-edited or old row never breaks the screen", () => {
  const t = taskFromDoc("a", { status: "weird", priority: 3, deadline: "soon", createdAt: { toDate: () => new Date("2026-11-21T10:00:00Z") } });
  assert.equal(t.title, "(untitled)");
  assert.equal(t.status, "todo");
  assert.equal(t.priority, "normal");
  assert.equal(t.deadline, "");
  assert.equal(t.createdAt, "2026-11-21T10:00:00.000Z");
});

test("the starter list is twelve valid tasks", () => {
  assert.equal(STARTER_TASKS.length, 12);
  for (const s of STARTER_TASKS) assert.equal(cleanTaskInput(s, false).ok, true, s.title);
});

console.log(`\n${passed} passed`);
