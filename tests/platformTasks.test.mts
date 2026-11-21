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
  requestToTask,
  clinicView,
  buildDigest,
  cairoNow,
  digestDue,
  digestFromDoc,
  monthCells,
  type PlatformTask,
} from "../src/lib/platformTasks";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log("ok -", name); };

const base: PlatformTask = {
  id: "x", title: "T", notes: "", clinic: "", status: "todo", priority: "normal",
  startDate: "", deadline: "", createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "", liveAt: "",
  source: "admin", clinicId: "", requestedBy: "", seen: true,
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

test("a clinic request: first line is the title, long lines are cut, too short is refused", () => {
  const r = requestToTask("  \n Add a print button\nfor the lab sheet ");
  assert.deepEqual(r, { ok: true, title: "Add a print button", notes: "Add a print button\nfor the lab sheet" });
  const long = requestToTask("x".repeat(200));
  assert.equal(long.ok && long.title.length, 88);
  assert.equal(requestToTask("ok").ok, false);
  assert.equal(requestToTask(5).ok, false);
});

test("a clinic never sees the console's notes or priority", () => {
  const v = clinicView(task({ notes: "internal", priority: "high", status: "built" }));
  assert.deepEqual(Object.keys(v).sort(), ["createdAt", "id", "liveAt", "status", "title"]);
});

test("an old row without the new fields reads as an admin task already seen", () => {
  const t = taskFromDoc("a", { title: "x" });
  assert.equal(t.source, "admin");
  assert.equal(t.seen, true);
  assert.equal(taskFromDoc("b", { title: "y", source: "clinic", seen: false }).seen, false);
});

test("morning message: late, today, next 3 days, new requests; a quiet day is null", () => {
  const today = "2026-11-21";
  assert.equal(buildDigest([task({ deadline: "2026-12-30" }), task({ deadline: "2026-11-01", status: "live" })], today), null);
  const text = buildDigest([
    task({ id: "a", title: "AXA scan", clinic: "DENT INN", deadline: "2026-11-19" }),
    task({ id: "b", title: "Ship GASCO", deadline: today, status: "built" }),
    task({ id: "c", title: "Calendar", deadline: "2026-11-23", status: "doing" }),
    task({ id: "d", title: "Print button", clinic: "Amal", source: "clinic", seen: false }),
    task({ id: "e", title: "Old", deadline: "2026-11-01", status: "live" }),
  ], today)!;
  assert.match(text, /Alpha tasks — 21 Nov/);
  assert.match(text, /Late \(1\)\*\n• AXA scan — DENT INN \(was due 19 Nov\)/);
  assert.match(text, /Due today \(1\)\*\n• Ship GASCO/);
  assert.match(text, /Next 3 days \(1\)\*\n• Calendar \(23 Nov\)/);
  assert.match(text, /New clinic requests \(1\)\*\n• Amal: Print button/);
  assert.match(text, /Open: 4 · in progress 1 · built, not live 1/);
  assert.doesNotMatch(text, /Old/);
});

test("Cairo clock follows Egypt's summer time", () => {
  assert.deepEqual(cairoNow(new Date("2026-11-21T07:30:00Z")), { day: "2026-11-21", hour: 9 }); // winter UTC+2
  assert.deepEqual(cairoNow(new Date("2026-07-01T06:30:00Z")), { day: "2026-07-01", hour: 9 }); // summer UTC+3
  assert.deepEqual(cairoNow(new Date("2026-11-21T22:30:00Z")), { day: "2026-11-22", hour: 0 });
});

test("the morning message goes once a day, from the chosen hour, only when on", () => {
  const s = digestFromDoc({ enabled: true, phone: "01000000000", hour: 9, lastSentDay: "2026-11-20" });
  assert.equal(digestDue(s, new Date("2026-11-21T06:30:00Z")), false); // 8:30 Cairo
  assert.equal(digestDue(s, new Date("2026-11-21T07:10:00Z")), true); // 9:10 Cairo
  assert.equal(digestDue({ ...s, lastSentDay: "2026-11-21" }, new Date("2026-11-21T10:00:00Z")), false);
  assert.equal(digestDue({ ...s, enabled: false }, new Date("2026-11-21T07:10:00Z")), false);
  assert.equal(digestDue({ ...s, phone: "" }, new Date("2026-11-21T07:10:00Z")), false);
  assert.equal(digestFromDoc({ hour: 40 }).hour, 9);
});

test("calendar: Saturday first, whole weeks, only the month marked in", () => {
  const nov = monthCells(2026, 10); // 1 Nov 2026 is a Sunday
  assert.equal(nov.length % 7, 0);
  assert.equal(nov[0].day, "2026-10-31");
  assert.equal(nov[1].day, "2026-11-01");
  assert.equal(nov.filter((c) => c.inMonth).length, 30);
  assert.equal(monthCells(2026, 1)[0].day <= "2026-02-01", true);
});

console.log(`\n${passed} passed`);
