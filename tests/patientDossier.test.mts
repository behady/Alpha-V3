import assert from "node:assert/strict";
import { dossierLines, type PatientDossier } from "../src/lib/bot/patientDossier";
import { isLatinMessage, localizeOutbound } from "../src/lib/bot/localize";

/**
 * The two pieces of the assistant that speak with authority: the patient's own money, and the
 * language everything fixed goes out in. Both are pure, and both are the kind of thing that is
 * embarrassing rather than merely wrong when it slips.
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

run("the file the assistant reads back is the file the desk sees", () => {
  const d: PatientDossier = {
    finance: { charged: 2400, paid: 900, balance: 1500, lastPayment: { date: "2026-09-02", amount: 500, method: "Cash" } },
    treatments: [
      { name: "حشو عصب", date: "2026-08-25" },
      { name: "خلع", date: "2026-07-30" },
    ],
    prescriptions: [{ date: "2026-08-25", items: ["Augmentin 1g — كل 12 ساعة — 5 أيام"], notes: "بعد الأكل" }],
    usualDoctor: "Mohamed Ehab",
    visits: 3,
    lastVisit: "2026-08-25",
  };
  const text = dossierLines(d);
  assert.ok(text.includes("2,400") && text.includes("900") && text.includes("1,500"), "every figure is quoted, none recomputed");
  assert.ok(text.includes("2026-09-02") && text.includes("500"), "the last payment carries its date");
  assert.ok(text.includes("Mohamed Ehab"), "the usual dentist is offered first when they book again");
  assert.ok(text.includes("Augmentin 1g — كل 12 ساعة — 5 أيام"), "a prescription is quoted verbatim, never paraphrased");
  assert.ok(text.includes("متخترعش"), "the model is told these are the only figures it may use");

  // A clinic that has never charged this patient must not produce an empty money sentence.
  const fresh = dossierLines({ treatments: [], prescriptions: [], visits: 0 });
  assert.equal(fresh, "", "a stranger's file says nothing at all");
  const noMoney = dossierLines({ treatments: [], prescriptions: [], visits: 1, lastVisit: "2026-09-01" });
  assert.ok(noMoney.includes("زار العيادة") && !noMoney.includes("الحساب"), "no invoice, no balance sentence");
});

run("a button id is not a language, and a translated reply carries its buttons with it", () => {
  // The tells that used to flip an Arabic patient into English mid-booking.
  assert.equal(isLatinMessage("m1"), false);
  assert.equal(isLatinMessage("back_menu"), false);
  assert.equal(isLatinMessage("dr|Mohamed Ehab"), false);
  assert.equal(isLatinMessage("t2026-09-08|03:30 PM|"), false);
  assert.equal(isLatinMessage("d2026-09-08|"), false);
  assert.equal(isLatinMessage("3"), false);
  assert.equal(isLatinMessage("👍"), false);
  assert.equal(isLatinMessage("عايز احجز"), false);
  // And the ones that are.
  assert.equal(isLatinMessage("hi how much is a cleaning"), true);
  assert.equal(isLatinMessage("3ayez a3raf el tanzeef bkam"), true);

  const { text, structure } = localizeOutbound("📅 اختار اليوم اللي يناسبك:\n\n*0* — رجوع للقائمة", {
    body: "📅 اختار اليوم اللي يناسبك:",
    list: {
      buttonLabel: "اختيار اليوم",
      rows: [
        { id: "d2026-09-06|", title: "الأحد 6/9" },
        { id: "d2026-09-07|", title: "الإثنين 7/9" },
      ],
    },
  });
  assert.ok(text.includes("Pick the day"), "the message text is translated");
  assert.ok(structure?.body.includes("Pick the day"), "and so is the interactive body");
  assert.equal(structure?.list?.buttonLabel, "Choose a day", "and the list's own button");
  assert.equal(structure?.list?.rows[0].title, "Sunday 6/9", "and every row, day name included");
  assert.ok(!/[؀-ۿ]/.test(JSON.stringify(structure)), "nothing Arabic survives in the structure");

  const clock = localizeOutbound("⏰ 3:30 م", undefined).text;
  assert.equal(clock, "⏰ 3:30 PM", "the clock marker reads in English too");
});

console.log("patientDossier + localize: all suites passed");
