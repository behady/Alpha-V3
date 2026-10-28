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
import {
  buildManualEntryRow,
  buildPaymentRow,
  resolveDoctorForPayment,
  sumPayments,
  type ProcedureLite,
  type StaffLite,
} from "@/lib/ledgerWrite";
import {
  allocationMessage,
  chargeAmount,
  checkAllocation,
  OVER_ALLOCATION_CODE,
  type AllocationVerdict,
} from "@/lib/paymentAllocation";
import { buildDeleteContext, evaluateDelete, type DeleteTarget } from "@/lib/deletePolicy";
import { applyProcedureSync, readProcedureCommissionBasis, readProcedurePayments, treatmentHasDentist } from "@/lib/server/ledgerSync";
import { recordLedgerAudit, recordLedgerAuditBatch, recordMoneyChange } from "@/lib/server/ledgerAudit";
import { recalcCommissionFromPayment } from "@/lib/ledgerCommission";
import { allowedDiscount, checkDiscountAllowed, isDiscountMode } from "@/lib/discountMath";
import { afterLedgerCreate, afterLedgerDelete, afterLedgerUpdate } from "@/lib/alerts/moneyAlerts";
import { DISCOUNTS_DOC, parseDiscountSettings } from "@/lib/priceLists";
import { PAST_DAY_LOCKED, PAST_DAY_LOCKED_MESSAGE, refusesPastPayment, refusesPastPaymentEdit } from "@/lib/pastDayLock";
import { isFullAccessRole } from "@/lib/permissions";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { INSURER_PAYMENT_METHOD, isApprovalRow, isCompanyRow } from "@/lib/ledgerInsurer";
import { insurerRows, type LedgerLite } from "@/lib/insurerLedger";
import { PRIVATE_PAYER_ID } from "@/lib/payers";
import { LOCATIONS_DOC, parseClinicBranches } from "@/lib/clinicLocations";
import { logActivityServer } from "@/lib/server/systemLog";
import { isDownloadUrlFor, isOwnReceiptPath, RECEIPT_CATEGORY_IDS, RECEIPT_MAX_LINES } from "@/lib/receiptScan";
import { assertBranchAllowed, assertRowBranchAllowed, automaticBranch } from "@/lib/server/branchAccess";
import {
  RECEIPT_SETTINGS_DOC,
  formatReceiptNumber,
  normalizeReceiptSettings,
  receiptCounterDocId,
  receiptPrefixOrClinic,
} from "@/lib/receiptSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Actor = { uid: string; name: string; role: string };

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * A payment that would settle more than its treatment is worth.
 *
 * Thrown from inside a transaction, so it has to survive being caught by the dispatcher. It
 * carries the numbers rather than a sentence, because the browser needs the remaining amount to
 * offer "record that much and put the rest on account" — a refusal that only says no leaves the
 * receptionist holding the patient's money with nowhere to put it.
 */
/**
 * A discount this person may not give, or one with no reason behind it.
 *
 * The clinical route has asked both questions since discounts existed; this one never did, so the
 * same discount refused on the treatment screen went through unchallenged from any screen that
 * edits a charge. A ceiling enforced in one of two doors is not a ceiling.
 */
class DiscountRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountRefusedError";
  }
}

class OverAllocationError extends Error {
  readonly verdict: Extract<AllocationVerdict, { ok: false }>;
  readonly description: string | null;

  constructor(verdict: Extract<AllocationVerdict, { ok: false }>, description: string | null) {
    super("OVER_ALLOCATION");
    this.name = "OverAllocationError";
    this.verdict = verdict;
    this.description = description;
  }
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Whether the clinic has turned on the past-day lock, read only when it could matter: an Owner or
 * Admin is never refused, so their writes do not pay for the settings read.
 */
async function pastDayLockOn(clinicId: string, actor: Actor): Promise<boolean> {
  if (isFullAccessRole(actor.role)) return false;
  const snap = await adminClinicDoc(clinicId, "settings", DISCOUNTS_DOC).get();
  return parseDiscountSettings(snap.data() ?? null).lockPastPaymentsNonAdmin;
}

/** Today in the clinic's zone: the day the lock calls open. Not `todayKey`, which is UTC. */
const clinicToday = () => ymdInTimeZone(clinicTimeZone());

/** Rounded the way the row will store it (ledgerWrite's rule), so a figure is judged as saved. */
function money(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
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
const EDITABLE_PROCEDURE_FIELDS = ["date", "description", "discountMode", "discountPercent", "discountFixed", "discountReason", "listPrice"] as const;
/**
 * A treatment written by an insurance approval is priced by the approval: the insurer's approved
 * part plus the patient's share, with the dentist's share stamped from the approval. Re-pricing it
 * here (or from the catalogue) would charge the paper's list price. Only these may change here;
 * everything else changes on the patient's Insurance tab.
 */
const EDITABLE_APPROVAL_ROW_FIELDS = ["date", "description", "note"] as const;
const APPROVAL_ROW_LOCKED_FIELDS = ["listPrice", "discountMode", "discountPercent", "discountFixed", "cost", "amount", "doctorId", "payerId"] as const;
const APPROVAL_ROW_MESSAGE = "This treatment comes from an insurance approval; change it on the patient's Insurance tab.";
/** An expense row written by a staff payout (`settlementId`): the payout on the Team page owns it. */
const SETTLEMENT_ROW_MESSAGE = "This is a staff payout; change or delete it on the Team page.";
/** The branch a row was stamped with when it was written is permanent; money does not move between branches by edit. */
const BRANCH_LOCKED_MESSAGE = "A row's branch can't be changed after it is saved.";

/**
 * Does a posted value differ from the stored one? Screens re-send the price fields on every save,
 * so an unchanged figure is not an edit: blank and null agree, and numbers compare as numbers.
 */
function differsFromStored(posted: unknown, stored: unknown): boolean {
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  if (blank(posted) && blank(stored)) return false;
  if (blank(posted) || blank(stored)) return true;
  const a = Number(posted);
  const b = Number(stored);
  if (typeof posted !== "boolean" && Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) > 0.005;
  return String(posted) !== String(stored);
}

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

  // Rounded before it is judged: the row stores two decimals, so 0.001 passed a "> 0" check and
  // then landed as a numbered 0.00 receipt.
  const amount = money(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 0.01) return bad("Enter an amount greater than zero.");

  const procedureId = body.procedureId ? String(body.procedureId).trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : todayKey();

  // Only a date the screen chose: the default above is the server's own (UTC) day, which just
  // after midnight in Cairo is yesterday, and a payment taken then is not being backdated.
  const sentDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : "";
  if (sentDate && sentDate < clinicToday()) {
    const locked = await pastDayLockOn(clinicId, actor);
    if (refusesPastPayment({ locked, role: actor.role, today: clinicToday(), date: sentDate })) return bad(PAST_DAY_LOCKED_MESSAGE, 403);
  }

  // The payment belongs to the branch on screen, even when the charge it settles was made at another.
  // The phone sends no branch: then the settled charge's own, its visit's, the patient's, the first.
  const branch = await assertBranchAllowed({
    clinicId, uid: actor.uid, role: actor.role, branchId: body.branchId,
    fallback: (branches) => automaticBranch(clinicId, branches, { ledgerId: procedureId || null, patientId }),
  });
  if (!branch.ok) return branch.response;

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
      // One patient's money settles only their own treatment — the same rule the edit path holds.
      // Without it a mistyped procedure id put patient A's receipt against patient B's balance.
      if (String(procedureData.patientId || "") !== patientId) throw new Error("WRONG_PATIENT");
      // A company's treatment (Gasco, no paper) is the company's bill, whole: the patient owes
      // nothing on it, and their cash is credit on account. The company's money comes in through
      // insurer-collect, never here.
      if (isCompanyRow(procedureData)) throw new Error("COMPANY_ROW");
      // The owner's rule: money from a patient for a treatment names the dentist who did it.
      if (!treatmentHasDentist(procedureData)) throw new Error("NO_DENTIST");

      procedure = {
        id: procedureId,
        doctorId: typeof procedureData.doctorId === "string" ? procedureData.doctorId : null,
        doctorName: typeof procedureData.doctorName === "string" ? procedureData.doctorName : null,
        doctor: typeof procedureData.doctor === "string" ? procedureData.doctor : null,
        labFee: Number(procedureData.labFee) || 0,
        description: typeof procedureData.description === "string" ? procedureData.description : null,
        // Carried from the treatment, never from the request. Who paid for a case is settled when
        // the case is recorded; a payment screen must not be able to move revenue between an
        // insurer and the clinic's own books.
        payerId: typeof procedureData.payerId === "string" ? procedureData.payerId : null,
        payerName: typeof procedureData.payerName === "string" ? procedureData.payerName : null,
      };

      // Read the existing payments here, inside the transaction, rather than trusting a client
      // flag. Whether this is the first payment decides who carries the lab fee, and a browser
      // that raced another receptionist would get that wrong in a way nobody would notice.
      siblings = await readProcedurePayments(txn, clinicId, procedureId);

      // Does this fit? Asked here, inside the transaction, against the payments actually in the
      // database — a browser that checked against a stale list, or one of the three screens that
      // did not check at all, is exactly how 1,200 EGP came to settle a 200 EGP consultation.
      const verdict = checkAllocation({
        cost: chargeAmount(procedureData),
        otherPaymentsTotal: sumPayments(siblings),
        amount,
      });
      if (!verdict.ok) throw new OverAllocationError(verdict, procedure.description ?? null);
    }

