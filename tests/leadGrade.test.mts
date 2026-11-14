// Lead grading: the rule score, the signals it reads, and the rule that decides what a screen
// shows. Run with tsx. The model is not exercised here; what it refines is this.
import assert from "node:assert/strict";
import { effectiveGrade, gradeAgreement, gradeFromScore, gradeRank, rulesGrade, signalsFromThread, weekKeyOf, type GradeSignals } from "../src/lib/leads/leadGrade";

const H = 3_600_000;
const now = Date.UTC(2026, 8, 29, 12);

const base: GradeSignals = {
  patientMessages: 1,
  namedService: false,
  highValue: false,
  urgency: false,
  askedToBook: false,
  askedPrice: false,
  priceOnly: false,
  objection: false,
  declined: false,
  hoursSinceLastInbound: 1,
  fromAd: false,
  existingPatient: false,
  staffReplied: false,
  booked: false,
};

// ================================================================================================
// Signals read off real Egyptian Arabic.
// ================================================================================================
const pain = signalsFromThread({ patientTexts: ["السلام عليكم", "ضرسي بيوجعني جامد من امبارح، ينفع اجي النهارده؟"], lastInboundAtMs: now - H, now });
assert.equal(pain.urgency, true, "وجع is urgency");
assert.equal(pain.askedToBook, true, "ينفع اجي النهارده asks to come");
assert.equal(pain.patientMessages, 2);
assert.equal(rulesGrade(pain).grade, "hot");

const shopper = signalsFromThread({ patientTexts: ["الاسعار بكام؟"], lastInboundAtMs: now - H, now });
assert.equal(shopper.askedPrice, true);
assert.equal(shopper.priceOnly, true, "a price with no service and no booking word is the shopper");
assert.equal(rulesGrade(shopper).grade, "cold");

const whitening = signalsFromThread({ patientTexts: ["التبييض بكام عندكم"], lastInboundAtMs: now - H, now });
assert.equal(whitening.namedService, true);
assert.equal(whitening.priceOnly, false, "a price for a named service is a real question");
assert.equal(rulesGrade(whitening).grade, "warm");

// A short word is a word, not a run of letters inside another one.
//
// "ألم" folds to "الم", which is also the article plus any noun starting with م. Every whitening
// lead that sent the ad's own first message ("…مزيد من المعلومات…") or asked "المكان فين" was
// therefore graded "in pain, urgent" and pushed to hot.
const adHello = signalsFromThread({ patientTexts: ["مرحبًا! هل يمكنني الحصول على مزيد من المعلومات حول هذا؟"], adText: "عرض تبييض الأسنان", fromAd: true, lastInboundAtMs: now - H, now });
assert.equal(adHello.urgency, false, "المعلومات is not ألم");
assert.notEqual(rulesGrade(adHello).grade, "hot", "an ad hello with nothing else is not a hot lead");
for (const t of ["المكان فين", "مكان العياده والمواعيد", "المهم السعر", "الميعاد المناسب"]) {
  assert.equal(signalsFromThread({ patientTexts: [t], lastInboundAtMs: now - H, now }).urgency, false, `no pain in: ${t}`);
}
for (const t of ["عندي الم في ضرسي", "الألم شديد", "بألم جامد", "والم مش بيروح", "ضرسي وجعني", "سني واجعني اوي", "في ورم في اللثه"]) {
  assert.equal(signalsFromThread({ patientTexts: [t], lastInboundAtMs: now - H, now }).urgency, true, `pain in: ${t}`);
}
// The same accident with other three-letter words.
assert.equal(signalsFromThread({ patientTexts: ["معقول السعر ده"], lastInboundAtMs: now - H, now }).namedService, false, "معقول is not ضرس العقل");
assert.equal(signalsFromThread({ patientTexts: ["محتاجين نعرف التفاصيل"], lastInboundAtMs: now - H, now }).askedToBook, false, "محتاجين is not اجي");
assert.equal(signalsFromThread({ patientTexts: ["الاسم الكامل احمد"], lastInboundAtMs: now - H, now }).askedPrice, false, "الكامل is not كام");
// …and the real forms still count.
assert.equal(signalsFromThread({ patientTexts: ["ضرس العقل بيتخلع بكام"], lastInboundAtMs: now - H, now }).namedService, true);
assert.equal(signalsFromThread({ patientTexts: ["ضرسي محتاج حشوه"], lastInboundAtMs: now - H, now }).namedService, true);
assert.equal(signalsFromThread({ patientTexts: ["هاجي بعد الشغل"], lastInboundAtMs: now - H, now }).askedToBook, true);
assert.equal(signalsFromThread({ patientTexts: ["للحجز ازاي"], lastInboundAtMs: now - H, now }).askedToBook, true);
assert.equal(signalsFromThread({ patientTexts: ["الحشو كام؟"], lastInboundAtMs: now - H, now }).askedPrice, true);
assert.equal(signalsFromThread({ patientTexts: ["سعرها ايه"], lastInboundAtMs: now - H, now }).askedPrice, true);

