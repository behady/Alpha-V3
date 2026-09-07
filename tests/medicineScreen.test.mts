import assert from "node:assert/strict";
import { readScreeningAnswer, DEFAULT_SCREENING } from "../src/lib/bot/medicineScreen";

/**
 * The gate in front of the only feature in this assistant that can physically hurt somebody. It is
 * lopsided on purpose: a clear "nothing" proceeds, and every other answer — including one nobody
 * can parse — reaches the dentist.
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

run("anything that could matter reaches the dentist", () => {
  for (const answer of [
    "انا حامل في الشهر الرابع",
    "برضع لسه",
    "الدوا لبنتي مش ليا",
    "عندي حساسية من البنسلين",
    "عندي سكر وضغط",
    "باخد أدوية للقلب",
    "عندي قرحة في المعدة",
    "I am pregnant",
    "it's for my son",
    "I'm allergic to penicillin",
    "I take blood thinners",
    "للماما مش ليا",
  ]) {
    assert.equal(readScreeningAnswer(answer), "risk", answer);
  }
});

run("a clear nothing is a clear nothing", () => {
  for (const answer of ["مفيش", "لا مفيش حاجة", "لا خالص", "ولا حاجة الحمد لله", "no", "none", "nothing thanks", "لا، الدوا ليا"]) {
    assert.equal(readScreeningAnswer(answer), "clear", answer);
  }
});

run("an answer nobody can read is not permission", () => {
  for (const answer of ["", "   ", "طب وبعدين", "ok", "👍", "ممكن تقوليلي الأول السعر"]) {
    assert.notEqual(readScreeningAnswer(answer), "clear", answer);
  }
  // A long explanation is a conversation, not a yes/no, and is not read as consent.
  const essay = "بصي انا كنت عند دكتور تاني من كام شهر وقالي ان الضرس ده محتاج علاج عصب بس انا خفت وقتها ومكملتش وبقالي فترة بحس بوجع خفيف وبيروح لوحده";
  assert.notEqual(readScreeningAnswer(essay), "clear");
});

run("the built-in questions ask what they need to ask", () => {
  for (const needle of ["حمل", "رضاعة", "حساسية", "سكر", "ضغط"]) {
    assert.ok(DEFAULT_SCREENING.includes(needle), `screening must ask about ${needle}`);
  }
  // And it must tell them how to answer, or they will not.
  assert.ok(DEFAULT_SCREENING.includes("مفيش"));
});

console.log("medicineScreen: all suites passed");