    const patientSnap = await txn.get(adminClinicDoc(clinicId, "patients", patientId));
    // Every screen that takes money starts from a patient on file (booking creates one), so a
    // missing doc is another clinic's id or a patient already in the bin — not a walk-in.
    if (!patientSnap.exists) throw new Error("NO_PATIENT");
    const patientName =
      (typeof patientSnap.data()?.name === "string" && patientSnap.data()!.name) ||
      String(body.patientName || "") ||
      null;

    const basis = procedureData
      ? await readProcedureCommissionBasis(txn, clinicId, procedureData)
      : { labFee: 0, commissionPct: 0 };

    // The receipt number, minted here so it can never be skipped or handed out twice: the counter
    // and the payment land in the same transaction, and a retry replays both. Read before any
    // write, as Firestore transactions require. A payment at a branch is numbered from that
    // branch's own counter and prefix (HEL-0001), so two branches never share a sequence.
    const counterRef = adminClinicDoc(clinicId, "settings", receiptCounterDocId(branch.branchId));
    const [receiptSettingsSnap, counterSnap] = await Promise.all([
      txn.get(adminClinicDoc(clinicId, "settings", RECEIPT_SETTINGS_DOC)),
      txn.get(counterRef),
    ]);
    const receiptSettings = normalizeReceiptSettings(receiptSettingsSnap.exists ? receiptSettingsSnap.data() : null);
    const receiptSeq = (Number(counterSnap.exists ? counterSnap.data()?.last : 0) || 0) + 1;
    const receiptNumber = formatReceiptNumber(receiptSettings, receiptSeq, date, receiptPrefixOrClinic(branch.branch, branch.branches));

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
      // The share this payment can absorb; the rebalance below settles the rest across the others.
      appliedLabFee: isFirst ? Math.min(basis.labFee, amount) : 0,
      staff,
      actor: { uid: actor.uid, name: actor.name },
      category: typeof body.category === "string" ? body.category : null,
    });

    txn.set(newRef, {
      ...row,
      ...(branch.branchId ? { branchId: branch.branchId } : {}),
      receiptNumber,
      receiptSeq,
      createdAt: FieldValue.serverTimestamp(),
    });
    txn.set(
      counterRef,
      { last: receiptSeq, lastReceiptNumber: receiptNumber, updatedAt: new Date().toISOString() },
      { merge: true }
    );

    if (procedureId) {
      applyProcedureSync(txn, {
        clinicId,
        procedureLedgerId: procedureId,
        payments: paymentsAfter,
        labFee: basis.labFee,
        commissionPct: basis.commissionPct,
      });
    }

    return {
      id: newRef.id,
      row: { ...row, ...(branch.branchId ? { branchId: branch.branchId } : {}), receiptNumber, receiptSeq },
      patientName,
      receiptNumber,
    };
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

  void afterLedgerCreate(clinicId, result.row as Record<string, unknown>, actor);
  return NextResponse.json({ ok: true, id: result.id, receiptNumber: result.receiptNumber });
}

// ---------------------------------------------------------------------------------------------
// insurer-collect — the insurance company paid for treatments: record it, row by row or all at once
// ---------------------------------------------------------------------------------------------

const INSURER_COLLECT_MAX = 100;

/** Everything chosen is already settled (or is collected on the Insurance page). Thrown inside the transaction so a race reads the same as a repeat call. */
class NothingToCollectError extends Error {
  constructor() {
    super("NOTHING_TO_COLLECT");
    this.name = "NothingToCollectError";
  }
}

function nothingToCollect() {
  return NextResponse.json(
    { ok: false, reason: "NOTHING_TO_DO", error: "There is nothing left to collect on those treatments. / مفيش مبلغ متبقي يتحصّل على العلاجات دي." },
    { status: 409 },
  );
}

