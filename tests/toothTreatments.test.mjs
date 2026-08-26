// What the odontogram is allowed to claim was done to a tooth.
//
// This is a medical record drawn as a picture, and the failure mode is not a crash — it is a
// dentist glancing at a chart, believing it, and being wrong. Every assertion below is a
// statement the picture must never make falsely.
import assert from "node:assert/strict";
import {
  TREATMENT_STATES,
  dominantTreatment,
  resolveTreatments,
  pendingTreatments,
  treatmentForCategory,
  treatmentsByTooth,
} from "../src/lib/toothTreatments.ts";

// Price-list stand-ins. `byId` is the reliable path; `byName` is the guess for free-text.
const CATS = { s_fill: "restorative", s_rct: "endo", s_crown: "crowns", s_ext: "surgery", s_clean: "prevention" };
const byId = (id) => CATS[id];
const byName = (name) => (/clean|scal/i.test(name) ? "prevention" : /fill/i.test(name) ? "restorative" : undefined);

const note = (over = {}) => ({
  id: "n1", tooth: "26", procedure: "Composite Filling", serviceIds: ["s_fill"],
  status: "Completed", date: "2026-08-01", ...over,
});

// --- the category vocabulary --------------------------------------------------------------------

assert.equal(treatmentForCategory("endo"), "root_canal");
assert.equal(treatmentForCategory("surgery"), "extracted");
assert.equal(treatmentForCategory("crowns"), "crowned");
assert.equal(treatmentForCategory("restorative"), "filled");

// A scale and polish, a whitening, a check-up, a course of orthodontics and a denture are things
// done to a MOUTH. Painting them onto every tooth would grey out the chart for every returning
// patient and teach the dentist to stop looking at it, which costs more than the fact is worth.
for (const whole of ["prevention", "whitening", "diagnostics", "ortho", "prostho"]) {
  assert.equal(treatmentForCategory(whole), null, `${whole} is not true of one tooth`);
}

// Pediatric and uncategorised work is NOT dropped. The dentist named specific teeth; discarding
// that is the chart lying by omission. "Something was done here" is all it can honestly say, and
// it says it.
assert.equal(treatmentForCategory("pediatric"), "treated");
assert.equal(treatmentForCategory("other"), "treated");
assert.equal(treatmentForCategory(undefined), null);
assert.equal(treatmentForCategory("not_a_category"), null);

// --- reading teeth off a note ---------------------------------------------------------------------

// The API persists teeth as comma-joined text (`tooth: p.toothText`), never as an array.
const multi = treatmentsByTooth([note({ tooth: "26,27, 28" })], byId, byName);
assert.deepEqual(Object.keys(multi).sort(), ["26", "27", "28"]);

// "Gen" is what the API writes when no tooth was named. It is not a tooth and must not become one.
assert.deepEqual(treatmentsByTooth([note({ tooth: "Gen" })], byId, byName), {});
assert.deepEqual(treatmentsByTooth([note({ tooth: "" })], byId, byName), {});
assert.deepEqual(treatmentsByTooth([note({ tooth: undefined })], byId, byName), {});

// A typo must not invent a tooth. parseTeethString keeps only real FDI numbers.
assert.deepEqual(treatmentsByTooth([note({ tooth: "99, 26" })], byId, byName), {
  26: [{ state: "filled", noteId: "n1", procedure: "Composite Filling", status: "Completed", date: "2026-08-01" }],
});

// A service that is on the price list is read from the price list. The free-text name is consulted
// ONLY when no id resolved — otherwise a note could be classified two ways at once and the guess
// could contradict the record.
const guessed = treatmentsByTooth(
  [note({ serviceIds: [], serviceId: null, procedure: "Deep filling", procedures: ["Deep filling"] })],
  byId, byName
);
assert.equal(guessed["26"][0].state, "filled", "free-text procedures still reach the chart");

// A note naming a service nobody can classify contributes nothing rather than a wrong mark.
assert.deepEqual(
  treatmentsByTooth([note({ serviceIds: [], serviceId: null, procedure: "Mystery", procedures: ["Mystery"] })], byId, byName),
  {}
);

// The real keyword guesser never abstains — it answers "other" for anything it does not recognise.
// Treating that as a category put a mark on a tooth for "Follow-up review": a note about LOOKING
// at a tooth, drawn as work done to it. A guess with no evidence makes no clinical assertion.
const guesserThatNeverAbstains = () => "other";
assert.deepEqual(
  treatmentsByTooth(
    [note({ serviceIds: [], serviceId: null, procedure: "Follow-up review", procedures: ["Follow-up review"] })],
    byId, guesserThatNeverAbstains
  ),
  {},
  "an unrecognised procedure name must not become a treatment"
);

// But a service a HUMAN deliberately filed under "other" on the price list still counts — that is
// a choice somebody made, not a fallback.
const filedAsOther = treatmentsByTooth([note({ serviceIds: ["s_misc"] })], (id) => (id === "s_misc" ? "other" : undefined), byName);
assert.equal(filedAsOther["26"][0].state, "treated");

