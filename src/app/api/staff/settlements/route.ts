import { reportServerError } from "@/lib/server/reportError";
/**
 * Money the clinic paid a staff member, or held back from them.
 *
 * POST { clinicId, action: "create" | "update" | "delete", ... }
 *   create: { staffId, kind: "payout" | "deduction", amount, date, note? }
 *   update: { id, amount?, date?, note? }           (the kind never changes: delete and re-enter)
 *   delete: { id }
 *
 * Admins only. A payout is cash leaving the clinic, so it also writes a "Salary" expense row on the
 * ledger, in the same transaction, and keeps its id; editing or deleting the payout carries the
 * change to that row, and the ledger route refuses to touch such a row on its own (`settlementId`),
 * so the two can never disagree. A deduction moves no cash and writes nothing on the ledger.
 *
 * After every write the dentist's rows are restamped with what is now paid on each
 * (`lib/server/staffSettlementSync.ts`), so the Finance page can read paid and pending off a row.
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { buildManualEntryRow } from "@/lib/ledgerWrite";
import { recordMoneyChange } from "@/lib/server/ledgerAudit";
import { logActivityServer } from "@/lib/server/systemLog";
import { isSettlementKind, SETTLEMENTS_COLLECTION } from "@/lib/staffSettlement";
import { restampStaffSettlements } from "@/lib/server/staffSettlementSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The expense category a payout files under: the one the Finance page already offers. */
const PAYOUT_CATEGORY = "Salary";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Actor = { uid: string; name: string; role: string };

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function payoutDescription(staffName: string): string {
  return `Staff pay – ${staffName}`;
}

/** The ledger row a payout writes: the Finance page's own manual-expense shape plus the link back. */
function payoutRow(args: { staffId: string; staffName: string; settlementId: string; amount: number; date: string; note: string; actor: Actor }) {
  return {
    ...buildManualEntryRow({
      type: "expense",
      amount: args.amount,
      description: payoutDescription(args.staffName),
      category: PAYOUT_CATEGORY,
      date: args.date,
      method: "Cash",
      isRecurring: false,
      actor: { uid: args.actor.uid, name: args.actor.name },
    }),
    staffId: args.staffId,
    settlementId: args.settlementId,
    note: args.note,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }
  const action = String(body.action || "");
  const requestedClinicId = typeof body.clinicId === "string" ? body.clinicId : null;

  const authz = await requireAdminUser(request, requestedClinicId || undefined);
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
      case "create":
        return await create({ clinicId, actor, body });
      case "update":
        return await update({ clinicId, actor, body });
      case "delete":
        return await remove({ clinicId, actor, body });
      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "NOT_FOUND") return bad("That entry no longer exists. Refresh and try again.", 404);
    reportServerError("staff/settlements failed", e, { action });
    return bad("Something went wrong saving that. Nothing was changed.", 500);
  }
}

function readAmount(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? money(n) : null;
}

async function create(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const staffId = String(body.staffId || "").trim();
  const kind = body.kind;
  const amount = readAmount(body.amount);
  const date = String(body.date || "");
  const note = String(body.note || "").trim().slice(0, 500);
  if (!staffId) return bad("Which staff member?");
  if (!isSettlementKind(kind)) return bad("An entry is a payout or a deduction.");
  if (amount === null) return bad("Enter an amount greater than zero.");
  if (!ISO_DATE.test(date)) return bad("Enter a valid date.");

  const staffSnap = await adminClinicDoc(clinicId, "staff", staffId).get();
  if (!staffSnap.exists) return bad("That staff member no longer exists.", 404);
  const staffName = String(staffSnap.get("name") || "").trim() || "Staff";

  const settlementRef = adminClinicCollection(clinicId, SETTLEMENTS_COLLECTION).doc();
  const ledgerRef = kind === "payout" ? adminClinicCollection(clinicId, "ledger").doc() : null;
  const row = ledgerRef ? payoutRow({ staffId, staffName, settlementId: settlementRef.id, amount, date, note, actor }) : null;

  await adminDb().runTransaction(async (tx) => {
    tx.set(settlementRef, {
      staffId,
      staffName,
      kind,
      amount,
      date,
      note,
      ledgerId: ledgerRef?.id ?? null,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actor.uid,
      createdByName: actor.name,
    });
    if (ledgerRef && row) tx.set(ledgerRef, { ...row, createdAt: FieldValue.serverTimestamp() });
  });

  if (ledgerRef && row) {
    await recordMoneyChange({
      entry: { clinicId, action: "create", collection: "ledger", documentId: ledgerRef.id, after: row, actor, via: "staff/settlements:create" },
      action: "Staff Paid",
      details: `${amount} EGP paid to ${staffName} on ${date}`,
    });
  } else {
    await logActivityServer({ clinicId, user: actor, action: "Staff Deduction Recorded", details: `${amount} EGP held from ${staffName} on ${date}${note ? ` — ${note}` : ""}`, severity: "MEDIUM", module: "finance" });
  }
  await restamp(clinicId, staffId);
  return NextResponse.json({ ok: true, id: settlementRef.id, ledgerId: ledgerRef?.id ?? null });
}

