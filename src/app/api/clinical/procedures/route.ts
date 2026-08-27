import { reportServerError } from "@/lib/server/reportError";
/**
 * Recording, changing and removing a treatment — as one indivisible operation.
 *
 * Saving a procedure touches four documents: the clinical note, its ledger charge, the back-link
 * that ties them together, and the appointment's denormalised `services[]` list. The browser wrote
 * them one at a time, so a dropped connection between any two left the patient's record in a state
 * the app itself calls broken: a charge with no treatment behind it, or — the expensive direction —
 * a treatment that was performed and never invoiced. Both recovery engines exist to hunt for
 * exactly those, which is a strong hint they should not be possible to create.
 *
 * Everything here runs in a single Firestore transaction. All four land, or none do.
 *
 * The second reason this route exists: the numbers. The client sends what it displayed, but the
 * server recomputes the cost, the lab fee and the commission from the price list and the staff
 * records it reads itself. A cost arriving in a request body is a number the caller chose, and
 * before this route the caller was the only one who decided it.
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { computeProcedurePricing, type PricedService } from "@/lib/procedurePricing";
import { allowedDiscount, checkDiscountAllowed } from "@/lib/discountMath";
import {
  DISCOUNTS_DOC,
  PRICE_LISTS_DOC,
  findPriceList,
  parseDiscountSettings,
  parsePriceLists,
  resolveActiveListId,
} from "@/lib/priceLists";
import { buildDeleteContext, evaluateDelete } from "@/lib/deletePolicy";
import { applyProcedureSync, readProcedureCommissionBasis, readProcedurePayments } from "@/lib/server/ledgerSync";
import { recordLedgerAudit, recordMoneyChange } from "@/lib/server/ledgerAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Actor = { uid: string; name: string; role: string; permissions: string[] };

/** A discount the caller is not allowed to give. Carries the reason so the user reads it. */
class DiscountRefused extends Error {}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function loadServices(clinicId: string): Promise<PricedService[]> {
  const snap = await adminClinicCollection(clinicId, "services").get();
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      name: String(data.name || ""),
      price: Number(data.price) || 0,
      // Per-list overrides. Only numbers survive; a malformed entry falls back to `price` rather
      // than pricing a treatment at NaN.
      prices:
        data.prices && typeof data.prices === "object"
          ? Object.fromEntries(
              Object.entries(data.prices as Record<string, unknown>)
                .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
                .map(([k, v]) => [k, Number(v)])
            )
          : null,
      requiresLab: data.requiresLab === true,
      estimatedLabFee: Number(data.estimatedLabFee) || 0,
      pricingMode: typeof data.pricingMode === "string" ? data.pricingMode : null,
    };
  });
}

/** The clinic's price lists and its discount policy, both seeded on first read. */
async function loadPricingPolicy(clinicId: string) {
  const [listsSnap, discountsSnap] = await Promise.all([
    adminClinicDoc(clinicId, "settings", PRICE_LISTS_DOC).get(),
    adminClinicDoc(clinicId, "settings", DISCOUNTS_DOC).get(),
  ]);
  return {
    priceLists: parsePriceLists(listsSnap.exists ? listsSnap.data() : null),
    discountSettings: parseDiscountSettings(discountsSnap.exists ? discountsSnap.data() : null),
  };
}

/**
 * The shape both create and update need: the priced treatment plus who performed it.
 *
 * `doctorId` is the treating dentist and is what the payout follows. It is separate from the actor,
 * who is whoever is at the keyboard — an assistant typing up a session is a different person, and
 * the note is only trustworthy if it says which is which.
 */
