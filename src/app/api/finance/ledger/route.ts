import { reportServerError } from "@/lib/server/reportError";
/**
 * Every write to a clinic's ledger.
 *
 * The four screens that took payments each wrote to Firestore directly, and each built its row
 * differently — two of them omitted the dentist, the lab fee and the commission entirely, so that
 * money paid the dentist nothing and booked whole as clinic profit. Worse, the `finance.*`
 * permissions that were supposed to control all this only ever hid buttons: the security rules
 * granted write access on `ledger` to every member of the clinic, so anyone signed in could write
 * any row through the SDK regardless of what the screen showed them.
 *
 * Both problems are the same problem — the rules for money lived in the browser, where they are
 * suggestions. They live here now. This route is the only writer, and firestore.rules denies the
 * client, so:
 *
 *   - the permission check is real, not cosmetic;
 *   - a payment cannot be written without its attribution, because the server resolves it;
 *   - the lab fee is decided from the payments actually in the database, never from a client-sent
 *     "this is the first payment" flag;
 *   - a charge with money against it cannot be deleted, from any screen;
 *   - each change lands as one transaction, and leaves a before/after record behind.
 *
 * Reads are untouched and still go straight to Firestore, so every live screen stays live.
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { buildManualEntryRow, buildPaymentRow, type ProcedureLite, type StaffLite } from "@/lib/ledgerWrite";
import { buildDeleteContext, evaluateDelete, type DeleteTarget } from "@/lib/deletePolicy";
import { applyProcedureSync, readProcedureCommissionBasis, readProcedurePayments } from "@/lib/server/ledgerSync";
import { recordLedgerAudit, recordMoneyChange } from "@/lib/server/ledgerAudit";
import { recalcCommissionFromPayment } from "@/lib/ledgerCommission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Actor = { uid: string; name: string; role: string };

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

/** Only the fields a client is allowed to change, per row type. Everything else is derived. */
const EDITABLE_PAYMENT_FIELDS = ["date", "description", "paid", "method"] as const;
const EDITABLE_ENTRY_FIELDS = ["date", "description", "amount", "category", "method", "isRecurring"] as const;
/**
 * A treatment charge may have its date and its discount adjusted here — that is the edit the
 * patient-ledger screen offers. Everything that describes the treatment itself (which procedure,
 * which teeth, how many units, which dentist) belongs to the clinical route, which recomputes the
 * price, the lab fee and the payout together.
 */
const EDITABLE_PROCEDURE_FIELDS = ["date", "description", "discountMode", "discountPercent", "discountFixed", "listPrice"] as const;

/**
 * Apply a discount to a charge, server-side.
 *
 * The client used to compute this and send the result, which meant the stored cost was whatever
 * the browser said it was. The inputs are the list price and the discount the user chose; the
 * charged amount is derived from them here.
 */
function applyProcedureDiscount(args: {
  listPrice: number;
  mode: string;
  percent?: number | null;
  fixed?: number | null;
  fallbackCost: number;
}): { cost: number; listPrice: number; discountMode: string; discountPercent: number | null; discountFixed: number | null; discountAmount: number } {
  const list = Math.max(0, Number(args.listPrice) || 0) || Math.max(0, args.fallbackCost);

  if (args.mode === "percent") {
    const percent = Math.min(100, Math.max(0, Number(args.percent) || 0));
    const discountAmount = Math.round(((list * percent) / 100) * 100) / 100;
    return {
      cost: Math.max(0, Math.round((list - discountAmount) * 100) / 100),
      listPrice: list, discountMode: "percent", discountPercent: percent, discountFixed: null, discountAmount,
    };
  }
  if (args.mode === "fixed") {
    const fixed = Math.max(0, Number(args.fixed) || 0);
    const discountAmount = Math.min(list, fixed);
    return {
      cost: Math.max(0, Math.round((list - discountAmount) * 100) / 100),
      listPrice: list, discountMode: "fixed", discountPercent: null, discountFixed: fixed, discountAmount,
    };
  }
  return {
    cost: list, listPrice: list, discountMode: "none", discountPercent: null, discountFixed: null, discountAmount: 0,
  };
}

async function loadStaff(clinicId: string): Promise<StaffLite[]> {
  const snap = await adminClinicCollection(clinicId, "staff").get();
  return snap.docs.map((d) => ({
    id: d.id,
    name: typeof d.data().name === "string" ? d.data().name : null,
    commissionPercentage: Number(d.data().commissionPercentage) || 0,
  }));
}

// ---------------------------------------------------------------------------------------------
// create-payment
// ---------------------------------------------------------------------------------------------

