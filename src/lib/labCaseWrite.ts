/**
 * Writing lab cases.
 *
 * Split from `labCases.ts` so the rules about what a case *is* stay Firebase-free and testable,
 * the same split `procedurePricing.ts` and `ledgerWrite.ts` already draw. Everything here touches
 * Firestore; everything there is arithmetic.
 *
 * Two things this file is careful about, both of which have bitten this codebase before:
 *
 *   - **Firestore rejects `undefined`.** An optional field set to undefined kills the entire write
 *     in the browser SDK and surfaces as an error that reads exactly like a rules denial. Every
 *     optional value here is omitted with a conditional spread rather than written empty, which is
 *     the same shape `NewPatientModal` uses when a patient has no branch.
 *   - **A human code must never repeat.** The counter is bumped inside a transaction, exactly as
 *     patient file numbers are, so two people saving an order in the same second cannot both mint
 *     `MAD-0142`.
 */

import { runTransaction, addDoc, getDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { localYmd } from "@/lib/clinicDate";
import {
  LAB_PAYMENTS_COLLECTION,
  labPaymentExpenseAmount,
  labPaymentMethodLabel,
  type LabPayment,
  type LabPaymentCase,
} from "@/lib/labAccounts";
import { MoneyApiError, createLedgerEntry, deleteLedgerRow, updateLedgerRow } from "@/lib/moneyApi";
import {
  LABS_SETTINGS_DOC,
  findLabByName,
  makeLabId,
  parseDentalLabs,
  serializeDentalLabs,
  type DentalLab,
} from "@/lib/dentalLabs";
import {
  DEFAULT_BRANCH_CODE,
  LAB_CASES_COLLECTION,
  LAB_COUNTERS_COLLECTION,
  LAB_COUNTERS_DOC,
  formatLabCode,
  statusFor,
  type LabCase,
  type LabCaseEvent,
  type LabCaseStatus,
} from "@/lib/labCases";

/** Numbering starts here so the first printed code is a four-digit `-0001`, not `-0000`. */
const FIRST_CASE_NUMBER = 1;

/**
 * The clinic's calendar date, on the device's own clock.
 *
 * `localYmd`, never `toISOString().slice(0,10)`. The latter is the UTC date, and in Egypt at
 * UTC+2/+3 a case handed to a driver at half past midnight would be stamped with the previous
 * day — the same mistake attendance made once, which `clinicDate.ts` documents.
 */
function today(): string {
  return localYmd();
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Strip every key whose value is undefined, empty string, or NaN.
 *
 * Written as one pass rather than a spread per field because a lab case has thirty optional
 * fields and thirty conditional spreads at the call site is where one gets missed.
 */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/**
 * Take the next number for a branch code, atomically.
 *
 * Keyed by the printed CODE rather than the branch id, and that choice is load-bearing: if an
 * admin gives two branches the same three letters, keying by id would hand both of them
 * `MAD-0142` and put two different patients' work under one number on two bags. Sharing a counter
 * means they share a sequence instead — ugly in a report, harmless on a bag.
 */
export async function mintLabCaseNumber(branchCode: string): Promise<number> {
  const key = (branchCode || DEFAULT_BRANCH_CODE).replace(/[^A-Z0-9]/gi, "").toUpperCase() || DEFAULT_BRANCH_CODE;
  const ref = getClinicDoc(LAB_COUNTERS_COLLECTION, LAB_COUNTERS_DOC);

  return runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    const current = snap.exists() ? Number(snap.data()?.[key]) : NaN;
    const next = Number.isFinite(current) && current >= FIRST_CASE_NUMBER ? current + 1 : FIRST_CASE_NUMBER;
    if (snap.exists()) {
      txn.update(ref, { [key]: next });
    } else {
      txn.set(ref, { [key]: next }, { merge: true });
    }
    return next;
  });
}

/**
 * Add a lab typed into an order to the clinic's lab list, and return it.
 *
 * Read-and-append inside a transaction, because the list is one array in one document: writing
 * back a copy read a minute earlier would wipe a lab somebody else added in between. A name that
 * is already on the list returns that lab rather than adding it twice. Admin-only, like the rest
 * of `settings` — the order form only calls it for an Admin.
 */
