import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { notifyTiming, type AlertPreferences } from "@/lib/notificationCatalog";
import { clinicHourNow, deliverClinicNotification, readClinicMembers } from "@/lib/notificationDelivery";
import {
  CALL_REMINDERS_COLLECTION,
  cairoInstant,
  missedSummaryText,
  recipientLabel,
  reminderFromDoc,
  reminderWhatsappText,
  resolveRecipients,
  type StaffForRecipients,
} from "@/lib/callReminders";

/**
 * The call-reminder half of the 10-minute alert sweep (lib/alerts/sweep.ts).
 *
 * A reminder is due once its `pendingFireAt` has passed. The field exists only until the reminder
 * is sent or handled, so the due query is a single-field range with no composite index, and a sent
 * reminder drops out of it for good. Each one is claimed in a transaction before anything is
 * delivered: two sweeps that overlap can both see it, but only one of them sends it.
 */

export type Deliver = typeof deliverClinicNotification;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alphadental.app";
const DUE_BATCH = 50;

/** Everyone who works here, with the branches they work at (the owner everywhere). */
async function staffWithBranches(clinicId: string): Promise<StaffForRecipients[]> {
  const [members, staffSnap] = await Promise.all([readClinicMembers(clinicId), adminClinicCollection(clinicId, "staff").get()]);
  const branches = new Map<string, string[] | null>();
  for (const doc of staffSnap.docs) {
    const d = doc.data() || {};
    const uid = String(d.uid || "").trim();
    if (uid) branches.set(uid, Array.isArray(d.branchIds) ? d.branchIds.map(String) : null);
  }
  return members.map((m) => ({ uid: m.uid, role: m.role, branchIds: m.role === "Owner" ? null : branches.get(m.uid) ?? null }));
}

/** Take a due reminder for this sweep. False when another sweep has it, or it was handled. */
async function claim(ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!d || d.pendingFireAt == null) return false;
    if (d.status !== "open") {
      tx.update(ref, { pendingFireAt: FieldValue.delete() });
      return false;
    }
    tx.update(ref, { notifiedAt: FieldValue.serverTimestamp(), pendingFireAt: FieldValue.delete() });
    return true;
  });
}

export async function sendDueCallReminders(clinicId: string, now: Date, out: string[], deps: { deliver?: Deliver } = {}): Promise<number> {
  const deliver = deps.deliver ?? deliverClinicNotification;
  const due = await adminClinicCollection(clinicId, CALL_REMINDERS_COLLECTION)
    .where("pendingFireAt", "<=", Timestamp.fromDate(now))
    .limit(DUE_BATCH)
    .get();
  if (due.empty) return 0;

  let staff: StaffForRecipients[] | null = null;
  let sent = 0;
  for (const doc of due.docs) {
    if (!(await claim(doc.ref))) continue;
    // Claimed means it will not be picked up again, so anything that goes wrong from here on is
    // written onto the reminder — the card still shows it, and the reason is there to read.
    const fail = (reason: string) => doc.ref.update({ deliveryError: reason.slice(0, 200) }).catch(() => undefined);
    try {
      const reminder = reminderFromDoc(doc.id, doc.data() || {});

      const patient = await adminClinicDoc(clinicId, "patients", reminder.patientId).get();
      if (!patient.exists) {
        await fail("patient-missing");
        continue;
      }
      const p = patient.data() || {};
      reminder.patientName = String(p.name || reminder.patientName);
      reminder.patientPhone = String(p.phone || reminder.patientPhone);

      staff ??= await staffWithBranches(clinicId);
      const uids = resolveRecipients(reminder.recipient, reminder.branchId, staff);
      if (uids.length === 0) {
        await fail("nobody");
        continue;
      }

      // The gate never throws: it answers. Muted, switched off or nobody left is a refusal to
      // record, not a send to count.
      const result = await deliver(
        clinicId,
        { title: "📞 تذكير بمكالمة", body: `${reminder.patientName} — ${reminder.reason}` },
        {
          event: "callReminderDue",
          uids,
          actionUrl: `/calls?id=${doc.id}`,
          data: { screen: "calls" },
          whatsappText: reminderWhatsappText(reminder, `${APP_URL}/calls?id=${doc.id}`),
        },
      );
      if (!result.raised || result.reason === "nobody") {
        await fail(result.reason || "failed");
        continue;
      }
      sent += 1;
      out.push(`callReminderDue:${doc.id}`);
    } catch (e) {
      await fail(String((e as Error)?.message || e));
    }
  }
  return sent;
}

/**
 * The evening list of today's calls nobody made, once a day at the clinic's chosen hour, to
 * Owner/Admin. Nothing missed means nothing sent.
 */
export async function sendMissedCalls(
  clinicId: string,
  prefs: AlertPreferences,
  today: string,
  now: Date,
  out: string[],
  deps: { deliver?: Deliver } = {},
): Promise<boolean> {
  if (clinicHourNow(now) !== notifyTiming("callRemindersMissed", "hour", prefs)) return false;
  const deliver = deps.deliver ?? deliverClinicNotification;
  const startOfToday = cairoInstant(today, "00:00");

  const [todaySnap, openSnap] = await Promise.all([
    adminClinicCollection(clinicId, CALL_REMINDERS_COLLECTION).where("fireAt", ">=", Timestamp.fromDate(startOfToday)).get(),
    adminClinicCollection(clinicId, CALL_REMINDERS_COLLECTION).where("status", "==", "open").get(),
  ]);
  const missed = todaySnap.docs
    .map((d) => reminderFromDoc(d.id, d.data() || {}))
    .filter((r) => r.status === "open" && r.fireAtMs <= now.getTime())
    .sort((a, b) => a.fireAtMs - b.fireAtMs);
  if (missed.length === 0) return false;
  const older = openSnap.docs.filter((d) => reminderFromDoc(d.id, d.data() || {}).fireAtMs < startOfToday.getTime()).length;

  // One a day: the mark is created only when there is something to say, and an existing one
  // means another sweep already said it.
  try {
    await adminClinicDoc(clinicId, "alert_marks", `callsMissed_${today}`).create({ at: FieldValue.serverTimestamp() });
  } catch {
    return false;
  }

  const text = missedSummaryText(missed, older, (role) => recipientLabel({ kind: "role", role: role as "Receptionist" }, true));
  await deliver(
    clinicId,
    { title: "⚠️ مكالمات ما اتعملتش", body: `${missed.length} مكالمات النهارده ما اتعملتش` },
    { event: "callRemindersMissed", actionUrl: "/calls", data: { screen: "calls" }, whatsappText: text ?? undefined },
  );
  out.push(`callRemindersMissed:${today}`);
  return true;
}
