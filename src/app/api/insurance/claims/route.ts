import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { adminBucket, adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, isInsurerFormat, parsePayers, PRIVATE_PAYER_ID, type CommissionRates } from "@/lib/payers";
import { isFullAccessRole } from "@/lib/permissions";
import { buildManualEntryRow, buildPaymentRow, sumPayments } from "@/lib/ledgerWrite";
import { RECEIPT_COUNTER_DOC, RECEIPT_SETTINGS_DOC, formatReceiptNumber, normalizeReceiptSettings } from "@/lib/receiptSettings";
import { applyProcedureSync, readProcedurePayments, type PaymentRowLite } from "@/lib/server/ledgerSync";
import { recordMoneyChange } from "@/lib/server/ledgerAudit";
import { afterLedgerCreate } from "@/lib/alerts/moneyAlerts";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { writeInsurance } from "@/lib/patientInsurance";
import { binEntry, liveEntryId, stripUndefined } from "@/lib/server/recycleBinStore";
import { binNoticeOf, type BinNotice } from "@/lib/recycleBin";
import { patientPortion } from "@/lib/ledgerInsurer";
import { isDentistStaff } from "@/lib/staffRoles";
import { nameSimilarity } from "@/lib/insurance/matchPatient";
import { hasHardFailure, normalizeMetlife, type Check } from "@/lib/insurance/metlife";
import { checkApproval } from "@/lib/insurance/formats";
import {
  claimDocId,
  claimExtraction,
  claimFromExtraction,
  claimMetlifeFrom,
  claimTotals,
  CLAIMS_COLLECTION,
  DOCS_COLLECTION,
  insuranceEntryToWrite,
  membershipFromPaper,
  isClaimStatus,
  isIsoDate,
  normalizeConfirmed,
  parseClaim,
  treatedDateAfter,
  WORDING_DOC,
  type ClaimStatus,
  type InsuranceClaim,
  applyDentistPicks,
  cappedPayment,
  dentistRowPatch,
  insuranceTreatmentRows,
  isLineStatus,
  lineDentistFor,
  rowsActionForStatus,
  type LineDentist,
  type LineLedger,
  type LineStatus,
  type ShareCollected,
  type TreatmentRowArgs,
} from "@/lib/insurance/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION = "patients.edit";
const MAX_LINES = 100;
const MAX_NAME = 200;
const MAX_WORDING = 200;
const PATCH_KEYS = new Set(["status", "treatedDate", "patientId", "lines", "metlife", "dentists", "lineStatus", "collectShare", "insurerPaid"]);
const LINE_KEY = /^\d{1,3}$/;
const LINE_STATUS_ERROR = 'A service state must be "Completed", "Planned" or "Ongoing".';
/** How the insurer's own payment is filed: its own method and category, so cash reports never mistake it for cash. */
const INSURER_METHOD = "Insurance";
const INSURER_CATEGORY = "Insurance Payment";
/** The ledger category the patient's share is filed under: a readable word, as every other category is. */
const SHARE_CATEGORY = "Insurance patient share";

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/** One path segment as it arrived in the body: present, short, and unable to step out of its folder. */
function segment(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 200) return "";
  if (s === "." || s === ".." || /[/\\]/.test(s) || /[\u0000-\u001f]/.test(s)) return "";
  return s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

function savedAtOf(data: DocumentData | undefined): string | null {
  const at = (data?.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
  return at ? at.toISOString() : null;
}

/** The settings wording a desk typed on the card: code → Arabic, only for codes on this paper. */
function postedWording(raw: unknown, codes: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const code = k.trim().toUpperCase();
    const ar = typeof v === "string" ? v.trim() : "";
    if (!codes.has(code) || !ar || ar.length > MAX_WORDING) continue;
    out[code] = ar;
  }
  return out;
}

/**
 * The wording the treatment rows are named by: the clinic's stored wording wins (it is what the
 * clinic calls a code everywhere else), and what the desk typed on this card fills codes it lacks.
 */
function rowWording(stored: unknown, posted: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (isRecord(stored)) {
    for (const [code, entry] of Object.entries(stored)) {
      const ar = isRecord(entry) ? entry.ar : undefined;
      if (typeof ar === "string" && ar.trim()) out[code] = ar.trim();
    }
  }
  for (const [code, ar] of Object.entries(posted)) {
    if (!out[code]) out[code] = ar;
  }
  return out;
}

type Charge = { id: string; row: Record<string, unknown> };

/**
 * The treatments themselves, as the patient's file records any other work: one clinical note and
 * one ledger charge per approved line, under this insurer, so Finance, the reports and the
 * patient's balance all see insurance work without a second entry. Writes only; the caller has
 * done every read. Returns the links to keep on the claim and the charges for the audit trail.
 */
function writeTreatmentRows(tx: Transaction, clinicId: string, args: TreatmentRowArgs): { ledgerIds: Record<number, LineLedger>; charges: Charge[] } {
  const ledgerIds: Record<number, LineLedger> = {};
  const charges: Charge[] = [];
  for (const r of insuranceTreatmentRows(args)) {
    const noteRef = adminClinicCollection(clinicId, "clinical_notes").doc();
    const ledgerRef = adminClinicCollection(clinicId, "ledger").doc();
    tx.set(noteRef, { ...stripUndefined(r.note), ledgerId: ledgerRef.id, createdAt: FieldValue.serverTimestamp() });
    tx.set(ledgerRef, { ...stripUndefined(r.charge), clinicalNoteId: noteRef.id, createdAt: FieldValue.serverTimestamp() });
    ledgerIds[r.lineIndex] = { ledgerId: ledgerRef.id, noteId: noteRef.id };
    charges.push({ id: ledgerRef.id, row: r.charge });
  }
  return { ledgerIds, charges };
}

type Actor = { uid: string; name: string; role: string };

/**
 * The trail a treatment logged by hand leaves: one audit row per charge. No discount alert: a
 * line the insurer approved for less than the paper asked is the insurer's decision, not a
 * discount anyone at the desk gave, and every reduced line would otherwise raise one.
 */
async function auditCharges(clinicId: string, charges: Charge[], actor: Actor, via: string): Promise<void> {
  await Promise.all(
    charges.map((c) =>
      recordMoneyChange({
        entry: { clinicId, action: "create", collection: "ledger", documentId: c.id, after: c.row, actor, via },
        action: "Procedure Logged",
        details: `${String(c.row.description)} - ${c.row.amount} EGP`,
      }).catch((err) => reportServerError("Insurance treatment audit failed:", err)),
    ),
  );
}

type DocFacts = InsuranceClaim["doc"];
const NO_DOC: DocFacts = { path: "", contentType: "", bytes: 0, pages: null };

function docFactsOf(data: DocumentData | undefined): DocFacts | null {
  if (!data || typeof data.path !== "string" || !data.path) return null;
  return {
    path: data.path,
    contentType: typeof data.contentType === "string" ? data.contentType : "",
    bytes: typeof data.bytes === "number" && Number.isFinite(data.bytes) ? data.bytes : 0,
    pages: typeof data.pages === "number" && Number.isFinite(data.pages) ? data.pages : null,
  };
}

