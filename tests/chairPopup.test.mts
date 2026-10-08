/**
 * The chair popup's logic: whose note can be touched, how a patient's treatments are grouped,
 * and which approved lines belong to the dentist looking.
 * Run: npm run test:chair-popup
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { approvalLinesForChair, canTouch, groupForChair, statusPayload } from "../src/lib/chairPopup";
import type { Note } from "../src/components/clinical-notes/types";
import type { InsuranceClaim } from "../src/lib/insurance/claims";

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks += 1; };
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks += 1; };

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

// statusPayload: a status tap sends the note back exactly as it is, plus the new state. The
// review (2026-10-08) found the first version re-priced the treatment: a continued crown was
// billed a second time, "A + B" notes lost their charge, and reception's typed price vanished.
{
  const base = { id: "n1", patientId: "p1", appointmentId: "v1", procedure: "Crown + Core", procedures: ["Crown", "Core"], tooth: "16", note: "x", date: "2026-10-08", doctorId: "s1" } as unknown as Note;
  const priced = { ...base, unitCost: 1500, pricingMode: "flat", priceListId: "L1", payerId: "P1", discountMode: "percent", discountValue: 10, discountReason: "friend", ledgerId: "led1", cost: 1350 } as unknown as Note;
  const p = statusPayload(priced, me, "Completed");
  eq(p.procedures, ["Crown", "Core"], "every procedure on the note goes back, not the joined name");
  eq([p.unitCost, p.pricingMode, p.priceListId, p.payerId], [1500, "flat", "L1", "P1"], "the price, rule, list and payer are the note's own");
  eq([p.discountMode, p.discountValue, p.discountReason], ["percent", 10, "friend"], "the discount is kept");
  eq([p.addToLedger, p.status, p.doctorId, p.selectedTeeth, p.patientId], [true, "Completed", "s1", ["16"], "p1"], "billed note stays billed; status, dentist, teeth and patient carried");
  const continued = { ...base, isContinued: true, cost: 0 } as unknown as Note;
  const c = statusPayload(continued, me, "Completed");
  eq([c.addToLedger, c.unitCost, c.procedures], [false, null, ["Crown", "Core"]], "a continued treatment is not billed again by a status tap");
  const bare = { ...base, procedures: undefined } as unknown as Note;
  eq(statusPayload(bare, me, "Ongoing").procedures, ["Crown + Core"], "a note with no procedures[] sends its name");
}

// The fixes the review asked for, pinned in the source so a refactor cannot undo them quietly.
{
  const read = (rel: string) => readFileSync(join(import.meta.dirname, "..", rel), "utf8");
  const editor = read("src/components/clinical-notes/ServiceEditorDrawer.tsx");
  ok(editor.includes("const dentistNew = dentistMode && !initialNote"), "dentist-mode pricing overrides apply to NEW treatments only; an edit keeps its list, price and discount");
  ok(editor.includes("dentistMode ? approvalSummaryBare : approvalSummary"), "an approval row in dentist mode shows no amounts");
  ok((editor.match(/\{!dentistMode && doctorField\}/g) || []).length >= 4, "the dentist picker is hidden in both layouts, approval rows included");
  ok(editor.includes("(dentistNew ? defaultListId : discount.priceListId) || null"), "a dentist picks from the default list's own menu");
  const card = read("src/components/chair/ChairNoteCard.tsx");
  ok(card.includes('permission="clinical.delete"') && card.includes("!fromApproval"), "delete is shown only to those who may delete, never on an approval row");
  ok(read("src/components/chair/ChairPopup.tsx").includes("scrollIntoView"), "opening the editor brings it on screen");
  ok(read("src/components/chair/ChairPopup.tsx").includes("statusPayload("), "the popup's status tap uses the shared payload");
  const home = read("src/components/dashboard/DentistHome.tsx");
  ok(home.includes("statusPayload("), "the home's status tap uses the shared payload");
  ok(home.includes("heroNotesState.heroId === heroId"), "the slab never shows the previous patient's notes");
  const page = read("src/app/(dashboard)/patients/[id]/page.tsx");
  ok(page.includes('chair && (activeTab === "finance" || activeTab === "insurance")'), "a hidden money tab cannot be reached by deep link or the snapshot button in chair mode");
  ok(page.includes("hideMoney={chair}"), "the timeline tab hides amounts in chair mode");
  ok(/Financial Summary Snapshot[\s\S]{0,400}chair \? "hidden"/.test(page), "the overview's money snapshot is hidden in chair mode");
}

console.log(`chair popup: ${checks} checks passed`);
