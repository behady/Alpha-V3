// Asking for the location always gets the map link. Run with tsx.
//
// 14/11/2026, Alpha Dental: a patient asked for the location three times ("العنوان واللوكيشن",
// "امكانية تبعتلي اللوكيشن", "في انتظار اللوكيش") and got the street address, then a name
// request, then nothing. The clinic's map link was saved; the model was never given it, and no
// code put it under the reply. A receptionist pasted it by hand.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { asksForLocation } from "../src/lib/bot/quickAnswers";
import { LOCATION_PIN_LABEL, locationPinLine, withPin } from "../src/lib/bot/careNote";
import { factLines } from "../src/lib/bot/botPrompt";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";
import { localizeOutbound } from "../src/lib/bot/localize";

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const addr = "شارع الرحمة (شارع أبو بكر) - مساكن شروق النادي الأهلي - عمارة أولاد يحيى - الدور الأول.";
const url = "https://share.google/WMMoYEwra3TyBTw0S";
const pin = `${LOCATION_PIN_LABEL}\n${url}`;

run("every way today's patients asked counts, including the typo", () => {
  for (const s of [
    "الموقع",
    "المكان فين لو سمحت",
    "السلام عليكم ورحمة الله وبركاته.. العنوان واللوكيشن.. يناسبني موعد اي يوم في الفترة الصباحية",
    "تمام.. عنوان العيادة.. ولكم الشكر",
    "Okay.. الأحد.. 15 نوفمبر الحالي الساعة 3 عصرا وألف شكر.. امكانية تبعتلي اللوكيشن..",
    "تم أعلاه.. في انتظار اللوكيش",
    "اللوكيش",
    "العنوان",
    "العنوان ايه",
    "هو المكان فين",
    "السلام عليكم العيادة فين",
    "الماب",
    "والموقع",
    "ابعتلي الخريطة",
    "موقعك فين",
    "انتم فين",
    "where is your location?",
    "where r u",
    "send me the pin",
    "Address please",
  ]) assert.ok(asksForLocation(s), s);
});

run("a no, a website, another subject and a name are not asks", () => {
  for (const s of [
    "لا العنوان بعيد عليا",
    "للاسف بعيد",
    "مفيش فرع اقريب المهندسين",
    "التنظيف بكام",
    "عايز احجز بكره",
    "مواعيدكم ايه",
    "هو فيه موقع ليكم على النت",
    "تمام",
    "شكرا",
    "خميس عبد الوهاب الحلواني.. موبايل رقم.. 01064785354.. ولكم الشكر",
    "عندي pain",
    "how much is a pin crown",
    "محمد أحمد",
    "اسمي محمد احمد وعنواني مدينة نصر",
    "",
  ]) assert.ok(!asksForLocation(s), s);
});

run("the 09:35 turn: the name request now carries the pin, and still ends on the request", () => {
  const askName = "أهلاً بيك 🙏 عشان أسجل الحجز باسمك، ابعتلي اسمك الكامل.";
  assert.equal(locationPinLine({ asked: "تم أعلاه.. في انتظار اللوكيش", reply: askName, addressText: addr, mapsUrl: url }), pin);
  // The code's own one-paragraph request: the pin above it.
  assert.equal(withPin(askName, pin, true), `${pin}\n\n${askName}`);
  // With the model's line in front: between the two.
  assert.equal(withPin(`تمام 👍\n\n${askName}`, pin, true), `تمام 👍\n\n${pin}\n\n${askName}`);
});