async function createPayment(args: {
  clinicId: string;
  actor: Actor;
  body: Record<string, unknown>;
}) {
  const { clinicId, actor, body } = args;

  const patientId = String(body.patientId || "").trim();
  if (!patientId) return bad("A payment needs a patient.");

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return bad("Enter an amount greater than zero.");

  const procedureId = body.procedureId ? String(body.procedureId).trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : todayKey();

  const staff = await loadStaff(clinicId);

  const result = await adminDb().runTransaction(async (txn) => {
    let procedure: ProcedureLite | null = null;
    let procedureData: Record<string, unknown> | null = null;
    let siblings: Awaited<ReturnType<typeof readProcedurePayments>> = [];

    if (procedureId) {
      const procRef = adminClinicDoc(clinicId, "ledger", procedureId);
      const procSnap = await txn.get(procRef);
      if (!procSnap.exists) throw new Error("NO_PROCEDURE");
      procedureData = procSnap.data() || {};
      if (String(procedureData.type || "") !== "procedure") throw new Error("NOT_A_PROCEDURE");

      procedure = {
        id: procedureId,
        doctorId: typeof procedureData.doctorId === "string" ? procedureData.doctorId : null,
        doctorName: typeof procedureData.doctorName === "string" ? procedureData.doctorName : null,
        doctor: typeof procedureData.doctor === "string" ? procedureData.doctor : null,
        labFee: Number(procedureData.labFee) || 0,
        description: typeof procedureData.description === "string" ? procedureData.description : null,
      };

      // Read the existing payments here, inside the transaction, rather than trusting a client
      // flag. Whether this is the first payment decides who carries the lab fee, and a browser
      // that raced another receptionist would get that wrong in a way nobody would notice.
      siblings = await readProcedurePayments(txn, clinicId, procedureId);
    }

    const patientSnap = await txn.get(adminClinicDoc(clinicId, "patients", patientId));
    const patientName =
      (patientSnap.exists && typeof patientSnap.data()?.name === "string" && patientSnap.data()!.name) ||
      String(body.patientName || "") ||
      null;

    const basis = procedureData
      ? await readProcedureCommissionBasis(txn, clinicId, procedureData)
      : { labFee: 0, commissionPct: 0 };

    const newRef = adminClinicCollection(clinicId, "ledger").doc();

    // The set as it will stand once this payment exists — a transaction cannot read its own
    // writes, so the new row is added by hand for the rebalance below.
    const paymentsAfter = [...siblings, { id: newRef.id, date, paid: amount, amount }];
    const isFirst =
      [...paymentsAfter]
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.id.localeCompare(b.id))[0]
        ?.id === newRef.id;

    const row = buildPaymentRow({
      patientId,
      patientName,
      amount,
      method: typeof body.method === "string" ? body.method : "Cash",
      description: String(body.description || "").trim() || (procedure ? `Payment for ${procedure.description || "treatment"}` : "Payment on account"),
      date,
      procedure,
      appliedLabFee: isFirst ? basis.labFee : 0,
      staff,
      actor: { uid: actor.uid, name: actor.name },
      category: typeof body.category === "string" ? body.category : null,
    });

    txn.set(newRef, { ...row, createdAt: FieldValue.serverTimestamp() });

    if (procedureId) {
      applyProcedureSync(txn, {
        clinicId,
        procedureLedgerId: procedureId,
        payments: paymentsAfter,
        labFee: basis.labFee,
        commissionPct: basis.commissionPct,
      });
    }

    return { id: newRef.id, row, patientName };
  });

  await recordMoneyChange({
    entry: {
      clinicId,
      action: "create",
      collection: "ledger",
      documentId: result.id,
      after: result.row,
      actor,
      via: "finance/ledger:create-payment",
    },
    action: "Payment Received",
    details: `${amount} EGP from ${result.patientName || patientId}${procedureId ? ` toward ${procedureId}` : " (on account)"}`,
  });

  return NextResponse.json({ ok: true, id: result.id });
}

// ---------------------------------------------------------------------------------------------
// create-entry — clinic income or overhead, belonging to no patient
// ---------------------------------------------------------------------------------------------

