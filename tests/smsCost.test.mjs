// The SMS billing arithmetic behind the counter in Settings → SMS.
//
// Worth a test because the number it produces is the only warning a clinic gets before a template
// starts costing them three texts per patient per day, and because the GSM-7/UCS-2 boundary is the
// kind of rule that is easy to get subtly wrong and never notice.
import assert from "node:assert/strict";
import { measureSms, DEFAULT_SMS_REMINDER_TEMPLATE } from "../src/lib/sms/config.ts";

const seg = (text) => measureSms(text).segments;
const enc = (text) => measureSms(text).encoding;

// --- empty ---
assert.equal(seg(""), 0, "an empty body is not a billed message");

// --- plain latin text: 160 per message, 153 once it splits ---
assert.equal(enc("Hello"), "GSM-7");
assert.equal(seg("Hello"), 1);
assert.equal(seg("a".repeat(160)), 1, "160 GSM characters still fit one message");
assert.equal(seg("a".repeat(161)), 2, "one character over and the whole thing is billed twice");
assert.equal(seg("a".repeat(306)), 2, "2 x 153 is the real limit once a message is split");
assert.equal(seg("a".repeat(307)), 3);

// --- Arabic forces UCS-2: 70 per message, 67 once it splits ---
assert.equal(enc("تذكير"), "UCS-2", "any Arabic character drops the message to the 70-char alphabet");
assert.equal(seg("ا".repeat(70)), 1);
assert.equal(seg("ا".repeat(71)), 2);
assert.equal(seg("ا".repeat(134)), 2, "2 x 67 once split");
assert.equal(seg("ا".repeat(135)), 3);

// A single Arabic word in an otherwise English message costs the whole message its alphabet —
// this is the trap the counter exists to expose.
assert.equal(enc("Reminder: your appointment is tomorrow at the عيادة"), "UCS-2");
assert.equal(seg("a".repeat(100) + "ع"), 2, "100 latin chars are free; adding one Arabic letter bills two");

// --- emoji do the same thing, even with no Arabic in sight ---
assert.equal(enc("See you tomorrow 🙂"), "UCS-2", "an emoji forces UCS-2 just like Arabic does");

// --- GSM extended characters cost two ---
assert.equal(enc("Cost: 100€"), "GSM-7", "the euro sign is in the GSM extension, not outside the alphabet");
assert.equal(seg("a".repeat(158) + "€"), 1, "158 + a 2-char escape = 160, still one message");
assert.equal(seg("a".repeat(159) + "€"), 2, "159 + a 2-char escape = 161, so it splits");

// --- the shipped default must be a single message ---
const shipped = measureSms(DEFAULT_SMS_REMINDER_TEMPLATE);
assert.equal(
  shipped.segments,
  1,
  `the default reminder must cost one message, not ${shipped.segments} — it is Arabic, so the budget is 70 characters`
);

console.log(
  `✓ smsCost: default template is ${shipped.characters} ${shipped.encoding} chars = ${shipped.segments} billed message`
);
