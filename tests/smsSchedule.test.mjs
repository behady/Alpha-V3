// When a text message is allowed to leave the phone, and which messages exist at all.
//
// Worth testing because the whole "send reminders at 2pm" feature rests on one instant computed on
// the server and honoured on a handset, and because getting it wrong is invisible: nobody notices
// a reminder that went out at 6am until a patient complains about being woken up, and nobody
// notices a cancellation that was held until 2pm until somebody drives to a closed clinic.
import assert from "node:assert/strict";
import { instantAtHourInTimeZone } from "../src/lib/clinicDate.ts";
import { isDue, sendAfterFor } from "../src/lib/sms/schedule.ts";
import {
  DEFAULT_SMS_TEMPLATES,
  MAX_SEND_HOUR,
  MIN_SEND_HOUR,
  SMS_EVENT_TYPES,
  clampSendHour,
  isScheduledEvent,
  isSmsEventEnabled,
  measureSms,
  parseSmsSettings,
} from "../src/lib/sms/config.ts";

const CAIRO = "Africa/Cairo";

// --- the clinic's chosen hour, resolved to a real instant ---------------------------------------

// Egypt runs summer time again since 2023: +03 in August, +02 in January. A hardcoded offset would
// put every reminder an hour out for half the year.
{
  const summer = instantAtHourInTimeZone(CAIRO, 14, new Date("2026-08-14T03:00:00Z"));
  assert.equal(summer.toISOString(), "2026-08-14T11:00:00.000Z", "2pm Cairo in August is 11:00 UTC");

  const winter = instantAtHourInTimeZone(CAIRO, 14, new Date("2026-01-14T03:00:00Z"));
  assert.equal(winter.toISOString(), "2026-01-14T12:00:00.000Z", "2pm Cairo in January is 12:00 UTC");
}

// The date is taken in the clinic's timezone, not UTC. Just after midnight in Cairo it is still
// "yesterday" in UTC, and a reminder filed under the wrong day goes out twice or not at all.
{
  const justAfterCairoMidnight = new Date("2026-08-13T21:30:00Z"); // 00:30 on the 14th in Cairo
  const due = instantAtHourInTimeZone(CAIRO, 10, justAfterCairoMidnight);
  assert.equal(due.toISOString(), "2026-08-14T07:00:00.000Z", "10am on the Cairo date, not the UTC date");
}

// --- which events wait, and which do not --------------------------------------------------------

{
  const settings = parseSmsSettings({ sendHour: 14 });
  const dawn = new Date("2026-08-14T03:00:00Z"); // the sweep, 06:00 in Cairo

  assert.equal(
    sendAfterFor("reminder24h", settings, dawn),
    "2026-08-14T11:00:00.000Z",
    "a reminder queued at dawn is held until the hour the clinic picked"
  );

  for (const type of ["new", "edit", "cancel", "invoice"]) {
    assert.equal(
      sendAfterFor(type, settings, dawn),
      undefined,
      `${type} is a reaction to something that just happened and must not be held`
    );
    assert.equal(isScheduledEvent(type), false);
  }
  assert.equal(isScheduledEvent("reminder24h"), true);
}

// An hour that has already gone by means "now", not "tomorrow". A clinic set to 8am that books
// something at noon wants the text today.
{
  const settings = parseSmsSettings({ sendHour: 8 });
  const noon = new Date("2026-08-14T10:00:00Z"); // 13:00 in Cairo, well past 8am
  assert.equal(sendAfterFor("reminder24h", settings, noon), undefined, "a passed hour releases immediately");
}

// --- the phone's side of the gate ---------------------------------------------------------------

{
  const now = Date.parse("2026-08-14T11:00:00Z");

  assert.equal(isDue({}, now), true, "no stamp means send now");
  assert.equal(isDue({ sendAfter: "2026-08-14T10:59:59Z" }, now), true);
  assert.equal(isDue({ sendAfter: "2026-08-14T11:00:00Z" }, now), true, "due exactly now is due");
  assert.equal(isDue({ sendAfter: "2026-08-14T11:00:01Z" }, now), false, "one second early is still early");

  // Failing open on nonsense: a message stranded by a malformed timestamp is a patient who is
  // never told anything, with nothing on screen to explain why.
  assert.equal(isDue({ sendAfter: "not a date" }, now), true, "an unparseable stamp must not strand the message");
  assert.equal(isDue({ sendAfter: "" }, now), true);
}