// A whole-mouth service that nonetheless names teeth still adds nothing — the category decides.
assert.deepEqual(treatmentsByTooth([note({ serviceIds: ["s_clean"], tooth: "26" })], byId, byName), {});

// --- what may repaint a tooth ----------------------------------------------------------------------

// THE most dangerous thing this feature could do: draw a gap where an extraction is only BOOKED.
const plannedExt = treatmentsByTooth([note({ serviceIds: ["s_ext"], status: "Planned" })], byId, byName);
assert.equal(dominantTreatment(plannedExt["26"]), null, "planned work must never repaint a tooth");
assert.equal(pendingTreatments(plannedExt["26"]).length, 1, "but it is still known, so it can be flagged");

const ongoing = treatmentsByTooth([note({ serviceIds: ["s_rct"], status: "Ongoing" })], byId, byName);
assert.equal(dominantTreatment(ongoing["26"]), null, "a root canal under way is not a treated tooth");
assert.equal(pendingTreatments(ongoing["26"])[0].state, "root_canal");

// A missing status is the least claim, not the most.
const noStatus = treatmentsByTooth([note({ status: undefined })], byId, byName);
assert.equal(dominantTreatment(noStatus["26"]), null, "an unstated status is not a completed one");

// --- precedence, which is clinical finality and not recency -------------------------------------------

// The commonest real sequence in dentistry: root canal, then a crown over it. Both are true; the
// crown is what you SEE. Drawing the older root canal instead would show an uncrowned tooth that
// has a crown in the patient's mouth.
const rctThenCrown = treatmentsByTooth([
  note({ id: "a", serviceIds: ["s_rct"], date: "2026-01-10" }),
  note({ id: "b", serviceIds: ["s_crown"], date: "2026-02-20" }),
], byId, byName);
assert.equal(dominantTreatment(rctThenCrown["26"]).state, "crowned");
assert.equal(rctThenCrown["26"].length, 2, "the root canal is not forgotten, only out-ranked");

// And the reverse order must give the same answer — precedence, not the calendar.
const crownThenRct = treatmentsByTooth([
  note({ id: "a", serviceIds: ["s_crown"], date: "2026-02-20" }),
  note({ id: "b", serviceIds: ["s_rct"], date: "2026-03-30" }),
], byId, byName);
assert.equal(dominantTreatment(crownThenRct["26"]).state, "crowned");

// An extracted tooth is gone. Nothing done to it before that can still be drawn on it — a gap
// showing a filling is the chart contradicting itself.
const filledThenOut = treatmentsByTooth([
  note({ id: "a", serviceIds: ["s_fill"], date: "2025-05-05" }),
  note({ id: "b", serviceIds: ["s_ext"], date: "2026-06-06" }),
], byId, byName);
assert.equal(dominantTreatment(filledThenOut["26"]).state, "extracted");

// Precedence is a total order, so two treatments can never tie and flicker between renders.
const ranks = Object.values(TREATMENT_STATES).map((s) => s.precedence);
assert.equal(new Set(ranks).size, ranks.length, "every treatment state needs its own rank");
assert.ok(
  TREATMENT_STATES.extracted.precedence > TREATMENT_STATES.implant.precedence,
  "an extracted tooth outranks everything, including what replaced it"
);

// --- a note that cannot say which tooth got which -------------------------------------------------
//
// A visit note routinely reads "46, 47" with procedures ["Surgical extraction", "Zircon crown"] —
// extract one, crown the other. The note has never recorded WHICH way round. Painting both states
// onto both teeth put a ✕ through a crowned molar sitting in occlusion, and the legend agreed:
// "Extracted — 46, 47". A dentist reading that plans an implant into a tooth that is still there.
const CATS2 = { ...CATS };
const mixed = treatmentsByTooth(
  [note({ tooth: "46,47", serviceIds: ["s_ext", "s_crown"] })],
  (id) => CATS2[id], byName
);
for (const tooth of ["46", "47"]) {
  const states = mixed[tooth].map((e) => e.state);
  assert.deepEqual(states, ["treated"], `${tooth} must not claim a treatment the note cannot attribute`);
}

// Several procedures that all mean the SAME thing are still attributable — two fillings in one
// visit is one kind of work, and refusing to draw it would be over-correction.
const twoFillings = treatmentsByTooth(
  [note({ tooth: "46,47", serviceIds: ["s_fill", "s_fill"] })],
  (id) => CATS2[id], byName
);
assert.equal(dominantTreatment(twoFillings["46"]).state, "filled");