export async function addLabToDirectory(name: string): Promise<DentalLab> {
  const clean = name.trim().replace(/\s+/g, " ");
  const ref = getClinicDoc("settings", LABS_SETTINGS_DOC);
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(ref);
    const labs = parseDentalLabs(snap.exists() ? snap.data() : null);
    const existing = findLabByName(labs, clean);
    if (existing) return existing;
    const lab: DentalLab = { id: makeLabId(), name: clean };
    txn.set(
      ref,
      { labs: serializeDentalLabs([...labs, lab]), updatedAt: nowIso() },
      { merge: true }
    );
    return lab;
  });
}

/**
 * Record a payment to a lab: the `lab_payments` row only.
 *
 * The screen goes through `saveLabPaymentWithExpense`, which also puts the payment in Finance as a
 * Lab expense — less whatever the linked treatments already booked as lab fees, so the same lab
 * work is never charged against profit twice.
 */
export async function recordLabPayment(input: {
  labId: string;
  labName: string;
  amount: number;
  date: string;
  method: string;
  reference?: string;
  note?: string;
  createdBy?: string;
  cases?: LabPaymentCase[];
  expenseLedgerId?: string;
  expenseAmount?: number;
}): Promise<string> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("A lab payment needs an amount greater than zero.");
  }
  if (!input.labId) throw new Error("A lab payment needs a lab.");

  const ref = await addDoc(getClinicCollection(LAB_PAYMENTS_COLLECTION), {
    ...compact({
      labId: input.labId,
      labName: input.labName,
      method: input.method || "cash",
      reference: input.reference,
      note: input.note,
      createdBy: input.createdBy,
    }),
    ...(input.cases?.length ? { cases: input.cases } : {}),
    ...(input.expenseLedgerId ? { expenseLedgerId: input.expenseLedgerId, expenseAmount: input.expenseAmount || 0 } : {}),
    amount: Math.round(amount * 100) / 100,
    date: input.date || today(),
    createdAt: nowIso(),
    createdAtServer: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Correct a lab payment — the wrong amount, date or method. Same `lab_payments`-only rule as
 * recording one. The lab itself is not editable here: a payment to the wrong lab is deleted and
 * recorded again, so neither lab's history shows a payment that silently moved.
 */
export async function updateLabPayment(
  id: string,
  input: {
    amount: number;
    date: string;
    method: string;
    reference?: string;
    cases?: LabPaymentCase[];
    expenseLedgerId?: string;
    expenseAmount?: number;
  }
): Promise<void> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("A lab payment needs an amount greater than zero.");
  }
  await updateDoc(getClinicDoc(LAB_PAYMENTS_COLLECTION, id), {
    amount: Math.round(amount * 100) / 100,
    date: input.date || today(),
    method: input.method || "cash",
    // An emptied box removes the reference rather than storing "".
    reference: input.reference ? input.reference : deleteField(),
    cases: input.cases?.length ? input.cases : deleteField(),
    expenseLedgerId: input.expenseLedgerId ? input.expenseLedgerId : deleteField(),
    expenseAmount: input.expenseLedgerId ? input.expenseAmount || 0 : deleteField(),
    updatedAt: nowIso(),
  });
}

/** What the treatments behind these cases already booked as lab fees in Finance. */
async function bookedLabFees(ledgerIds: string[]): Promise<number[]> {
  return Promise.all(
    ledgerIds.map(async (id) => {
      try {
        const snap = await getDoc(getClinicDoc("ledger", id));
        return snap.exists() ? Number(snap.data().labFee) || 0 : 0;
      } catch {
        return 0;
      }
    })
  );
}

function isGone(err: unknown): boolean {
  return err instanceof MoneyApiError && err.status === 404;
}