// --- the hour is clamped to something the sweep can honour ---------------------------------------

{
  assert.equal(clampSendHour(14), 14);
  assert.equal(clampSendHour(3), MIN_SEND_HOUR, "before the sweep runs, so it could not be honoured today");
  assert.equal(clampSendHour(23), MAX_SEND_HOUR);
  assert.equal(clampSendHour("14"), 14);
  assert.equal(clampSendHour(undefined), 10, "the default is mid-morning");
  assert.equal(clampSendHour("nonsense"), 10);
  assert.ok(MIN_SEND_HOUR >= 6, "the sweep runs at 03:00 UTC, which is 05:00 or 06:00 in Cairo");
}

// --- settings migration --------------------------------------------------------------------------

// A clinic that configured SMS before per-event templates existed has one hand-edited `template`
// field. Replacing it with the default would silently rewrite a message they chose.
{
  const legacy = parseSmsSettings({ enabled: true, reminderChannel: "sms", template: "نصي أنا" });
  assert.equal(legacy.templates.reminder24h, "نصي أنا", "the clinic's own reminder body survives the upgrade");
  assert.equal(legacy.templates.cancel, DEFAULT_SMS_TEMPLATES.cancel, "events they never saw get the defaults");
  assert.equal(legacy.sendHour, 10);
}

// Turning the master switch on must not start charging for four new kinds of message.
{
  const fresh = parseSmsSettings({ enabled: true, reminderChannel: "sms" });
  assert.equal(fresh.events.reminder24h, true, "the reminder is what the feature is for");
  for (const type of ["new", "edit", "cancel", "invoice"]) {
    assert.equal(fresh.events[type], false, `${type} must be opted into deliberately`);
  }
}

// An explicit false is honoured; only an absent value falls back to the default.
{
  const off = parseSmsSettings({ events: { reminder24h: false, cancel: true } });
  assert.equal(off.events.reminder24h, false, "switching the reminder off must stick");
  assert.equal(off.events.cancel, true);
  assert.equal(off.events.new, false);
}

// The defaults must not share one object between clinics.
{
  const a = parseSmsSettings(undefined);
  const b = parseSmsSettings(undefined);
  a.events.cancel = true;
  a.templates.cancel = "changed";
  assert.equal(b.events.cancel, false, "one clinic's settings must not leak into another's");
  assert.equal(b.templates.cancel, DEFAULT_SMS_TEMPLATES.cancel);
}

// --- an event only fires when every switch agrees -------------------------------------------------

{
  const on = parseSmsSettings({ enabled: true, reminderChannel: "sms", events: { cancel: true } });
  assert.equal(isSmsEventEnabled(on, "cancel"), true);
  assert.equal(isSmsEventEnabled(on, "new"), false, "an event that is switched off does not fire");

  const whatsappOnly = parseSmsSettings({ enabled: true, reminderChannel: "whatsapp", events: { cancel: true } });
  assert.equal(isSmsEventEnabled(whatsappOnly, "cancel"), false, "the channel has to include SMS");

  const masterOff = parseSmsSettings({ enabled: false, reminderChannel: "sms", events: { cancel: true } });
  assert.equal(isSmsEventEnabled(masterOff, "cancel"), false, "the master switch overrules everything");

  assert.equal(
    isSmsEventEnabled(parseSmsSettings({ enabled: true, reminderChannel: "both", events: { cancel: true } }), "cancel"),
    true,
    "both means both"
  );
}

// --- every default body stays inside one billed message -------------------------------------------

// The point of these terse defaults. A body that spills into a second segment doubles the cost of
// every message of that kind, and nothing on screen would say so until the bill arrived.
{
  const longClinicName = "مركز ألفا لطب الأسنان";
  const values = {
    patient_name: "محمد عبد الرحمن",
    clinic_name: longClinicName,
    date: "2026-08-15",
    time: "02:30 PM",
    doctor: "أحمد",
    amount: "1,500",
    balance: "2,750",
  };

  for (const type of SMS_EVENT_TYPES) {
    const merged = DEFAULT_SMS_TEMPLATES[type].replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "—");
    const { segments, characters } = measureSms(merged);
    assert.equal(segments, 1, `the default ${type} body is ${characters} characters — over one billed message`);
  }
}

console.log("smsSchedule: all assertions passed");
