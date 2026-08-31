/**
 * Push notifications, phase 1: the pushes that reach the right person at the
 * right moment instead of everybody at once.
 *
 *  - A patient checking in pushes the treating dentist, and only them.
 *  - 07:30: each dentist gets their own day; owners and reception get the
 *    clinic's shape.
 *  - 10:00: reception is told how many lead follow-ups are due today.
 *  - 21:00: owners get the day's money and attendance in one line.
 *  - 11:00: owners are told when messages to patients have stopped going out.
 *
 * All of it flows through sendClinicPush's targeting: roles, single uids, a
 * notification channel the phone can mute per-category, and a `screen` hint the
 * app uses to open the right page on tap.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { DateTime } = require("luxon");
const { getFirestore } = require("firebase-admin/firestore");
const { sendClinicPush } = require("./clinicPush");

const TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";

/** This project's database is literally named "default" — see firebase.json. */
const db = () => getFirestore(admin.app(), "default");

const todayKey = () => DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM-dd");

/** "Arrived" is the older vocabulary for "Checked In"; both mean in the waiting room. */
const isCheckedIn = (status) => status === "Checked In" || status === "Arrived";

const FINISHED = new Set(["Completed", "Cancelled", "No Show"]);

/** A message still waiting this long is not "about to be sent", it is stuck. */
const STUCK_MESSAGE_HOURS = 3;

async function allClinicIds() {
  const snap = await db().collection("clinics").get();
  return snap.docs.map((doc) => doc.id);
}

/**
 * The outbox writes `createdAt` as an ISO string from the server and as a Timestamp from other
 * paths. Read both rather than trusting either — a row whose age cannot be read is treated as
 * new, so an unparseable date can never manufacture an alert.
 */
function ageHours(createdAt) {
  let ms = 0;
  if (createdAt && typeof createdAt.toMillis === "function") ms = createdAt.toMillis();
  else if (typeof createdAt === "string") ms = Date.parse(createdAt);
  if (!ms || Number.isNaN(ms)) return 0;
  return (Date.now() - ms) / 3600000;
}

// ---------------------------------------------------------------------------
// 11:00 — messages that never left the building.
//
// A clinic whose gateway has died does not find out from the gateway. It finds out weeks later,
// from a patient who says nobody ever confirmed their appointment. Every send path here already
// falls back to "queued for a human" rather than losing the message, which is the right failure —
// but the queue is silent, and a silent queue is indistinguishable from a working one.
//
// Found the hard way: one clinic had 22 messages waiting, the oldest four days old, its Wapilot
// instance returning INSTANCE_NOT_FOUND on every send, and nothing anywhere said so.
// ---------------------------------------------------------------------------