/**
 * Saves a confirmed insurer approval as a claim.
 *
 * POST { clinicId, docId, payerId, extraction, patient: { id } | { create: { name, phone? } },
 *        status?: "approved" | "treated" (default "treated"), treatedDate?, dentistId?,
 *        lines?: { [lineIndex]: { dentistId?: string | null, status?: "Completed" | "Planned" | "Ongoing" } },
 *        wording?: { [code]: arabic }, docPath? }
 *   → 201 { ok: true, claimId, patientId }
 *   → 409 { ok: false, duplicate: { claimId, savedAt } } when this approval is already a claim
 *   → 409 { ok: false, error, claimId } when this document is already attached to another claim
 *   → 400 { ok: false, error, checks } when the extraction fails a hard check
 *
 * Gates, as in /api/insurance/read: body → staff with `patients.edit` → the `insurance` add-on → an
 * active payer with a document format → the hard checks, run again here because the browser's Save
 * button is not the only way to reach this route.
 *
 * One transaction does every write, so two tabs saving the same paper make exactly one claim: it reads
 * the claim (exists → 409), the document row (linked to another claim → 409), the patient (or the patient counter when creating one)
 * and the wording table, then creates the claim, links the document row to it (set+merge: a read that
 * failed leaves no row), writes `insurance.{payerId}` on the patient when it is missing or different,
 * and adds any Arabic wording the clinic did not have yet. Existing wording is never overwritten here.
 * The claim keeps `read: { checks, at }`: the soft warnings the desk saved over.
 *
 * A claim saved as `treated` also writes its treatment rows in the same transaction (one clinical
 * note and one ledger charge per approved line, dated the treated day, named by the clinic's stored
 * wording where it has one); an `approved` claim writes them when PATCH marks it treated or sent.
 * Every line gets its row whatever its state: the note carries the state, the charge exists either way.
 *
 * `lines` is the confirm card's per-service choice: who did each service (null or "" = nobody yet) and
 * where it stands. A line with no entry, or an entry with no `dentistId`, takes `dentistId` (the older
 * one-dentist-for-the-paper shape, kept for compatibility); a line with no state is Completed. Every
 * index must be a line on the paper and every dentist must be a dentist (400 otherwise).
 *
 * `docPath` is optional and only used when no document row exists (the read failed and the desk typed
 * the paper in): it must sit in this clinic's `insurance_docs/{docId}/` folder, and the file's type
 * and size are taken from Storage, never from the body.
 */
