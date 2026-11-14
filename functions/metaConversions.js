/**
 * Queues Meta conversion events when an appointment is booked, confirmed or visited — for clinics
 * that switched "Report bookings to Meta" on. It sends nothing itself: the web app's cron
 * (/api/automation/meta-conversions, every ten minutes) picks the queue up, finds the ad click,
 * values the visit and talks to Meta. See src/lib/metaConversions.ts for the why of the feature.
 *
 * Why a trigger and not a call at each save: appointments are written from about eight places —
 * the browser's booking pop-up and calendar drags, the dentist's chair view, the WhatsApp bot,
 * the AI assistant, the MCP connector, the online booking page, imports. Only a Firestore trigger
 * sees every one of them, including the browser writes that never pass through a server at all.
 * A hook in each writer would be eight places to forget.
 *
 * Why it reads nothing on most writes: nearly every appointment write is an autosave, a drag to
 * another time or a note edit — the status does not move. The plan is worked out from the two
 * snapshots Firestore hands us, with no read at all, and only a write that is a booking, a
 * confirmation or a first arrival goes on to read the clinic's switch. A clinic that has the
 * feature off pays one small read per such moment and nothing else.
 *
 * Why create() is the dedupe: the queue doc id is `${appointmentId}_${eventName}`, and create()
 * fails with ALREADY_EXISTS when the doc is there. Firebase delivers a trigger at least once, and
 * a status can go Confirmed → Scheduled → Confirmed again; while the first row is still queued the
 * second create() fails, is swallowed, and one event goes out. That matters because Meta does NOT
 * deduplicate Business Messaging events by event_id — its docs ask partners to dedupe before
 * sending — so every copy we post is counted. Our guards are the only protection: this create(),
 * the sender's claim lock, rows that are sent once and never reopened, and the once-per-click
 * markers for leads. (The sender re-reads the appointment before sending and DELETES a row whose
 * moment was undone, so a later real confirmation or arrival can queue again here.) One residual
 * risk is stated in the sender: a request that timed out after Meta had already taken it is
 * retried, and that copy is counted too.
 *
 * The queue lives under clinic_secrets/{clinicId}/meta_conversion_events because every path under
 * clinic_secrets is denied to all clients, while anything under clinics/{id}/ is readable and
 * writable by every member of the clinic. The send log holds Meta's answers and the click ids, so
 * it stays server-only.
 *
 * Inert unless clinic_secrets/{clinicId}.metaCapi.enabled === true. Every failure is logged and
 * swallowed: a missed queue entry costs one conversion report, a throw here would only make
 * Firebase retry a write that has nothing to do with booking.
 */

const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { planConversionEvents } = require("./metaConversionsPlan");

/** This project's database is literally named "default" — see firebase.json. */
const db = () => getFirestore(admin.app(), "default");

/** gRPC ALREADY_EXISTS: this event was queued before (duplicate delivery, or a status flip back). */
function isAlreadyExists(e) {
  if (!e) return false;
  if (e.code === 6 || e.code === "already-exists" || e.code === "ALREADY_EXISTS") return true;
  return /ALREADY_EXISTS/i.test(String(e.message || ""));
}

exports.onAppointmentConversion = onDocumentWritten(
  {
    document: "clinics/{clinicId}/appointments/{appointmentId}",
    database: "default",
    // Pinned like the schedulers: a function that once existed in two regions blocked every deploy.
    region: "us-central1",
    timeoutSeconds: 60,
  },
  async (event) => {
    try {
      const before = event.data?.before?.exists ? event.data.before.data() : null;
      const after = event.data?.after?.exists ? event.data.after.data() : null;
      const clinicId = event.params.clinicId;
      const appointmentId = event.params.appointmentId;

      // Worked out from the snapshots alone — an autosave or a drag stops here without a read.
      const plan = planConversionEvents({ clinicId, appointmentId, before, after, nowMs: Date.now() });
      if (!plan.length) return;

      const secretRef = db().collection("clinic_secrets").doc(clinicId);
      const secretSnap = await secretRef.get();
      const capi = (secretSnap.exists && secretSnap.data() && secretSnap.data().metaCapi) || {};
      if (capi.enabled !== true) return;

      const queue = secretRef.collection("meta_conversion_events");
      for (const { id, data } of plan) {
        try {
          await queue.doc(id).create({
            ...data,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } catch (e) {
          if (isAlreadyExists(e)) continue;
          console.error(`onAppointmentConversion: could not queue ${id} for clinic ${clinicId}:`, e);
        }
      }
    } catch (e) {
      console.error("onAppointmentConversion failed:", e);
    }
  }
);
