import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { deliverClinicNotification } from "@/lib/notificationDelivery";

/**
 * The six owner alerts — a booking, a change, a deletion; a payment, an edit, a deletion.
 *
 * Kept at its old path and with its old body so the four screens that call it (the appointments
 * page, both dashboards, the dentist home) keep working unchanged. What changed is where it goes:
 * each old `alertKey` is now a catalogue event, so the alert obeys the notification centre —
 * the clinic's roles, its WhatsApp / push / bell switches, quiet hours, each person's mute and
 * phone — instead of one owner number on a page nobody knew about.
 *
 * Before this the route read the top-level `settings/whatsapp` document, which nothing ever wrote,
 * so no owner alert had been sent in the life of the feature. See lib/notificationCatalog for the
 * `legacyOwnerKey` fallback that honours the ticks clinics left on the old grid.
 */

const EVENT_FOR_KEY: Record<string, string> = {
  appointment_add: "appointmentAdded",
  appointment_edit: "appointmentEdited",
  appointment_delete: "appointmentDeleted",
  finance_add: "paymentAdded",
  finance_edit: "paymentEdited",
  finance_delete: "paymentDeleted",
  appointment_no_show: "noShowMarked",
  appointment_same_day_cancel: "sameDayCancellation",
  appointment_walk_in: "walkInBooked",
};

const TITLE_FOR_EVENT: Record<string, string> = {
  appointmentAdded: "Appointment booked",
  appointmentEdited: "Appointment changed",
  appointmentDeleted: "Appointment deleted",
  paymentAdded: "Payment recorded",
  paymentEdited: "Payment changed",
  paymentDeleted: "Payment deleted",
  noShowMarked: "No-show",
  sameDayCancellation: "Same-day cancellation",
  walkInBooked: "Walk-in booked",
};

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    alertKey?: string;
    message?: string;
  };

  // The clinic on screen, honoured only when the caller holds a role there; otherwise the
  // account's default.
  let clinicId: string | null = null;
  try {
    clinicId = await resolveUserClinicId(authz.uid, typeof body.clinicId === "string" ? body.clinicId : undefined);
  } catch {
    clinicId = null;
  }
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });

  // SUBSCRIPTION ENFORCEMENT
  const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
  const clinic = clinicSnap.data();
  if (clinic && (clinic.status !== "Active" || (clinic.expiresAt && clinic.expiresAt.toDate() < new Date()))) {
    return NextResponse.json({ ok: false, error: "Subscription expired or suspended." }, { status: 403 });
  }

  const alertKey = typeof body.alertKey === "string" ? body.alertKey.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const event = EVENT_FOR_KEY[alertKey];
  if (!event) return NextResponse.json({ ok: false, error: "Invalid alertKey" }, { status: 400 });
  if (!message) return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });

  try {
    const result = await deliverClinicNotification(
      clinicId,
      { title: TITLE_FOR_EVENT[event], body: message.slice(0, 400) },
      {
        event,
        whatsappText: message.slice(0, 3000),
        data: { screen: event.startsWith("payment") ? "money" : "day" },
      },
    );
    return NextResponse.json({ ok: true, sent: result.whatsapped > 0, ...result });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