/**
 * Save a lab payment AND the Lab expense it puts in Finance.
 *
 * The clinic pays the lab, so the money shows in Finance as an expense under "Lab". Only the part
 * Finance has not already counted: a case raised from a treatment booked its lab fee when the
 * treatment was saved, and that much comes off (see `labPaymentExpenseAmount`).
 *
 * The expense goes through the money API like every other ledger write; the payment keeps its id
 * so an edit or a delete moves both. A payment saved before this existed has no expense, and
 * gains one the first time it is edited.
 */
export async function saveLabPaymentWithExpense(input: {
  existing?: LabPayment | null;
  labId: string;
  labName: string;
  amount: number;
  date: string;
  method: string;
  reference?: string;
  createdBy?: string;
  cases: LabPaymentCase[];
  /** The treatment rows behind the ticked cases, if any. */
  linkedLedgerIds: string[];
  language: "en" | "ar";
}): Promise<{ expenseAmount: number }> {
  const isAr = input.language === "ar";
  const expenseAmount = labPaymentExpenseAmount(input.amount, await bookedLabFees(input.linkedLedgerIds));
  const forWhom = input.cases.map((c) => `${c.code} ${c.patient}`.trim()).join("، ");
  const description = [isAr ? `دفعة معمل — ${input.labName}` : `Lab payment — ${input.labName}`, forWhom]
    .filter(Boolean)
    .join(" · ");
  const method = labPaymentMethodLabel(input.method, "en");
  const date = input.date || today();

  let expenseId = input.existing?.expenseLedgerId || "";
  let created = "";
  if (expenseAmount > 0) {
    if (expenseId) {
      try {
        await updateLedgerRow(expenseId, { amount: expenseAmount, date, method, description });
      } catch (err) {
        // Deleted from Finance by hand: put it back rather than leave the payment uncounted.
        if (!isGone(err)) throw err;
        expenseId = "";
      }
    }
    if (!expenseId) {
      expenseId = (await createLedgerEntry({ type: "expense", category: "Lab", amount: expenseAmount, description, date, method })).id;
      created = expenseId;
    }
  } else if (expenseId) {
    try {
      await deleteLedgerRow(expenseId);
    } catch (err) {
      if (!isGone(err)) throw err;
    }
    expenseId = "";
  }

  const fields = {
    amount: input.amount,
    date,
    method: input.method,
    reference: input.reference,
    cases: input.cases,
    expenseLedgerId: expenseId || undefined,
    expenseAmount: expenseId ? expenseAmount : undefined,
  };
  try {
    if (input.existing) await updateLabPayment(input.existing.id, fields);
    else await recordLabPayment({ ...fields, labId: input.labId, labName: input.labName, createdBy: input.createdBy });
  } catch (err) {
    // The payment did not save: take back the expense this call just made, so Finance never
    // shows a lab cost with no payment behind it.
    if (created) await deleteLedgerRow(created).catch(() => {});
    throw err;
  }
  return { expenseAmount };
}