// The ad they tapped names the service when they did not.
const fromAd = signalsFromThread({ patientTexts: ["مرحبا"], adText: "زراعة الأسنان بالتقسيط", fromAd: true, lastInboundAtMs: now - H, now });
assert.equal(fromAd.namedService, true);
assert.equal(fromAd.highValue, true, "implants are high value");
assert.equal(rulesGrade(fromAd).grade, "warm");

const objection = signalsFromThread({ patientTexts: ["التقويم بكام", "لا ده غالي اوي هفكر"], lastInboundAtMs: now - H, now });
assert.equal(objection.objection, true);
assert.equal(rulesGrade(objection).grade, "cold", "expensive + I'll think = cold even with a named service");

const declined = signalsFromThread({ patientTexts: ["عايز احجز تنظيف", "مش دلوقتي بعدين"], lastInboundAtMs: now - H, now });
assert.equal(declined.declined, true);
assert.equal(rulesGrade(declined).grade, "cold", "'not now' cools a booking request");

// The English side.
const en = signalsFromThread({ patientTexts: ["Hi, my tooth is broken and it hurts. When can I come?"], lastInboundAtMs: now - H, now });
assert.equal(en.urgency, true);
assert.equal(en.askedToBook, true);
assert.equal(rulesGrade(en).grade, "hot");

// Silence cools.
const fresh = signalsFromThread({ patientTexts: ["عايز احجز كشف"], lastInboundAtMs: now - H, now });
const stale = signalsFromThread({ patientTexts: ["عايز احجز كشف"], lastInboundAtMs: now - 3 * 24 * H, now });
const dead = signalsFromThread({ patientTexts: ["عايز احجز كشف"], lastInboundAtMs: now - 9 * 24 * H, now });
assert.ok(rulesGrade(fresh).score > rulesGrade(stale).score && rulesGrade(stale).score > rulesGrade(dead).score, "silence lowers the score step by step");
assert.equal(rulesGrade(fresh).grade, "warm");
assert.equal(rulesGrade(dead).grade, "cold");

// An ad tap that never typed.
const tapOnly = signalsFromThread({ patientTexts: [], adText: "تبييض", fromAd: true, lastInboundAtMs: null, now });
assert.equal(tapOnly.patientMessages, 0);
assert.equal(tapOnly.hoursSinceLastInbound, null);
assert.equal(rulesGrade(tapOnly).grade, "cold");
assert.ok(rulesGrade(tapOnly).reasons.includes("فتح الشات ومكتبش"));

// A form lead's typed interest counts as a message.
const form = signalsFromThread({ patientTexts: [], interest: "زراعة", lastInboundAtMs: null, now });
assert.equal(form.namedService, true);

// Booked is hot, whatever the words.
assert.deepEqual(rulesGrade({ ...base, booked: true, declined: true }), { grade: "hot", score: 100, reasons: ["حجز فعلاً"] });

// The score is bounded and the thresholds are what they say.
assert.equal(rulesGrade({ ...base, urgency: true, askedToBook: true, namedService: true, highValue: true, patientMessages: 5 }).score, 100);
assert.equal(gradeFromScore(65), "hot");
assert.equal(gradeFromScore(64), "warm");
assert.equal(gradeFromScore(39), "cold");

// ================================================================================================
// What a screen shows.
// ================================================================================================
assert.deepEqual(effectiveGrade({ staffGrade: "cold", aiGrade: "hot" }, true), { grade: "cold", by: "staff" }, "the desk always wins");
assert.deepEqual(effectiveGrade({ aiGrade: "hot" }, false), { grade: null, by: null }, "the AI's grade is hidden until a flow is approved");
assert.deepEqual(effectiveGrade({ aiGrade: "hot" }, true), { grade: "hot", by: "ai" });
assert.deepEqual(effectiveGrade({ staffGrade: null, aiGrade: null }, true), { grade: null, by: null });
assert.equal(gradeAgreement({ staffGrade: "hot", aiGrade: "hot" }), true);
assert.equal(gradeAgreement({ staffGrade: "hot", aiGrade: "warm" }), false);
assert.equal(gradeAgreement({ staffGrade: "hot" }), null);
assert.ok(gradeRank("hot") < gradeRank("warm") && gradeRank("warm") < gradeRank("cold") && gradeRank(null) > gradeRank("cold"));

// ISO weeks, for the draft ids.
assert.equal(weekKeyOf(Date.UTC(2026, 8, 29)), "2026-W40");
assert.equal(weekKeyOf(Date.UTC(2026, 0, 1)), "2026-W01");
assert.equal(weekKeyOf(Date.UTC(2027, 0, 3)), "2026-W53", "Jan 3rd 2027 is still ISO week 53 of 2026");

console.log("leadGrade: all checks passed");