/**
 * Record that an insurance company paid what it owes on a list of treatments.
 *
 * Each treatment gets one payment for exactly what is still unpaid (`insurerRows`' outstanding:
 * cost less the patient's cash and the company's earlier money), never the full cost, so a charge the
 * patient part-paid is settled for the rest. A row with nothing outstanding, or one written by an
 * approval (collected on the Insurance page), is skipped; when nothing is left the answer is a 409.
 *
 * Insurer money follows the work, not the screen: each payment takes the CHARGE's branch and is
 * numbered from that branch's counter, so one company paying for both branches at once lands each
 * receipt where the treatment was done. The branch the browser sends is deliberately not read.
 *
 * The figures are worked out twice: once outside the transaction to refuse early (404, 400, 403,
 * 409), and again inside it from the rows actually in the database, so two people pressing the
 * button together cannot both pay the same row.
 */
async function insurerCollect(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;

  const payerId = typeof body.payerId === "string" ? body.payerId.trim() : "";
  if (!payerId || payerId === PRIVATE_PAYER_ID) return bad("Choose the insurance company that paid.");
  const chargeIds = Array.isArray(body.chargeIds)
    ? [...new Set(body.chargeIds.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean))]
    : [];
  if (chargeIds.length === 0) return bad("Choose at least one treatment to collect.");
  if (chargeIds.length > INSURER_COLLECT_MAX) return bad(`Collect at most ${INSURER_COLLECT_MAX} treatments at a time.`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : todayKey();

  const ledgerCol = adminClinicCollection(clinicId, "ledger");
  const snaps = await adminDb().getAll(...chargeIds.map((id) => ledgerCol.doc(id)));
  const loaded = new Map<string, Record<string, unknown>>();
  for (const snap of snaps) {
    if (!snap.exists) return bad("A treatment you chose no longer exists. Refresh and try again.", 404);
    const data = snap.data() || {};
    if (String(data.type || "") !== "procedure") return bad("Only a treatment can be collected from the insurance company.");
    if (String(data.payerId || "").trim() !== payerId) return bad("A treatment you chose belongs to another payer. Refresh and try again.");
    loaded.set(snap.id, data);
  }

  // What each one has had paid against it so far, to find what is still owed.
  const paymentSnaps = await Promise.all(
    chargeIds.map((id) => ledgerCol.where("procedureId", "==", id).where("type", "==", "payment").get()),
  );
  const lite: LedgerLite[] = chargeIds.map((id) => ({ id, ...(loaded.get(id) as Record<string, unknown>) }));
  for (const snap of paymentSnaps) for (const d of snap.docs) lite.push({ id: d.id, ...(d.data() as Record<string, unknown>) });
  // Approval rows are collected through their claim (the claims route), never here: paying them
  // from both doors would pay the company's money twice.
  const wanted = insurerRows(lite, payerId).filter((r) => r.collectable && !r.viaClaim);
  if (wanted.length === 0) return nothingToCollect();

  // The owner's rule: money for a treatment names the dentist who did it.
  for (const r of wanted) if (!treatmentHasDentist(loaded.get(r.charge.id))) throw new Error("NO_DENTIST");

  // Whose money may this person move? The charge's own branch decides, and one refusal refuses all.
  const locations = await adminClinicDoc(clinicId, "settings", LOCATIONS_DOC).get();
  const branches = parseClinicBranches(locations.exists ? locations.data() : null);
  const live = (v: unknown) => (typeof v === "string" && branches.some((b) => b.id === v) ? v : null);
  const branchOf = new Map<string, string | null>();
  const checked = new Set<string>();
  for (const r of wanted) {
    const data = loaded.get(r.charge.id) as Record<string, unknown>;
    const own = live(data.branchId);
    if (own) {
      if (!checked.has(own)) {
        const verdict = await assertRowBranchAllowed({ clinicId, uid: actor.uid, role: actor.role, rowBranchId: own });
        if (!verdict.ok) return verdict.response;
        checked.add(own);
      }
      branchOf.set(r.charge.id, own);
    } else if (branches.length === 0) {
      branchOf.set(r.charge.id, null);
    } else {
      // Work from before branches, or from a branch since closed: the visit's, the patient's, the first.
      const fallback = await assertBranchAllowed({
        clinicId, uid: actor.uid, role: actor.role, branchId: undefined,
        fallback: (bs) => automaticBranch(clinicId, bs, { ledgerId: r.charge.id, patientId: typeof data.patientId === "string" ? data.patientId : null }),
      });
      if (!fallback.ok) return fallback.response;
      branchOf.set(r.charge.id, fallback.branchId);
    }
  }

  const staff = await loadStaff(clinicId);

  let result: { paid: number; count: number; receiptNumbers: string[]; written: Array<{ id: string; row: Record<string, unknown> }> };
  try {
    result = await adminDb().runTransaction(async (txn) => {
      // ---- reads (a transaction takes all of them before its first write) ----
      const fresh: Array<{ id: string; data: Record<string, unknown>; payments: Awaited<ReturnType<typeof readProcedurePayments>> }> = [];
      for (const { charge } of wanted) {
        const snap = await txn.get(adminClinicDoc(clinicId, "ledger", charge.id));
        if (!snap.exists) continue;
        fresh.push({ id: charge.id, data: snap.data() || {}, payments: await readProcedurePayments(txn, clinicId, charge.id) });
      }
      const rows: LedgerLite[] = [];
      for (const f of fresh) {
        rows.push({ id: f.id, ...f.data });
        for (const p of f.payments) rows.push({ id: p.id, type: "payment", procedureId: f.id, paid: p.paid, amount: p.amount, method: p.method });
      }
      const todo = insurerRows(rows, payerId).filter((r) => r.collectable && !r.viaClaim);
      if (todo.length === 0) throw new NothingToCollectError();

      const bases = new Map<string, Awaited<ReturnType<typeof readProcedureCommissionBasis>>>();
      for (const t of todo) bases.set(t.charge.id, await readProcedureCommissionBasis(txn, clinicId, fresh.find((f) => f.id === t.charge.id)!.data));

      const receiptSettings = normalizeReceiptSettings(
        (await txn.get(adminClinicDoc(clinicId, "settings", RECEIPT_SETTINGS_DOC))).data() ?? null,
      );
      // One counter per branch, however many of its charges are in the batch.
      const counters = new Map<string, { ref: FirebaseFirestore.DocumentReference; seq: number }>();
      for (const t of todo) {
        const branchId = branchOf.get(t.charge.id) ?? null;
        const key = branchId ?? "";
        if (counters.has(key)) continue;
        const ref = adminClinicDoc(clinicId, "settings", receiptCounterDocId(branchId));
        const snap = await txn.get(ref);
        counters.set(key, { ref, seq: Number(snap.exists ? snap.data()?.last : 0) || 0 });
      }

      // ---- writes ----
      const written: Array<{ id: string; row: Record<string, unknown> }> = [];
      const lastNumber = new Map<string, string>();
      let paid = 0;
      for (const t of todo) {
        const f = fresh.find((x) => x.id === t.charge.id)!;
        const basis = bases.get(t.charge.id)!;
        const branchId = branchOf.get(t.charge.id) ?? null;
        const counter = counters.get(branchId ?? "")!;
        counter.seq += 1;
        const branch = branchId ? branches.find((b) => b.id === branchId) ?? null : null;
        const receiptNumber = formatReceiptNumber(receiptSettings, counter.seq, date, receiptPrefixOrClinic(branch, branches));
        lastNumber.set(branchId ?? "", receiptNumber);

        const amount = t.outstanding;
        const newRef = adminClinicCollection(clinicId, "ledger").doc();
        const paymentsAfter = [...f.payments, { id: newRef.id, date, paid: amount, amount }];
        const isFirst =
          [...paymentsAfter].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.id.localeCompare(b.id))[0]?.id === newRef.id;
        const text = (v: unknown) => (typeof v === "string" ? v : null);
        const procedure: ProcedureLite = {
          id: f.id,
          doctorId: text(f.data.doctorId),
          doctorName: text(f.data.doctorName),
          doctor: text(f.data.doctor),
          labFee: Number(f.data.labFee) || 0,
          description: text(f.data.description),
          payerId: text(f.data.payerId),
          payerName: text(f.data.payerName),
        };
        const row = buildPaymentRow({
          patientId: String(f.data.patientId || ""),
          patientName: text(f.data.patientName),
          amount,
          method: INSURER_PAYMENT_METHOD,
          description: `Insurance payment from ${procedure.payerName || "the insurer"} for ${procedure.description || "treatment"}`,
          date,
          procedure,
          appliedLabFee: isFirst ? Math.min(basis.labFee, amount) : 0,
          staff,
          actor: { uid: actor.uid, name: actor.name },
        });
        const stored = {
          ...row,
          ...(branchId ? { branchId } : {}),
          receiptNumber,
          receiptSeq: counter.seq,
        };
        txn.set(newRef, { ...stored, createdAt: FieldValue.serverTimestamp() });
        applyProcedureSync(txn, {
          clinicId,
          procedureLedgerId: f.id,
          payments: paymentsAfter,
          labFee: basis.labFee,
          commissionPct: basis.commissionPct,
        });
        txn.update(adminClinicDoc(clinicId, "ledger", f.id), { insurerPaidAt: date });
        written.push({ id: newRef.id, row: stored });
        paid += amount;
      }
      for (const [key, counter] of counters) {
        txn.set(
          counter.ref,
          { last: counter.seq, lastReceiptNumber: lastNumber.get(key) ?? null, updatedAt: new Date().toISOString() },
          { merge: true },
        );
      }
      return { paid: money(paid), count: written.length, receiptNumbers: written.map((w) => String(w.row.receiptNumber)), written };
    });
  } catch (e) {
    if (e instanceof NothingToCollectError) return nothingToCollect();
    throw e;
  }

  await recordLedgerAuditBatch(
    result.written.map((w) => ({
      clinicId, action: "create" as const, collection: "ledger" as const, documentId: w.id, after: w.row, actor, via: "finance/ledger:insurer-collect",
    })),
  );
  void logActivityServer({
    clinicId,
    user: actor,
    action: "Insurance Payment Collected",
    details: `${result.paid} EGP from ${payerId} across ${result.count} treatment${result.count === 1 ? "" : "s"}`,
    severity: "MEDIUM",
    module: "finance",
  });
  for (const w of result.written) void afterLedgerCreate(clinicId, w.row, actor);

  return NextResponse.json({ ok: true, paid: result.paid, count: result.count, receiptNumbers: result.receiptNumbers });
}

