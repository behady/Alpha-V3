import assert from "node:assert/strict";
import { quickIntent } from "../src/lib/bot/quickAnswers";
import { activeOffers, offerForService, closingLine } from "../src/lib/bot/sales";

/**
 * The salesman layer: offers with an end date, the closing line, and the three objections.
 *
 * What is pinned: an ended offer vanishes by itself; an offer is mentioned only for the service
 * it is about; the close speaks in the patient's gender and uses the consultation terms when
 * written; and "غالي" / "هفكر" / "في أرخص" are recognised — and, with nothing written to answer
 * them, fetch a person rather than invent a discount.
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

run("offers end on their date, and the service they are about is the only one that hears of them", () => {
  const facts = { offers: "خصم 20% على التبييض لغاية آخر الشهر", offersUntil: "2026-09-30" };
  assert.equal(activeOffers(facts, "2026-09-05"), facts.offers);
  assert.equal(activeOffers(facts, "2026-09-30"), facts.offers, "the last day still counts");
  assert.equal(activeOffers(facts, "2026-10-01"), "", "the day after, it is gone");
  assert.equal(activeOffers({ offers: "خصم 10%" }, "2030-01-01"), "خصم 10%", "no date means no expiry");
  assert.equal(activeOffers({ offers: "  " }, "2026-09-05"), "");

  assert.ok(offerForService(facts.offers, "تبييض الأسنان").includes("خصم 20%"), "whitening offer under whitening");
  assert.ok(offerForService(facts.offers, "التبييض"), "with the article too");
  assert.equal(offerForService(facts.offers, "تقويم معدن"), "", "not under braces");
  assert.equal(offerForService(facts.offers, ""), "");
});

run("the close speaks to the patient and uses the consultation terms when written", () => {
  assert.ok(closingLine({ gender: "male" }).startsWith("تحب أحجزلك"));
  assert.ok(closingLine({ gender: "female" }).startsWith("تحبي أحجزلك"));
  assert.ok(closingLine({ gender: "male", facts: { consultation: "الكشف مجاني" } }).startsWith("الكشف مجاني"));
  assert.equal(closingLine({ gender: "male", alreadyBooked: true }), "", "no pitch to someone who is coming");
});

run("objections are recognised, and ordered under the concrete questions", () => {
  assert.equal(quickIntent("ده غالي اوي"), "expensive");
  assert.equal(quickIntent("مش هقدر ادفع المبلغ ده"), "expensive", "a money objection, not a cancellation");
  assert.equal(quickIntent("مش هقدر اجي بكره"), "cancel", "the cancellation still cancels");
  assert.equal(quickIntent("تمام هفكر وهرد عليكم"), "thinking");
  assert.equal(quickIntent("هفكر بس التقويم بكام"), null, "a question beats a goodbye — the model answers the price");
  assert.equal(quickIntent("في عياده تانيه ارخص"), "competitor");
  assert.equal(quickIntent("في عرض على التبييض"), "offers");
});

console.log("sales: all suites passed");
