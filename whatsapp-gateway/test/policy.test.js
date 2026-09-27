import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, dailyProactiveCap, inSendWindow, nextWindowOpen, zonedParts } from "../src/policy.js";

const CAIRO = { tz: "Africa/Cairo", startHour: 10, endHour: 22 };

test("the window is 10:00–22:00 Cairo time, whatever the server's clock says", () => {
  // 2026-09-27 is Cairo summer time (UTC+3): 06:30Z = 09:30 Cairo, 07:00Z = 10:00 Cairo.
  assert.equal(inSendWindow(new Date("2026-09-27T06:30:00Z"), CAIRO), false);
  assert.equal(inSendWindow(new Date("2026-09-27T07:00:00Z"), CAIRO), true);
  assert.equal(inSendWindow(new Date("2026-09-27T18:59:00Z"), CAIRO), true); // 21:59 Cairo
  assert.equal(inSendWindow(new Date("2026-09-27T19:00:00Z"), CAIRO), false); // 22:00 Cairo
  // Winter (UTC+2): 08:00Z = 10:00 Cairo.
  assert.equal(inSendWindow(new Date("2026-12-10T07:59:00Z"), CAIRO), false);
  assert.equal(inSendWindow(new Date("2026-12-10T08:00:00Z"), CAIRO), true);
});

test("a message held at night waits for 10:00 the next morning, Cairo time", () => {
  const lateEvening = new Date("2026-09-27T20:15:00Z"); // 23:15 Cairo
  const open = nextWindowOpen(lateEvening, CAIRO);
  assert.equal(zonedParts(open, CAIRO.tz).hour, 10);
  assert.equal(zonedParts(open, CAIRO.tz).day, 28);

  const earlyMorning = new Date("2026-09-27T04:00:00Z"); // 07:00 Cairo — same day
  const sameDay = nextWindowOpen(earlyMorning, CAIRO);
  assert.equal(zonedParts(sameDay, CAIRO.tz).hour, 10);
  assert.equal(zonedParts(sameDay, CAIRO.tz).day, 27);
});

test("a fresh number starts at 20 first-contacts a day and grows to the ceiling", () => {
  const rule = { base: 20, growth: 1.5, max: 200 };
  assert.equal(dailyProactiveCap(0, rule), 20);
  assert.equal(dailyProactiveCap(1, rule), 30);
  assert.equal(dailyProactiveCap(3, rule), 67);
  assert.equal(dailyProactiveCap(6, rule), 200);
  assert.equal(dailyProactiveCap(30, rule), 200);
});

test("a chat that wrote in within 24h gets replies; older or never is proactive", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(classify(now.getTime() - 3600_000, now), "reply");
  assert.equal(classify(now.getTime() - 25 * 3600_000, now), "proactive");
  assert.equal(classify(undefined, now), "proactive");
});
