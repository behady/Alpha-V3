import assert from "node:assert/strict";
import { needsHuman, triageMessage } from "../src/lib/bot/clinicalTriage";

/**
 * The bot's one safety-critical branch, tested in both directions.
 *
 * Both halves matter and they pull against each other, which is exactly why they are pinned here:
 * loosening the list to catch a missed emergency is how ordinary words start getting blocked
 * again, and tightening it to unblock a word is how a swollen face reaches a menu. A change that
 * improves one direction must leave the other direction green.
 *
 * The ordinary-words list is not a style preference. Every entry in it was measured against the
 * previous implementation and found to be silently answered with the emergency script, followed by
 * permanent silence for the rest of that conversation.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

run("ordinary words are not emergencies — the ال+م collision is closed", () => {
  const ordinary = [
    // Every one of these was a permanent clinical handoff before whole-word matching.
    "ممكن اعرف المواعيد المتاحه للحجز الاسبوع ده",
    "المواعيد بتاعتكم ايه",
    "الميعاد بتاعي بكره صح ولا لأ",
    "ياريت تأكدولي الميعاد",
    "المكان فين بالظبط انا تايه",
    "المبلغ كام",
    "المهم انا عايز احجز",
    "المدير موجود؟",
    "الملف بتاعي",
    "التلبيسه جت من المعمل ولا لسه",
    "في اسانسير ولا المصعد بس؟",
    "المساء متاح؟",
    "المفروض اجي امتى",
    "انتوا فاضيين المغرب النهارده",
    "ايه الفرق بين التقويم المعدن والشفاف",
    // دم inside innocent words.
    "شكرا مقدما",
    "شكرا على الخدمة الممتازة",
    "بتقدموا خدمة التقويم؟",
    "بتستخدموا بنج ولا ايه",
    "عايز اعرف الخدمات عندكم",
    // سكر / ضغط / مسكن / حمل inside innocent words.
    "بتسكروا الساعه كام",
    "السكرتيرة قالتلي اجي",
    "اضغط على اللينك",
    "مسكني جنب العيادة اجي على طول؟",
    "مش عارف احمل الصورة، ابعتها ازاي؟",
  ];
  for (const text of ordinary) {
    assert.equal(needsHuman(text), false, `wrongly blocked: ${text}`);
  }
});

run("a named treatment beside a price or a booking is shopping, not a symptom", () => {
  // خلع is both a service the clinic sells and a thing that goes wrong.
  assert.equal(needsHuman("بكام الخلع"), false);
  assert.equal(needsHuman("خلع ضرس العقل بكام"), false);
  assert.equal(needsHuman("عايز احجز خلع ضرس العقل"), false);
  // Alone, with no commercial context, it stays with a person — post-op questions belong there.
  assert.equal(needsHuman("الاكل بعد الخلع ايه"), true);
});

run("the spoken forms of an emergency are caught, not just the dictionary ones", () => {
  const urgent = [
    "مش قادر انام من وجع ضرسي",
    "وشي وارم من ناحية الشمال",
    "الدم مش واقف من مكان الخلع",
    "اخد مسكن ايه دلوقتي",
    "الدكتور قالي اخد مضاد حيوي ايه",
    "انا حامل في الشهر التالت ينفع اخلع",
    "انا عندي سكر وضغط عالي",
    // None of these matched anything in the previous list.
    "ضرسي مكسور نص وبيقطع في لساني",
    "سني اتفكك وبيتحرك",
    "لثتي بتنزف وانا بغسل سناني",
    "ابني وقع وسنته طلعت من مكانها",
    "بنتي وقعت على وشها وسنتها اتحركت",
    "ابني سخن ومش عايز ياكل من امبارح",
    "الطربوش بتاعي وقع وانا باكل",
    "الخيط اللي في اللثه اتفك",
    "بلعت حته من الضرس",
    "قلبي بيدق جامد بعد البنج",
    "مش عارف ابلع ريقي",
    "لساني مخدر من امبارح ومش حاسس بيه",
    "وشي بيكبر ومش عارف انام",
    "مكان الضرس اللي شيلته ريحته وحشه",
  ];
  for (const text of urgent) {
    assert.equal(needsHuman(text), true, `missed an emergency: ${text}`);
  }
});

run("franco-Arabic and English reach the same branch as Arabic", () => {
  // Previously invisible: the list held Arabic script and English words only.
  assert.equal(needsHuman("el dars beywga3ni gamed mn embare7"), true);
  assert.equal(needsHuman("wshy waram"), true);
  assert.equal(needsHuman("3andy nazif"), true);
  assert.equal(needsHuman("my tooth is broken"), true);
  assert.equal(needsHuman("severe pain since yesterday"), true);
});

run("asking whether it hurts is not the same as saying it hurts", () => {
  // A nervous patient before treatment. Blocking this also cost the booking, because the bot
  // went silent afterwards.
  assert.equal(needsHuman("هو بيوجع"), false);
  assert.equal(needsHuman("هو بيوجع ولا لا"), false);
  // The same verb with a mouth beside it is a report, and is caught.
  assert.equal(needsHuman("ضرسي بيوجع"), true);
});

run("the mouth-plus-distress net catches what no word list would", () => {
  const r = triageMessage("حاسس بحاجه غريبه في ضرسي");
  assert.equal(r.needsHuman, true);
  assert.equal(r.reason, "mouth_distress");
  assert.equal(needsHuman("بقالي يومين مش عارف اكل على الناحية اليمين"), true);
  assert.equal(needsHuman("مش قادر افتح بقي"), true);
  // Neither half fires alone: a tooth with no distress is a normal enquiry.
  assert.equal(needsHuman("ضرس العقل بكام"), false);
  assert.equal(needsHuman("العربيه غريبه"), false);
});

run("short stems do not grow endings — الم is not المهم", () => {
  // A three-letter stem plus an ending re-creates the original bug one size smaller.
  for (const word of ["المهم", "المها", "الملك", "المره", "المياه", "المدرسه", "المكتب"]) {
    assert.equal(needsHuman(word), false, `short-stem suffix leaked: ${word}`);
  }
  // The real inflections still match.
  assert.equal(needsHuman("الالم مش مستحمل"), true);
  assert.equal(needsHuman("عندي الم"), true);
});

run("an attached و does not hide a phrase behind it", () => {
  // Egyptians write "ومش عارف انام" as one token; the phrase must still be found.
  assert.equal(needsHuman("وشي بيكبر ومش عارف انام"), true);
  assert.equal(needsHuman("وجعني ومش قادر ابلع"), true);
});

run("empty and trivial input is never an emergency", () => {
  assert.equal(needsHuman(""), false);
  assert.equal(needsHuman("   "), false);
  assert.equal(needsHuman("1"), false);
  assert.equal(needsHuman("تمام"), false);
  assert.equal(needsHuman("👍"), false);
});

console.log("\nclinicalTriage: all suites passed");