async function priceRequest(clinicId: string, body: Record<string, unknown>, actor: Actor) {
  const services = await loadServices(clinicId);
  const { priceLists, discountSettings } = await loadPricingPolicy(clinicId);

  const doctorId = String(body.doctorId || "").trim();
  if (!doctorId) throw new Error("NO_DOCTOR");
  const staffSnap = await adminClinicDoc(clinicId, "staff", doctorId).get();
  // Two different failures wearing one message. "Choose the dentist" is true when the field was
  // left empty and a lie when a name is sitting in the dropdown — which is what the owner saw:
  // Dr Omar Sherif selected on screen, and the app telling him to pick a dentist. The dentist he
  // picked no longer resolves to a staff record, and that is what it should say.
  if (!staffSnap.exists) throw new Error("DOCTOR_NOT_FOUND");
  const staff = staffSnap.data() || {};
  const doctorName = String(staff.name || "").trim() || "Unknown Doctor";

  const selectedTeeth = asStringArray(body.selectedTeeth);
  const procedures = asStringArray(body.procedures);
  if (procedures.length === 0) throw new Error("NO_PROCEDURE_NAME");

  // Which list to charge from. An unknown or deactivated list falls back to the clinic default
  // rather than being honoured — a request naming a retired list must not resurrect its prices.
  const patientDefaultListId =
    typeof body.patientDefaultPriceListId === "string" ? body.patientDefaultPriceListId : null;
  const priceListId = resolveActiveListId(
    priceLists,
    typeof body.priceListId === "string" ? body.priceListId : null,
    patientDefaultListId
  );
  const priceList = findPriceList(priceLists, priceListId);

  const pricing = computeProcedurePricing({
    procedures,
    services,
    selectedTeeth,
    typedUnitCost: body.unitCost === undefined || body.unitCost === null || body.unitCost === "" ? null : Number(body.unitCost),
    pricingModeOverride: typeof body.pricingMode === "string" ? body.pricingMode : null,
    commissionPct: Number(staff.commissionPercentage) || 0,
    priceListId,
    priceListName: priceList?.name || null,
    discountMode: typeof body.discountMode === "string" ? body.discountMode : null,
    discountValue:
      body.discountValue === undefined || body.discountValue === null || body.discountValue === ""
        ? null
        : Number(body.discountValue),
    discountReason: typeof body.discountReason === "string" ? body.discountReason : null,
  });

  // The ceiling and the reason are enforced here, which is the only place either means anything.
  // A cap checked in the browser decides whether a field is disabled; it does not stop a request.
  const check = checkDiscountAllowed({
    listPrice: pricing.listPrice,
    discountAmount: pricing.discountAmount,
    reason: pricing.discountReason,
    authority: allowedDiscount(actor.role, actor.permissions, discountSettings),
    availableReasons: discountSettings.reasons,
  });
  if (!check.ok) throw new DiscountRefused(check.error);

  const toothText = selectedTeeth.length > 0 ? selectedTeeth.join(",") : String(body.tooth || "").trim() || "Gen";
  const displayProcedure = pricing.procedures.join(" + ");
  const status = ["Planned", "Ongoing", "Completed"].includes(String(body.status))
    ? String(body.status)
    : "Planned";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : todayKey();

  return { pricing, doctorId, doctorName, selectedTeeth, toothText, displayProcedure, status, date };
}

type Priced = Awaited<ReturnType<typeof priceRequest>>;

function noteFields(p: Priced, body: Record<string, unknown>, appointmentId: string | null) {
  return {
    appointmentId,
    tooth: p.toothText,
    procedure: p.displayProcedure,
    procedures: p.pricing.procedures,
    cost: p.pricing.cost,
    unitCost: p.pricing.unitCost,
    unitsCount: p.pricing.pricingUnits,
    pricingFormula: p.pricing.pricingFormula,
    pricingMode: p.pricing.pricingMode,
    // Structured, not prose. The old edit screen rewrote the description into
    // "Before 500 → After 400 (20% off)", so the only record of a discount was a sentence nothing
    // could total, group, or explain the reason for.
    listPrice: p.pricing.listPrice,
    priceListId: p.pricing.priceListId,
    priceListName: p.pricing.priceListName,
    discountMode: p.pricing.discountMode,
    discountValue: p.pricing.discountValue,
    discountAmount: p.pricing.discountAmount,
    discountReason: p.pricing.discountReason,
    note: String(body.note || ""),
    doctor: p.doctorName,
    doctorId: p.doctorId,
    serviceIds: p.pricing.serviceIds,
    serviceId: p.pricing.serviceIds[0] || null,
    serviceName: p.pricing.matchedServices[0]?.name || null,
    unmatchedProcedures: p.pricing.unmatchedProcedures,
    date: p.date,
    status: p.status,
  };
}