async function createEntry(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const type = body.type === "income" ? "income" : body.type === "expense" ? "expense" : null;
  if (!type) return bad("An entry must be income or expense.");

  let row: Record<string, unknown>;
  try {
    row = buildManualEntryRow({
      type,
      amount: Number(body.amount),
      description: String(body.description || "").trim(),
      category: typeof body.category === "string" ? body.category : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : todayKey(),
      method: typeof body.method === "string" ? body.method : null,
      isRecurring: body.isRecurring === true,
      actor: { uid: actor.uid, name: actor.name },
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Could not save that entry.");
  }

  const ref = await adminClinicCollection(clinicId, "ledger").add({
    ...row,
    createdAt: FieldValue.serverTimestamp(),
  });

  await recordMoneyChange({
    entry: { clinicId, action: "create", collection: "ledger", documentId: ref.id, after: row, actor, via: "finance/ledger:create-entry" },
    action: type === "income" ? "Finance Entry Created" : "Finance Entry Created",
    details: `${type.toUpperCase()} ${row.amount} EGP - ${row.description}`,
  });

  return NextResponse.json({ ok: true, id: ref.id });
}

// ---------------------------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------------------------

async function updateRow(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which row?");
  const patch = (body.patch || {}) as Record<string, unknown>;

  const staff = await loadStaff(clinicId);

  const result = await adminDb().runTransaction(async (txn) => {
    const ref = adminClinicDoc(clinicId, "ledger", id);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const before = snap.data() || {};
    const type = String(before.type || "");

    const allowed =
      type === "payment"
        ? EDITABLE_PAYMENT_FIELDS
        : type === "procedure"
          ? EDITABLE_PROCEDURE_FIELDS
          : EDITABLE_ENTRY_FIELDS;
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (patch[key] !== undefined) update[key] = patch[key];
    }

    if (update.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(update.date))) {
      throw new Error("BAD_DATE");
    }

    if (type === "payment") {
      const paid = update.paid !== undefined ? Number(update.paid) : Number(before.paid ?? before.amount ?? 0);
      if (!Number.isFinite(paid) || paid <= 0) throw new Error("BAD_AMOUNT");
      update.paid = paid;
      // `amount` mirrors `paid` so the finance dashboard, which reads `amount` for non-procedure
      // rows, cannot disagree with the patient ledger, which reads `paid`.
      update.amount = paid;

      const procedureId = typeof before.procedureId === "string" ? before.procedureId : "";
      if (procedureId) {
        const procSnap = await txn.get(adminClinicDoc(clinicId, "ledger", procedureId));
        if (procSnap.exists) {
          const procedureData = procSnap.data() || {};
          const basis = await readProcedureCommissionBasis(txn, clinicId, procedureData);
          const siblings = await readProcedurePayments(txn, clinicId, procedureId);
          // The edited row's new figures, in the set the rebalance will see.
          const paymentsAfter = siblings.map((p) =>
            p.id === id ? { ...p, paid, date: String(update.date ?? before.date ?? "") } : p
          );
          applyProcedureSync(txn, {
            clinicId,
            procedureLedgerId: procedureId,
            payments: paymentsAfter,
            labFee: basis.labFee,
            commissionPct: basis.commissionPct,
          });
          // applyProcedureSync writes this row's commission too; keep the two writes consistent
          // by letting it win rather than computing a second answer here.
        } else {
          const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(
            paid,
            Number(before.labFee) || 0,
            Number(before.doctorCommissionPercentage) || 0
          );
          update.doctorCommissionAmount = doctorCommissionAmount;
          update.clinicProfit = clinicProfit;
        }
      } else {
        // Unallocated payment: no dentist, so nothing to recompute beyond the amount itself.
        const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(paid, 0, 0);
        update.doctorCommissionAmount = doctorCommissionAmount;
        update.clinicProfit = clinicProfit;
      }
    } else if (type === "income" || type === "expense") {
      if (update.amount !== undefined) {
        const amount = Number(update.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("BAD_AMOUNT");
        update.amount = amount;
        update.paid = type === "income" ? amount : 0;
        update.cost = type === "expense" ? amount : 0;
      }
    } else if (type === "procedure") {
      // Only the discount is adjustable here; what the treatment IS belongs to the clinical route.
      const discounted = applyProcedureDiscount({
        listPrice: Number(update.listPrice ?? before.listPrice ?? before.cost ?? 0),
        mode: String(update.discountMode ?? before.discountMode ?? "none"),
        percent: update.discountPercent !== undefined ? Number(update.discountPercent) : Number(before.discountPercent),
        fixed: update.discountFixed !== undefined ? Number(update.discountFixed) : Number(before.discountFixed),
        fallbackCost: Number(before.cost) || 0,
      });
      Object.assign(update, discounted, { amount: discounted.cost });

      // The dentist's share follows the discounted amount: the lab is paid in full either way, so
      // a discount comes out of what is left, not off the lab's invoice.
      const labFee = Number(before.labFee) || 0;
      const commissionPct = Number(before.doctorCommissionPercentage) || 0;
      const net = discounted.cost - labFee;
      update.doctorCommissionAmount = net > 0 ? Number((net * (commissionPct / 100)).toFixed(2)) : 0;
      update.clinicProfit = Number((discounted.cost - Number(update.doctorCommissionAmount) - labFee).toFixed(2));

      // The clinical note holds its own copy of the cost; leaving it stale would mean the next
      // save from the clinical screen silently undid the discount.
      const noteId = typeof before.clinicalNoteId === "string" ? before.clinicalNoteId : "";
      if (noteId) {
        txn.update(adminClinicDoc(clinicId, "clinical_notes", noteId), { cost: discounted.cost });
      }
    } else {
      throw new Error("UNKNOWN_ROW_TYPE");
    }

    if (Object.keys(update).length === 0) throw new Error("NOTHING_TO_DO");

    update.updatedAt = FieldValue.serverTimestamp();
    update.updatedByUid = actor.uid;
    update.updatedByName = actor.name;
    txn.update(ref, update);

    return { before, update, type };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "update", collection: "ledger", documentId: id,
      before: result.before, after: result.update, actor, via: "finance/ledger:update",
    },
    action: "Finance Entry Updated",
    details: `${result.type} ${id}`,
  });

  return NextResponse.json({ ok: true, id });
}