export async function POST(req: Request) {
  try {
    // --- body -------------------------------------------------------------------------------
    const body = await req.json().catch(() => ({}));
    const clinicId = segment(body?.clinicId);
    const payerId = segment(body?.payerId);
    const docId = segment(body?.docId);
    if (!clinicId || !payerId || !docId || !isRecord(body?.extraction)) {
      return fail(400, "clinicId, docId, payerId and extraction are required.");
    }
    // The confirm card no longer sends a status: the paper it saves is treated work. "approved" is
    // still accepted from any other caller.
    const rawStatus: unknown = body.status === undefined || body.status === null ? "treated" : body.status;
    if (rawStatus !== "approved" && rawStatus !== "treated") return fail(400, 'status must be "approved" or "treated".');
    const status: "approved" | "treated" = rawStatus;
    if (body.treatedDate !== undefined && body.treatedDate !== null && !isIsoDate(body.treatedDate)) {
      return fail(400, "treatedDate must be a yyyy-mm-dd date.");
    }
    // The dentist who did the work, if the desk knows at save time: every line is assigned to
    // them and the treatment rows carry them. Optional: the patient's Insurance tab assigns later.
    const dentistId = body.dentistId === undefined || body.dentistId === null || body.dentistId === "" ? "" : segment(body.dentistId);
    if (body.dentistId && !dentistId) return fail(400, "dentistId must name a staff member.");
    // Per service: { "<lineIndex>": { dentistId?, status? } }. A `dentistId` of "" here means
    // "nobody yet" and overrides the paper-wide one; an absent one falls back to it.
    const lineIn: Record<number, { dentistId?: string; status?: LineStatus }> = {};
    if (body.lines !== undefined && body.lines !== null) {
      if (!isRecord(body.lines)) return fail(400, "lines must map a line index to { dentistId?, status? }.");
      for (const [k, v] of Object.entries(body.lines)) {
        if (!LINE_KEY.test(k)) return fail(400, "lines keys must be line indices.");
        if (!isRecord(v)) return fail(400, "lines must map a line index to { dentistId?, status? }.");
        const entry: { dentistId?: string; status?: LineStatus } = {};
        if (v.dentistId !== undefined) {
          if (v.dentistId === null || v.dentistId === "") entry.dentistId = "";
          else {
            const id = segment(v.dentistId);
            if (!id) return fail(400, "A service's dentistId must name a staff member or be null.");
            entry.dentistId = id;
          }
        }
        if (v.status !== undefined) {
          if (!isLineStatus(v.status)) return fail(400, LINE_STATUS_ERROR);
          entry.status = v.status;
        }
        lineIn[Number(k)] = entry;
      }
    }
    const patientIn = isRecord(body.patient) ? body.patient : null;
    const existingId = patientIn && typeof patientIn.id === "string" ? segment(patientIn.id) : "";
    const create = patientIn && isRecord(patientIn.create) ? patientIn.create : null;
    const newName = create && typeof create.name === "string" ? create.name.trim().replace(/\s+/g, " ") : "";
    const rawPhone = create && typeof create.phone === "string" ? create.phone.trim() : "";
    const newPhone = rawPhone ? normalizeToE164AssumingCountry(rawPhone) : "";
    if (existingId ? create : !create) return fail(400, "patient must be either { id } or { create: { name } }.");
    if (create && (!newName || newName.length > MAX_NAME)) return fail(400, "The new patient needs a name.");
    if (rawPhone && !newPhone) return fail(400, "The new patient's phone number is not valid.");
    const docPathIn = typeof body.docPath === "string" ? body.docPath.trim() : "";

    // --- who --------------------------------------------------------------------------------
    const authz = await requireStaffPermission(req, clinicId, PERMISSION);
    if (!authz.ok) return authz.response;

    // --- add-on -----------------------------------------------------------------------------
    if (!(await clinicHasFeature(clinicId, "insurance"))) {
      return fail(403, "Insurance is not part of this clinic's subscription.", { reason: "feature_locked" });
    }

    // --- payer and its document format ------------------------------------------------------
    const payersSnap = await adminClinicDoc(clinicId, "settings", "payers").get();
    const payer = findPayer(parsePayers(payersSnap.data()), payerId);
    if (!payer) return fail(400, "That insurer is not set up in this clinic.");
    if (!payer.active) return fail(403, "That insurer is retired in this clinic's settings.");
    if (payer.id === PRIVATE_PAYER_ID || !isInsurerFormat(payer.format)) {
      return fail(403, "This insurer has no document format set.");
    }
    const format = payer.format;

    // --- the patient, for the name check ----------------------------------------------------
    const patients = adminClinicCollection(clinicId, "patients");
    let checkName = newName;
    if (existingId) {
      const snap = await patients.doc(existingId).get();
      if (!snap.exists) return fail(404, "That patient was not found.");
      checkName = typeof snap.get("name") === "string" ? (snap.get("name") as string) : "";
    }

    // --- the extraction, read and checked again ---------------------------------------------
    const extraction = normalizeConfirmed(body.extraction, format);
    const h = extraction.header;
    if (extraction.lines.length > MAX_LINES) return fail(400, "Too many service lines.");
    if (Object.keys(lineIn).some((k) => Number(k) >= extraction.lines.length)) {
      return fail(400, "lines names a service line that is not on the paper.");
    }
    /** Who did line i: its own pick when the card sent one ("" = nobody yet), else the paper-wide one. */
    const dentistOfLine = (i: number): string => (lineIn[i]?.dentistId !== undefined ? (lineIn[i].dentistId as string) : dentistId);
    // Every dentist named, the paper-wide one included, is read and must be a dentist.
    const staffIds = [...new Set([dentistId, ...extraction.lines.map((_, i) => dentistOfLine(i))].filter(Boolean))];
    const checks = checkApproval(format, extraction, {
      today: ymdInTimeZone(clinicTimeZone()),
      providerCode: payer.providerCode,
      ...(checkName ? { matchedPatientName: checkName, nameScore: nameSimilarity(h.paperPatientName, checkName) } : {}),
    });
    if (hasHardFailure(checks)) {
      return fail(400, "The approval does not add up yet. Fix the marked fields and save again.", { checks });
    }
    const softChecks: Check[] = checks.filter((c) => c.severity === "soft");
    const claimId = claimDocId(format, h.approvalNumber);
    const treatedDate = status === "treated" ? (isIsoDate(body.treatedDate) ? body.treatedDate : h.approvalDate) : null;
    const wording = postedWording(body.wording, new Set(extraction.lines.map((l) => l.code).filter(Boolean)));

    // --- the document's facts, when no row records them yet ---------------------------------
    const docsRef = adminClinicDoc(clinicId, DOCS_COLLECTION, docId);
    let fallbackDoc: DocFacts = NO_DOC;
    if (docPathIn && !docFactsOf((await docsRef.get()).data())) {
      const prefix = `clinics/${clinicId}/${DOCS_COLLECTION}/${docId}/`;
      const fileName = docPathIn.startsWith(prefix) ? docPathIn.slice(prefix.length) : "";
      if (!segment(fileName) || fileName !== fileName.trim()) {
        return fail(400, "That document is not in this clinic's insurance folder.");
      }
      try {
        const [meta] = await adminBucket().file(docPathIn).getMetadata();
        fallbackDoc = {
          path: docPathIn,
          contentType: String(meta.contentType || "").split(";")[0].trim().toLowerCase(),
          bytes: Number(meta.size) || 0,
          pages: null,
        };
      } catch (err) {
        if ((err as { code?: unknown })?.code === 404) return fail(404, "The uploaded document was not found. Upload it again.");
        throw err;
      }
    }

    // --- one transaction for every write ----------------------------------------------------
    const claimRef = adminClinicDoc(clinicId, CLAIMS_COLLECTION, claimId);
    const wordingRef = adminClinicDoc(clinicId, "settings", WORDING_DOC);
    const counterRef = adminClinicDoc(clinicId, "settings", "counters");
    const patientRef: DocumentReference = existingId ? patients.doc(existingId) : patients.doc();
    // What the paper says about the patient's membership, per format (lib/insurance/claims membershipFromPaper).
    const paperEntry = membershipFromPaper(format, h);

    type Outcome =
      | { kind: "duplicate"; savedAt: string | null }
      | { kind: "in_bin"; notice: BinNotice }
      | { kind: "doc_taken"; claimId: string }
      | { kind: "no_patient" }
      | { kind: "no_staff" }
      | { kind: "not_dentist" }
      | { kind: "saved"; charges: Charge[] };
    let outcome: Outcome;
    try {
      outcome = await adminDb().runTransaction(async (tx): Promise<Outcome> => {
        // Reads first: a transaction may not read after it writes.
        const claimSnap = await tx.get(claimRef);
        if (claimSnap.exists) return { kind: "duplicate", savedAt: savedAtOf(claimSnap.data()) };
        // The same approval, deleted and still in Recently Deleted: saving it again would make a
        // second copy the bin could never take (it keeps one per approval number). Restore instead.
        const binSnap = await tx.get(binEntry(liveEntryId(clinicId, CLAIMS_COLLECTION, claimId)));
        const inBin = binNoticeOf(binSnap.data());
        if (inBin) return { kind: "in_bin", notice: inBin };
        const docsSnap = await tx.get(docsRef);
        const wordingSnap = await tx.get(wordingRef);
        const payersSnap = await tx.get(adminClinicDoc(clinicId, "settings", "payers"));
        const staffSnaps = await Promise.all(staffIds.map((id) => tx.get(adminClinicDoc(clinicId, "staff", id))));
        const patientSnap = existingId ? await tx.get(patientRef) : null;
        const counterSnap = existingId ? null : await tx.get(counterRef);
        if (patientSnap && !patientSnap.exists) return { kind: "no_patient" };
        if (staffSnaps.some((s) => !s.exists)) return { kind: "no_staff" };
        if (staffSnaps.some((s) => !isDentistStaff(s.data()))) return { kind: "not_dentist" };
        const staffById = new Map<string, { id: string; name: string } & CommissionRates>();
        staffSnaps.forEach((s, k) => {
          const d = s.data() ?? {};
          staffById.set(staffIds[k], {
            id: staffIds[k],
            name: typeof d.name === "string" ? d.name : "",
            // Raw: commissionRateFor coerces, and a rate stored as "25" must not stamp as 0%.
            commissionPercentage: d.commissionPercentage as number | null | undefined,
            commissionByPayer: isRecord(d.commissionByPayer) ? d.commissionByPayer : null,
          });
        });
        const linked = docsSnap.get("claimId");
        if (typeof linked === "string" && linked && linked !== claimId) return { kind: "doc_taken", claimId: linked };

        const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: authz.uid };
        let patientName = newName;

        if (patientSnap) {
          const data = patientSnap.data() ?? {};
          patientName = typeof data.name === "string" ? data.name : "";
          // Only when missing or different; a dotted path, so other payers' entries are untouched.
          const entry = insuranceEntryToWrite(payerId, h, data, format);
          if (entry) tx.update(patientRef, { [`insurance.${payerId}`]: stripUndefined(entry) });
        } else {
          // The shape NewPatientModal writes, with the file number from the same counter.
          const counter = counterSnap?.data();
          const last = typeof counter?.patientId === "number" ? counter.patientId : null;
          const nextId = last === null ? 1000 : last + 1;
          tx.set(counterRef, { patientId: nextId }, { merge: true });
          tx.create(patientRef, {
            ...stripUndefined({
              fileId: `PT-${nextId}`,
              name: newName,
              // The paper's Latin spelling, kept so a later approval can still be matched by name.
              nameLatin: h.paperPatientName && h.paperPatientName !== newName ? h.paperPatientName : undefined,
              phone: newPhone,
              allergies: "",
              medicalHistory: "",
              status: "New",
              teethData: {},
              insurance: writeInsurance({ [payerId]: paperEntry }),
            }),
            createdAt: FieldValue.serverTimestamp(),
            createdBy: authz.uid,
          });
        }

        const rowFacts = docFactsOf(docsSnap.data());
        const docFacts = rowFacts ?? fallbackDoc;
        const claim = claimFromExtraction({ payerId, format, extraction, patientId: patientRef.id, patientName, status, treatedDate, doc: docFacts });
        // The dentist on each line, stamped with their rate on this payer and the share on the
        // approved amount (the owner's rule: earned when assigned, on what the insurer approved),
        // and the state of each line the card named.
        claim.lines.forEach((line, i) => {
          const staff = staffById.get(dentistOfLine(i));
          if (staff) claim.dentists[i] = lineDentistFor(line, staff, payerId);
          const state = lineIn[i]?.status;
          if (state) claim.lineStatus[i] = state;
        });
        // The treatments are recorded only once they are done: a claim saved as `treated` writes
        // its rows now, dated the treated day; an `approved` one writes them when it is marked
        // treated (or sent).
        let charges: Charge[] = [];
        if (status === "treated") {
          const payerName = findPayer(parsePayers(payersSnap.data()), payerId)?.name ?? payerId;
          const written = writeTreatmentRows(tx, clinicId, {
            claimId,
            claim,
            payerName,
            wording: rowWording(wordingSnap.get(format), wording),
            actor: { uid: authz.uid, name: authz.name, role: authz.role },
          });
          claim.ledgerIds = written.ledgerIds;
          charges = written.charges;
        }
        tx.create(claimRef, {
          ...stripUndefined(claim),
          sentAt: null,
          // The warnings the desk saw and saved over. The model's raw answer is not stored anywhere; the
          // read's token count is in the AI usage log.
          read: { checks: stripUndefined(softChecks), at: FieldValue.serverTimestamp() },
          createdAt: FieldValue.serverTimestamp(),
          createdBy: authz.uid,
          ...stamp,
        });

        // The row may be missing (a read that failed writes none): set+merge, never update.
        tx.set(
          docsRef,
          {
            ...stripUndefined({ claimId, payerId, ...(!rowFacts && docFacts.path ? docFacts : {}) }),
            ...(docsSnap.exists ? {} : { uploadedAt: FieldValue.serverTimestamp(), uploadedBy: authz.uid }),
          },
          { merge: true },
        );

        // Learn the wording the clinic did not have; never overwrite what it already calls a code.
        const storedWording = wordingSnap.get(format) as Record<string, unknown> | undefined;
        const learned = Object.fromEntries(
          Object.entries(wording)
            .filter(([code]) => !(isRecord(storedWording) && Object.hasOwn(storedWording, code)))
            .map(([code, ar]) => [code, { ar }]),
        );
        if (Object.keys(learned).length) {
          tx.set(wordingRef, { [format]: stripUndefined(learned), ...stamp }, { merge: true });
        }
        return { kind: "saved", charges };
      });
    } catch (err) {
      // Two tabs in the same instant: the loser's create fails rather than retrying into the read.
      if (!isAlreadyExists(err)) throw err;
      const snap = await claimRef.get();
      if (!snap.exists) throw err;
      outcome = { kind: "duplicate", savedAt: savedAtOf(snap.data()) };
    }

    if (outcome.kind === "duplicate") {
      return NextResponse.json({ ok: false, duplicate: { claimId, savedAt: outcome.savedAt } }, { status: 409 });
    }
    if (outcome.kind === "in_bin") {
      return fail(
        409,
        outcome.notice.withParent
          ? `This approval was deleted together with ${outcome.notice.withParent}. Restore the patient from Recently Deleted to bring it back.`
          : "This approval is in Recently Deleted. Restore it from there instead of saving the paper again.",
        { inBin: outcome.notice },
      );
    }
    if (outcome.kind === "doc_taken") {
      return fail(409, "This document is already attached to another claim.", { claimId: outcome.claimId });
    }
    if (outcome.kind === "no_patient") return fail(404, "That patient was not found.");
    if (outcome.kind === "no_staff") return fail(404, "That dentist was not found.");
    if (outcome.kind === "not_dentist") return fail(400, "That staff member is not a dentist.");
    if (outcome.kind === "saved" && outcome.charges.length) {
      await auditCharges(clinicId, outcome.charges, { uid: authz.uid, name: authz.name, role: authz.role }, "insurance/claims:save");
    }
    return NextResponse.json({ ok: true, claimId, patientId: patientRef.id }, { status: 201 });
  } catch (error) {
    reportServerError("Insurance claim save failed:", error);
    return fail(500, "Saving the claim failed. Please try again.");
  }
}

