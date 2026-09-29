import assert from "node:assert/strict";
import { anonymise, expectFromKind, testCaseId, turnsFromLines } from "../src/lib/bot/testCases";

// A phone in any spelling leaves; short numbers (a price, a time) stay.
assert.equal(anonymise("رقمي 01001732671 اتصل بيا"), "رقمي [phone] اتصل بيا");
assert.equal(anonymise("call +20 100 173 2671 please"), "call [phone] please");
assert.equal(anonymise("التنظيف بـ 1200 جنيه الساعة 5"), "التنظيف بـ 1200 جنيه الساعة 5");

// Every word of the name, not only the full string; two-letter words are left alone.
assert.equal(anonymise("أهلاً يا سحر، حجز سحر احمد الحصري اتأكد", "سحر احمد الحصري"), "أهلاً يا [name]، حجز [name] [name] [name] اتأكد");
assert.equal(anonymise("من غير حجز", "من"), "من غير حجز");

// Turns: consecutive patient lines fold; staff and system lines vanish; silence is a turn.
const turns = turnsFromLines(
  [
    { direction: "in", author: "patient", text: "سلام" },
    { direction: "in", author: "patient", text: "عايز احجز" },
    { direction: "out", author: "bot", text: "أهلاً! تحب يوم ايه؟", kind: "booking" },
    { direction: "out", author: "system", text: "🔔 تم تأكيد حجزك", kind: "appointment_new" },
    { direction: "in", author: "patient", text: "بكره" },
    { direction: "out", author: "bot", text: "عندنا 5 و 8", kind: "booking_day" },
    { direction: "out", author: "bot", text: "قولي الرقم", kind: "booking_day" },
    { direction: "out", author: "staff", text: "أنا مروة من العيادة", name: "مروة" } as never,
    { direction: "in", author: "patient", text: "ضرسي بيوجعني" },
  ],
  "احمد"
);
assert.equal(turns.length, 3);
assert.equal(turns[0].q, "سلام\nعايز احجز");
assert.equal(turns[0].kind, "booking");
assert.equal(turns[1].a, "عندنا 5 و 8\nقولي الرقم");
assert.equal(turns[2].a, "");
assert.equal(turns[2].kind, "");

// A voice note with no words is not a question.
assert.equal(turnsFromLines([{ direction: "in", author: "patient", text: "[audio]", media: "audio" }]).length, 0);

// The kind-to-action guess.
assert.deepEqual(expectFromKind("ai_handoff_medical"), ["handoff_medical"]);
assert.deepEqual(expectFromKind("booking_time"), ["open_booking", "book_slot", "answer"]);
assert.deepEqual(expectFromKind("hours"), ["answer"]);
assert.deepEqual(expectFromKind(""), ["answer"]);

assert.equal(testCaseId("308753744", "abc/DEF"), "308753744_abcDEF");

console.log("botTestCases: ok");