// ---------------------------------------------------------------------------------------------
// create-entry — clinic income or overhead, belonging to no patient
// ---------------------------------------------------------------------------------------------

async function createEntry(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const type = body.type === "income" ? "income" : body.type === "expense" ? "expense" : null;
  if (!type) return bad("An entry must be income or expense.");

  // The phone sends no branch: then the clinic's first.
  const branch = await assertBranchAllowed({
    clinicId, uid: actor.uid, role: actor.role, branchId: body.branchId,
    fallback: (branches) => automaticBranch(clinicId, branches, {}),
  });
  if (!branch.ok) return branch.response;

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
  if (branch.branchId) row.branchId = branch.branchId;

  const ref = await adminClinicCollection(clinicId, "ledger").add({
    ...row,
    createdAt: FieldValue.serverTimestamp(),
  });

  await recordMoneyChange({
    entry: { clinicId, action: "create", collection: "ledger", documentId: ref.id, after: row, actor, via: "finance/ledger:create-entry" },
    action: type === "income" ? "Finance Entry Created" : "Finance Entry Created",
    details: `${type.toUpperCase()} ${row.amount} EGP - ${row.description}`,
  });

  void afterLedgerCreate(clinicId, row, actor);
  return NextResponse.json({ ok: true, id: ref.id });
}

// ---------------------------------------------------------------------------------------------
// create-receipt-entries — one scanned receipt, saved as one expense row per category
// ---------------------------------------------------------------------------------------------

/**
 * The review sheet's "Save all". Every row is built by `buildManualEntryRow`, exactly like a typed
 * expense, and then carries three extra fields: `receiptGroupId` (the rows from one receipt),
 * `receiptPath` and `receiptImageUrl` (the photo). Nothing that reads the ledger needs them.
 *
 * All rows or none: one bad line refuses the receipt, so a half-saved bill never sits in the books.
 * `create-entry` is deliberately left as it was; this is a separate door.
 */
