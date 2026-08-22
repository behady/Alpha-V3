/**
 * Deleting an appointment, and deciding what happens to the treatments recorded against it.
 *
 * The old client-side delete tried to tidy up the visit's clinical notes with
 * `where("lastAppointmentId", "==", id)` — a field nothing in this app has ever written. Notes are
 * written with `appointmentId`. So the query matched nothing, every note survived its appointment
 * with a pointer to a document that no longer existed, and nobody was told. They still rendered
 * (the timeline drops notes with a missing appointment into its general bucket rather than hiding
 * them, which is the right failure direction) but the delete was silently not doing what it read
 * as doing.
 *
 * Fixing the field alone would have made things worse: it would have started quietly deleting
 * clinical records whenever someone tidied the calendar. Deleting a booking is an administrative
 * act; deleting the record of a tooth being drilled is not. So the caller must now say which it
 * means, and the screen asks:
 *
 *   servicesAction: "keep"   — detach the treatments; they stay in the patient's history
 *   servicesAction: "delete" — remove them and their charges too
 *
 * Either way, money already collected stops the delete. A treatment with payments against it
 * cannot be removed here any more than it can from the finance screen — same rule, same module.
 */

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { recordLedgerAudit, recordMoneyChange } from "@/lib/server/ledgerAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type LedgerRow = { id: string; type: string; procedureId: string | null; clinicalNoteId: string | null };

/**
 * Everything recorded against this visit, following every link the app has ever written.
 *
 * Three routes into the notes, because three eras of this code linked them differently: the note's
 * own `appointmentId`, the appointment's legacy single `clinicalNoteId`, and the ids embedded in
 * its denormalised `services[]` array. Missing any one of them leaves a treatment behind.
 */
async function collectVisitRecords(clinicId: string, appointmentId: string, appointment: Record<string, unknown>) {
  const noteIds = new Set<string>();

  const byAppointment = await adminClinicCollection(clinicId, "clinical_notes")
    .where("appointmentId", "==", appointmentId)
    .get();
  for (const d of byAppointment.docs) noteIds.add(d.id);

  if (typeof appointment.clinicalNoteId === "string" && appointment.clinicalNoteId.trim()) {
    noteIds.add(appointment.clinicalNoteId.trim());
  }
  if (Array.isArray(appointment.services)) {
    for (const s of appointment.services as Record<string, unknown>[]) {
      if (typeof s?.clinicalNoteId === "string" && s.clinicalNoteId.trim()) noteIds.add(s.clinicalNoteId.trim());
    }
  }

  // Notes reached through a legacy pointer may not exist any more; read them so the caller can
  // show real names, and drop the ones that are already gone.
  const notes: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const id of noteIds) {
    const snap = await adminClinicDoc(clinicId, "clinical_notes", id).get();
    if (snap.exists) notes.push({ id, data: snap.data() || {} });
  }

  const ledgerRows = new Map<string, LedgerRow>();
  const addRow = (id: string, data: Record<string, unknown>) => {
    if (ledgerRows.has(id)) return;
    ledgerRows.set(id, {
      id,
      type: String(data.type || ""),
      procedureId: typeof data.procedureId === "string" ? data.procedureId : null,
      clinicalNoteId: typeof data.clinicalNoteId === "string" ? data.clinicalNoteId : null,
    });
  };

  const byApptLedger = await adminClinicCollection(clinicId, "ledger")
    .where("appointmentId", "==", appointmentId)
    .get();
  for (const d of byApptLedger.docs) addRow(d.id, d.data() || {});

  for (const note of notes) {
    const linked = await adminClinicCollection(clinicId, "ledger").where("clinicalNoteId", "==", note.id).get();
    for (const d of linked.docs) addRow(d.id, d.data() || {});

    const legacy = typeof note.data.ledgerId === "string" ? note.data.ledgerId.trim() : "";
    if (legacy && !ledgerRows.has(legacy)) {
      const snap = await adminClinicDoc(clinicId, "ledger", legacy).get();
      if (snap.exists) addRow(snap.id, snap.data() || {});
    }
  }

  // Payments settling any of those charges. These are what can block the delete.
  const procedureIds = [...ledgerRows.values()].filter((r) => r.type === "procedure").map((r) => r.id);
  const payments: LedgerRow[] = [];
  for (const procedureId of procedureIds) {
    const snap = await adminClinicCollection(clinicId, "ledger").where("procedureId", "==", procedureId).get();
    for (const d of snap.docs) {
      const data = d.data() || {};
      if (String(data.type || "") !== "payment") continue;
      payments.push({ id: d.id, type: "payment", procedureId, clinicalNoteId: null });
    }
  }

  return { notes, ledgerRows: [...ledgerRows.values()], payments };
}