/**
 * Edits a saved claim.
 *
 * PATCH { clinicId, claimId, patch: { status?, treatedDate?, patientId?, lines?, metlife?, dentists?, lineStatus?, collectShare?, insurerPaid? } }
 *   → 200 { ok: true } (plus `payments` or `shareCollected` when money was recorded)
 *
 * Only those keys; anything else is a 400, so a typo never silently does nothing.
 *
 * - `lines` / `metlife`: laid over the stored claim, read through the reader's own normaliser, and the
 *   hard checks run again with the same context as a save (400 { ok: false, error, checks } on a hard
 *   failure; nothing written). Totals are recomputed from the lines. To claim less than the paper
 *   approved, the printed totals in `metlife` are edited along with the lines.
 * - `status`: `approved` clears the treated date; `treated` without a date keeps the stored one or takes
 *   the approval date; `sent` stamps `sentAt` and, with no treated date yet, fills it as `treated`
 *   does. The treatment rows follow the status: becoming `treated` or `sent` with no rows yet
 *   writes them (dated the treated day); going back to `approved`, or
 *   `cancelled`, deletes them in the same transaction — refused (409) once any of them has money
 *   against it.
 * - `patientId`: re-snapshots the patient's name (404 when the patient does not exist) and writes
 *   `insurance.{payerId}` on that patient when missing or different, as a save does. A `metlife` edit
 *   is never pushed to the patient: the patient's own editor owns that.
 * - Once the approval has written its treatment rows, `lines`, `metlife` and `patientId` are refused
 *   (409): the rows are the record of what was done and to whom. The dentist and the status stay
 *   editable.
 * - `dentists`: { lineIndex: staffId | null }, each staff member a dentist (400 otherwise); the rate and
 *   share are stamped from the staff record and follow into the treatment rows that exist.
 * - `lineStatus`: { lineIndex: "Completed" | "Planned" | "Ongoing" }, merged into the stored map; each
 *   index must be a line of the claim. The state follows into the clinical note of each treatment
 *   row that exists (the ledger charge carries no state, as in the clinical editor).
 * - `collectShare` / `insurerPaid` (one at a time, never with a status change): one payment per
 *   treatment row, capped at what is still open on it, only on a `treated` or `sent` approval.
 *
 * Every edit stamps `updatedAt`/`updatedBy`.
 */
