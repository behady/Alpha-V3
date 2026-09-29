// The "General" option in the dentist picker: a visit the clinic owns rather than one dentist.
//
// Run with `npx tsx tests/generalDentist.test.mjs` so the TS module loads directly. No npm script
// yet: package.json was held by another session's uncommitted edits when this was written.
//
// The whole point of this file is the round trip. General is a UI sentinel that must NEVER reach
// Firestore — it stores as no dentist name at all — and a stored appointment with no dentist must
// come back on General rather than being silently handed to whoever is first on staff.
import assert from "node:assert/strict";
import {
  GENERAL_DOCTOR_VALUE,
  doctorCardLabel,
  doctorFieldFromPicker,
  generalDoctorLabel,
  isGeneralDoctorValue,
  pickerValueFromDoctorField,
} from "../src/lib/generalDentist.ts";

// --- the sentinel ------------------------------------------------------------------------------
assert.equal(isGeneralDoctorValue(GENERAL_DOCTOR_VALUE), true);
assert.equal(isGeneralDoctorValue("Dr. Ahmed"), false);
// It has to be something, not "": the booking modal repairs an empty dentist by snapping to the
// first one on staff, which would undo the choice the instant it was made.
assert.notEqual(GENERAL_DOCTOR_VALUE, "");

// --- what gets stored --------------------------------------------------------------------------
assert.equal(doctorFieldFromPicker(GENERAL_DOCTOR_VALUE), "", "General never reaches Firestore");
assert.equal(doctorFieldFromPicker("Dr. Ahmed"), "Dr. Ahmed");
assert.equal(doctorFieldFromPicker(undefined), "");

// --- and what comes back -----------------------------------------------------------------------
assert.equal(pickerValueFromDoctorField(""), GENERAL_DOCTOR_VALUE);
assert.equal(pickerValueFromDoctorField(null), GENERAL_DOCTOR_VALUE);
assert.equal(pickerValueFromDoctorField("   "), GENERAL_DOCTOR_VALUE, "whitespace is nobody");
assert.equal(pickerValueFromDoctorField("Dr. Ahmed"), "Dr. Ahmed");
// The round trip: a General booking that is reopened and saved again stays General.
assert.equal(doctorFieldFromPicker(pickerValueFromDoctorField(doctorFieldFromPicker(GENERAL_DOCTOR_VALUE))), "");

// --- how it reads ------------------------------------------------------------------------------
assert.equal(generalDoctorLabel("en"), "General");
assert.equal(generalDoctorLabel("ar"), "عام");
assert.equal(generalDoctorLabel(undefined), "General");

// THE BUG this label exists to stop: the cards printed "Dr. " and then nothing at all.
assert.equal(doctorCardLabel("", "en"), "General");
assert.equal(doctorCardLabel(null, "ar"), "عام");
assert.equal(doctorCardLabel("Dr. Ahmed", "en"), "Dr. Ahmed", "the second word is the name");
assert.equal(doctorCardLabel("Ahmed", "en"), "Dr. Ahmed", "a one-word name is used whole");

console.log("✓ generalDentist: General stores as no dentist, comes back as General, never prints a bare Dr.");