/** Delete a lab payment and the Lab expense it put in Finance. */
export async function deleteLabPaymentWithExpense(payment: LabPayment): Promise<void> {
  if (payment.expenseLedgerId) {
    try {
      await deleteLedgerRow(payment.expenseLedgerId);
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }
  await deleteLabPayment(payment.id);
}

/** Remove a lab payment — a mistyped amount, a duplicate entry. */
export async function deleteLabPayment(id: string): Promise<void> {
  await deleteDoc(getClinicDoc(LAB_PAYMENTS_COLLECTION, id));
}

/**
 * Remove a case that should never have existed — a mistyped order, a duplicate, the wrong patient.
 *
 * A case that really went to the lab and was called off should be CANCELLED instead, so its trip
 * stays on the record. Deleting also takes it out of the lab's balance, which is exactly right for
 * an order that was never real. A remake raised off this case keeps its printed `remakeOfCode`.
 */
export async function deleteLabCase(id: string): Promise<void> {
  await deleteDoc(getClinicDoc(LAB_CASES_COLLECTION, id));
}

export type NewLabCaseInput = Omit<
  LabCase,
  "id" | "code" | "codeNumber" | "events" | "createdAt" | "updatedAt" | "createdBy"
> & {
  createdBy?: string;
};

export type CreatedLabCase = { id: string; code: string; codeNumber: number };

/**
 * Create a case and give it its code.
 *
 * The number is minted BEFORE the document is written, so a failed write leaves a gap in the
 * sequence rather than a case with no code. A missing number in a printed series is a curiosity;
 * an unlabelled bag is the exact problem this feature exists to prevent.
 */
export async function createLabCase(input: NewLabCaseInput): Promise<CreatedLabCase> {
  const branchCode = (input.branchCode || DEFAULT_BRANCH_CODE).toUpperCase();
  const codeNumber = await mintLabCaseNumber(branchCode);
  const code = formatLabCode(branchCode, codeNumber, input.remakeRound);

  const stamp = nowIso();
  const firstEvent: LabCaseEvent = {
    status: input.status,
    at: stamp,
    ...(input.createdBy ? { by: input.createdBy } : {}),
  };

  const payload = {
    ...compact({
      code,
      codeNumber,
      branchCode,
      branchId: input.branchId,
      branchName: input.branchName,
      patientId: input.patientId,
      patientName: input.patientName,
      patientFirstName: input.patientFirstName,
      patientPhone: input.patientPhone,
      doctorId: input.doctorId,
      doctorName: input.doctorName,
      clinicalNoteId: input.clinicalNoteId,
      ledgerId: input.ledgerId,
      labId: input.labId,
      labName: input.labName,
      workType: input.workType,
      workDescription: input.workDescription,
      units: input.units,
      bodyShade: input.bodyShade,
      cervicalShade: input.cervicalShade,
      gumShade: input.gumShade,
      material: input.material,
      implantSystem: input.implantSystem,
      implantPlatform: input.implantPlatform,
      abutmentType: input.abutmentType,
      retention: input.retention,
      guideType: input.guideType,
      sleeveSystem: input.sleeveSystem,
      notes: input.notes,
      sentAt: input.sentAt,
      dueDate: input.dueDate,
      remakeOfId: input.remakeOfId,
      remakeOfCode: input.remakeOfCode,
      remakeReason: input.remakeReason,
      remakeFault: input.remakeFault,
      remakeRound: input.remakeRound,
      createdBy: input.createdBy,
    }),
    // Written unconditionally: these are never absent, and `agreedPrice: 0` is a real answer
    // (a remake the lab is redoing at its own cost) that compact() would have dropped.
    teeth: Array.isArray(input.teeth) ? input.teeth : [],
    // Written only on a joined order, so an order of separate crowns keeps the shape it always had.
    ...(input.bridge === true ? { bridge: true, pontics: Array.isArray(input.pontics) ? input.pontics : [] } : {}),
    agreedPrice: Number(input.agreedPrice) || 0,
    sentVia: input.sentVia === "digital" ? "digital" : "driver",
    status: input.status,
    needsTryIn: input.needsTryIn === true,
    events: [firstEvent],
    createdAt: stamp,
    updatedAt: stamp,
    createdAtServer: serverTimestamp(),
  };

  const ref = await addDoc(getClinicCollection(LAB_CASES_COLLECTION), payload);
  return { id: ref.id, code, codeNumber };
}

/** Edit the details of an existing case. Status moves go through `advanceLabCase` instead. */
export async function updateLabCase(
  id: string,
  patch: Partial<LabCase>,
  /** Fields the caller deliberately cleared, which must be written as "" rather than omitted. */
  cleared: string[] = []
): Promise<void> {
  const body: Record<string, unknown> = {
    ...compact(patch as Record<string, unknown>),
    updatedAt: nowIso(),
  };
  // compact() drops empty strings, which is right for a create and wrong for an edit: a shade the
  // user deleted has to reach Firestore as "" or the old value survives the save.
  for (const key of cleared) body[key] = "";
  if (Array.isArray(patch.teeth)) body.teeth = patch.teeth;
  // Un-joining an order has to clear its pontics too, or the paper keeps a cross on a tooth.
  if (patch.bridge !== undefined) {
    body.bridge = patch.bridge === true;
    body.pontics = patch.bridge === true && Array.isArray(patch.pontics) ? patch.pontics : [];
  }
  if (patch.agreedPrice !== undefined) body.agreedPrice = Number(patch.agreedPrice) || 0;
  if (patch.needsTryIn !== undefined) body.needsTryIn = patch.needsTryIn === true;

  await updateDoc(getClinicDoc(LAB_CASES_COLLECTION, id), body);
}

/**
 * Move a case to its next stage, stamping the dates that stage implies.
 *
 * The event log is appended rather than replaced so a denture that loops through try-in three
 * times reads as three dated trips instead of one case that mysteriously took a month. The whole
 * array is rewritten (not arrayUnion) because two identical stage moves seconds apart are a real
 * thing a nervous assistant does, and arrayUnion would silently swallow the second.
 */
export async function advanceLabCase(
  labCase: LabCase,
  next: LabCaseStatus,
  options?: { by?: string; note?: string; date?: string }
): Promise<void> {
  const stamp = nowIso();
  const day = options?.date || today();
  const event: LabCaseEvent = {
    status: next,
    at: stamp,
    ...(options?.by ? { by: options.by } : {}),
    ...(options?.note ? { note: options.note } : {}),
  };

  const body: Record<string, unknown> = {
    status: next,
    events: [...(labCase.events || []), event],
    updatedAt: stamp,
  };

  // Each stage owns one date, and only the first arrival at that stage sets it. Re-entering
  // "back at clinic" after a remake must not rewrite the day the original case first came in.
  if (statusFor(next).atLab && !labCase.sentAt) body.sentAt = day;
  if (next === "back" && !labCase.receivedAt) body.receivedAt = day;
  if (next === "fitted" && !labCase.fittedAt) body.fittedAt = day;

  await updateDoc(getClinicDoc(LAB_CASES_COLLECTION, labCase.id), body);
}

/**
 * Raise a replacement for a case that came back wrong.
 *
 * The original keeps its code and its history — it is a record of something that physically
 * happened and rewriting it would lose the fact that the first attempt failed. The replacement
 * gets its own number with an `-R2` suffix and a pointer back, so "how many remakes did this lab
 * cause us" is a question the board can actually answer later.
 */
export async function createRemake(
  original: LabCase,
  options: {
    reason: string;
    fault: LabCase["remakeFault"];
    dueDate?: string;
    agreedPrice?: number;
    by?: string;
  }
): Promise<CreatedLabCase> {
  const round = Math.max(2, (original.remakeRound || 1) + 1);

  return createLabCase({
    branchCode: original.branchCode,
    branchId: original.branchId,
    branchName: original.branchName,
    patientId: original.patientId,
    patientName: original.patientName,
    patientFirstName: original.patientFirstName,
    patientPhone: original.patientPhone,
    doctorId: original.doctorId,
    doctorName: original.doctorName,
    clinicalNoteId: original.clinicalNoteId,
    ledgerId: original.ledgerId,
    labId: original.labId,
    labName: original.labName,
    workType: original.workType,
    workDescription: original.workDescription,
    units: original.units,
    teeth: original.teeth,
    // A remade bridge is still a bridge.
    bridge: original.bridge,
    pontics: original.pontics,
    bodyShade: original.bodyShade,
    cervicalShade: original.cervicalShade,
    gumShade: original.gumShade,
    material: original.material,
    implantSystem: original.implantSystem,
    implantPlatform: original.implantPlatform,
    abutmentType: original.abutmentType,
    retention: original.retention,
    guideType: original.guideType,
    sleeveSystem: original.sleeveSystem,
    notes: original.notes,
    // A remake the lab owns costs nothing; the caller decides, and 0 is a real answer.
    agreedPrice: options.agreedPrice ?? 0,
    sentVia: original.sentVia,
    status: "at_lab",
    needsTryIn: original.needsTryIn,
    sentAt: today(),
    dueDate: options.dueDate,
    remakeOfId: original.id,
    remakeOfCode: original.code,
    remakeReason: options.reason,
    remakeFault: options.fault,
    remakeRound: round,
    createdBy: options.by,
  });
}