async function createReceiptEntries(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const receiptId = typeof body.receiptId === "string" ? body.receiptId.trim() : "";
  const receiptPath = typeof body.receiptPath === "string" ? body.receiptPath.trim() : "";
  const receiptImageUrl = typeof body.receiptImageUrl === "string" ? body.receiptImageUrl.trim() : "";
  if (!isOwnReceiptPath(receiptPath, clinicId, receiptId)) return bad("That receipt is not in this clinic's receipts folder.");
  if (!isDownloadUrlFor(receiptImageUrl, receiptPath)) return bad("The receipt photo link does not match the uploaded file.");

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) return bad("A receipt needs at least one line.");
  if (lines.length > RECEIPT_MAX_LINES) return bad(`A receipt can have at most ${RECEIPT_MAX_LINES} lines.`);

  const branch = await assertBranchAllowed({
    clinicId, uid: actor.uid, role: actor.role, branchId: body.branchId,
    fallback: (branches) => automaticBranch(clinicId, branches, {}),
  });
  if (!branch.ok) return branch.response;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : todayKey();
  const method = typeof body.method === "string" ? body.method : null;
  const rows: Record<string, unknown>[] = [];
  try {
    for (const raw of lines) {
      const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const category = typeof line.category === "string" ? line.category : "";
      if (!RECEIPT_CATEGORY_IDS.includes(category)) throw new Error("Pick a category for every line.");
      const row = buildManualEntryRow({
        type: "expense",
        amount: Number(line.amount),
        description: String(line.description || "").trim().slice(0, 200),
        category,
        date,
        method,
        isRecurring: false,
        actor: { uid: actor.uid, name: actor.name },
      });
      if (branch.branchId) row.branchId = branch.branchId;
      rows.push({ ...row, receiptGroupId: receiptId, receiptPath, receiptImageUrl });
    }
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Could not save that receipt.");
  }

  const batch = adminDb().batch();
  const written = rows.map((row) => {
    const ref = adminClinicCollection(clinicId, "ledger").doc();
    batch.set(ref, { ...row, createdAt: FieldValue.serverTimestamp() });
    return { id: ref.id, row };
  });
  await batch.commit();

  await recordLedgerAuditBatch(
    written.map((w) => ({
      clinicId, action: "create" as const, collection: "ledger" as const, documentId: w.id, after: w.row, actor, via: "finance/ledger:create-receipt-entries",
    })),
  );
  const total = money(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
  void logActivityServer({
    clinicId,
    user: actor,
    action: "Finance Entry Created",
    details: `Receipt scan: ${written.length} expense${written.length === 1 ? "" : "s"}, ${total} EGP`,
    severity: "LOW",
    module: "finance",
  });
  for (const w of written) void afterLedgerCreate(clinicId, w.row, actor);

  return NextResponse.json({ ok: true, ids: written.map((w) => w.id), total });
}

/**
 * Another branch's money is not this person's to change. Read before the transaction: a row's
 * branch never changes by edit, so it cannot move between this read and the write.
 */
async function rowBranchGate(clinicId: string, actor: Actor, id: string) {
  const snap = await adminClinicDoc(clinicId, "ledger", id).get();
  return assertRowBranchAllowed({ clinicId, uid: actor.uid, role: actor.role, rowBranchId: snap.data()?.branchId });
}

// ---------------------------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------------------------

