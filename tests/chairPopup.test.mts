/**
 * The chair popup's logic: whose note can be touched, how a patient's treatments are grouped,
 * and which approved lines belong to the dentist looking.
 * Run: npm run test:chair-popup
 */
import assert from "node:assert/strict";
import { approvalLinesForChair, canTouch, groupForChair } from "../src/lib/chairPopup";
import type { Note } from "../src/components/clinical-notes/types";
import type { InsuranceClaim } from "../src/lib/insurance/claims";

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks += 1; };

const me = { staffId: "s1", name: "Dr Mona" };

// canTouch: only a dentist with a real staff row, and only their own notes.
eq(canTouch({ doctorId: "s1" }, null), false, "no dentist identity = nothing is mine");
eq(canTouch({ doctorId: "s1" }, { staffId: "", name: "x" }), false, "empty staffId never matches");
eq(canTouch({ doctorId: "s1" }, me), true, "doctorId match");
eq(canTouch({ doctor: "dr mona" }, me), true, "pre-doctorId rows match by name, case-insensitive");
eq(canTouch({ doctorId: "s2", doctor: "Dr Mona" }, me), false, "a doctorId that is someone else's wins over the name");
eq(canTouch({}, me), false, "a note with no dentist (the clinic's) is locked");

// groupForChair: today's visit first (present even when empty), then earlier visits newest first,
// then the notes with no visit.
{
  const n = (id: string, appointmentId: string | null, date: string): Note =>
    ({ id, procedure: "x", appointmentId, date }) as unknown as Note;
  const notes = [n("a", "v-old", "2026-01-05"), n("b", null, "2026-02-01"), n("c", "v-new", "2026-03-01"), n("d", "v-new", "2026-03-01")];
  const groups = groupForChair(notes, "v-today", { "v-old": "2026-01-05", "v-new": "2026-03-01" });
  eq(groups.map((g) => g.key), ["v-today", "v-new", "v-old", "__none__"], "today, then newest first, unlinked last");
  eq(groups[0].isToday && groups[0].notes.length === 0, true, "today's group is there even with nothing in it yet");
  eq(groups[1].notes.map((x) => x.id), ["c", "d"], "a visit's notes stay together");
  eq(groups[3].title.ar, "مش مرتبط بزيارة", "the unlinked group's name");
  const noToday = groupForChair(notes.filter((x) => x.appointmentId), null, { "v-old": "2026-01-05", "v-new": "2026-03-01" });
  eq(noToday.map((g) => g.key), ["v-new", "v-old"], "no today's visit and no unlinked notes: neither group appears");
}

// approvalLinesForChair: live claims only; `mine` only on the line assigned to me.
{
  const claim = (id: string, status: InsuranceClaim["status"], dentists: InsuranceClaim["dentists"]): InsuranceClaim =>
    ({
      id,
      status,
      dentists,
      lineStatus: { 1: "Ongoing" },
      lines: [
        { code: "D2391", description: "Composite filling", teeth: ["44", "46"] },
        { code: "D0220", description: "X-ray" },
      ],
    }) as unknown as InsuranceClaim;
  const lines = approvalLinesForChair(
    [claim("c1", "approved", { 0: { staffId: "s1", name: "Dr Mona", rate: 0, share: 0 } }), claim("c2", "cancelled", {})],
    me,
  );
  eq(lines.map((l) => [l.claimId, l.lineIndex, l.mine, l.status, l.teeth]), [["c1", 0, true, "Completed", "44, 46"], ["c1", 1, false, "Ongoing", ""]], "two lines from the live claim; the cancelled one is skipped");
  eq(lines[0].name, "Composite filling", "the line's own wording");
  eq(approvalLinesForChair([claim("c1", "approved", { 0: { staffId: "s1", name: "", rate: 0, share: 0 } })], null).every((l) => !l.mine), true, "nobody's when there is no dentist identity");
}

console.log(`chair popup: ${checks} checks passed`);
