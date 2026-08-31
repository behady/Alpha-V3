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

import { runTransaction, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { localYmd } from "@/lib/clinicDate";
import { LAB_PAYMENTS_COLLECTION } from "@/lib/labAccounts";
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
 * Record a payment to a lab.
 *
 * Writes to `lab_payments` and NOTHING else. It must never post to `ledger`: the lab fee was
 * already booked as a cost when the treatment was saved, so a second entry here would charge the
 * same lab work against profit twice — invisibly, because both entries look perfectly reasonable
 * on their own. This settles a debt recorded months ago; it does not create one.
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
    amount: Math.round(amount * 100) / 100,
    date: input.date || today(),
    createdAt: nowIso(),
    createdAtServer: serverTimestamp(),
  });
  return ref.id;
}

/** Remove a lab payment — a mistyped amount, a duplicate entry. */
export async function deleteLabPayment(id: string): Promise<void> {
  await deleteDoc(getClinicDoc(LAB_PAYMENTS_COLLECTION, id));
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