// ---------------------------------------------------------------------------------------------
// set-commission — the payout screen's manual split override
// ---------------------------------------------------------------------------------------------

/**
 * Set a payment's commission percentage by hand.
 *
 * The payout screen lets an Admin override the split on a single payment — a locum on different
 * terms, a case shared between two dentists, a correction agreed after the fact. The recalculation
 * is the same as everywhere else; what is different is that the result did NOT come from the
 * dentist's standing rate, and nothing recorded that.
 *
 * `commissionSetManually` is that record. It matters because a repair script cannot otherwise tell
 * a deliberate override from a row that was never computed properly, and "helpfully" recomputing
 * an override back to the standing rate silently reverses a decision someone made on purpose.
 */
async function setCommission(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which payment?");

  const percent = Number(body.commissionPercentage);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return bad("Enter a percentage between 0 and 100.");
  }

  const result = await adminDb().runTransaction(async (txn) => {
    const ref = adminClinicDoc(clinicId, "ledger", id);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const before = snap.data() || {};
    if (String(before.type || "") !== "payment") throw new Error("NOT_A_PAYMENT");

    const paid = Number(before.paid ?? before.amount ?? 0) || 0;
    const labFee = Number(before.labFee) || 0;
    const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(paid, labFee, percent);

    const update = {
      doctorCommissionPercentage: percent,
      doctorCommissionAmount,
      clinicProfit,
      commissionSetManually: true,
      commissionSetByUid: actor.uid,
      commissionSetByName: actor.name,
      commissionSetAt: FieldValue.serverTimestamp(),
    };
    txn.update(ref, update);
    return { before, update };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "update", collection: "ledger", documentId: id,
      before: result.before, after: result.update, actor, via: "finance/ledger:set-commission",
    },
    action: "Commission Split Updated",
    details: `Set the split on payment ${id} to ${percent}% by hand`,
  });

  return NextResponse.json({ ok: true, id });
}

// ---------------------------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------------------------

