import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offerForService } from "../src/lib/bot/sales";
import { adSubjectText } from "../src/lib/bot/adReferral";
import {
  CHECKUP_IN_OFFER_FACT,
  CHECKUP_IN_OFFER_RULE,
  checkupFees,
  checkupIsInAdOffer,
  checkupPriceInOffer,
  isPlainCheckup,
  namesCheckup,
  plainCheckupPrices,
  stripCheckupFee,
} from "../src/lib/bot/offerCheckup";

/**
 * "A patient from an offer ad is not quoted the standalone check-up fee."
 *
 * On Saturday 14/11 at 08:25 a patient who tapped the clinic's "كشف + تنظيف وتلميع بـ 299" ad
 * asked about veneers and then "السعر كام", and was told "والكشف عموماً 200 ج.م". The offer they
 * came for already includes the check-up. The gate decides whose offer that is; the prompt hides
 * the fee for them; the reply check removes it when the model says it anyway. Everyone else's
 * prompt and reply are byte-identical.
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

// The clinic's real settings and ad on 14/11/2026.
const consultation = "الكشف 200 ج.م وبيتخصم من العلاج لو كمّلت معانا — يعني الزيارة الأولى بتحاسب عليها مرة واحدة بس.";
const offers =
  "عرض لفترة محدودة: كشف شامل + تنظيف وتلميع (إزالة الجير والتصبغات وتلميع) في زيارة واحدة بـ 299 ج.م بس بدل 550 ج.م. العرض ساري لحد 30 نوفمبر 2026. المواعيد يومياً من 3 العصر لـ 11 بالليل ما عدا الجمعة، والحجز على واتساب أو 01066666124.";
const adBody =
  "عرض الـ 299 جنيه من عيادة \"ألفا\" للأسنان! (بدل 550 جنيه) 🦷🔥 اطمن على أسنانك كلها ونضفها في زيارة واحدة بس بمدينة نصر! العرض يشمل: 👍 كشف شامل وتفصيلي لكل أسنانك. 👍 تنظيف جير وتصبغات. 👍 تلميع احترافي للأسنان. 💸 السعر: 299 جنيه بس (بدون أي مصاريف خفية).";
const ad1 = { headline: "رجّع لضحكتك لمعتها الطبيعية بـ 299 ج 🌟", body: adBody };
const ad2 = { headline: "احجز كشف وتنظيف وتلميع بـ 299 ج بدل 550 ج ⏱️", body: adBody };
const priceLines = "كشف: يبدأ من 200 ج.م\nكشف تقويم: يبدأ من 300 ج.م\nكمبوزيت فينير: يبدأ من 1,500 ج.م\nتنظيف وتلميع: يبدأ من 550 ج.م";
const fees = checkupFees(consultation, [200], offers);

run("the gate: both of the real campaign's ads, and a headline alone that quotes the offer's price", () => {
  assert.equal(checkupIsInAdOffer({ adText: adSubjectText(ad1), offersText: offers }), true);
  assert.equal(checkupIsInAdOffer({ adText: adSubjectText(ad2), offersText: offers }), true);
  assert.equal(checkupIsInAdOffer({ adText: ad1.headline, offersText: offers }), true, "shares 299 with the offer");
  assert.equal(checkupIsInAdOffer({ adText: "Book a check-up and cleaning", offersText: offers }), true, "English ad naming the check-up");
});

run("the gate: everything else keeps today's behaviour", () => {
  assert.equal(checkupIsInAdOffer({ adText: adSubjectText(ad1), offersText: "" }), false, "no running offer");
  assert.equal(checkupIsInAdOffer({ adText: adSubjectText(ad1), offersText: "خصم 20% على التبييض لغاية آخر الشهر" }), false, "offer without the check-up");
  assert.equal(checkupIsInAdOffer({ adText: "ابتسامة هوليود بأحدث تقنيات الزراعة", offersText: offers }), false, "implant ad, no shared price");
  assert.equal(checkupIsInAdOffer({ adText: "عروض 2026 على الزراعة", offersText: offers }), false, "a year is not a shared price");
  assert.equal(checkupIsInAdOffer({ adText: "", offersText: offers }), false, "an ad with no headline or body");
  // offerForService returns the WHOLE offers text when the ad's service is named anywhere in it,
  // so a whitening ad at a clinic that also offers a free check-up with braces must not pass.
  const multi = "كشف مجاني لأي حد هيركب تقويم. وخصم 20% على تبييض الأسنان.";
  const whiteningAd = "ابتسامة أفتح في جلسة واحدة — تبييض الأسنان بالليزر";
  assert.ok(offerForService(multi, "تبييض الأسنان"), "the greeting's offer line would be set for the whitening ad");
  assert.equal(checkupIsInAdOffer({ adText: whiteningAd, offersText: multi }), false, "but the whitening ad is not a check-up offer");
});

run("namesCheckup: the attached forms and the English/Franco words; not look-alike words", () => {
  for (const s of ["كشف", "الكشف", "والكشف", "للكشف", "وللكشف", "بالكشف", "فالكشف", "ميعاد للكشف بـ 200", "el kashf b 200", "The consultation is 200 EGP", "a check-up", "checkup"])
    assert.ok(namesCheckup(s), s);
  for (const s of ["اكتشف الفرق", "مكشوف", "التنظيف", "an example", ""]) assert.ok(!namesCheckup(s), s);
});

run("the price list: the plain check-up line says it is in the offer; specialist check-ups and the rest are kept", () => {
  assert.equal(
    checkupPriceInOffer(priceLines),
    "كشف: داخل في العرض للمريض ده\nكشف تقويم: يبدأ من 300 ج.م\nكمبوزيت فينير: يبدأ من 1,500 ج.م\nتنظيف وتلميع: يبدأ من 550 ج.م"
  );
  assert.equal(checkupPriceInOffer("الكشف: يبدأ من 250 ج.م"), "الكشف: داخل في العرض للمريض ده");
  assert.equal(checkupPriceInOffer("استشارة: يبدأ من 150 ج.م"), "استشارة: داخل في العرض للمريض ده");
  assert.equal(checkupPriceInOffer(""), "");
  assert.ok(isPlainCheckup("الكشف") && isPlainCheckup("كشف عام") && isPlainCheckup("Consultation") && isPlainCheckup("Check up"));
  assert.ok(!isPlainCheckup("كشف تقويم") && !isPlainCheckup("كشف وتنظيف") && !isPlainCheckup("تنظيف"));
  assert.deepEqual(plainCheckupPrices([{ name: "كشف", price: 200 }, { name: "كشف تقويم", price: 300 }, { name: "حشو", price: 200 }, { price: 50 }]), [200]);
});

run("the fee figures: the fact's and the service's, never the offer's own or a year", () => {
  assert.deepEqual(fees, ["200"]);
  assert.deepEqual(checkupFees("الكشف ٢٠٠ جنيه", [], offers), ["200"], "Arabic-Indic digits");
  assert.deepEqual(checkupFees("الكشف 299 ج.م", [299], offers), [], "the offer's own price is not an ordinary fee");
  assert.deepEqual(checkupFees("الكشف مجاني لحد 2026", [], offers), [], "a year is not a fee");
  assert.deepEqual(checkupFees(undefined, [0, 250.4], ""), ["250"]);
});

run("the incident at 08:25, verbatim: 200 is gone; the veneer price and both times stay", () => {
  const incident =
    "أيوه متاح عندنا كمبوزيت فينير، وسعره يبدأ من 1,500 ج.م، والاستقبال بيأكد السعر النهائي بعد ما الدكتور يحدد الأنسب لضحكتك. والكشف عموماً 200 ج.م وبيتخصم من تكلفة العلاج لو كمّلت معانا.\n\nالمواعيد المتاحة عندي مثلاً السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، تحب أنهي فيهم؟";
  const r = stripCheckupFee(incident, fees);
  assert.equal(r.stripped, true);
  assert.equal(
    r.text,
    "أيوه متاح عندنا كمبوزيت فينير، وسعره يبدأ من 1,500 ج.م، والاستقبال بيأكد السعر النهائي بعد ما الدكتور يحدد الأنسب لضحكتك. والكشف نفسه داخل في العرض.\n\nالمواعيد المتاحة عندي مثلاً السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، تحب أنهي فيهم؟"
  );
});

run("today's other leaks: implants at 01:30 and insurance at 07:39", () => {
  const implants =
    "أيوه، متوفر عندنا زراعة الأسنان وبتبدأ من 6,000 ج.م للمصري، والكوري بيبدأ من 7,500 ج.م، والألماني بيبدأ من 12,500 ج.م. والكشف بـ 200 ج.م وبيتخصم من تكلفة العلاج لو كملت معانا.";
  assert.equal(
    stripCheckupFee(implants, fees).text,
    "أيوه، متوفر عندنا زراعة الأسنان وبتبدأ من 6,000 ج.م للمصري، والكوري بيبدأ من 7,500 ج.م، والألماني بيبدأ من 12,500 ج.م. والكشف نفسه داخل في العرض."
  );
  const insurance = "للأسف مش متاح عندنا تعاقدات تأمين حالياً.\n\nالكشف عندنا بـ 200 ج.م وبيتخصم بالكامل من تكلفة أي علاج تعمله معانا.";
  assert.equal(stripCheckupFee(insurance, fees).text, "للأسف مش متاح عندنا تعاقدات تأمين حالياً.\n\nالكشف نفسه داخل في العرض.");
});

run("a deduction clause after the fee goes with it; the slots after it stay", () => {
  const r = stripCheckupFee("الكشف بـ 200 ج.م، وبيتخصم من العلاج، وعندي ميعاد السبت 3:00 م أو الأحد 6:30 م، إيه اللي يناسبك؟", fees);
  assert.equal(r.text, "الكشف نفسه داخل في العرض، وعندي ميعاد السبت 3:00 م أو الأحد 6:30 م، إيه اللي يناسبك؟");
  assert.ok(stripCheckupFee("ادفع 200 ج.م للكشف بس", fees).stripped, "للكشف");
  assert.ok(stripCheckupFee("الكشف ٢٠٠ جنيه", fees).stripped, "Arabic-Indic digits");
  assert.ok(stripCheckupFee("el kashf b 200 EGP", fees).stripped, "Franco");
});

run("left exactly as written: the offer itself, a deduction with no figure, a 200 that is not the check-up", () => {
  for (const s of [
    "العرض متاح بالفعل ويشمل كشف شامل وتنظيف وتلميع بـ 299 ج.م بدل 550 ج.م، والكشف كمان بيتخصم من أي علاج هتكمله معانا.",
    "الحشو العادي يبدأ من 200 ج.م، والكشف بيتخصم من العلاج.",
    "أسعار التبييض بتبدأ من 2,000 ج.م، والكشف بيتخصم.",
    "عندي ميعاد السبت 14/11 الساعة 3:00 م.",
  ]) {
    assert.deepEqual(stripCheckupFee(s, fees), { text: s, stripped: false }, s);
  }
});

run("no comma before the next thing: another service's 200 and the offered times are never taken with the check-up", () => {
  // The coaching asks for "والكشف بيتخصم" under every price, often joined with "و" and no comma.
  for (const s of [
    "الحشو العادي يبدأ من 200 ج.م والكشف بيتخصم من العلاج لو كملت معانا.",
    "الحشو يبدأ من 200 ج.م وقيمة الكشف بتتخصم من العلاج.",
    "الخلع بـ200ج والكشف بيتخصم.",
    "الحشو بـ 200 والكشف بيتخصم من أي علاج.",
    "Fillings start at 200 EGP and the consultation is deducted from treatment.",
  ]) {
    assert.deepEqual(stripCheckupFee(s, fees), { text: s, stripped: false }, s);
  }
  // The fee goes; the times offered after it in the same sentence stay, so "الأول" still means one of them.
  assert.equal(
    stripCheckupFee("الكشف 200 ج.م وعندي ميعاد السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، إيه اللي يناسبك؟", fees).text,
    "الكشف نفسه داخل في العرض وعندي ميعاد السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، إيه اللي يناسبك؟"
  );
  assert.equal(stripCheckupFee("الكشف بـ 200 ج.م والتنظيف بـ 550 ج.م.", fees).text, "الكشف نفسه داخل في العرض والتنظيف بـ 550 ج.م.");
  assert.equal(
    stripCheckupFee("Veneers start at 1,500 EGP and the consultation is 200 EGP.", fees).text,
    "Veneers start at 1,500 EGP and the check-up itself is included in the offer."
  );
  // The deduction joined by "و" still goes with the fee, leaving no stray space before the full stop.
  assert.equal(stripCheckupFee("تمام.\nالكشف ٢٠٠ جنيه وبيتخصم من العلاج.", fees).text, "تمام.\nالكشف نفسه داخل في العرض.");
  assert.equal(stripCheckupFee("والكشف عموماً 200 ج.م، وقيمته بتتخصم من تكلفة العلاج.", fees).text, "الكشف نفسه داخل في العرض.");
  // Said twice inside one sentence: the offer already covers it, so the added words go.
  assert.equal(stripCheckupFee("العرض بيشمل كشف شامل وتنظيف بـ 299 ج.م والكشف لوحده 200 ج.م.", fees).text, "العرض بيشمل كشف شامل وتنظيف بـ 299 ج.م.");
});

run("no fees (no ad, no offer, a free check-up): every reply is untouched", () => {
  const incident = "والكشف عموماً 200 ج.م وبيتخصم من تكلفة العلاج.";
  assert.deepEqual(stripCheckupFee(incident, []), { text: incident, stripped: false });
  assert.deepEqual(stripCheckupFee("", fees), { text: "", stripped: false });
});

run("said twice: when the reply already says the offer covers the check-up, nothing is added", () => {
  const r = stripCheckupFee("العرض بيشمل كشف شامل وتنظيف وتلميع بـ 299 ج.م، والكشف لوحده 200 ج.م.", fees);
  assert.equal(r.stripped, true);
  assert.equal(r.text, "العرض بيشمل كشف شامل وتنظيف وتلميع بـ 299 ج.م.");
});

run("English: the fee clause becomes 'the check-up itself is included in the offer'", () => {
  const r = stripCheckupFee("Veneers start at 1,500 EGP. The consultation is 200 EGP, deducted from treatment.", fees);
  assert.equal(r.text, "Veneers start at 1,500 EGP. The check-up itself is included in the offer.");
});

run("the prompt texts carry no figure (so they can never be a stray number or a price)", () => {
  assert.ok(!/\d/.test(CHECKUP_IN_OFFER_FACT) && !/\d/.test(CHECKUP_IN_OFFER_RULE));
  assert.ok(CHECKUP_IN_OFFER_RULE.startsWith("- "));
});

run("wiring: respond.ts gates once, covers both brains after the name check, the price list and the close", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const gate = src.indexOf("const checkupInOffer = Boolean(ctx.ad && offersActive && checkupIsInAdOffer({ adText: adSubjectText(ctx.ad), offersText: offersActive }));");
  const adSet = src.indexOf("ctx.ad = args.ad ?? conversation.ad;");
  const pick = src.indexOf("const brainReply = await pickReply(");
  const names = src.indexOf("if (settings.hideDoctorNames && profile?.doctors.length");
  const strip = src.indexOf("const cleaned = stripCheckupFee(ai.text, checkupFees(ctx.facts?.consultation, prices, offersActive));");
  const priceFirst = src.indexOf("ai.text = priceBeforeQuestions(ai.text);");
  assert.ok(gate > 0 && adSet > 0 && pick > 0 && names > 0 && strip > 0 && priceFirst > 0);
  assert.ok(adSet < gate && gate < pick && pick < names && names < strip && strip < priceFirst, "after the ad is known; after either brain and the name check");
  const block = src.slice(strip - 700, strip + 600);
  assert.ok(block.includes('if (checkupInOffer && (ai.kind === "answer" || ai.kind === "handoff") && ai.text && namesCheckup(ai.text))'));
  assert.ok(/if \(!args\.dryRun\) \{\s*void adminClinicCollection\(clinicId, "ai_debug"\)\s*\.add\(\{ kind: "checkup_fee_stripped"/.test(block), "no debug write from the playground");
  assert.ok(src.includes("...(checkupInOffer ? { checkupInOffer: true } : {}),"), "the prompt flag rides the AI arguments only when on");
  assert.ok(src.includes("if (!name || price <= 0 || (checkupInOffer && isPlainCheckup(name))) return \"\";"), "the rule-based price list");
  assert.ok(src.includes('facts: checkupInOffer ? { ...ctx.facts, consultation: "" } : ctx.facts'), "the rule-based closing line");
  // The booking card keeps its own, looser rule (7c335a0b).
  assert.ok(src.includes("ctx.facts?.consultation?.trim() && !(ctx.ad && offersActive)"));
  const ai = readFileSync(new URL("../src/lib/bot/aiReply.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(ai.includes("...(args.checkupInOffer === true ? { checkupInOffer: true } : {}),"), "the standard brain's prompt gets the flag");
  assert.ok(/args\.brief\?\.prices === "consult" \? "" : promptInput\.priceLines,\s*factLines\(facts\),/.test(ai), "the number guard still reads the raw list and facts");
});
