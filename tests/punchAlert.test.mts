// What the owner reads when somebody clocks in or out.
// Run: npm run test:punch-alert
import assert from "node:assert/strict";
import { punchAlertText, shiftStartFor } from "../src/lib/alerts/punchAlert";
import { notifyEvent, resolveNotify } from "../src/lib/notificationCatalog";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log("punchAlertText");

check("clock-in, late against the shift, with the branch", () => {
  const t = punchAlertText({ direction: "in", name: "sohila ahmed", at: "14:21", shiftStart: "14:00", branch: "التجمع الخامس" });
  assert.equal(t.title, "🟢 sohila ahmed: حضور 14:21");
  assert.equal(t.body, "تأخير 21 دقيقة (الشيفت 14:00) · فرع التجمع الخامس");
});

check("clock-in on time or early says so", () => {
  assert.equal(punchAlertText({ direction: "in", name: "jana", at: "13:58", shiftStart: "14:00", branch: null }).body, "في الميعاد (الشيفت 14:00)");
  assert.equal(punchAlertText({ direction: "in", name: "jana", at: "14:00", shiftStart: "14:00", branch: null }).body, "في الميعاد (الشيفت 14:00)");
});

check("clock-in with no shift that day: just the time and the branch", () => {
  const t = punchAlertText({ direction: "in", name: "Rana", at: "10:05", shiftStart: null, branch: "مصر الجديدة" });
  assert.equal(t.title, "🟢 Rana: حضور 10:05");
  assert.equal(t.body, "فرع مصر الجديدة");
});

check("clock-out gives the hours worked in plain words", () => {
  const t = punchAlertText({ direction: "out", name: "faten", at: "22:05", shiftStart: "14:00", branch: "مصر الجديدة", durationMinutes: 7 * 60 + 44 });
  assert.equal(t.title, "🔴 faten: انصراف 22:05");
  assert.equal(t.body, "مدة الشغل 7 ساعات و44 دقيقة · فرع مصر الجديدة");
});

check("hours read naturally: one, two, a few, many, none", () => {
  const body = (m: number) => punchAlertText({ direction: "out", name: "x", at: "10:00", shiftStart: null, branch: null, durationMinutes: m }).body;
  assert.equal(body(60), "مدة الشغل ساعة");
  assert.equal(body(120 + 5), "مدة الشغل ساعتين و5 دقيقة");
  assert.equal(body(11 * 60), "مدة الشغل 11 ساعة");
  assert.equal(body(40), "مدة الشغل 40 دقيقة");
  assert.equal(body(0), "مدة الشغل أقل من دقيقة");
});

console.log("shiftStartFor");

check("reads the roster for the punch's own weekday (Sunday = 0)", () => {
  const schedule = { "1": { active: true, start: "14:00" }, "5": { active: false, start: "09:00" } };
  assert.equal(shiftStartFor(schedule, "2026-11-23"), "14:00"); // a Monday
  assert.equal(shiftStartFor(schedule, "2026-11-27"), null); // Friday, switched off
  assert.equal(shiftStartFor(schedule, "2026-11-24"), null); // Tuesday, not in the roster
  assert.equal(shiftStartFor(undefined, "2026-11-23"), null);
  assert.equal(shiftStartFor({ "1": { active: true, start: "" } }, "2026-11-23"), null);
});

console.log("catalogue");

check("off for every clinic until it is switched on; owner only; WhatsApp can be offered", () => {
  const e = notifyEvent("staffClockInOut");
  assert.ok(e, "the alert is not in the catalogue");
  assert.equal(e.bell, false);
  assert.equal(e.push, false);
  assert.ok(!e.whatsapp);
  assert.equal(e.waReady, true);
  assert.deepEqual([...e.roles], ["Owner"]);
  const r = resolveNotify("staffClockInOut", {});
  assert.ok(r && !r.bell && !r.push && !r.whatsapp, "on out of the box");
  const on = resolveNotify("staffClockInOut", { events: { staffClockInOut: { bell: true, push: true } } });
  assert.ok(on && on.bell && on.push, "a clinic's switch is not honoured");
});

console.log(`\n${passed} passed`);
