import assert from "node:assert/strict";
import { quickIntent } from "../src/lib/bot/quickAnswers";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";
import { activeOffers, offerForService, closingLine, expensiveReply } from "../src/lib/bot/sales";

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

const base: BotContext = { clinicName: "Alpha Dental", patientName: "أحمد", gender: "male", canOfferBooking: true };

run("with the clinic's words the objection is answered; without them a person is fetched, and it is a miss", () => {
  const rich = { ...base, facts: { installments: "التقويم بيتقسط على 3 دفعات", whyUs: "أطباء متخصصين وضمان سنة" } };
  const answered = decideBotReply({ state: "awaiting_choice", text: "غالي اوي", ctx: rich });
  assert.equal(answered.reason, "objection_price");
  assert.equal(answered.handoff, false);
  assert.ok(answered.reply.includes("3 دفعات") && answered.reply.includes("ضمان سنة"));

  const bare = decideBotReply({ state: "awaiting_choice", text: "غالي اوي", ctx: base });
  assert.equal(bare.reason, "objection_price_unknown", "recorded as a miss so the field gets filled");
  assert.equal(bare.handoff, true);
  assert.ok(!bare.reply.includes("خصم"), "never invents a discount");

  const later = decideBotReply({ state: "awaiting_choice", text: "هفكر وهرد", ctx: base });
  assert.equal(later.reason, "objection_thinking");
  assert.equal(later.handoff, false);

  const cheaper = decideBotReply({ state: "awaiting_choice", text: "لقيت ارخص في مكان تاني", ctx: rich });
  assert.equal(cheaper.reason, "objection_competitor");
  assert.ok(cheaper.reply.includes("أطباء متخصصين"));

  assert.equal(expensiveReply({ facts: {} }).known, false);
});

run("an ended offer is told honestly, not handed to a person", () => {
  const ctx = { ...base, facts: { offers: "" }, offersExpired: true };
  const d = decideBotReply({ state: "awaiting_choice", text: "في خصم", ctx });
  assert.equal(d.reason, "offers_expired");
  assert.equal(d.handoff, false);
  const none = decideBotReply({ state: "awaiting_choice", text: "في خصم", ctx: base });
  assert.equal(none.reason, "offers_unknown", "no offer ever written still fetches a person");
});

run("salesperson mode: the model leads, the calendar and safety stay fixed", () => {
  const ai = { ...base, aiFirst: true, aiAvailable: true, hoursText: "من 3 م إلى 11 م" };
  assert.equal(decideBotReply({ state: "new", text: "السلام عليكم", ctx: ai }).action?.type, "ai", "even the greeting is the model's");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "مواعيدكم ايه", ctx: ai }).action?.type, "ai", "hours go to the model, not the canned line");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "غالي اوي", ctx: ai }).action?.type, "ai", "objections are the model's job here");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "عايز احجز", ctx: ai }).action?.type, "ai", "even 'book me' is the model's call — it opens the lists itself");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "m1", ctx: ai }).action?.type, "list_days", "a tapped book button still opens the lists");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "2", ctx: ai }).reason, "hours", "digits still mean the menu");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "تمام", ctx: ai }).action?.type, "ack", "a confirmation still confirms");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "سناني بتوجعني", ctx: ai }).reason, "clinical", "pain never reaches the model");
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "عايز اكلم حد", ctx: ai }).reason, "asked_for_human");
  // Budget spent: the old ladder stands.
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "مواعيدكم ايه", ctx: { ...ai, aiAvailable: false } }).reason, "hours");
});

console.log("sales: all suites passed");