function ledgerFields(p: Priced, patientId: string, patientName: string | null, appointmentId: string | null) {
  return {
    patientId,
    patientName,
    type: "procedure" as const,
    category: "Treatment",
    amount: p.pricing.cost,
    cost: p.pricing.cost,
    unitCost: p.pricing.unitCost,
    unitsCount: p.pricing.pricingUnits,
    pricingFormula: p.pricing.pricingFormula,
    pricingMode: p.pricing.pricingMode,
    description: `${p.displayProcedure} (T: ${p.toothText}) | ${p.pricing.pricingFormula}=${p.pricing.cost}`,
    listPrice: p.pricing.listPrice,
    priceListId: p.pricing.priceListId,
    priceListName: p.pricing.priceListName,
    discountMode: p.pricing.discountMode,
    discountValue: p.pricing.discountValue,
    discountAmount: p.pricing.discountAmount,
    discountReason: p.pricing.discountReason,
    serviceId: p.pricing.serviceIds[0] || null,
    serviceIds: p.pricing.serviceIds,
    serviceName: p.pricing.matchedServices[0]?.name || null,
    doctorId: p.doctorId,
    doctorName: p.doctorName,
    doctorCommissionPercentage: p.pricing.commissionPct,
    doctorCommissionAmount: p.pricing.doctorCommissionAmount,
    clinicProfit: p.pricing.clinicProfit,
    labFee: p.pricing.labFee,
    labFeePerUnit: p.pricing.labFeePerUnit,
    labOrderService: "",
    date: p.date,
    appointmentId,
  };
}

/**
 * Keep the appointment's `services[]` mirror in step.
 *
 * That array is a denormalised copy of the visit's treatments, read by the calendar and the side
 * panel so they can show a total without loading the notes. It is a display convenience, not the
 * source of truth — but a stale one shows the patient a total that does not match their bill.
 */
function syncedAppointmentServices(
  appointmentData: Record<string, unknown>,
  entry: {
    clinicalNoteId: string;
    ledgerId: string | null;
    serviceId: string | null;
    serviceName: string;
    cost: number;
    status: string;
  }
) {
  const existing = Array.isArray(appointmentData.services) ? [...(appointmentData.services as Record<string, unknown>[])] : [];

  // A visit booked with a single service, before per-procedure notes existed, carries it on the
  // appointment itself. Fold it into the array once so it is not lost when the array takes over.
  if (existing.length === 0 && appointmentData.serviceId) {
    existing.push({
      serviceId: appointmentData.serviceId,
      serviceName: appointmentData.serviceName || appointmentData.treatment || "",
      cost: Number(appointmentData.cost) || 0,
      listPrice: Number(appointmentData.listPrice) || Number(appointmentData.cost) || 0,
      status: "Planned",
    });
  }

  const index = existing.findIndex((s) => s.clinicalNoteId === entry.clinicalNoteId);
  const row = {
    serviceId: entry.serviceId || "",
    serviceName: entry.serviceName,
    cost: entry.cost,
    listPrice: entry.cost,
    clinicalNoteId: entry.clinicalNoteId,
    ledgerId: entry.ledgerId,
    status: entry.status,
  };
  if (index === -1) existing.push(row);
  else existing[index] = { ...existing[index], ...row };

  const totalListPrice = existing.reduce((sum, s) => sum + (Number(s.listPrice) || Number(s.cost) || 0), 0);
  const discountAmount = Number(appointmentData.discountAmount) || 0;
  const hasDiscount = appointmentData.discountMode && appointmentData.discountMode !== "none";

  return {
    services: existing,
    listPrice: totalListPrice,
    cost: hasDiscount ? Math.max(0, totalListPrice - discountAmount) : totalListPrice,
  };
}

// ---------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------

