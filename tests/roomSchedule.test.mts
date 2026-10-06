// The dashboard's room calendar: which rooms get a column, and which column each visit sits in.
import assert from "node:assert/strict";
import { roomColumns, NO_ROOM } from "../src/lib/roomSchedule";

const branches = [
  { id: "b1", name: "Maadi", rooms: [{ id: "r1", name: "Room 1" }, { id: "r2", name: "Room 2" }] },
  { id: "b2", name: "Zayed", rooms: [{ id: "r3", name: "Chair A" }] },
  { id: "b3", name: "Empty", rooms: [] },
];

// One branch: its rooms only, by their own names.
const one = roomColumns(branches, "b1", [
  { id: "a1", roomId: "r2" },
  { id: "a2", roomId: "r1" },
]);
assert.deepEqual(
  one.columns.map((c) => [c.id, c.label]),
  [
    ["r1", "Room 1"],
    ["r2", "Room 2"],
  ],
  "no 'No room' column while every visit has a room",
);
assert.equal(one.columnOf.get("a1"), "r2");

// A visit with no room, or a room from elsewhere, lands in a "No room" column at the end.
const loose = roomColumns(branches, "b1", [
  { id: "a1", roomId: "" },
  { id: "a2", roomId: "r3" },
  { id: "a3" },
]);
assert.deepEqual(loose.columns.map((c) => c.id), ["r1", "r2", NO_ROOM]);
assert.equal(loose.columnOf.get("a1"), NO_ROOM);
assert.equal(loose.columnOf.get("a2"), NO_ROOM, "a room that is not in this branch is not given a column of its own");
assert.equal(loose.columnOf.get("a3"), NO_ROOM);

// Every branch at once: every room, named with its branch so two "Room 1"s cannot be confused.
const all = roomColumns(branches, "", [{ id: "a1", roomId: "r3" }]);
assert.deepEqual(
  all.columns.map((c) => [c.id, c.label, c.branchId]),
  [
    ["r1", "Maadi · Room 1", "b1"],
    ["r2", "Maadi · Room 2", "b1"],
    ["r3", "Zayed · Chair A", "b2"],
  ],
);

// A branch with no rooms: nothing to draw.
assert.deepEqual(roomColumns(branches, "b3", []).columns, []);

console.log("roomSchedule: all checks passed");