/**
 * What deleting this appointment would affect — so the screen can ask before it does.
 *
 * The dialog needs the treatments by name, what each cost, and whether any money has been
 * collected against them (which decides whether "delete them too" is even offerable). Gathering
 * that here rather than in the browser keeps one definition of "recorded against this visit";
 * the client following three different link shapes of its own is how they drift apart.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const appointmentId = (params.get("appointmentId") || "").trim();
  if (!appointmentId) return bad("Which appointment?");

  const requestedClinicId = params.get("clinicId");
  const authz = await requireStaffPermission(request, requestedClinicId || undefined, "appointments.delete");
  if (!authz.ok) return authz.response;

  let clinicId: string;
  try {
    clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "No clinic for this account.", 403);
  }

  try {
    const apptSnap = await adminClinicDoc(clinicId, "appointments", appointmentId).get();
    if (!apptSnap.exists) return bad("That appointment no longer exists.", 404);
    const appointment = apptSnap.data() || {};

    const { notes, ledgerRows, payments } = await collectVisitRecords(clinicId, appointmentId, appointment);

    const paidByProcedure = new Map<string, number>();
    for (const payment of payments) {
      if (!payment.procedureId) continue;
      const snap = await adminClinicDoc(clinicId, "ledger", payment.id).get();
      const paid = Number(snap.data()?.paid ?? snap.data()?.amount ?? 0) || 0;
      paidByProcedure.set(payment.procedureId, (paidByProcedure.get(payment.procedureId) || 0) + paid);
    }

    const chargeByNote = new Map<string, { id: string; paid: number }>();
    for (const row of ledgerRows) {
      if (row.type !== "procedure" || !row.clinicalNoteId) continue;
      chargeByNote.set(row.clinicalNoteId, { id: row.id, paid: paidByProcedure.get(row.id) || 0 });
    }

    return NextResponse.json({
      ok: true,
      services: notes.map((note) => {
        const charge = chargeByNote.get(note.id);
        return {
          noteId: note.id,
          name: String(note.data.procedure || "Treatment"),
          tooth: String(note.data.tooth || ""),
          cost: Number(note.data.cost) || 0,
          paid: charge?.paid || 0,
          status: String(note.data.status || ""),
        };
      }),
      hasPayments: payments.length > 0,
      paymentCount: payments.length,
    });
  } catch (e) {
    console.error("appointments/delete preview failed", { appointmentId }, e);
    return bad("Could not check what this appointment holds.", 500);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }

  const appointmentId = String(body.appointmentId || "").trim();
  if (!appointmentId) return bad("Which appointment?");

  const servicesAction = body.servicesAction === "delete" ? "delete" : "keep";

  const requestedClinicId = typeof body.clinicId === "string" ? body.clinicId : null;
  const authz = await requireStaffPermission(request, requestedClinicId || undefined, "appointments.delete");
  if (!authz.ok) return authz.response;

  let clinicId: string;
  try {
    clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "No clinic for this account.", 403);
  }

  const actor = { uid: authz.uid, name: authz.name, role: authz.role };

  try {
    const apptRef = adminClinicDoc(clinicId, "appointments", appointmentId);
    const apptSnap = await apptRef.get();
    if (!apptSnap.exists) return bad("That appointment no longer exists.", 404);
    const appointment = apptSnap.data() || {};

    const { notes, ledgerRows, payments } = await collectVisitRecords(clinicId, appointmentId, appointment);

    if (servicesAction === "delete" && payments.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: "HAS_PAYMENTS",
          error:
            payments.length === 1
              ? "A payment has been recorded against this visit's treatment. Delete the payment first, or keep the treatments."
              : `${payments.length} payments have been recorded against this visit's treatments. Delete them first, or keep the treatments.`,
          blockingPaymentIds: payments.map((p) => p.id),
        },
        { status: 409 }
      );
    }

    const batch = adminDb().batch();

    if (servicesAction === "delete") {
      for (const note of notes) batch.delete(adminClinicDoc(clinicId, "clinical_notes", note.id));
      for (const row of ledgerRows) batch.delete(adminClinicDoc(clinicId, "ledger", row.id));
    } else {
      // Detach rather than delete. The treatment keeps its date and its money, and shows in the
      // patient's timeline under the general heading — which is exactly where the timeline already
      // puts a note whose appointment has gone.
      for (const note of notes) {
        batch.update(adminClinicDoc(clinicId, "clinical_notes", note.id), { appointmentId: null });
      }
      for (const row of ledgerRows) {
        batch.update(adminClinicDoc(clinicId, "ledger", row.id), { appointmentId: null });
      }
    }

    batch.delete(apptRef);
    await batch.commit();

    await recordMoneyChange({
      entry: {
        clinicId, action: "delete", collection: "appointments", documentId: appointmentId,
        before: appointment, actor, via: `appointments/delete:${servicesAction}`,
      },
      action: "Appointment Deleted",
      details:
        servicesAction === "delete"
          ? `Deleted appointment for ${String(appointment.patientName || "Unknown")} along with ${notes.length} treatment(s) and ${ledgerRows.length} finance row(s)`
          : `Deleted appointment for ${String(appointment.patientName || "Unknown")}; kept ${notes.length} treatment(s) in the patient's record`,
      severity: "HIGH",
    });

    if (servicesAction === "delete") {
      for (const note of notes) {
        await recordLedgerAudit({
          clinicId, action: "delete", collection: "clinical_notes", documentId: note.id,
          before: note.data, actor, via: "appointments/delete (cascade)",
        });
      }
      for (const row of ledgerRows) {
        await recordLedgerAudit({
          clinicId, action: "delete", collection: "ledger", documentId: row.id,
          actor, via: "appointments/delete (cascade)",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      servicesAction,
      deletedNotes: servicesAction === "delete" ? notes.length : 0,
      detachedNotes: servicesAction === "keep" ? notes.length : 0,
      deletedLedgerRows: servicesAction === "delete" ? ledgerRows.length : 0,
    });
  } catch (e) {
    console.error("appointments/delete failed", { appointmentId }, e);
    return bad("Something went wrong deleting that. Nothing was changed.", 500);
  }
}