async function updateRow(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which row?");
  const patch = (body.patch || {}) as Record<string, unknown>;

  const gate = await rowBranchGate(clinicId, actor, id);
  if (!gate.ok) return gate.response;

  const staff = await loadStaff(clinicId);

  // Only read the policy when the patch could change a discount — every other edit (a date, a
  // description, a payment amount) has no business paying for a settings read.
  const touchesDiscount =
    patch.discountMode !== undefined ||
    patch.discountPercent !== undefined ||
    patch.discountFixed !== undefined ||
    patch.listPrice !== undefined;
  const discountSettings = touchesDiscount
    ? parseDiscountSettings((await adminClinicDoc(clinicId, "settings", DISCOUNTS_DOC).get()).data() ?? null)
    : null;
  // Read before the transaction, which cannot read after it writes; only when the edit names a
  // date or an amount, the two things the lock is about.
  const pastDayLocked = patch.date !== undefined || patch.paid !== undefined ? await pastDayLockOn(clinicId, actor) : false;
  const today = clinicToday();

  const result = await adminDb().runTransaction(async (txn) => {
    const ref = adminClinicDoc(clinicId, "ledger", id);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const before = snap.data() || {};
    const type = String(before.type || "");
    if (typeof before.settlementId === "string" && before.settlementId) throw new Error("SETTLEMENT_ROW");
    // Every row type: the branch it was stamped with at creation stays.
    if (patch.branchId !== undefined && differsFromStored(patch.branchId, before.branchId)) {
      throw new Error("BRANCH_LOCKED");
    }
    const approvalRow = type === "procedure" && isApprovalRow(before);
    if (approvalRow && APPROVAL_ROW_LOCKED_FIELDS.some((k) => patch[k] !== undefined && differsFromStored(patch[k], before[k]))) {
      throw new Error("APPROVAL_ROW_LOCKED");
    }

    const allowed =
      type === "payment"
        ? EDITABLE_PAYMENT_FIELDS
        : approvalRow
          ? EDITABLE_APPROVAL_ROW_FIELDS
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

    if (type === "payment" && refusesPastPaymentEdit({ locked: pastDayLocked, role: actor.role, today, before, patch: update })) {
      throw new Error(PAST_DAY_LOCKED);
    }

    if (type === "payment") {
      // Rounded first, as on create: an edit to 0.004 must not leave a 0.00 receipt either.
      const paid = money(update.paid !== undefined ? Number(update.paid) : Number(before.paid ?? before.amount ?? 0));
      if (!Number.isFinite(paid) || paid < 0.01) throw new Error("BAD_AMOUNT");
      update.paid = paid;
      // `amount` mirrors `paid` so the finance dashboard, which reads `amount` for non-procedure
      // rows, cannot disagree with the patient ledger, which reads `paid`.
      update.amount = paid;

      const beforeProcedureId = typeof before.procedureId === "string" ? before.procedureId.trim() : "";
      const beforePaid = Number(before.paid ?? before.amount ?? 0) || 0;

      /**
       * Which treatment this payment settles — changeable, deliberately.
       *
       * It was not, and that is half of why a misallocated payment was so hard to put right: the
       * only way to move 1,200 EGP off the wrong charge was to delete the row and re-enter it,
       * which loses who collected it, when, and the audit trail that says it ever existed. The
       * money was real; only the row it pointed at was wrong. So the link is editable, and every
       * consequence of moving it — the dentist, the lab fee, the commission on both charges — is
       * recomputed here rather than left for somebody to notice.
       */
      const repointing = patch.procedureId !== undefined;
      const nextProcedureId = repointing
        ? String(patch.procedureId ?? "").trim()
        : beforeProcedureId;

      // Everything read up front: a transaction cannot read after it writes, and moving a payment
      // touches two procedures.
      const beforeProcSnap = beforeProcedureId
        ? await txn.get(adminClinicDoc(clinicId, "ledger", beforeProcedureId))
        : null;

      const sameTarget = nextProcedureId === beforeProcedureId;
      const nextProcSnap = !nextProcedureId
        ? null
        : sameTarget
          ? beforeProcSnap
          : await txn.get(adminClinicDoc(clinicId, "ledger", nextProcedureId));

      if (nextProcedureId && !sameTarget) {
        if (!nextProcSnap?.exists) throw new Error("NO_PROCEDURE");
        const nextData = nextProcSnap.data() || {};
        if (String(nextData.type || "") !== "procedure") throw new Error("NOT_A_PROCEDURE");
        // A payment may only be moved between charges belonging to the same patient. Without this
        // the edit dialog becomes a way to move money between patients' books with no trace of
        // where it came from.
        if (String(nextData.patientId || "") !== String(before.patientId || "")) {
          throw new Error("WRONG_PATIENT");
        }
      }

      const beforeSiblings = beforeProcedureId
        ? await readProcedurePayments(txn, clinicId, beforeProcedureId)
        : [];
      const nextSiblings = !nextProcedureId
        ? []
        : sameTarget
          ? beforeSiblings
          : await readProcedurePayments(txn, clinicId, nextProcedureId);

      if (nextProcedureId && nextProcSnap?.exists) {
        const nextData = nextProcSnap.data() || {};
        const verdict = checkAllocation({
          cost: chargeAmount(nextData),
          otherPaymentsTotal: sumPayments(nextSiblings.filter((p) => p.id !== id)),
          amount: paid,
          // Only the row's own history excuses an overage, and only when it stays on the same
          // charge. Dropping 1,400 onto a charge it was never on is a fresh over-allocation.
          previousAmount: sameTarget ? beforePaid : null,
        });
        if (!verdict.ok) {
          throw new OverAllocationError(
            verdict,
            typeof nextData.description === "string" ? nextData.description : null
          );
        }
      }

      if (repointing && !sameTarget) {
        update.procedureId = nextProcedureId || null;
        // The dentist follows the treatment. A payment left pointing at the old dentist would keep
        // paying them commission for work it no longer settles.
        const nextData = nextProcSnap?.exists ? nextProcSnap.data() || {} : null;
        const doctor = resolveDoctorForPayment(
          nextData
            ? {
                id: nextProcedureId,
                doctorId: typeof nextData.doctorId === "string" ? nextData.doctorId : null,
                doctorName: typeof nextData.doctorName === "string" ? nextData.doctorName : null,
                doctor: typeof nextData.doctor === "string" ? nextData.doctor : null,
              }
            : null,
          staff
        );
        update.doctorId = doctor ? doctor.id : null;
        update.doctorName = doctor ? doctor.name || null : null;
        update.category = nextProcedureId ? "Treatment Payment" : "Advance Payment";
        // A split someone set by hand was set against the OLD treatment. Carrying the flag over
        // would tell the repair classifier that these freshly-derived figures were a human's
        // decision, and it would then refuse to correct them forever.
        update.commissionSetManually = false;
        if (!nextProcedureId) {
          // Unlinked: it settles no treatment, so it owes no lab fee and earns no commission.
          // Explicit zeroes, not absent fields — the repair classifier tells those two apart.
          // The amount-derived fields are written by the unallocated branch below, which every
          // payment carrying no procedure passes through.
          update.labFee = 0;
          update.doctorCommissionPercentage = 0;
        }
      }

      // Rebalance whichever charges changed. Both, when the payment moved between them: the one it
      // left has one fewer payment (so the lab fee may move to a different row), and the one it
      // joined has one more.
      // Both bases read here, before the first write: a Firestore transaction refuses any read
      // issued after a write, and moving a payment has to rebalance two procedures.
      const beforeBasis =
        beforeProcedureId && beforeProcSnap?.exists && !sameTarget
          ? await readProcedureCommissionBasis(txn, clinicId, beforeProcSnap.data() || {})
          : null;
      const nextBasis =
        nextProcedureId && nextProcSnap?.exists
          ? await readProcedureCommissionBasis(txn, clinicId, nextProcSnap.data() || {})
          : null;

      if (beforeProcedureId && beforeProcSnap?.exists && !sameTarget && beforeBasis) {
        const basis = beforeBasis;
        applyProcedureSync(txn, {
          clinicId,
          procedureLedgerId: beforeProcedureId,
          payments: beforeSiblings.filter((p) => p.id !== id),
          labFee: basis.labFee,
          commissionPct: basis.commissionPct,
        });
      }

      if (nextProcedureId && nextProcSnap?.exists && nextBasis) {
        const basis = nextBasis;
        const date = String(update.date ?? before.date ?? "");
        const withoutThis = nextSiblings.filter((p) => p.id !== id);
        // The set as it will stand once this edit lands. The row may be joining the set for the
        // first time, so it is added rather than mapped over.
        // The flag and the rate come along: correcting an AMOUNT must not throw away a rate
        // somebody set on this payment by hand.
        const paymentsAfter = [
          ...withoutThis,
          {
            id,
            paid,
            amount: paid,
            date,
            commissionSetManually: before.commissionSetManually === true,
            doctorCommissionPercentage:
              typeof before.doctorCommissionPercentage === "number" ? before.doctorCommissionPercentage : null,
          },
        ];
        applyProcedureSync(txn, {
          clinicId,
          procedureLedgerId: nextProcedureId,
          payments: paymentsAfter,
          labFee: basis.labFee,
          commissionPct: basis.commissionPct,
        });
        // applyProcedureSync writes this row's lab fee and commission too. Leaving them out of
        // `update` — which is written last and would win — is what keeps the two agreeing.
      } else if (nextProcedureId && !nextProcSnap?.exists) {
        // The charge this settles has been deleted out from under it. Keep whatever was recorded
        // rather than inventing a new split from a row that is gone.
        const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(
          paid,
          Number(before.labFee) || 0,
          Number(before.doctorCommissionPercentage) || 0
        );
        update.doctorCommissionAmount = doctorCommissionAmount;
        update.clinicProfit = clinicProfit;
      } else if (!nextProcedureId) {
        // Unallocated payment: no dentist, so nothing to recompute beyond the amount itself.
        // Reached both by a payment that never had a treatment and by one just unlinked from
        // theirs. Gating this on `!repointing` left an on-account payment's clinicProfit frozen at
        // the old amount whenever the figure was edited, because the screen now sends the (unchanged)
        // link on every save.
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
    } else if (approvalRow) {
      // A date, a description or a note: nothing derived moves. The price and the dentist's
      // stamped share stay as the approval wrote them.
    } else if (type === "procedure") {
      // Only the discount is adjustable here; what the treatment IS belongs to the clinical route.
      //
      // Two row shapes carry a discount. Rows this route priced hold discountPercent/discountFixed;
      // rows the clinical route priced hold discountValue under their discountMode. Reading only the
      // first shape meant every save of the finance dialog — which sends nulls for both, since the
      // row it opened has neither — re-priced a clinical-route charge to full list price: discount,
      // reason and the dentist's lower share all gone, from an edit that only changed the date.
      const blank = (v: unknown) => v === undefined || v === null || v === "";
      const figure = (v: unknown) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
      const storedMode = isDiscountMode(before.discountMode) ? before.discountMode : "none";
      const storedList = Number(before.listPrice ?? before.cost ?? 0) || 0;
      const storedPercent = figure(before.discountPercent) ?? (storedMode === "percent" ? figure(before.discountValue) : null);
      const storedFixed = figure(before.discountFixed) ?? (storedMode === "fixed" ? figure(before.discountValue) : null);

      // A blank figure in the patch means "nothing typed here", not "zero" — the dialog's inputs
      // turn a cleared box into 0, so only a screen that never had the figure sends null.
      const nextList = blank(update.listPrice) ? storedList : Number(update.listPrice);
      const nextMode = blank(update.discountMode)
        ? storedMode
        : isDiscountMode(update.discountMode) ? update.discountMode : "none";
      const nextPercent = blank(update.discountPercent) ? storedPercent : Number(update.discountPercent);
      const nextFixed = blank(update.discountFixed) ? storedFixed : Number(update.discountFixed);

      // Only re-price when the price actually changes. A re-sent, unchanged discount re-priced is
      // at best a no-op and at worst a rounding drift written over the charge, its commission and
      // the clinical note — for an edit that was only ever about the date.
      const reprice =
        differsFromStored(nextList, storedList) ||
        nextMode !== storedMode ||
        (nextMode === "percent" && differsFromStored(nextPercent, storedPercent)) ||
        (nextMode === "fixed" && differsFromStored(nextFixed, storedFixed));

      for (const key of ["listPrice", "discountMode", "discountPercent", "discountFixed"] as const) delete update[key];

      if (!reprice) {
        // The reason may still be reworded on a discount that stands; a blank one keeps the stored
        // reason rather than erasing it, and a charge with no discount has no reason to change.
        if (blank(update.discountReason) || !(Number(before.discountAmount) > 0)) delete update.discountReason;
      } else {
        const discounted = applyProcedureDiscount({
          listPrice: nextList,
          mode: nextMode,
          percent: nextPercent,
          fixed: nextFixed,
          fallbackCost: Number(before.cost) || 0,
        });
        // discountValue kept in step so the clinical editor, which reads that shape, opens on the
        // discount this screen just set rather than the one it replaced.
        const discountValue =
          discounted.discountMode === "percent" ? discounted.discountPercent
            : discounted.discountMode === "fixed" ? discounted.discountFixed
              : null;
        Object.assign(update, discounted, { discountValue, amount: discounted.cost });

        /**
         * Who may take this much off, and what for.
         *
         * Asked only when the discount GROWS. An edit that re-sends the discount already on the row
         * — which is what the patient's finance screen does on every save, discount or not — is not
         * someone giving a discount, and making it fail for want of a reason would break editing a
         * date on a charge that was discounted months ago by somebody else.
         */
        if (discountSettings) {
          const beforeAmount = Number(before.discountAmount) || 0;
          const reason = String(update.discountReason ?? before.discountReason ?? "");
          if (discounted.discountAmount > beforeAmount + 0.001) {
            const verdict = checkDiscountAllowed({
              listPrice: discounted.listPrice,
              discountAmount: discounted.discountAmount,
              reason,
              authority: allowedDiscount(actor.role, null, discountSettings),
              availableReasons: discountSettings.reasons,
            });
            if (!verdict.ok) throw new DiscountRefusedError(verdict.error);
          }
          // A discount lifted off takes its reason with it; one left in place keeps the reason it
          // was given under, even when this patch never mentioned it.
          update.discountReason = discounted.discountAmount > 0 ? reason || null : null;
        }

        // The dentist's share follows the discounted amount: the lab is paid in full either way, so
        // a discount comes out of what is left, not off the lab's invoice.
        const labFee = Number(before.labFee) || 0;
        const commissionPct = Number(before.doctorCommissionPercentage) || 0;
        const net = discounted.cost - labFee;
        update.doctorCommissionAmount = net > 0 ? Number((net * (commissionPct / 100)).toFixed(2)) : 0;
        update.clinicProfit = Number((discounted.cost - Number(update.doctorCommissionAmount) - labFee).toFixed(2));

        // The clinical note holds its own copy of the price and the discount; leaving either stale
        // would mean the next save from the clinical screen silently undid this one.
        const noteId = typeof before.clinicalNoteId === "string" ? before.clinicalNoteId : "";
        if (noteId) {
          txn.update(adminClinicDoc(clinicId, "clinical_notes", noteId), {
            cost: discounted.cost,
            listPrice: discounted.listPrice,
            discountMode: discounted.discountMode,
            discountValue,
            discountAmount: discounted.discountAmount,
            discountReason: update.discountReason ?? null,
          });
        }
      }
    } else {
      throw new Error("UNKNOWN_ROW_TYPE");
    }

    // A treatment re-saved with the discount it already carries (the Money tab's "apply discount"
    // pressed twice) changes nothing now that an unchanged discount is no longer re-priced. That is
    // a success with nothing to write, not an error toast at the desk.
    if (Object.keys(update).length === 0 && type === "procedure") return { before, update, type, unchanged: true };
    if (Object.keys(update).length === 0) throw new Error("NOTHING_TO_DO");

    update.updatedAt = FieldValue.serverTimestamp();
    update.updatedByUid = actor.uid;
    update.updatedByName = actor.name;
    txn.update(ref, update);

    return { before, update, type, unchanged: false };
  });
  if (result.unchanged) return NextResponse.json({ ok: true, id });

  await recordMoneyChange({
    entry: {
      clinicId, action: "update", collection: "ledger", documentId: id,
      before: result.before, after: result.update, actor, via: "finance/ledger:update",
    },
    action: "Finance Entry Updated",
    details: `${result.type} ${id}`,
  });

  void afterLedgerUpdate(clinicId, result.before as Record<string, unknown>, result.update as Record<string, unknown>, actor);
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

  const gate = await rowBranchGate(clinicId, actor, id);
  if (!gate.ok) return gate.response;

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
// set-lab-fee — correcting the estimate to what the lab actually charged
// ---------------------------------------------------------------------------------------------

/**
 * Correct what a treatment was charged for its lab work.
 *
 * The price list holds an ESTIMATE, and that estimate is what came off the top when the treatment
 * was saved — before the dentist's commission, before clinic profit. When the lab actually charges
 * something else, the books stay quietly wrong until somebody says so. This is that correction,
 * driven from the agreed price on a lab case.
 *
 * `labFee` is deliberately absent from EDITABLE_PROCEDURE_FIELDS, so `update` cannot reach it. It
 * gets its own action because changing it is not an edit to one row: it moves money between the
 * dentist and the clinic on every payment already recorded against the treatment, which is why
 * this rebalances those too rather than just stamping a new number on the charge.
 *
 * A dentist noticing their commission shifted overnight with no explanation is a real problem, not
 * a technical one. So the row keeps what it was corrected FROM, and the audit trail and the
 * activity log both name the old figure, the new one and who did it.
 */
async function setLabFee(args: { clinicId: string; actor: Actor; body: Record<string, unknown> }) {
  const { clinicId, actor, body } = args;
  const id = String(body.id || "").trim();
  if (!id) return bad("Which treatment?");

  const labFee = Number(body.labFee);
  if (!Number.isFinite(labFee) || labFee < 0) return bad("Enter a lab fee of zero or more.");

  const reason = String(body.reason || "").trim();

  const gate = await rowBranchGate(clinicId, actor, id);
  if (!gate.ok) return gate.response;

  const result = await adminDb().runTransaction(async (txn) => {
    const ref = adminClinicDoc(clinicId, "ledger", id);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const before = snap.data() || {};
    if (String(before.type || "") !== "procedure") throw new Error("NOT_A_PROCEDURE");

    const previous = Number(before.labFee) || 0;
    if (Math.abs(previous - labFee) < 0.01) throw new Error("NOTHING_TO_DO");

    // The dentist's rate comes from their staff record, not from whatever was copied onto the row
    // when it was written — the same basis every other money path in this route uses.
    const basis = await readProcedureCommissionBasis(txn, clinicId, { ...before, labFee });
    const payments = await readProcedurePayments(txn, clinicId, id);

    // The lab is paid in full whatever the patient was charged, so the fee comes off before the
    // split, never out of it.
    const cost = chargeAmount(before);
    const net = cost - labFee;
    // A treatment from an insurance approval keeps the dentist's share the approval stamped: it is
    // a rate on the approved amount, earned when the line was assigned, not a split of this charge.
    const doctorCommissionAmount = isApprovalRow(before)
      ? Number(before.doctorCommissionAmount) || 0
      : net > 0 ? Number((net * (basis.commissionPct / 100)).toFixed(2)) : 0;
    const update: Record<string, unknown> = {
      labFee,
      doctorCommissionAmount,
      clinicProfit: Number((cost - doctorCommissionAmount - labFee).toFixed(2)),
      labFeeCorrectedFrom: previous,
      labFeeCorrectedAt: FieldValue.serverTimestamp(),
      labFeeCorrectedByName: actor.name,
      ...(reason ? { labFeeCorrectedReason: reason } : {}),
    };
    txn.update(ref, update);

    applyProcedureSync(txn, {
      clinicId,
      procedureLedgerId: id,
      payments,
      labFee,
      commissionPct: basis.commissionPct,
    });

    return { before, update, previous, payments: payments.length };
  });

  await recordMoneyChange({
    entry: {
      clinicId, action: "update", collection: "ledger", documentId: id,
      before: result.before, after: result.update, actor, via: "finance/ledger:set-lab-fee",
    },
    action: "Lab Fee Corrected",
    details:
      `Lab fee on treatment ${id} corrected from ${result.previous} to ${labFee}` +
      (result.payments ? `, rebalancing ${result.payments} payment(s)` : "") +
      (reason ? ` — ${reason}` : ""),
    severity: "HIGH",
  });

  return NextResponse.json({ ok: true, id, previousLabFee: result.previous, labFee });
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
  const gate = await assertRowBranchAllowed({ clinicId, uid: actor.uid, role: actor.role, rowBranchId: target.branchId });
  if (!gate.ok) return gate.response;
  const type = String(target.type || "");
  // The approval keeps a link to this charge and its note; deleting the charge alone strands it.
  // Deleting the approval (Recently Deleted keeps all of them together) is the way out.
  if (type === "procedure" && isApprovalRow(target)) {
    return bad("This treatment comes from an insurance approval; delete the approval instead.", 409);
  }
  if (typeof target.settlementId === "string" && target.settlementId) return bad(SETTLEMENT_ROW_MESSAGE, 409);

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

  void afterLedgerDelete(clinicId, target as Record<string, unknown>, actor);
  return NextResponse.json({ ok: true, deleted: verdict.cascade });
}

// ---------------------------------------------------------------------------------------------

const PERMISSION_BY_ACTION: Record<string, string> = {
  "create-payment": "finance.add",
  "create-entry": "finance.add",
  "create-receipt-entries": "finance.add",
  "insurer-collect": "finance.add",
  update: "finance.edit",
  "set-commission": "finance.edit",
  // Correcting a lab fee moves money between the dentist and the clinic on every payment already
  // recorded against the treatment. That is a finance edit, not a lab-tracking one — holding
  // access.lab lets you record what a lab charged; changing what a dentist was paid does not.
  "set-lab-fee": "finance.edit",
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
      case "create-receipt-entries":
        return await createReceiptEntries({ clinicId, actor, body });
      case "insurer-collect":
        return await insurerCollect({ clinicId, actor, body });
      case "update":
        return await updateRow({ clinicId, actor, body });
      case "set-commission":
        return await setCommission({ clinicId, actor, body });
      case "set-lab-fee":
        return await setLabFee({ clinicId, actor, body });
      case "delete":
        return await deleteRow({ clinicId, actor, body });
      default:
        return bad("Unknown action.");
    }
  } catch (e) {
    // Carries its numbers, so this cannot go through the message-string switch below.
    if (e instanceof OverAllocationError) {
      return NextResponse.json(
        {
          ok: false,
          error: allocationMessage(e.verdict, e.description),
          reason: OVER_ALLOCATION_CODE,
          remaining: e.verdict.remaining,
          excess: e.verdict.excess,
        },
        { status: 409 }
      );
    }

    // Carries a sentence written for the person who typed the discount, not a code.
    if (e instanceof DiscountRefusedError) return bad(e.message, 403);

    const message = e instanceof Error ? e.message : "";
    switch (message) {
      case "NO_PROCEDURE":
        return bad("That treatment no longer exists. Refresh and try again.", 404);
      case "NO_DENTIST":
        return NextResponse.json(
          { ok: false, reason: "NO_DENTIST", error: "Choose the dentist for this treatment before taking money for it. / اختار الطبيب اللي عمل العلاج ده قبل ما تحصّل." },
          { status: 409 },
        );
      case "NOT_A_PROCEDURE":
        return bad("A payment can only be linked to a treatment charge.");
      case "COMPANY_ROW":
        return NextResponse.json(
          {
            ok: false,
            reason: "COMPANY_ROW",
            error:
              "This treatment is on the insurance company's account — the patient owes nothing on it. Take the patient's money on account (credit), and collect the company's from Finance. / العلاج ده على حساب الشركة والمريض مش عليه حاجة فيه. خد فلوس المريض كرصيد ليه، وفلوس الشركة بتتحصل من المالية.",
          },
          { status: 409 },
        );
      case "WRONG_PATIENT":
        return bad("A payment can only settle a treatment belonging to the same patient.");
      case "NO_PATIENT":
        return bad("That patient no longer exists.", 404);
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
      case "APPROVAL_ROW_LOCKED":
        return bad(APPROVAL_ROW_MESSAGE);
      case "SETTLEMENT_ROW":
        return bad(SETTLEMENT_ROW_MESSAGE, 409);
      case "BRANCH_LOCKED":
        return bad(BRANCH_LOCKED_MESSAGE, 409);
      case PAST_DAY_LOCKED:
        return bad(PAST_DAY_LOCKED_MESSAGE, 403);
      default:
        reportServerError("finance/ledger failed", e, { action });
        return bad("Something went wrong saving that. Nothing was changed.", 500);
    }
  }
}