async function deleteRow(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which row?");

  const targetSnap = await adminClinicDoc(clinicId, "ledger", id).get();
  if (!targetSnap.exists) return bad("That row no longer exists.", 404);
  const target = targetSnap.data() || {};
  const type = String(target.type || "");

  // Everything that could be linked to this row, in either direction. Loaded outside the
  // transaction because deciding IF the delete may happen needs a query, and Firestore
  // transactions cannot run the `in` queries this would need against several note ids.
  const related: Array<{ id: string; type?: string; procedureId?: string | null; clinicalNoteId?: string | null }> = [];

  const clinicalNoteId = typeof target.clinicalNoteId === "string" ? target.clinicalNoteId : "";
  if (type === "procedure") {
    const paymentsSnap = await adminClinicCollection(clinicId, "ledger").where("procedureId", "==", id).get();
    for (const d of paymentsSnap.docs) {
      related.push({ id: d.id, type: String(d.data().type || ""), procedureId: id });
    }
    related.push({ id, type, clinicalNoteId: clinicalNoteId || null });
    if (clinicalNoteId) {
      const linkedSnap = await adminClinicCollection(clinicId, "ledger")
        .where("clinicalNoteId", "==", clinicalNoteId)
        .get();
      for (const d of linkedSnap.docs) {
        if (d.id === id) continue;
        related.push({ id: d.id, type: String(d.data().type || ""), clinicalNoteId });
      }
    }
  } else {
    related.push({
      id,
      type,
      procedureId: typeof target.procedureId === "string" ? target.procedureId : null,
      clinicalNoteId: clinicalNoteId || null,
    });
  }

  const context = buildDeleteContext(related);
  const deleteTarget: DeleteTarget =
    type === "procedure"
      ? { kind: "ledger-procedure", id }
      : type === "payment"
        ? { kind: "ledger-payment", id, procedureId: typeof target.procedureId === "string" ? target.procedureId : null }
        : { kind: "ledger-entry", id };

  const verdict = evaluateDelete(deleteTarget, context);
  if (!verdict.allowed) {
    return NextResponse.json(
      { ok: false, error: verdict.message, reason: verdict.reason, blockingPaymentIds: verdict.blockingPaymentIds },
      { status: 409 }
    );
  }

  await adminDb().runTransaction(async (txn) => {
    // Rebalance first: reading the remaining payments has to happen before any delete is queued,
    // because a transaction cannot read after it writes.
    for (const procedureId of verdict.resyncProcedureIds) {
      const procSnap = await txn.get(adminClinicDoc(clinicId, "ledger", procedureId));
      if (!procSnap.exists) continue;
      const basis = await readProcedureCommissionBasis(txn, clinicId, procSnap.data() || {});
      const siblings = await readProcedurePayments(txn, clinicId, procedureId);
      const remaining = siblings.filter((p) => !verdict.cascade.some((c) => c.id === p.id));
      applyProcedureSync(txn, {
        clinicId,
        procedureLedgerId: procedureId,
        payments: remaining,
        labFee: basis.labFee,
        commissionPct: basis.commissionPct,
      });
    }

    for (const item of verdict.cascade) {
      txn.delete(adminClinicDoc(clinicId, item.collection, item.id));
    }
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "delete", collection: "ledger", documentId: id,
      before: target, actor, via: "finance/ledger:delete",
    },
    action: "Finance Entry Deleted",
    details: `Deleted ${type} ${id}: ${String(target.description || "")}`,
    severity: "HIGH",
  });

  // Cascaded rows are recorded individually so each is searchable by its own id.
  for (const item of verdict.cascade) {
    if (item.id === id) continue;
    await recordLedgerAudit({
      clinicId, action: "delete", collection: item.collection, documentId: item.id,
      actor, via: "finance/ledger:delete (cascade)",
    });
  }

  return NextResponse.json({ ok: true, deleted: verdict.cascade });
}

// ---------------------------------------------------------------------------------------------

const PERMISSION_BY_ACTION: Record<string, string> = {
  "create-payment": "finance.add",
  "create-entry": "finance.add",
  update: "finance.edit",
  "set-commission": "finance.edit",
  delete: "finance.delete",
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

  // Membership is proved before the permission is checked, and the clinic is resolved from the
  // authenticated user — a clinicId in a request body is just a string an attacker can change.
  const authz = await requireStaffPermission(request, requestedClinicId || undefined, permission);
  if (!authz.ok) return authz.response;

  let clinicId: string;
  try {
    clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "No clinic for this account.", 403);
  }

  const actor: Actor = { uid: authz.uid, name: authz.name, role: authz.role };

  try {
    switch (action) {
      case "create-payment":
        return await createPayment({ clinicId, actor, body });
      case "create-entry":
        return await createEntry({ clinicId, actor, body });
      case "update":
        return await updateRow({ clinicId, actor, body });
      case "set-commission":
        return await setCommission({ clinicId, actor, body });
      case "delete":
        return await deleteRow({ clinicId, actor, body });
      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    switch (message) {
      case "NO_PROCEDURE":
        return bad("That treatment no longer exists. Refresh and try again.", 404);
      case "NOT_A_PROCEDURE":
        return bad("A payment can only be linked to a treatment charge.");
      case "NOT_FOUND":
        return bad("That row no longer exists. Refresh and try again.", 404);
      case "NOT_A_PAYMENT":
        return bad("Only a payment carries a commission split.");
      case "BAD_AMOUNT":
        return bad("Enter an amount greater than zero.");
      case "BAD_DATE":
        return bad("Enter a valid date.");
      case "NOTHING_TO_DO":
        return bad("Nothing to change.");
      case "UNKNOWN_ROW_TYPE":
        return bad("That row cannot be edited here.");
      default:
        reportServerError("finance/ledger failed", e, { action });
        return bad("Something went wrong saving that. Nothing was changed.", 500);
    }
  }
}