async function createProcedure(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const patientId = String(body.patientId || "").trim();
  if (!patientId) return bad("A treatment needs a patient.");

  const priced = await priceRequest(clinicId, body, actor);
  const appointmentId = body.appointmentId ? String(body.appointmentId).trim() : null;
  const addToLedger = body.addToLedger !== false;

  const result = await adminDb().runTransaction(async (txn) => {
    const patientSnap = await txn.get(adminClinicDoc(clinicId, "patients", patientId));
    if (!patientSnap.exists) throw new Error("NO_PATIENT");
    const patientName = String(patientSnap.data()?.name || "") || null;

    const appointmentRef = appointmentId ? adminClinicDoc(clinicId, "appointments", appointmentId) : null;
    const appointmentSnap = appointmentRef ? await txn.get(appointmentRef) : null;

    const noteRef = adminClinicCollection(clinicId, "clinical_notes").doc();
    const shouldBill = addToLedger && priced.pricing.cost > 0;
    const ledgerRef = shouldBill ? adminClinicCollection(clinicId, "ledger").doc() : null;

    const note = {
      patientId,
      ...noteFields(priced, body, appointmentId),
      ledgerId: ledgerRef ? ledgerRef.id : null,
      // Who typed this up, as distinct from the dentist it is attributed to.
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdByRole: actor.role,
      createdAt: FieldValue.serverTimestamp(),
    };
    txn.set(noteRef, note);

    if (ledgerRef) {
      txn.set(ledgerRef, {
        ...ledgerFields(priced, patientId, patientName, appointmentId),
        clinicalNoteId: noteRef.id,
        paid: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      });
    }

    if (appointmentRef && appointmentSnap?.exists) {
      txn.update(
        appointmentRef,
        syncedAppointmentServices(appointmentSnap.data() || {}, {
          clinicalNoteId: noteRef.id,
          ledgerId: ledgerRef ? ledgerRef.id : null,
          serviceId: priced.pricing.serviceIds[0] || null,
          serviceName: priced.pricing.matchedServices[0]?.name || priced.displayProcedure,
          cost: priced.pricing.cost,
          status: priced.status,
        })
      );
    }

    return { noteId: noteRef.id, ledgerId: ledgerRef?.id || null, note, patientName };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "create", collection: "clinical_notes", documentId: result.noteId,
      after: result.note, actor, via: "clinical/procedures:create",
    },
    action: "Procedure Logged",
    details: `${priced.displayProcedure} (${priced.pricing.cost} EGP) for ${result.patientName || patientId}`,
  });

  return NextResponse.json({ ok: true, noteId: result.noteId, ledgerId: result.ledgerId, cost: priced.pricing.cost });
}

// ---------------------------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------------------------