// --- the tooth that was replaced ------------------------------------------------------------------
//
// extraction → implant → implant crown is the most ordinary sequence in dentistry. Ranking by
// clinical finality alone drew an empty socket over an osseointegrated implant: the dentist plans
// into that ridge, quotes a second implant, and nobody books the peri-implantitis recall for a site
// the chart says is not there.
const rebuilt = treatmentsByTooth([
  note({ id: "a", tooth: "46", serviceIds: ["s_ext"], date: "2023-03-01" }),
  note({ id: "b", tooth: "46", serviceIds: ["s_impl"], date: "2024-05-01" }),
  note({ id: "c", tooth: "46", serviceIds: ["s_crown"], date: "2024-09-01" }),
], (id) => ({ ...CATS2, s_impl: "implants" })[id], byName);
// It reads as an IMPLANT, not as a crowned tooth. A crown on a fixture and a crown on a natural
// root are different objects — one has no periodontal ligament, cannot be root-treated, and fails
// in a different way. The crown is the visible part; the implant is the fact that changes decisions.
assert.equal(resolveTreatments(rebuilt["46"]).form.state, "implant", "the site is restored, not empty");

// But only work that REPLACES the tooth may outrank the extraction, and only if it came after. A
// filling dated after an extraction is nonsense and must not win.
const nonsense = treatmentsByTooth([
  note({ id: "a", tooth: "46", serviceIds: ["s_ext"], date: "2023-03-01" }),
  note({ id: "b", tooth: "46", serviceIds: ["s_fill"], date: "2024-05-01" }),
], (id) => CATS2[id], byName);
assert.equal(resolveTreatments(nonsense["46"]).form.state, "extracted");

// An implant placed BEFORE the extraction date is a different tooth's story, or bad data. Either
// way it must not resurrect the socket.
const beforehand = treatmentsByTooth([
  note({ id: "a", tooth: "46", serviceIds: ["s_impl"], date: "2020-01-01" }),
  note({ id: "b", tooth: "46", serviceIds: ["s_ext"], date: "2024-05-01" }),
], (id) => ({ ...CATS2, s_impl: "implants" })[id], byName);
assert.equal(resolveTreatments(beforehand["46"]).form.state, "extracted");

// --- a crowned tooth that has had its nerve taken out ----------------------------------------------
//
// The commonest pair in dentistry, and the one a single winner destroyed. Drawing only the crown
// presented a root-filled tooth as crowned and VITAL. Vitality testing then "confirms" a
// non-response that reads as necrosis, and somebody cuts an access cavity through a new crown to
// reach a pulp that was removed two years ago.
const rctUnderCrown = treatmentsByTooth([
  note({ id: "a", tooth: "26", serviceIds: ["s_rct"], date: "2024-01-10" }),
  note({ id: "b", tooth: "26", serviceIds: ["s_crown"], date: "2024-02-20" }),
], (id) => CATS2[id], byName);
const both = resolveTreatments(rctUnderCrown["26"]);
assert.equal(both.form.state, "crowned", "the crown is what you see");
assert.equal(both.mark.state, "root_canal", "and the endo underneath is still drawn");

// The two channels never compete: a form state can never win the mark slot or the reverse.
assert.equal(TREATMENT_STATES[both.form.state].channel, "form");
assert.equal(TREATMENT_STATES[both.mark.state].channel, "mark");

// Nothing done at all means nothing drawn on either channel.
assert.deepEqual(resolveTreatments([]), { form: null, mark: null });
assert.deepEqual(resolveTreatments(undefined), { form: null, mark: null });

// --- the chart must stay legible in Arabic and in greyscale -------------------------------------------

for (const state of Object.values(TREATMENT_STATES)) {
  assert.ok(state.labelEn && state.labelAr, `${state.id} needs both languages`);
  assert.match(state.color, /^#[0-9a-f]{6}$/i, `${state.id} needs a real colour`);
  assert.ok(state.channel === "form" || state.channel === "mark");
}

// Treatment colours stay out of the warm end, which the eleven diagnosis categories already own.
// A dentist must never read a filling as caries. Shape carries the meaning too, which is why the
// colours can afford to be quiet.
const DIAGNOSIS_COLORS = ["#10b981","#ef4444","#f97316","#b45309","#eab308","#8b5cf6","#6366f1","#14b8a6","#3b82f6","#64748b","#1e293b"];
for (const state of Object.values(TREATMENT_STATES)) {
  if (state.id === "treated") continue; // deliberately the neutral slate, see the module
  assert.ok(
    !DIAGNOSIS_COLORS.includes(state.color.toLowerCase()),
    `${state.id} reuses a diagnosis colour (${state.color}) — a treatment must never read as a problem`
  );
}

// --- nothing here writes -----------------------------------------------------------------------------

// Derived, never stored. The input must come back untouched, or a re-render could mutate the notes
// the rest of the screen is drawing from.
const original = note();
const snapshot = JSON.stringify(original);
treatmentsByTooth([original], byId, byName);
assert.equal(JSON.stringify(original), snapshot, "deriving must not mutate the notes it reads");

assert.deepEqual(treatmentsByTooth([], byId, byName), {});
assert.deepEqual(treatmentsByTooth(undefined, byId, byName), {});
assert.equal(dominantTreatment(undefined), null);
assert.deepEqual(pendingTreatments(undefined), []);

console.log(
  `✓ toothTreatments: ${Object.keys(TREATMENT_STATES).length} states, ` +
    `planned work never repaints, extraction outranks all`
);