run("the pin goes before a closing question, otherwise at the end", () => {
  const ai = `عنواننا: ${addr}\n\nتحب نظبط ميعادك السبت الساعة 3:30 م ولا 6:30 م؟`;
  assert.equal(withPin(ai, pin), `عنواننا: ${addr}\n\n${pin}\n\nتحب نظبط ميعادك السبت الساعة 3:30 م ولا 6:30 م؟`);
  // A question with an emoji after it is still a question.
  assert.equal(withPin("عنواننا هنا\n\nتحب أنهي؟ 😊", pin), `عنواننا هنا\n\n${pin}\n\nتحب أنهي؟ 😊`);
  // The address alone (the times held back as a repeat): under it.
  assert.equal(withPin(`عنواننا: ${addr}`, pin), `عنواننا: ${addr}\n\n${pin}`);
  // One paragraph that is a question holds the answer too: under it, never above the address.
  assert.equal(withPin(`عنواننا ${addr} تحب نحجز؟`, pin), `عنواننا ${addr} تحب نحجز؟\n\n${pin}`);
  // The model introducing it ("وده اللوكيشن 👇"): right under its line.
  assert.equal(withPin(`عنواننا: ${addr}\n\nوده اللوكيشن 👇`, pin), `عنواننا: ${addr}\n\nوده اللوكيشن 👇\n\n${pin}`);
  // Nothing to add, nothing changes.
  assert.equal(withPin("x", ""), "x");
});

run("a reply that already carries a map link gets nothing more", () => {
  // The menu's own address answer and the booking note print the saved link.
  assert.equal(locationPinLine({ asked: "العنوان", reply: `📍 *العنوان:*\n${addr}\n\n${url}`, addressText: addr, mapsUrl: url }), "");
  // Any map link: a different saved one, the clinic profile's, one copied from coaching.
  assert.equal(locationPinLine({ asked: "اللوكيشن", reply: "اللوكيشن: https://maps.app.goo.gl/EkNj94mr5qGk8oqR7", addressText: addr, mapsUrl: url }), "");
  assert.equal(locationPinLine({ asked: "اللوكيشن", reply: "اللوكيشن: share.google/WMMoYEwra3", addressText: addr, mapsUrl: url }), "");
});

run("no link saved, words only, not asked, or another branch: nothing", () => {
  assert.equal(locationPinLine({ asked: "العنوان", reply: "x", addressText: addr, mapsUrl: "" }), "");
  assert.equal(locationPinLine({ asked: "العنوان", reply: "x", addressText: addr, mapsUrl: undefined }), "");
  assert.equal(locationPinLine({ asked: "العنوان", reply: "x", addressText: addr, mapsUrl: "بجوار المترو" }), "");
  assert.equal(locationPinLine({ asked: "التنظيف بكام", reply: "x", addressText: addr, mapsUrl: url }), "");
  assert.equal(locationPinLine({ asked: "لا العنوان بعيد عليا", reply: "ولا يهمك", addressText: addr, mapsUrl: url }), "");
  assert.equal(locationPinLine({ asked: "عنوان فرع حدائق الاهرام", reply: "فرعنا في شارع الطاقة", addressText: addr, mapsUrl: url }), "");
  // Asked about the main branch and answered with the main address: the pin is right.
  assert.equal(locationPinLine({ asked: "عنوان الفرع الرئيسي", reply: `عنواننا: ${addr}`, addressText: addr, mapsUrl: url }), pin);
});