async function updateProcedure(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const noteId = String(body.noteId || "").trim();
  if (!noteId) return bad("Which treatment?");

  const priced = await priceRequest(clinicId, body, actor);
  const addToLedger = body.addToLedger !== false;

  const result = await adminDb().runTransaction(async (txn) => {
    const noteRef = adminClinicDoc(clinicId, "clinical_notes", noteId);
    const noteSnap = await txn.get(noteRef);
    if (!noteSnap.exists) throw new Error("NOT_FOUND");
    const before = noteSnap.data() || {};
    const patientId = String(before.patientId || "");

    // The note may point at its charge, or the charge may point back at the note — both link
    // directions have been written over the years, so both are followed.
    let ledgerId = typeof before.ledgerId === "string" ? before.ledgerId : "";
    if (ledgerId) {
      const existing = await txn.get(adminClinicDoc(clinicId, "ledger", ledgerId));
      if (!existing.exists || String(existing.data()?.type) !== "procedure") ledgerId = "";
    }
    if (!ledgerId) {
      const linked = await txn.get(
        adminClinicCollection(clinicId, "ledger")
          .where("clinicalNoteId", "==", noteId)
          .where("type", "==", "procedure")
      );
      if (!linked.empty) ledgerId = linked.docs[0].id;
    }

    // Payments have to be read before anything is written — a transaction cannot read after write.
    const existingPayments = ledgerId ? await readProcedurePayments(txn, clinicId, ledgerId) : [];

    const appointmentId = typeof before.appointmentId === "string" ? before.appointmentId : null;
    const appointmentRef = appointmentId ? adminClinicDoc(clinicId, "appointments", appointmentId) : null;
    const appointmentSnap = appointmentRef ? await txn.get(appointmentRef) : null;

    const patientSnap = patientId ? await txn.get(adminClinicDoc(clinicId, "patients", patientId)) : null;
    const patientName = patientSnap?.exists ? String(patientSnap.data()?.name || "") || null : null;

    const shouldBill = addToLedger && priced.pricing.cost > 0;

    if (!shouldBill && ledgerId) {
      // Un-billing a treatment that has already been paid for would strand those payments.
      if (existingPayments.length > 0) throw new Error("HAS_PAYMENTS");
      txn.delete(adminClinicDoc(clinicId, "ledger", ledgerId));
      ledgerId = "";
    }

    let ledgerRefId = ledgerId;
    if (shouldBill) {
      const fields = ledgerFields(priced, patientId, patientName, appointmentId);
      if (ledgerId) {
        txn.update(adminClinicDoc(clinicId, "ledger", ledgerId), { ...fields, clinicalNoteId: noteId });
      } else {
        const newRef = adminClinicCollection(clinicId, "ledger").doc();
        txn.set(newRef, {
          ...fields,
          clinicalNoteId: noteId,
          paid: 0,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        });
        ledgerRefId = newRef.id;
      }
    }

    txn.update(noteRef, {
      ...noteFields(priced, body, appointmentId),
      ledgerId: shouldBill ? ledgerRefId : null,
      updatedByUid: actor.uid,
      updatedByName: actor.name,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The lab fee and the commission percentage may both have moved, so every payment against
    // this charge is recomputed against the new basis.
    if (shouldBill && ledgerRefId && existingPayments.length > 0) {
      applyProcedureSync(txn, {
        clinicId,
        procedureLedgerId: ledgerRefId,
        payments: existingPayments,
        labFee: priced.pricing.labFee,
        commissionPct: priced.pricing.commissionPct,
      });
    }

    if (appointmentRef && appointmentSnap?.exists) {
      txn.update(
        appointmentRef,
        syncedAppointmentServices(appointmentSnap.data() || {}, {
          clinicalNoteId: noteId,
          ledgerId: shouldBill ? ledgerRefId : null,
          serviceId: priced.pricing.serviceIds[0] || null,
          serviceName: priced.pricing.matchedServices[0]?.name || priced.displayProcedure,
          cost: priced.pricing.cost,
          status: priced.status,
        })
      );
    }

    return { before, ledgerId: shouldBill ? ledgerRefId : null, patientName, patientId };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "update", collection: "clinical_notes", documentId: noteId,
      before: result.before, after: { cost: priced.pricing.cost, procedure: priced.displayProcedure, status: priced.status },
      actor, via: "clinical/procedures:update",
    },
    action: "Procedure Updated",
    details: `${priced.displayProcedure} (${priced.pricing.cost} EGP) for ${result.patientName || result.patientId}`,
  });

  return NextResponse.json({ ok: true, noteId, ledgerId: result.ledgerId, cost: priced.pricing.cost });
}

// ---------------------------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------------------------

async function deleteProcedure(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const noteId = String(body.noteId || "").trim();
  if (!noteId) return bad("Which treatment?");

  const noteSnap = await adminClinicDoc(clinicId, "clinical_notes", noteId).get();
  if (!noteSnap.exists) return bad("That treatment no longer exists.", 404);
  const note = noteSnap.data() || {};

  // Both link directions, then every payment settling any charge among them.
  const linkedSnap = await adminClinicCollection(clinicId, "ledger").where("clinicalNoteId", "==", noteId).get();
  const related: Array<{ id: string; type?: string; procedureId?: string | null; clinicalNoteId?: string | null }> =
    linkedSnap.docs.map((d) => ({ id: d.id, type: String(d.data().type || ""), clinicalNoteId: noteId }));

  const legacyLedgerId = typeof note.ledgerId === "string" ? note.ledgerId.trim() : "";
  if (legacyLedgerId && !related.some((r) => r.id === legacyLedgerId)) {
    const legacy = await adminClinicDoc(clinicId, "ledger", legacyLedgerId).get();
    if (legacy.exists) {
      related.push({ id: legacy.id, type: String(legacy.data()?.type || ""), clinicalNoteId: noteId });
    }
  }

  for (const row of [...related]) {
    if (row.type !== "procedure") continue;
    const paymentsSnap = await adminClinicCollection(clinicId, "ledger").where("procedureId", "==", row.id).get();
    for (const d of paymentsSnap.docs) {
      related.push({ id: d.id, type: String(d.data().type || ""), procedureId: row.id });
    }
  }

  const verdict = evaluateDelete(
    { kind: "clinical-note", id: noteId, ledgerIds: legacyLedgerId ? [legacyLedgerId] : [] },
    buildDeleteContext(related)
  );
  if (!verdict.allowed) {
    return NextResponse.json(
      { ok: false, error: verdict.message, reason: verdict.reason, blockingPaymentIds: verdict.blockingPaymentIds },
      { status: 409 }
    );
  }

  const batch = adminDb().batch();
  for (const item of verdict.cascade) {
    batch.delete(adminClinicDoc(clinicId, item.collection, item.id));
  }
  await batch.commit();

  await recordMoneyChange({
    entry: {
      clinicId, action: "delete", collection: "clinical_notes", documentId: noteId,
      before: note, actor, via: "clinical/procedures:delete",
    },
    action: "Procedure Deleted",
    details: `Deleted ${String(note.procedure || "treatment")} and ${verdict.cascade.length - 1} linked finance row(s)`,
    severity: "HIGH",
  });
  for (const item of verdict.cascade) {
    if (item.id === noteId) continue;
    await recordLedgerAudit({
      clinicId, action: "delete", collection: item.collection, documentId: item.id,
      actor, via: "clinical/procedures:delete (cascade)",
    });
  }

  return NextResponse.json({ ok: true, deleted: verdict.cascade });
}

// ---------------------------------------------------------------------------------------------
// move / continue
// ---------------------------------------------------------------------------------------------

async function moveProcedure(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const noteId = String(body.noteId || "").trim();
  const targetAppointmentId = String(body.targetAppointmentId || "").trim();
  if (!noteId || !targetAppointmentId) return bad("Which treatment, and to which visit?");

  const linkedSnap = await adminClinicCollection(clinicId, "ledger").where("clinicalNoteId", "==", noteId).get();
  const linkedIds = linkedSnap.docs.map((d) => d.id);

  const result = await adminDb().runTransaction(async (txn) => {
    const noteRef = adminClinicDoc(clinicId, "clinical_notes", noteId);
    const noteSnap = await txn.get(noteRef);
    if (!noteSnap.exists) throw new Error("NOT_FOUND");
    const before = noteSnap.data() || {};

    const apptSnap = await txn.get(adminClinicDoc(clinicId, "appointments", targetAppointmentId));
    if (!apptSnap.exists) throw new Error("NO_APPOINTMENT");
    const newDate = String(apptSnap.data()?.date || before.date || "");

    const legacyLedgerId = typeof before.ledgerId === "string" ? before.ledgerId.trim() : "";
    const allLedgerIds = Array.from(new Set([...linkedIds, ...(legacyLedgerId ? [legacyLedgerId] : [])]));

    txn.update(noteRef, { appointmentId: targetAppointmentId, date: newDate });
    // The charge moves with the treatment, so the ledger date matches the visit it belongs to.
    for (const ledgerId of allLedgerIds) {
      txn.update(adminClinicDoc(clinicId, "ledger", ledgerId), { date: newDate, appointmentId: targetAppointmentId });
    }

    return { before, newDate, movedLedgerIds: allLedgerIds };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "update", collection: "clinical_notes", documentId: noteId,
      before: result.before, after: { appointmentId: targetAppointmentId, date: result.newDate },
      actor, via: "clinical/procedures:move",
    },
    action: "Procedure Moved",
    details: `Moved ${String(result.before.procedure || "treatment")} to visit ${targetAppointmentId}`,
  });

  return NextResponse.json({ ok: true, noteId, date: result.newDate });
}

