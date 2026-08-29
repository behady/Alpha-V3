// Reaching a patient by the number a receptionist actually typed. Run with tsx.
//
// Two rules that pull in opposite directions, which is the whole point of this file:
//
//   Sending  — refuse a number with no country. Guessing a country and messaging a stranger in it
//              is worse than refusing, so `normalizeToE164WithCountryCode` stays strict.
//   Matching — be generous. An inbound WhatsApp reply identifies its sender as `201551552440`
//              with no plus, and a patient on the books may be stored any of five ways.
//
// Conflating the two caused both live bugs: a real stop request matched nobody, and every patient
// stored as `01024348877` was silently unreachable on both channels.
import assert from "node:assert/strict";
import {
  foldArabicDigits,
  normalizeToE164AssumingCountry,
  normalizeToE164WithCountryCode,
} from "../src/lib/phoneNumber.ts";
import { patientSendablePhone, phoneMatchKey, samePhone } from "../src/lib/patientPhone.ts";

// --- the strict rule keeps refusing what it should refuse ---
assert.equal(normalizeToE164WithCountryCode("+201551552440"), "+201551552440");
assert.equal(
  normalizeToE164WithCountryCode("01024348877"),
  "",
  "a bare national number names no country; sending must not invent one"
);

// --- the stored-patient rule reads it as the clinic's country ---
assert.equal(normalizeToE164AssumingCountry("01024348877"), "+201024348877");
assert.equal(normalizeToE164AssumingCountry("1024348877"), "+201024348877", "no trunk zero");
assert.equal(normalizeToE164AssumingCountry("201024348877"), "+201024348877", "already international, no plus");
assert.equal(normalizeToE164AssumingCountry("+201024348877"), "+201024348877");
assert.equal(normalizeToE164AssumingCountry("00201024348877"), "+201024348877");
assert.equal(
  normalizeToE164AssumingCountry("+966501234567"),
  "+966501234567",
  "a number that names its own country keeps it — the assumption only fills a gap"
);
assert.equal(normalizeToE164AssumingCountry(""), "");
assert.equal(normalizeToE164AssumingCountry("not a phone"), "");
assert.equal(normalizeToE164AssumingCountry("0"), "", "a trunk prefix alone is not a number");

// --- Arabic-Indic digits, which are real in this database ---
assert.equal(foldArabicDigits("٠١٢٢٢٦٨١٥٧٨"), "01222681578");
assert.equal(
  normalizeToE164AssumingCountry("٠١٢٢٢٦٨١٥٧٨"),
  "+201222681578",
  "a phone typed on an Arabic keyboard must not vanish when non-digits are stripped"
);

// --- THE ONE THAT MATTERS: the patient who was silently unreachable ---
// Stored exactly like this in the live database. Both senders rejected it before dialling, so the
// reminder never went and nothing anywhere said why.
assert.equal(patientSendablePhone({ name: "mohamed nady", phone: "01145766055" }), "+201145766055");
assert.equal(patientSendablePhone({ name: "HALA", phone: "01030742043" }), "+201030742043");
assert.equal(patientSendablePhone({ phone: "+201551552440" }), "+201551552440");
assert.equal(patientSendablePhone({}), "", "no phone stays no phone, rather than becoming a country code");
assert.equal(patientSendablePhone(null), "");

// --- matching an inbound sender to a stored patient ---
const inbound = "201551552440"; // exactly what the gateway hands us
for (const stored of ["+201551552440", "01551552440", "00201551552440", "201551552440", "+20 155 155 2440"]) {
  assert.equal(samePhone(inbound, stored), true, `inbound must match a patient stored as ${stored}`);
}
assert.equal(phoneMatchKey("٠١٢٢٢٦٨١٥٧٨"), phoneMatchKey("+201222681578"));

// --- and must not match the wrong person ---
assert.equal(samePhone("201551552440", "201066037618"), false);
assert.equal(samePhone("", "201551552440"), false);
assert.equal(samePhone("abc", "201551552440"), false);
assert.equal(samePhone("2440", "201551552440"), false, "a fragment must never match a real number");

// --- THE THIRD INSTANCE: the number must be dialable, not merely matchable ---
// WhatsApp hands us "201551552440" with no plus. Matching it to a patient was fixed first, and
// sending to stored patients second, but the assistant replies to the raw inbound number — and
// sendWhatsApp rejected it with "Invalid destination phone" after composing a perfect reply.
// The webhook now converts once at the edge; this pins that the result is something a sender
// will actually accept.
import { normalizeToInternationalDigits } from "../src/lib/whatsapp.ts";
for (const waId of ["201551552440", "201066037618", "201024348877"]) {
  const atEdge = normalizeToE164AssumingCountry(waId);
  assert.ok(atEdge.startsWith("+"), `edge conversion must yield E.164 for ${waId}`);
  assert.notEqual(
    normalizeToInternationalDigits(atEdge),
    "",
    `sendWhatsApp must accept what the webhook hands it for ${waId}`
  );
}

console.log("✓ patientPhone: sending stays strict, stored patients are reachable, matching is spelling-proof");