exports.stuckMessagesAlert = onSchedule(
  { schedule: "0 11 * * *", timeZone: TIMEZONE, timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    for (const clinicId of await allClinicIds()) {
      try {
        const snap = await db()
          .collection(`clinics/${clinicId}/whatsapp_outbox`)
          .where("status", "==", "queued")
          .get();
        if (snap.empty) continue;

        const ages = snap.docs.map((d) => ageHours(d.data()?.createdAt));
        const stuck = ages.filter((h) => h >= STUCK_MESSAGE_HOURS);
        if (stuck.length === 0) continue; // a normal manual queue being worked through today

        const oldest = Math.max(...stuck);
        const days = Math.floor(oldest / 24);
        const oldestLabel = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(oldest)} hours`;

        await sendClinicPush(
          db(),
          clinicId,
          {
            title: `📵 ${stuck.length} message${stuck.length === 1 ? "" : "s"} to patients never sent`,
            body:
              `The oldest has been waiting ${oldestLabel}. If nobody is sending them by hand, ` +
              `WhatsApp sending is switched off or the connection is broken — check Settings → WhatsApp.`,
          },
          // The people who can actually fix a dead gateway, not the ones staring at the queue.
          { roles: ["Owner", "Admin"], channel: "alpha_leads", data: { screen: "settings" } }
        );
      } catch (e) {
        console.error(`stuckMessagesAlert failed for ${clinicId}:`, e);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Patient arrived → the treating dentist's pocket.
// ---------------------------------------------------------------------------

exports.onPatientCheckedIn = onDocumentUpdated(
  {
    document: "clinics/{clinicId}/appointments/{appointmentId}",
    database: "default",
    timeoutSeconds: 60,
  },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      if (!before || !after) return;
      if (isCheckedIn(before.status) || !isCheckedIn(after.status)) return;

      const clinicId = event.params.clinicId;

      // The settings toggle is respected: absent means on (the feature works out
      // of the box), an explicit false means the clinic turned it off.
      const clinicSnap = await db().collection("clinics").doc(clinicId).get();
      const pref = clinicSnap.data()?.alertPreferences?.inApp?.patientArrival;
      if (pref === false) return;

      // The dentist is found by the appointment's doctorId (a staff doc id),
      // falling back to the name — appointments written by hand carry only that.
      const staffSnap = await db().collection(`clinics/${clinicId}/staff`).get();
      const doctorName = String(after.doctor || "").trim().toLowerCase();
      const match = staffSnap.docs.find((doc) => {
        if (after.doctorId && doc.id === after.doctorId) return true;
        const name = String(doc.data()?.name || "").trim().toLowerCase();
        return doctorName && name && (name === doctorName || name.includes(doctorName) || doctorName.includes(name));
      });
      const uid = String(match?.data()?.uid || "").trim();
      // No dentist to tell is a skip, not a broadcast — reception already knows,
      // they are the ones who tapped Checked In.
      if (!uid) return;

      const patient = String(after.patientName || "A patient").trim() || "A patient";
      const detail = [after.time, after.treatment].filter(Boolean).join(" · ");
      await sendClinicPush(
        db(),
        clinicId,
        {
          title: `${patient} has arrived`,
          body: detail ? `In the waiting room · ${detail}` : "In the waiting room",
        },
        { uids: [uid], channel: "alpha_arrivals", data: { screen: "day" } }
      );
    } catch (e) {
      console.error("onPatientCheckedIn failed:", e);
    }
  }
);

// ---------------------------------------------------------------------------
// A slot just freed → the desk, while there is still time to fill it.
// ---------------------------------------------------------------------------

exports.onSlotFreed = onDocumentUpdated(
  {
    document: "clinics/{clinicId}/appointments/{appointmentId}",
    database: "default",
    timeoutSeconds: 60,
  },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      if (!before || !after) return;

      const freeing = new Set(["Cancelled", "No Show"]);
      if (freeing.has(before.status) || !freeing.has(after.status)) return;

      // A past appointment cancelling is bookkeeping; only today and the future
      // are slots somebody could still fill.
      const date = String(after.date || "");
      if (!date || date < todayKey()) return;

      const clinicId = event.params.clinicId;
      const patient = String(after.patientName || "A patient").trim() || "A patient";
      const whenLabel = date === todayKey() ? "today" : date;
      const slot = [after.time, whenLabel].filter(Boolean).join(" ");
      const what = after.status === "No Show" ? "did not show" : "cancelled";

      await sendClinicPush(
        db(),
        clinicId,
        {
          title: `${slot || "A slot"} just freed`,
          body: `${patient} ${what}${after.doctor ? ` · Dr. ${after.doctor}` : ""} — the waitlist or a due lead could take it.`,
        },
        { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
      );
    } catch (e) {
      console.error("onSlotFreed failed:", e);
    }
  }
);

// ---------------------------------------------------------------------------
// Stock crossing its reorder line → the people who order.
// ---------------------------------------------------------------------------

exports.onLowStock = onDocumentUpdated(
  {
    document: "clinics/{clinicId}/inventory/{itemId}",
    database: "default",
    timeoutSeconds: 60,
  },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      if (!before || !after) return;

      // minStock of 0 means "never configured", not "alert at empty" — the same
      // rule every low-stock view in the system applies.
      const min = Number(after.minStock) || 0;
      if (min <= 0) return;

      const was = Number(before.stock) || 0;
      const now = Number(after.stock) || 0;
      // Fires only on the crossing, so topping up and dipping again re-arms it
      // but hovering below the line does not nag on every small adjustment.
      if (!(was > min && now <= min)) return;

      const clinicId = event.params.clinicId;
      const name = String(after.name || "An item").trim() || "An item";
      const unit = after.isPercentage ? "%" : "";

      await sendClinicPush(
        db(),
        clinicId,
        {
          title: `${name} is running low`,
          body: `${now}${unit} left · reorder point is ${min}${unit}.`,
        },
        { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_clinic", data: { screen: "inventory" } }
      );
    } catch (e) {
      console.error("onLowStock failed:", e);
    }
  }
);

// ---------------------------------------------------------------------------
// 07:30 — the morning brief, per role.
// ---------------------------------------------------------------------------

exports.morningBrief = onSchedule(
  { schedule: "30 7 * * *", timeZone: TIMEZONE, timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    const date = todayKey();
    for (const clinicId of await allClinicIds()) {
      try {
        const apptSnap = await db()
          .collection(`clinics/${clinicId}/appointments`)
          .where("date", "==", date)
          .get();
        const appts = apptSnap.docs.map((d) => d.data()).filter((a) => !FINISHED.has(a.status));
        // A day with nothing booked is not worth a 07:30 buzz.
        if (appts.length === 0) continue;

        const firstTime = appts.map((a) => String(a.time || "")).filter(Boolean).sort()[0];

        // Owners and reception: the clinic's shape.
        await sendClinicPush(
          db(),
          clinicId,
          {
            title: "Today at the clinic",
            body: `${appts.length} booked${firstTime ? ` · first at ${firstTime}` : ""}`,
          },
          { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_reminders", data: { screen: "day" } }
        );

        // Each dentist: their own list, matched the way the app matches it —
        // by doctorId when the appointment has one, by name otherwise.
        const staffSnap = await db().collection(`clinics/${clinicId}/staff`).get();
        const dentists = staffSnap.docs.filter(
          (doc) => String(doc.data()?.role || "") === "Dentist" && String(doc.data()?.uid || "").trim()
        );
        for (const dentist of dentists) {
          const name = String(dentist.data()?.name || "").trim().toLowerCase();
          const mine = appts.filter((a) => {
            if (a.doctorId && a.doctorId === dentist.id) return true;
            const doc = String(a.doctor || "").trim().toLowerCase();
            return doc && name && (name === doc || name.includes(doc) || doc.includes(name));
          });
          if (mine.length === 0) continue;
          const myFirst = mine.map((a) => String(a.time || "")).filter(Boolean).sort()[0];
          await sendClinicPush(
            db(),
            clinicId,
            {
              title: "Your day",
              body: `${mine.length} patient${mine.length === 1 ? "" : "s"}${myFirst ? ` · first at ${myFirst}` : ""}`,
            },
            { uids: [String(dentist.data().uid).trim()], channel: "alpha_reminders", data: { screen: "day" } }
          );
        }
      } catch (e) {
        console.error(`morningBrief failed for ${clinicId}:`, e);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// 10:00 — lead follow-ups due, to the people who work the inbox.
// ---------------------------------------------------------------------------

exports.leadsDueToday = onSchedule(
  { schedule: "0 10 * * *", timeZone: TIMEZONE, timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    const date = todayKey();
    for (const clinicId of await allClinicIds()) {
      try {
        const snap = await db()
          .collection(`clinics/${clinicId}/leads`)
          .where("followUpDate", "<=", date)
          .get();
        const due = snap.docs
          .map((d) => d.data())
          .filter((l) => l.followUpDate && l.stage !== "won" && l.stage !== "lost");
        if (due.length === 0) continue;

        const named = due
          .map((l) => String(l.name || "").trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        await sendClinicPush(
          db(),
          clinicId,
          {
            title: `${due.length} lead follow-up${due.length === 1 ? "" : "s"} due`,
            body: named ? `Waiting on a call: ${named}${due.length > 3 ? "…" : ""}` : "Open the Leads inbox to work through them.",
          },
          { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_leads", data: { screen: "leads" } }
        );
      } catch (e) {
        console.error(`leadsDueToday failed for ${clinicId}:`, e);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// 21:00 — the owner's evening digest: the three numbers they check anyway.
// ---------------------------------------------------------------------------

exports.eveningDigest = onSchedule(
  { schedule: "0 21 * * *", timeZone: TIMEZONE, timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    const date = todayKey();
    for (const clinicId of await allClinicIds()) {
      try {
        const [ledgerSnap, apptSnap] = await Promise.all([
          db().collection(`clinics/${clinicId}/ledger`).where("date", "==", date).get(),
          db().collection(`clinics/${clinicId}/appointments`).where("date", "==", date).get(),
        ]);

        // Cash basis, same as everywhere: what actually came through the door.
        let collected = 0;
        ledgerSnap.forEach((doc) => {
          const d = doc.data();
          if (d.type !== "payment") return;
          collected += Number(d.paid ?? d.amount ?? 0) || 0;
        });

        let seen = 0;
        let noShows = 0;
        apptSnap.forEach((doc) => {
          const status = doc.data().status;
          if (status === "Completed" || status === "Checking Out") seen += 1;
          if (status === "No Show") noShows += 1;
        });

        // A day the clinic did not work is not worth a 21:00 buzz.
        if (collected === 0 && apptSnap.size === 0) continue;

        const parts = [`+${Math.round(collected).toLocaleString()} EGP`, `${seen} seen`];
        if (noShows > 0) parts.push(`${noShows} no-show${noShows === 1 ? "" : "s"}`);
        await sendClinicPush(
          db(),
          clinicId,
          { title: "Today, closed out", body: parts.join(" · ") },
          { roles: ["Owner", "Admin"], channel: "alpha_money", data: { screen: "money" } }
        );
      } catch (e) {
        console.error(`eveningDigest failed for ${clinicId}:`, e);
      }
    }
  }
);