export async function PATCH(req: Request) {
  try {
    // --- body -------------------------------------------------------------------------------
    const body = await req.json().catch(() => ({}));
    const clinicId = segment(body?.clinicId);
    const claimId = segment(body?.claimId);
    const patch = body?.patch;
    if (!clinicId || !claimId || !isRecord(patch)) return fail(400, "clinicId, claimId and patch are required.");
    const keys = Object.keys(patch);
    if (keys.length === 0) return fail(400, "Nothing to change.");
    const unknown = keys.filter((k) => !PATCH_KEYS.has(k));
    if (unknown.length) return fail(400, `Unknown field: ${unknown.join(", ")}.`);

    let status: ClaimStatus | undefined;
    if ("status" in patch) {
      if (!isClaimStatus(patch.status)) return fail(400, 'status must be "approved", "treated", "sent" or "cancelled".');
      status = patch.status;
    }
    let treatedDate: string | null | undefined;
    if ("treatedDate" in patch) {
      if (patch.treatedDate !== null && !isIsoDate(patch.treatedDate)) return fail(400, "treatedDate must be a yyyy-mm-dd date or null.");
      treatedDate = patch.treatedDate;
    }
    let newPatientId = "";
    if ("patientId" in patch) {
      newPatientId = segment(patch.patientId);
      if (!newPatientId) return fail(400, "patientId must name a patient.");
    }
    let rawLines: unknown[] | undefined;
    if ("lines" in patch) {
      if (!Array.isArray(patch.lines) || patch.lines.length === 0 || patch.lines.length > MAX_LINES) {
        return fail(400, "lines must be a list of 1 to 100 service lines.");
      }
      rawLines = patch.lines;
      if (normalizeMetlife({ lines: rawLines }).lines.length === 0) return fail(400, "lines must hold at least one service line.");
    }
    let rawMetlife: Record<string, unknown> | undefined;
    if ("metlife" in patch) {
      if (!isRecord(patch.metlife)) return fail(400, "metlife must be an object.");
      rawMetlife = patch.metlife;
    }
    // Who did each line: { "<lineIndex>": staffId | null }. The rate and share are stamped here,
    // from the staff record, never trusted from the browser.
    let picks: Record<string, string | null> | undefined;
    if ("dentists" in patch) {
      if (!isRecord(patch.dentists)) return fail(400, "dentists must map a line index to a staff id or null.");
      picks = {};
      for (const [k, v] of Object.entries(patch.dentists)) {
        if (!/^\d{1,3}$/.test(k)) return fail(400, "dentists keys must be line indices.");
        if (v !== null && !segment(v)) return fail(400, "dentists values must be a staff id or null.");
        picks[k] = v === null ? null : segment(v);
      }
      if (Object.keys(picks).length === 0) return fail(400, "dentists is empty.");
    }
    // Where each service stands: { "<lineIndex>": "Completed" | "Planned" | "Ongoing" }.
    let statePicks: Record<number, LineStatus> | undefined;
    if ("lineStatus" in patch) {
      if (!isRecord(patch.lineStatus)) return fail(400, "lineStatus must map a line index to a state.");
      statePicks = {};
      for (const [k, v] of Object.entries(patch.lineStatus)) {
        if (!LINE_KEY.test(k)) return fail(400, "lineStatus keys must be line indices.");
        if (!isLineStatus(v)) return fail(400, LINE_STATUS_ERROR);
        statePicks[Number(k)] = v;
      }
      if (Object.keys(statePicks).length === 0) return fail(400, "lineStatus is empty.");
    }
    // The patient's share taken as cash. The ledger rows and the claim's stamp are written in ONE
    // transaction here — two separate calls left a stray cash row whenever the second one failed.
    const collectShare = patch.collectShare === true;
    if ("collectShare" in patch && !collectShare) return fail(400, "collectShare must be true.");
    // The insurer's own payment against the treatment rows: its own method, no commission (the
    // dentist's share was earned when the line was assigned), the rows stamped as settled.
    const insurerPaid = patch.insurerPaid === true;
    if ("insurerPaid" in patch && !insurerPaid) return fail(400, "insurerPaid must be true.");
    if ("collectShare" in patch && "insurerPaid" in patch) {
      return fail(400, "Record the patient's share and the insurer's payment one at a time.");
    }
    const paying = collectShare || insurerPaid;
    // A status change can write or delete the very rows a payment would settle.
    if (paying && status !== undefined) return fail(400, "Change the status and record a payment one at a time.");

    // --- who --------------------------------------------------------------------------------
    const authz = await requireStaffPermission(req, clinicId, PERMISSION);
    if (!authz.ok) return authz.response;
    // Cash into the ledger is the finance permission's business, exactly as a manual income row is.
    if (paying && !(isFullAccessRole(authz.role) || authz.permissions.includes("finance.add"))) {
      return fail(403, "Recording the patient's share needs the finance permission.");
    }
    const actor: Actor = { uid: authz.uid, name: authz.name, role: authz.role };

    // --- add-on -----------------------------------------------------------------------------
    if (!(await clinicHasFeature(clinicId, "insurance"))) {
      return fail(403, "Insurance is not part of this clinic's subscription.", { reason: "feature_locked" });
    }

    const claimRef = adminClinicDoc(clinicId, CLAIMS_COLLECTION, claimId);
    type Collected = { ledgerId: string; amount: number; row: Record<string, unknown> };
    type PatchOutcome =
      | { kind: "no_claim" }
      | { kind: "unreadable" }
      | { kind: "no_patient" }
      | { kind: "no_staff"; ids: string[] }
      | { kind: "not_dentist" }
      | { kind: "bad_line" }
      | { kind: "rows_exist" }
      | { kind: "rows_paid_edit" }
      | { kind: "not_treated" }
      | { kind: "rows_paid" }
      | { kind: "already_collected"; share: ShareCollected }
      | { kind: "nothing_to_collect" }
      | { kind: "already_insurer_paid" }
      | { kind: "no_rows" }
      | { kind: "nothing_left" }
      | { kind: "checks"; checks: Check[] }
      | { kind: "ok"; created: Charge[]; removed: Charge[]; payments: Charge[] | null; what: "share" | "insurer"; collected: Collected | null; rebuilt: boolean };
    const result = await adminDb().runTransaction(async (tx): Promise<PatchOutcome> => {
      // --- reads: every one of them before the first write --------------------------------------
      const claimSnap = await tx.get(claimRef);
      if (!claimSnap.exists) return { kind: "no_claim" };
      const claim = parseClaim(claimId, claimSnap.data());
      if (!claim) return { kind: "unreadable" };
      const links = Object.entries(claim.ledgerIds).map(([k, link]) => ({ index: Number(k), ...link }));
      const hasRows = links.length > 0;
      // Editing a saved approval (its services, its header or its patient) rewrites the treatment
      // rows it put in the patient's file: the old ones leave, the new ones are written from the
      // edited paper in the same transaction. Not while money sits on them (checked below), and not
      // together with a status change or a payment, which act on the rows being replaced.
      const rebuild = hasRows && (rawLines !== undefined || rawMetlife !== undefined || !!newPatientId);
      if (rebuild && (status !== undefined || paying)) return { kind: "rows_exist" };
      if (paying && claim.status !== "treated" && claim.status !== "sent") return { kind: "not_treated" };
      if (collectShare && claim.shareCollected) return { kind: "already_collected", share: claim.shareCollected };
      if (collectShare && claim.totals.patientShare <= 0) return { kind: "nothing_to_collect" };
      if (insurerPaid && claim.insurerPaid) return { kind: "already_insurer_paid" };
      if (insurerPaid && !hasRows) return { kind: "no_rows" };
      const rowsAction = rowsActionForStatus({ from: claim.status, to: status, hasRows });

      const patientRef = newPatientId ? adminClinicDoc(clinicId, "patients", newPatientId) : null;
      const patientSnap = patientRef ? await tx.get(patientRef) : null;
      if (patientSnap && !patientSnap.exists) return { kind: "no_patient" };
      const reshape = rawLines !== undefined || rawMetlife !== undefined;
      const payersSnap = reshape || rebuild || paying || rowsAction === "write" ? await tx.get(adminClinicDoc(clinicId, "settings", "payers")) : null;
      const wordingSnap = rowsAction === "write" || rebuild ? await tx.get(adminClinicDoc(clinicId, "settings", WORDING_DOC)) : null;
      // The staff records behind the picks, read inside the transaction so the stamped rate is the
      // one on file at this moment. Only a dentist can be paid for a line.
      const staffById = new Map<string, { id: string; name: string } & CommissionRates>();
      let notDentist = false;
      if (picks) {
        const ids = [...new Set(Object.values(picks).filter((v): v is string => typeof v === "string"))];
        const snaps = await Promise.all(ids.map((id) => tx.get(adminClinicDoc(clinicId, "staff", id))));
        snaps.forEach((snap, i) => {
          if (!snap.exists) return;
          const d = snap.data() ?? {};
          if (!isDentistStaff(d)) notDentist = true;
          staffById.set(ids[i], {
            id: ids[i],
            name: typeof d.name === "string" ? d.name : "",
            // Raw: commissionRateFor coerces, and a rate stored as "25" must not stamp as 0%.
            commissionPercentage: d.commissionPercentage as number | null | undefined,
            commissionByPayer: isRecord(d.commissionByPayer) ? d.commissionByPayer : null,
          });
        });
      }
      // The treatment rows themselves: whether they still exist, what they cost, what is paid on
      // them. A row deleted from under the claim is skipped, never updated (that would fail the
      // whole transaction).
      const chargeSnaps = new Map<string, DocumentSnapshot>();
      const noteSnaps = new Map<string, DocumentSnapshot>();
      if (hasRows && (rowsAction === "remove" || paying || picks || rebuild)) {
        const snaps = await Promise.all(links.map((l) => tx.get(adminClinicDoc(clinicId, "ledger", l.ledgerId))));
        links.forEach((l, i) => chargeSnaps.set(l.ledgerId, snaps[i]));
      }
      if (hasRows && (picks || statePicks) && rowsAction !== "remove" && !rebuild) {
        const snaps = await Promise.all(links.map((l) => tx.get(adminClinicDoc(clinicId, "clinical_notes", l.noteId))));
        links.forEach((l, i) => noteSnaps.set(l.noteId, snaps[i]));
      }
      const paidOn = (snap: DocumentSnapshot | undefined) => (snap?.exists ? Number(snap.get("paid")) || 0 : 0);
      if (rowsAction === "remove" && links.some((l) => paidOn(chargeSnaps.get(l.ledgerId)) > 0)) return { kind: "rows_paid" };
      if (rebuild && links.some((l) => paidOn(chargeSnaps.get(l.ledgerId)) > 0)) return { kind: "rows_paid_edit" };
      // Payments settle the treatment rows, so every read they need comes now: the receipt
      // counter, and each live row's existing payments (the rebalance must see the real set).
      const liveLinks = links.filter((l) => chargeSnaps.get(l.ledgerId)?.exists);
      const [receiptSettingsSnap, receiptCounterSnap] =
        paying && hasRows
          ? await Promise.all([tx.get(adminClinicDoc(clinicId, "settings", RECEIPT_SETTINGS_DOC)), tx.get(adminClinicDoc(clinicId, "settings", RECEIPT_COUNTER_DOC))])
          : [null, null];
      const siblingsByRow = new Map<string, PaymentRowLite[]>();
      if (paying && hasRows) {
        const sets = await Promise.all(liveLinks.map((l) => readProcedurePayments(tx, clinicId, l.ledgerId)));
        liveLinks.forEach((l, i) => siblingsByRow.set(l.ledgerId, sets[i]));
      }

      // --- decisions: nothing is written until every refusal has had its say ------------------
      const update: Record<string, unknown> = {};
      if (status !== undefined) update.status = status;
      const treated = treatedDateAfter({
        status,
        treatedDate,
        current: claim.treatedDate,
        approvalDate: claim.approvalDate,
      });
      if (treated !== undefined) update.treatedDate = treated;

      let patientName = claim.patientName;
      if (patientSnap) {
        patientName = typeof patientSnap.get("name") === "string" ? (patientSnap.get("name") as string) : "";
        update.patientId = newPatientId;
        update.patientName = patientName;
      }

      let metlife = claim.metlife;
      let lines = claim.lines;
      if (reshape) {
        const merged = claimExtraction(claim, { lines: rawLines, metlife: rawMetlife });
        const payer = findPayer(parsePayers(payersSnap?.data()), claim.payerId);
        const checks = checkApproval(claim.insurer, merged, {
          today: ymdInTimeZone(clinicTimeZone()),
          providerCode: payer?.providerCode,
          ...(patientName ? { matchedPatientName: patientName, nameScore: nameSimilarity(merged.header.paperPatientName, patientName) } : {}),
        });
        if (hasHardFailure(checks)) return { kind: "checks", checks };
        if (rawMetlife !== undefined) {
          metlife = claimMetlifeFrom(merged.header);
          update.metlife = metlife;
        }
        if (rawLines !== undefined) {
          lines = merged.lines;
          update.lines = lines;
          update.totals = claimTotals(lines);
        }
      }

      // Lines removed by the edit take their dentist and state with them.
      const onLines = <T,>(m: Record<number, T>): Record<number, T> =>
        Object.fromEntries(Object.entries(m).filter(([k]) => Number(k) < lines.length)) as Record<number, T>;
      let dentists = rawLines !== undefined ? onLines(claim.dentists) : claim.dentists;
      if (rawLines !== undefined) update.dentists = dentists;
      if (picks) {
        const applied = applyDentistPicks({ lines, dentists, payerId: claim.payerId }, picks, staffById);
        if (applied.unknownStaff.length) return { kind: "no_staff", ids: applied.unknownStaff };
        if (notDentist) return { kind: "not_dentist" };
        dentists = applied.dentists;
        update.dentists = dentists;
      }

      let lineStatus = rawLines !== undefined ? onLines(claim.lineStatus) : claim.lineStatus;
      if (rawLines !== undefined) update.lineStatus = lineStatus;
      if (statePicks) {
        if (Object.keys(statePicks).some((k) => Number(k) >= lines.length)) return { kind: "bad_line" };
        lineStatus = { ...lineStatus, ...statePicks };
        update.lineStatus = lineStatus;
      }

      // One payment per live treatment row, each capped at what is still open on that row, so a row
      // the patient already settled at the counter is never paid twice.
      const plan: Array<{ index: number; ledgerId: string; amount: number; labFee: number; service: string }> = [];
      if (paying && hasRows) {
        for (const l of liveLinks) {
          const line = claim.lines[l.index];
          if (!line) continue;
          const data = chargeSnaps.get(l.ledgerId)?.data() ?? {};
          const cost = Number(data.cost) || Number(data.amount) || 0;
          const wanted = collectShare ? line.patientShare : line.approvedAmount;
          // The share is capped at the PATIENT'S open part (the insurer's part is not theirs to
          // pay), so a share already taken at the Finance counter is never recorded twice; the
          // insurer's payment is capped at whatever is still open on the row.
          const ceiling = collectShare ? patientPortion({ type: "procedure", cost, insurerCovered: data.insurerCovered, insurerPaidAt: data.insurerPaidAt }) : cost;
          const amount = cappedPayment(wanted, ceiling, sumPayments(siblingsByRow.get(l.ledgerId) ?? []));
          // The treatment row's name (the clinic's wording for the code), so the payment reads as
          // what was done rather than as a paper number.
          const service = String(data.serviceName || line.description || "").trim();
          if (amount > 0) plan.push({ index: l.index, ledgerId: l.ledgerId, amount, labFee: Math.max(0, Number(data.labFee) || 0), service });
        }
        // Nothing recorded, nothing stamped: a claim marked collected with no cash behind it is
        // worse than a refusal.
        if (plan.length === 0) return { kind: "nothing_left" };
      }

      // --- writes ----------------------------------------------------------------------------
      // The dentist change follows into the rows that still exist: doctor, rate and share, so the
      // patient's file and the payer report agree with the Insurance tab. A state change follows
      // into the clinical note. One update per note, whatever changed on it.
      const noteUpdates = new Map<string, Record<string, unknown>>();
      const noteUpdate = (noteId: string, fields: Record<string, unknown>) => noteUpdates.set(noteId, { ...(noteUpdates.get(noteId) ?? {}), ...fields });
      if (picks && rowsAction !== "remove" && !rebuild) {
        for (const k of Object.keys(picks)) {
          const i = Number(k);
          const link: LineLedger | undefined = claim.ledgerIds[i];
          const line = lines[i];
          if (!link || !line) continue;
          const dentist: LineDentist | null = dentists[i] ?? null;
          const rowPatch = dentistRowPatch(line, dentist);
          if (chargeSnaps.get(link.ledgerId)?.exists) {
            tx.update(adminClinicDoc(clinicId, "ledger", link.ledgerId), { doctorId: rowPatch.doctorId, doctorName: rowPatch.doctorName, doctorCommissionPercentage: rowPatch.doctorCommissionPercentage, doctorCommissionAmount: rowPatch.doctorCommissionAmount, clinicProfit: rowPatch.clinicProfit, updatedAt: FieldValue.serverTimestamp() });
          }
          if (noteSnaps.get(link.noteId)?.exists) noteUpdate(link.noteId, { doctorId: rowPatch.doctorId, doctor: rowPatch.doctor });
        }
      }
      if (statePicks && rowsAction !== "remove" && !rebuild) {
        for (const [k, state] of Object.entries(statePicks)) {
          const link: LineLedger | undefined = claim.ledgerIds[Number(k)];
          if (link && noteSnaps.get(link.noteId)?.exists) noteUpdate(link.noteId, { status: state, updatedAt: FieldValue.serverTimestamp() });
        }
      }
      for (const [noteId, fields] of noteUpdates) tx.update(adminClinicDoc(clinicId, "clinical_notes", noteId), fields);

      // An edited approval: its old rows leave the patient's file before the new ones are written.
      const removed: Charge[] = [];
      if (rebuild) {
        for (const l of links) {
          const snap = chargeSnaps.get(l.ledgerId);
          if (snap?.exists) tx.delete(adminClinicDoc(clinicId, "ledger", l.ledgerId));
          tx.delete(adminClinicDoc(clinicId, "clinical_notes", l.noteId));
          if (snap?.exists) removed.push({ id: l.ledgerId, row: snap.data() ?? {} });
        }
      }

      // The work is done: record it in the patient's file now, dated the treated day.
      let created: Charge[] = [];
      if (rowsAction === "write" || rebuild) {
        const payerName = findPayer(parsePayers(payersSnap?.data()), claim.payerId)?.name ?? claim.payerId;
        const written = writeTreatmentRows(tx, clinicId, {
          claimId,
          claim: {
            payerId: claim.payerId,
            approvalNumber: claim.approvalNumber,
            approvalDate: claim.approvalDate,
            treatedDate: treated ?? claim.treatedDate,
            patientId: patientSnap ? newPatientId : claim.patientId,
            patientName,
            lines,
            dentists,
            lineStatus,
          },
          payerName,
          wording: rowWording(wordingSnap?.get(claim.insurer), {}),
          actor,
        });
        update.ledgerIds = written.ledgerIds;
        created = written.charges;
      }

      // The work did not happen after all: its rows leave the patient's file (nothing is paid on
      // them, checked above). The dentist picks stay on the claim for when it is treated again.
      if (rowsAction === "remove") {
        for (const l of links) {
          const snap = chargeSnaps.get(l.ledgerId);
          tx.delete(adminClinicDoc(clinicId, "ledger", l.ledgerId));
          tx.delete(adminClinicDoc(clinicId, "clinical_notes", l.noteId));
          if (snap?.exists) removed.push({ id: l.ledgerId, row: snap.data() ?? {} });
        }
        update.ledgerIds = {};
      }

      let collected: Collected | null = null;
      let payments: Charge[] | null = null;
      if (plan.length > 0) {
        // One payment per treatment row, with a real receipt number each, settling that row: the
        // patient's share in cash, or the insurer's approved amount by "Insurance". Neither carries
        // commission: by the owner's rule the dentist's share was earned when the line was
        // assigned, on the approved amount, and lives on the row and the Insurance tab.
        const date = ymdInTimeZone(clinicTimeZone());
        const payer = findPayer(parsePayers(payersSnap?.data()), claim.payerId);
        const payerName = payer?.name ?? claim.payerId;
        const receiptSettings = normalizeReceiptSettings(receiptSettingsSnap?.exists ? receiptSettingsSnap.data() : null);
        let seq = Number(receiptCounterSnap?.exists ? receiptCounterSnap.data()?.last : 0) || 0;
        let lastReceipt = "";
        const made: Charge[] = [];
        let sum = 0;
        for (const p of plan) {
          const dentist = claim.dentists[p.index] ?? null;
          const row = buildPaymentRow({
            patientId: claim.patientId,
            patientName: claim.patientName,
            amount: p.amount,
            method: collectShare ? "Cash" : INSURER_METHOD,
            description: collectShare
              ? `Patient share - ${p.service || claim.approvalNumber}`
              : `${payerName} paid - ${p.service || `approval ${claim.approvalNumber}`}`,
            date,
            procedure: { id: p.ledgerId, doctorId: dentist?.staffId ?? null, doctorName: dentist?.name ?? null, payerId: claim.payerId, payerName, labFee: 0 },
            appliedLabFee: 0,
            staff: [],
            actor: { uid: authz.uid, name: authz.name },
            category: collectShare ? SHARE_CATEGORY : INSURER_CATEGORY,
          });
          seq += 1;
          lastReceipt = formatReceiptNumber(receiptSettings, seq, date);
          const ref = adminClinicCollection(clinicId, "ledger").doc();
          const full = { ...row, receiptNumber: lastReceipt, receiptSeq: seq, claimId, approvalNumber: claim.approvalNumber };
          tx.set(ref, { ...stripUndefined(full), createdAt: FieldValue.serverTimestamp() });
          const siblings = siblingsByRow.get(p.ledgerId) ?? [];
          applyProcedureSync(tx, { clinicId, procedureLedgerId: p.ledgerId, payments: [...siblings, { id: ref.id, date, paid: p.amount, amount: p.amount }], labFee: p.labFee, commissionPct: 0 });
          made.push({ id: ref.id, row: full });
          sum = round2(sum + p.amount);
        }
        // The insurer has settled the approval: every live row says so, including one the patient
        // had already paid off in full (nothing was left on it for the insurer's money).
        if (insurerPaid) {
          for (const l of liveLinks) tx.update(adminClinicDoc(clinicId, "ledger", l.ledgerId), { insurerPaidAt: date });
        }
        tx.set(adminClinicDoc(clinicId, "settings", RECEIPT_COUNTER_DOC), { last: seq, lastReceiptNumber: lastReceipt, updatedAt: new Date().toISOString() }, { merge: true });
        if (collectShare) update.shareCollected = { ledgerId: made[0].id, amount: sum, date };
        if (insurerPaid) update.insurerPaid = { date, amount: sum };
        payments = made;
      } else if (collectShare) {
        // A claim saved before treatment rows existed: the share still lands in the books, as
        // clinic income filed under its own category.
        const amount = claim.totals.patientShare;
        const date = ymdInTimeZone(clinicTimeZone());
        const payer = findPayer(parsePayers(payersSnap?.data()), claim.payerId);
        const row = buildManualEntryRow({
          type: "income",
          amount,
          description: `Patient share - ${payer?.name ?? claim.payerId} approval ${claim.approvalNumber} - ${claim.patientName}`,
          category: SHARE_CATEGORY,
          date,
          method: "Cash",
          actor: { uid: authz.uid, name: authz.name },
        });
        const ledgerRef = adminClinicCollection(clinicId, "ledger").doc();
        collected = { ledgerId: ledgerRef.id, amount, row };
        update.shareCollected = { ledgerId: ledgerRef.id, amount, date };
        tx.create(ledgerRef, { ...row, createdAt: FieldValue.serverTimestamp() });
      }

      if (patientRef && patientSnap) {
        const entry = insuranceEntryToWrite(claim.payerId, metlife, patientSnap.data() ?? {}, claim.insurer);
        if (entry) tx.update(patientRef, { [`insurance.${claim.payerId}`]: stripUndefined(entry) });
      }
      tx.update(claimRef, {
        ...stripUndefined(update),
        ...(status === "sent" ? { sentAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: authz.uid,
      });
      return { kind: "ok", created, removed, payments, what: collectShare ? "share" : "insurer", collected, rebuilt: rebuild };
    });

    if (result.kind === "no_claim") return fail(404, "That claim was not found.");
    if (result.kind === "unreadable") return fail(500, "That claim could not be read. Please contact support.");
    if (result.kind === "no_patient") return fail(404, "That patient was not found.");
    if (result.kind === "no_staff") return fail(404, `Staff not found: ${result.ids.join(", ")}.`);
    if (result.kind === "not_dentist") return fail(400, "That staff member is not a dentist.");
    if (result.kind === "bad_line") return fail(400, "lineStatus names a service line that is not on this approval.");
    if (result.kind === "rows_exist") {
      return fail(409, "Save the approval's edits first, then change its status or record a payment.");
    }
    if (result.kind === "rows_paid_edit") {
      return fail(409, "Payments are recorded against this approval's treatments. Delete those payments in the patient's Finance tab first, then edit the approval.");
    }
    if (result.kind === "not_treated") return fail(400, "Mark the approval treated before recording payments against it.");
    if (result.kind === "rows_paid") return fail(409, "This approval has payments recorded against its treatments; reverse them first.");
    if (result.kind === "already_collected") return fail(409, "The patient's share was already collected.", { shareCollected: result.share });
    if (result.kind === "nothing_to_collect") return fail(400, "This approval has no patient share to collect.");
    if (result.kind === "already_insurer_paid") return fail(409, "The insurer's payment was already recorded for this approval.");
    if (result.kind === "no_rows") return fail(400, "This approval has no treatment rows to settle (it was saved before treatments were recorded from approvals).");
    if (result.kind === "nothing_left") return fail(400, "Nothing left to settle on this approval.");
    if (result.kind === "checks") {
      return fail(400, "The edit does not add up. Fix the marked fields and save again.", { checks: result.checks });
    }

    if (result.created.length) await auditCharges(clinicId, result.created, actor, result.rebuilt ? "insurance/claims:edited" : "insurance/claims:treated");
    if (result.removed.length) {
      await Promise.all(
        result.removed.map((c) =>
          recordMoneyChange({
            entry: { clinicId, action: "delete", collection: "ledger", documentId: c.id, before: c.row, actor, via: result.rebuilt ? "insurance/claims:edited" : "insurance/claims:not-treated" },
            action: "Procedure Deleted",
            details: `${String(c.row.description)} - ${result.rebuilt ? "replaced by the edited approval" : "the approval is no longer marked treated"}`,
          }).catch((err) => reportServerError("Insurance treatment removal audit failed:", err)),
        ),
      );
    }
    if (result.payments) {
      const what = result.what;
      await Promise.all(
        result.payments.map((p) =>
          recordMoneyChange({
            entry: { clinicId, action: "create", collection: "ledger", documentId: p.id, after: p.row, actor, via: what === "share" ? "insurance/claims:collect-share" : "insurance/claims:insurer-paid" },
            action: "Payment Received",
            details: `${p.row.paid} EGP ${what === "share" ? "patient share" : "from the insurer"} - ${String(p.row.description)}`,
          }).catch((err) => reportServerError("Insurance payment audit failed:", err)),
        ),
      );
      for (const p of result.payments) void afterLedgerCreate(clinicId, p.row, actor);
      return NextResponse.json({ ok: true, payments: result.payments.map((p) => p.id) });
    }
    if (result.collected) {
      // The same trail a manual income row leaves: the money audit, the activity log, the owner's alerts.
      const c = result.collected;
      await recordMoneyChange({
        entry: { clinicId, action: "create", collection: "ledger", documentId: c.ledgerId, after: c.row, actor, via: "insurance/claims:collect-share" },
        action: "Finance Entry Created",
        details: `INCOME ${c.amount} EGP - ${String(c.row.description)}`,
      }).catch((err) => reportServerError("Insurance share audit failed:", err));
      void afterLedgerCreate(clinicId, c.row, actor);
      return NextResponse.json({ ok: true, shareCollected: { ledgerId: c.ledgerId, amount: c.amount } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportServerError("Insurance claim edit failed:", error);
    return fail(500, "Saving the change failed. Please try again.");
  }
}