run("branch talk: the saved link is one place, so no pin where another branch is in play", () => {
  // 14/11: the bot offered "فرع في شارع الطاقة بحدائق الأهرام" to four far-away patients. The next
  // "ابعتلي اللوكيشن" must not get the main clinic's pin under the other branch's address...
  assert.equal(locationPinLine({ asked: "ابعتلي اللوكيشن", reply: "ده عنوان فرع حدائق الأهرام: شارع الطاقة", addressText: addr, mapsUrl: url }), "");
  // ...nor under a bare "here it is" right after that offer (both bubbles of it are read).
  const offer = ["فاهمة حضرتك، إحنا برضه متاح عندنا فرع في شارع الطاقة بحدائق الأهرام لو أقربلك.", "تحب أساعدك بأي استفسار تاني؟"];
  assert.equal(locationPinLine({ asked: "ابعتلي اللوكيشن", reply: "تمام 👇", addressText: addr, mapsUrl: url, before: offer }), "");
  assert.equal(locationPinLine({ asked: "ابعتلي اللوكيشن", reply: "تمام 👇", addressText: addr, mapsUrl: url, before: [...offer].reverse() }), "");
  // The real 09:32 and 09:35 turns: what they answered names no branch, so the pin goes.
  const askName = "تمام 👍\n\nأهلاً بيك 🙏 عشان أسجل الحجز باسمك، ابعتلي اسمك الكامل.";
  const at0930 = "العيادة في مدينة نصر، عند مساكن شروق النادي الأهلي في شارع الرحمة (شارع أبو بكر).\n\nتحب نسجل حجزك السبت الساعة 3:00 العصر ولا الأحد الساعة 3:00 العصر؟";
  assert.equal(locationPinLine({ asked: "Okay.. الأحد.. 15 نوفمبر الحالي الساعة 3 عصرا وألف شكر.. امكانية تبعتلي اللوكيشن..", reply: askName, addressText: addr, mapsUrl: url, before: at0930 }), pin);
  assert.equal(locationPinLine({ asked: "تم أعلاه.. في انتظار اللوكيش", reply: askName, addressText: addr, mapsUrl: url, before: "أهلاً بيك 🙏 عشان أسجل الحجز باسمك، ابعتلي اسمك الكامل." }), pin);
});

run("a reply that promises the link gets it, even when the patient's words were not recognised", () => {
  assert.ok(!asksForLocation("انتو في انهي حته"));
  assert.equal(locationPinLine({ asked: "انتو في انهي حته", reply: `العيادة في مدينة نصر، وده اللوكيشن 👇`, addressText: addr, mapsUrl: url }), pin);
  assert.equal(locationPinLine({ asked: "هو ايه اللي بيحصل؟", reply: "حجزتلك الأحد 3:00 عصراً، والاستقبال هيبعتلك اللوكيشن حالاً.", addressText: addr, mapsUrl: url }), pin);
  assert.equal(locationPinLine({ asked: "where exactly?", reply: "Here's our location 👇", addressText: addr, mapsUrl: url }), pin);
  // Nothing about the place on either side: nothing, exactly as before.
  assert.equal(locationPinLine({ asked: "التنظيف بكام", reply: "التنظيف بيبدأ من 300 ج.م", addressText: addr, mapsUrl: url }), "");
  // The promise with the link already in it, or no link saved: nothing added.
  assert.equal(locationPinLine({ asked: "x", reply: `وده اللوكيشن ${url}`, addressText: addr, mapsUrl: url }), "");
  assert.equal(locationPinLine({ asked: "x", reply: "وده اللوكيشن 👇", addressText: addr, mapsUrl: "" }), "");
});

run("an explicit 'send it' beside a polite later still asks; the area question counts", () => {
  for (const s of ["ماشي ابعتلي اللوكيشن وهبلغك", "بعدين ابعتلي العنوان", "من فضلكم في اي منطقة..", "فين مكان العيادة"]) assert.ok(asksForLocation(s), s);
  // Still a no: the address named to refuse it.
  for (const s of ["لا العنوان بعيد عليا", "العنوان بعيد", "بعيد عليا"]) assert.ok(!asksForLocation(s), s);
});

run("messages sent together: an earlier line that asked still counts", () => {
  assert.equal(locationPinLine({ asked: ["والتنظيف بكام", "العنوان"], reply: "التنظيف 300", addressText: addr, mapsUrl: url }), pin);
  assert.equal(locationPinLine({ asked: ["والتنظيف بكام", "تمام"], reply: "التنظيف 300", addressText: addr, mapsUrl: url }), "");
});