async function update(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which entry?");
  const patch: Record<string, unknown> = {};
  if (body.amount !== undefined) {
    const amount = readAmount(body.amount);
    if (amount === null) return bad("Enter an amount greater than zero.");
    patch.amount = amount;
  }
  if (body.date !== undefined) {
    if (!ISO_DATE.test(String(body.date))) return bad("Enter a valid date.");
    patch.date = String(body.date);
  }
  if (body.note !== undefined) patch.note = String(body.note || "").trim().slice(0, 500);
  if (Object.keys(patch).length === 0) return bad("Nothing to change.");

  const ref = adminClinicDoc(clinicId, SETTLEMENTS_COLLECTION, id);
  const outcome = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const before = snap.data() || {};
    const ledgerId = typeof before.ledgerId === "string" ? before.ledgerId : "";
    const ledgerRef = ledgerId ? adminClinicDoc(clinicId, "ledger", ledgerId) : null;
    const ledgerSnap = ledgerRef ? await tx.get(ledgerRef) : null;

    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid, updatedByName: actor.name });
    let ledgerBefore: Record<string, unknown> | null = null;
    let ledgerAfter: Record<string, unknown> | null = null;
    if (ledgerRef && ledgerSnap?.exists) {
      ledgerBefore = ledgerSnap.data() || {};
      const rowPatch: Record<string, unknown> = {};
      if (patch.amount !== undefined) {
        rowPatch.amount = patch.amount;
        rowPatch.cost = patch.amount;
      }
      if (patch.date !== undefined) rowPatch.date = patch.date;
      if (patch.note !== undefined) rowPatch.note = patch.note;
      tx.update(ledgerRef, rowPatch);
      ledgerAfter = { ...ledgerBefore, ...rowPatch };
    }
    return { staffId: String(before.staffId || ""), staffName: String(before.staffName || ""), ledgerId, ledgerBefore, ledgerAfter };
  });

  if (outcome.ledgerBefore && outcome.ledgerAfter) {
    await recordMoneyChange({
      entry: { clinicId, action: "update", collection: "ledger", documentId: outcome.ledgerId, before: outcome.ledgerBefore, after: outcome.ledgerAfter, actor, via: "staff/settlements:update" },
      action: "Staff Payment Edited",
      details: `Payout to ${outcome.staffName} changed`,
    });
  }
  await restamp(clinicId, outcome.staffId);
  return NextResponse.json({ ok: true });
}

async function remove(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which entry?");

  const ref = adminClinicDoc(clinicId, SETTLEMENTS_COLLECTION, id);
  const outcome = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const before = snap.data() || {};
    const ledgerId = typeof before.ledgerId === "string" ? before.ledgerId : "";
    const ledgerRef = ledgerId ? adminClinicDoc(clinicId, "ledger", ledgerId) : null;
    const ledgerSnap = ledgerRef ? await tx.get(ledgerRef) : null;
    tx.delete(ref);
    let ledgerBefore: Record<string, unknown> | null = null;
    if (ledgerRef && ledgerSnap?.exists) {
      ledgerBefore = ledgerSnap.data() || {};
      tx.delete(ledgerRef);
    }
    return { staffId: String(before.staffId || ""), staffName: String(before.staffName || ""), amount: Number(before.amount) || 0, ledgerId, ledgerBefore };
  });

  if (outcome.ledgerBefore) {
    await recordMoneyChange({
      entry: { clinicId, action: "delete", collection: "ledger", documentId: outcome.ledgerId, before: outcome.ledgerBefore, actor, via: "staff/settlements:delete" },
      action: "Staff Payment Deleted",
      details: `${outcome.amount} EGP payout to ${outcome.staffName} removed`,
    });
  } else {
    await logActivityServer({ clinicId, user: actor, action: "Staff Deduction Removed", details: `${outcome.amount} EGP deduction from ${outcome.staffName} removed`, severity: "MEDIUM", module: "finance" });
  }
  await restamp(clinicId, outcome.staffId);
  return NextResponse.json({ ok: true });
}

/** The settlement is saved either way; a stamping failure is reported, not turned into a refusal. */
async function restamp(clinicId: string, staffId: string): Promise<void> {
  if (!staffId) return;
  try {
    await restampStaffSettlements(clinicId, staffId);
  } catch (e) {
    reportServerError("staff/settlements restamp failed", e, { clinicId, staffId });
  }
}
