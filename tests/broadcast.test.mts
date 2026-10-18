// Patient broadcasts: the free message checks, the pace arithmetic, and the stop-word handling a
// broadcast's own "ابعت STOP" line depends on. Run with tsx.
import assert from "node:assert/strict";
import {
  BROADCAST_TEMPLATES,
  checkBroadcastMessage,
  firstNameOf,
  gatewayDailyAllowance,
  hasBlockingIssue,
  perTickRelease,
  planBroadcastDays,
  versionFor,
} from "../src/lib/broadcast/shared";
import { appendOptOutFooter, isOptOutReply, WHATSAPP_OPT_OUT_FOOTER_AR } from "../src/lib/patientMessaging";

const level = (text: string, id: string) => checkBroadcastMessage(text).find((c) => c.id === id)?.level;

// The clinic's real message: no blocks, and every "good" rule met.
const dentInn = `أهلاً أ/ {{first_name}} 🌷
معاك سهيلة من عيادة د. أحمد رشدي – DENT INN.
حبينا نبلغ حضرتك إننا افتتحنا فرعنا الجديد في التجمع الخامس، وعشان حضرتك من مرضانا ليك خصم 10% في الفرع الجديد.
📍 العنوان: ٩٠ شارع التسعين الشمالي، التجمع الخامس
لو حابب نحجزلك ميعاد ابعتلنا 1 ✅
لو مش حابب توصلك رسايل مننا تاني ابعت STOP`;
const checks = checkBroadcastMessage(dentInn);
assert.equal(hasBlockingIssue(checks), false, JSON.stringify(checks));
for (const id of ["link", "stop", "name", "reply"]) assert.equal(level(dentInn, id), "good", id);
assert.equal(level(dentInn, "salesy"), undefined, "10% is not a big discount");
assert.equal(level("خصم 50% {{first_name}}", "salesy"), "warn");

// Every starter template blocks until its brackets are filled.
for (const t of BROADCAST_TEMPLATES) {
  assert.equal(level(t.body.ar, "placeholder"), "block", t.id);
  assert.equal(level(t.body.en, "placeholder"), "block", t.id);
  const filled = t.body.ar.replace(/\[[^\]]+\]/g, "كذا");
  assert.equal(hasBlockingIssue(checkBroadcastMessage(filled)), false, `${t.id} filled`);
}

// Links block, whatever their shape.
for (const link of ["https://x.com", "www.dentinn.com", "wa.me/2010", "maps.app.goo.gl/abc", "dentinn.com"]) {
  assert.equal(level(`أهلاً {{first_name}} ${link}`, "link"), "block", link);
}
assert.equal(level("", "empty"), "block");
assert.equal(level("Hi {name}", "token"), "block", "single-brace token is not ours");
assert.equal(level("Hi {{first_name}}", "token"), undefined);

// Names.
assert.equal(firstNameOf("د. محمد علي"), "محمد");
assert.equal(firstNameOf("Mona Adel"), "Mona");
assert.equal(firstNameOf(""), "");

// Pace: the gateway curve, and a 1,250-patient list on a number linked today.
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(gatewayDailyAllowance), [20, 30, 45, 67, 101, 151, 200, 200]);
const plan = planBroadcastDays(1250, 100, null);
assert.equal(plan.reduce((a, b) => a + b, 0), 1250);
assert.deepEqual(plan.slice(0, 6), [15, 22, 33, 50, 75, 100], "warm-up leaves a quarter for reminders");
assert.ok(plan.length >= 14 && plan.length <= 17, `days: ${plan.length}`);
assert.ok(planBroadcastDays(1250, 100, 30).every((n, i, a) => n === 100 || i === a.length - 1), "an old number runs at the ceiling");
assert.equal(planBroadcastDays(0, 100, 0).length, 0);

assert.equal(perTickRelease({ leftToday: 0, minutesLeftInWindow: 300, tickMinutes: 10 }), 0);
assert.equal(perTickRelease({ leftToday: 100, minutesLeftInWindow: 0, tickMinutes: 10 }), 0);
assert.equal(perTickRelease({ leftToday: 100, minutesLeftInWindow: 660, tickMinutes: 10 }), 2);
assert.equal(perTickRelease({ leftToday: 15, minutesLeftInWindow: 660, tickMinutes: 10 }), 1);
assert.equal(perTickRelease({ leftToday: 7, minutesLeftInWindow: 5, tickMinutes: 10 }), 7, "last tick sends what is left");

assert.equal(versionFor(0, 1), 0);
assert.deepEqual([0, 1, 2, 3, 4].map((i) => versionFor(i, 3)), [0, 1, 2, 0, 1]);

// Stop handling: the Arabic spelling of STOP is a stop, and an Arabic "ابعت STOP" line means the
// system must not print a second stop line underneath it.
assert.equal(isOptOutReply("ستوب"), true);
assert.equal(isOptOutReply("STOP"), true);
assert.equal(appendOptOutFooter(dentInn, WHATSAPP_OPT_OUT_FOOTER_AR), dentInn, "own stop line is enough");
assert.ok(appendOptOutFooter("أهلاً", WHATSAPP_OPT_OUT_FOOTER_AR).endsWith(WHATSAPP_OPT_OUT_FOOTER_AR));

console.log("broadcast tests passed");

// Compound Arabic first names stay whole.
import { firstNameOf as fn } from "../src/lib/broadcast/shared";
assert.equal(fn("عبد الله محمد"), "عبد الله");
assert.equal(fn("أبو بكر سالم"), "أبو بكر");
assert.equal(fn("أحمد عبد الله"), "أحمد");
console.log("first-name tests passed");
