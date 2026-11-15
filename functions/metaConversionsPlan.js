/**
 * Which Meta conversion events one appointment write should queue — the pure half of the
 * Firebase trigger in metaConversions.js.
 *
 * This file requires nothing on purpose. The web app's test suite loads it directly and runs the
 * same status table through it and through `conversionTriggers` in src/lib/metaConversions.ts:
 * the two copies exist because Cloud Functions cannot import the web app's TypeScript, and the
 * parity test is what stops them drifting apart. Change one, change the other, run the test.
 *
 * Nothing here talks to Firestore or to Meta. It answers one question — "this appointment went
 * from that to this; which events does that mean, under which ids, due when?" — and the trigger
 * does the writing. The web cron does the sending.
 */

/** booked → LeadSubmitted, confirmed → QualifiedLead, visited → Purchase. Same as the web copy. */
const TRIGGER_EVENT = Object.freeze({
  booked: "LeadSubmitted",
  confirmed: "QualifiedLead",
  visited: "Purchase",
});

/**
 * How long a visit waits before its Purchase may go out. We send ONE Purchase per visit and it
 * must already carry the day's charges: Meta does NOT deduplicate Business Messaging events by
 * event_id, so a second "corrected" Purchase would be counted as another sale. Three hours lets
 * the dentist enter the day's treatments so the value Meta learns from is the real one, not zero.
 */
const PURCHASE_SETTLE_MS = 3 * 60 * 60 * 1000;

/** Statuses that mean the patient physically came in. The first one reached is the visit. */
const VISITED_STATUSES = Object.freeze(["Checked In", "In Chair", "Checking Out", "Completed"]);

/**
 * Legacy spellings still found on old rows (see appointmentStages.ts, which maps the same ones).
 * "In Progress" was only ever a filter option, but a row that carries it is a patient in the chair.
 * Same table as the web copy — the parity test runs an "In Progress" row through both.
 */
const STATUS_ALIASES = Object.freeze({ Arrived: "Checked In", Seated: "In Chair", "In Progress": "In Chair", Pending: "Scheduled" });

/**
 * A booking that is over without the patient coming credits nothing. "Rescheduled" is the marker
 * left on the old slot when a booking moves — the visit lives on in the new appointment.
 */
const DEAD_STATUSES = new Set(["Cancelled", "No Show", "Rescheduled"]);

function canon(status) {
  const s = typeof status === "string" ? status.trim() : "";
  if (!s) return "";
  return STATUS_ALIASES[s] || s;
}

const isVisited = (s) => VISITED_STATUSES.includes(s);

/**
 * Which conversion moments one appointment write represents. An exact twin of
 * `conversionTriggers` in src/lib/metaConversions.ts, kept equal by the parity test in
 * tests/metaConversions.test.mts.
 *
 * `before` is null for a newly created appointment, `after` null for a deleted one. A new booking
 * is "booked"; a booking made already confirmed (the bot's auto-confirm, or the desk picking
 * Confirmed in the popup) is both "booked" and "confirmed". Reaching any visited stage from a
 * non-visited one is "visited" — Checked In → In Chair → Completed is one visit, not three, and
 * the event id makes sure only the first is ever queued.
 *
 * A new appointment carrying `rescheduledFromId` is a booking that MOVED, not a new lead: the
 * original booking was already the lead, so it is not "booked" again.
 */
function conversionTriggers(before, after) {
  if (!after) return [];
  const a = canon(after.status) || "Scheduled";
  if (DEAD_STATUSES.has(a)) return [];
  const out = [];
  const b = before ? canon(before.status) || "Scheduled" : null;
  const isReschedule = typeof after.rescheduledFromId === "string" && after.rescheduledFromId.trim() !== "";
  if (b === null && !isReschedule) out.push("booked");
  if (a === "Confirmed" && b !== "Confirmed") out.push("confirmed");
  if (isVisited(a) && !(b && isVisited(b))) out.push("visited");
  return out;
}

/** The idempotency key: one event of each kind per appointment, ever. Also the queue doc id. */
function conversionEventId(appointmentId, eventName) {
  return `${appointmentId}_${eventName}`;
}

/** When a queued event is first due. Purchases wait for the visit's charges to be entered. */
function firstDueAt(trigger, eventTimeMs) {
  return trigger === "visited" ? eventTimeMs + PURCHASE_SETTLE_MS : eventTimeMs;
}

/** Firestore Timestamp, Date, epoch ms or ISO string → epoch ms (0 when unreadable). */
function toMillis(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (v && typeof v === "object") {
    if (typeof v.toMillis === "function") {
      const t = v.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    const sec = typeof v.seconds === "number" ? v.seconds : typeof v._seconds === "number" ? v._seconds : NaN;
    if (Number.isFinite(sec)) return sec * 1000;
  }
  return 0;
}

/**
 * The queue documents one appointment write should create, as plain `{ id, data }` pairs.
 *
 * The event time of a booking is when the appointment was created (so a trigger delivered late
 * still reports the real moment), falling back to now; a confirmation or a visit happens at the
 * moment the status changed, which is now. Nothing here decides whether the patient came from an
 * ad: the sender looks for a click when the event is due, and only a click at or before the event
 * counts (a click after a booking did not cause it).
 *
 * Every field is defined: Firestore rejects a write that carries an undefined value.
 */
function planConversionEvents({ clinicId, appointmentId, before, after, nowMs }) {
  const triggers = conversionTriggers(before || null, after || null);
  if (!triggers.length) return [];
  const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  const patientId = after && typeof after.patientId === "string" && after.patientId.trim() ? after.patientId.trim() : null;
  return triggers.map((trigger) => {
    const eventName = TRIGGER_EVENT[trigger];
    const eventId = conversionEventId(appointmentId, eventName);
    const eventTimeMs = trigger === "booked" ? toMillis(after && after.createdAt) || now : now;
    return {
      id: eventId,
      data: {
        clinicId,
        appointmentId,
        patientId,
        trigger,
        eventName,
        eventId,
        eventTimeMs,
        status: "pending",
        dueAt: firstDueAt(trigger, eventTimeMs),
        attempts: 0,
      },
    };
  });
}

module.exports = {
  TRIGGER_EVENT,
  PURCHASE_SETTLE_MS,
  VISITED_STATUSES,
  conversionTriggers,
  conversionEventId,
  firstDueAt,
  toMillis,
  planConversionEvents,
};