async function continueProcedure(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const noteId = String(body.noteId || "").trim();
  const targetAppointmentId = String(body.targetAppointmentId || "").trim();
  if (!noteId || !targetAppointmentId) return bad("Which treatment, and to which visit?");

  const result = await adminDb().runTransaction(async (txn) => {
    const sourceSnap = await txn.get(adminClinicDoc(clinicId, "clinical_notes", noteId));
    if (!sourceSnap.exists) throw new Error("NOT_FOUND");
    const source = sourceSnap.data() || {};

    const apptSnap = await txn.get(adminClinicDoc(clinicId, "appointments", targetAppointmentId));
    if (!apptSnap.exists) throw new Error("NO_APPOINTMENT");
    const newDate = String(apptSnap.data()?.date || source.date || "");

    const clone: Record<string, unknown> = { ...source };
    delete clone.id;
    delete clone.createdAt;
    // Never carry the charge forward: a continuation is the same treatment across two visits, and
    // copying its ledger link would bill the patient a second time for work already invoiced.
    delete clone.ledgerId;

    const newRef = adminClinicCollection(clinicId, "clinical_notes").doc();
    const continued = {
      ...clone,
      cost: 0,
      unitCost: 0,
      pricingFormula: "",
      appointmentId: targetAppointmentId,
      date: newDate,
      status: "Ongoing",
      isContinued: true,
      // Signed by whoever continued it; the original author is preserved separately.
      continuedFromName: source.createdByName || "",
      continuedFromNoteId: noteId,
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdByRole: actor.role,
      createdAt: FieldValue.serverTimestamp(),
    };
    txn.set(newRef, continued);

    return { newNoteId: newRef.id, continued, sourceProcedure: String(source.procedure || "treatment") };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "create", collection: "clinical_notes", documentId: result.newNoteId,
      after: result.continued, actor, via: "clinical/procedures:continue",
    },
    action: "Procedure Continued",
    details: `Continued ${result.sourceProcedure} into visit ${targetAppointmentId} at no extra charge`,
  });

  return NextResponse.json({ ok: true, noteId: result.newNoteId });
}