run("Asnany: its pasted field keeps both links; a link the model already sent is not repeated", () => {
  const asnA = "العنوان ٣٠٠أ - شارع الثروة المعدنيه - حدائق الاهرام - البوابة الاولي - بجوار بافلو برجر - الدور الارضي";
  const asnF = `${asnA}\nhttps://maps.app.goo.gl/oE2Wjch6x9BxjGf38?g_st=ac\n\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8?g_st=ic`;
  assert.equal(locationPinLine({ asked: "ابعتلي اللوكيشن", reply: "العنوان…\n\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8", addressText: asnA, mapsUrl: asnF }), "");
  assert.equal(
    locationPinLine({ asked: "ابعتلي اللوكيشن", reply: "عنواننا", addressText: asnA, mapsUrl: asnF }),
    `${LOCATION_PIN_LABEL}\nhttps://maps.app.goo.gl/oE2Wjch6x9BxjGf38?g_st=ac\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8?g_st=ic`
  );
});

run("the engine: a location word at the name step is never a name; a menu clinic answers it with the link", () => {
  const ctx = { clinicName: "X", addressText: addr, facts: { mapsUrl: url }, canRegister: true, canOfferBooking: false } as BotContext;
  for (const aiFirst of [true, false]) {
    for (const t of ["الموقع", "اللوكيش"]) {
      const d = decideBotReply({ state: "booking_name", text: t, ctx: { ...ctx, aiFirst, aiAvailable: aiFirst } });
      assert.notEqual(d.reason, "registered", `${t} (aiFirst ${aiFirst})`);
    }
  }
  // A real name is still a name.
  assert.equal(decideBotReply({ state: "booking_name", text: "خميس الحلواني", ctx: { ...ctx, aiFirst: false, aiAvailable: false } }).reason, "registered");
  for (const t of ["اللوكيش", "الموقع", "موقعكم فين"]) {
    const m = decideBotReply({ state: "awaiting_choice", text: t, ctx: { ...ctx, aiFirst: false, aiAvailable: false } });
    assert.equal(m.reason, "location", t);
    assert.ok(m.reply.includes(url), t);
    // ...and the pin adds nothing to it.
    assert.equal(locationPinLine({ asked: t, reply: m.reply, addressText: addr, mapsUrl: url }), "", t);
  }
  // Sales mode: still the model's question to answer.
  assert.equal(decideBotReply({ state: "awaiting_choice", text: "اللوكيش", ctx: { ...ctx, aiFirst: true, aiAvailable: true } }).action?.type, "ai");
});

run("the prompt is told a link exists, never the URL, and is never told not to write one", () => {
  const row = factLines({ mapsUrl: url });
  assert.match(row, /لينك اللوكيشن/);
  assert.ok(!row.includes(url));
  assert.ok(!/متكتبش/.test(row));
  assert.ok(!/\d/.test(row), "no digits: the number guard is unchanged");
  // No link saved, or words only: no row, the prompt is unchanged.
  assert.equal(factLines({}), "");
  assert.equal(factLines({ mapsUrl: "  " }), "");
  assert.equal(factLines({ mapsUrl: "بجوار المترو" }), "");
});

run("an English chat reads the label in English", () => {
  assert.equal(localizeOutbound(`Our address is here\n\n${pin}`).text, `Our address is here\n\n📍 The clinic on Google Maps:\n${url}`);
});

run("wiring: one place in respond.ts, after the sales close and before the photo line", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/bot/respond.ts"), "utf8");
  const at = src.indexOf("locationPinLine({");
  assert.ok(at > 0, "respond.ts adds the pin");
  assert.equal(src.indexOf("locationPinLine({", at + 1), -1, "exactly once");
  assert.ok(at > src.indexOf("appendLine(closingLine("), "after the closing line");
  assert.ok(at < src.indexOf("let trailerBubble"), "before the photo trailer, localize and the send");
  assert.ok(at < src.indexOf("localizeOutbound(replyText"), "localized with the rest");
  assert.match(src.slice(at - 200, at), /reason !== "ai_unavailable"/, "not under 'send it again'");
  assert.match(src.slice(at, at + 200), /asked: \[text, \.\.\.askedTogether\]/, "messages sent together count");
  assert.match(src.slice(at, at + 300), /before: answeredTurn/, "the turn being answered is read for branch talk");
  assert.match(src, /answeredTurn\.push\(/, "and it is collected from the thread");
});

console.log("locationPin: ok");