// ---------------------------------------------------------------------------------------------

const PERMISSION_BY_ACTION: Record<string, string> = {
  create: "clinical.edit",
  update: "clinical.edit",
  move: "clinical.edit",
  continue: "clinical.edit",
  delete: "clinical.delete",
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }

  const action = String(body.action || "");
  const permission = PERMISSION_BY_ACTION[action];
  if (!permission) return bad("Unknown action.");

  const requestedClinicId = typeof body.clinicId === "string" ? body.clinicId : null;
  const authz = await requireStaffPermission(request, requestedClinicId || undefined, permission);
  if (!authz.ok) return authz.response;

  let clinicId: string;
  try {
    clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "No clinic for this account.", 403);
  }

  const actor: Actor = { uid: authz.uid, name: authz.name, role: authz.role, permissions: authz.permissions };

  try {
    switch (action) {
      case "create":
        return await createProcedure({ clinicId, actor, body });
      case "update":
        return await updateProcedure({ clinicId, actor, body });
      case "delete":
        return await deleteProcedure({ clinicId, actor, body });
      case "move":
        return await moveProcedure({ clinicId, actor, body });
      case "continue":
        return await continueProcedure({ clinicId, actor, body });
      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    if (e instanceof DiscountRefused) return bad(e.message, 403);
    const message = e instanceof Error ? e.message : "";
    switch (message) {
      case "NO_DOCTOR":
        return bad("Choose the dentist who performed this treatment.");
      case "DOCTOR_NOT_FOUND":
        return bad(
          "That dentist is no longer on this clinic's team, so the treatment cannot be attributed " +
          "to them. Pick another name, or add them back under Settings → Users."
        );
      case "NO_PROCEDURE_NAME":
        return bad("Name the procedure.");
      case "NO_PATIENT":
        return bad("That patient no longer exists.", 404);
      case "NOT_FOUND":
        return bad("That treatment no longer exists. Refresh and try again.", 404);
      case "NO_APPOINTMENT":
        return bad("That visit no longer exists. Refresh and try again.", 404);
      case "HAS_PAYMENTS":
        return NextResponse.json(
          { ok: false, reason: "HAS_PAYMENTS", error: "Payments have been recorded against this treatment. Delete them before removing its charge." },
          { status: 409 }
        );
      default:
        reportServerError("clinical/procedures failed", e, { action });
        return bad("Something went wrong saving that. Nothing was changed.", 500);
    }
  }
}
