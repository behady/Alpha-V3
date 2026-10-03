import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { adminBucket, adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, parsePayers, PRIVATE_PAYER_ID } from "@/lib/payers";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { readInsurance, writeInsurance, type PatientInsuranceEntry } from "@/lib/patientInsurance";
import { stripUndefined } from "@/lib/server/recycleBinStore";
import { nameSimilarity } from "@/lib/insurance/matchPatient";
import { checkMetlife, hasHardFailure, normalizeMetlife, type MetlifeLine } from "@/lib/insurance/metlife";
import {
  claimDocId,
  claimFromExtraction,
  claimMetlifeFrom,
  claimTotals,
  CLAIMS_COLLECTION,
  DOCS_COLLECTION,
  isClaimStatus,
  isIsoDate,
  normalizeConfirmed,
  WORDING_DOC,
  type InsuranceClaim,
} from "@/lib/insurance/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION = "patients.edit";
const MAX_LINES = 100;
const MAX_NAME = 200;
const MAX_WORDING = 200;
const PATCH_KEYS = new Set(["status", "treatedDate", "patientId", "lines", "metlife"]);

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

function sameEntry(a: PatientInsuranceEntry | undefined, b: PatientInsuranceEntry): boolean {
  if (!a) return false;
  return (["memberNumber", "certificateNumber", "dependentCode", "policyNumber"] as const).every((k) => (a[k] ?? "") === (b[k] ?? ""));
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
 *        status: "approved" | "treated", treatedDate?, wording?: { [code]: arabic }, docPath? }
 *   → 201 { ok: true, claimId, patientId }
 *   → 409 { ok: false, duplicate: { claimId, savedAt } } when this approval is already a claim
 *   → 400 { ok: false, error, checks } when the extraction fails a hard check
 *
 * Gates, as in /api/insurance/read: body → staff with `patients.edit` → the `insurance` add-on → an
 * active payer with a document format → the hard checks, run again here because the browser's Save
 * button is not the only way to reach this route.
 *
 * One transaction does every write, so two tabs saving the same paper make exactly one claim: it reads
 * the claim (exists → 409), the document row, the patient (or the patient counter when creating one)
 * and the wording table, then creates the claim, links the document row to it (set+merge: a read that
 * failed leaves no row), writes `insurance.{payerId}` on the patient when it is missing or different,
 * and adds any Arabic wording the clinic did not have yet. Existing wording is never overwritten here.
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
    const status = body.status;
    if (status !== "approved" && status !== "treated") return fail(400, 'status must be "approved" or "treated".');
    if (body.treatedDate !== undefined && body.treatedDate !== null && !isIsoDate(body.treatedDate)) {
      return fail(400, "treatedDate must be a yyyy-mm-dd date.");
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
    if (payer.id === PRIVATE_PAYER_ID || payer.format !== "metlife") {
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
    const extraction = normalizeConfirmed(body.extraction);
    const h = extraction.header;
    if (extraction.lines.length > MAX_LINES) return fail(400, "Too many service lines.");
    const checks = checkMetlife(extraction, {
      today: ymdInTimeZone(clinicTimeZone()),
      providerCode: payer.providerCode,
      ...(checkName ? { matchedPatientName: checkName, nameScore: nameSimilarity(h.paperPatientName, checkName) } : {}),
    });
    if (hasHardFailure(checks)) {
      return fail(400, "The approval does not add up yet. Fix the marked fields and save again.", { checks });
    }
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
    const paperEntry = { certificateNumber: h.certificateNumber, dependentCode: h.dependentCode, policyNumber: h.policyNumber, memberNumber: "" };

    type Outcome = { kind: "duplicate"; savedAt: string | null } | { kind: "no_patient" } | { kind: "saved" };
    let outcome: Outcome;
    try {
      outcome = await adminDb().runTransaction(async (tx): Promise<Outcome> => {
        // Reads first: a transaction may not read after it writes.
        const claimSnap = await tx.get(claimRef);
        if (claimSnap.exists) return { kind: "duplicate", savedAt: savedAtOf(claimSnap.data()) };
        const docsSnap = await tx.get(docsRef);
        const wordingSnap = await tx.get(wordingRef);
        const patientSnap = existingId ? await tx.get(patientRef) : null;
        const counterSnap = existingId ? null : await tx.get(counterRef);
        if (patientSnap && !patientSnap.exists) return { kind: "no_patient" };

        const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: authz.uid };
        let patientName = newName;

        if (patientSnap) {
          const data = patientSnap.data() ?? {};
          patientName = typeof data.name === "string" ? data.name : "";
          // Keep what the clinic typed that the paper does not print (a policy number left blank on it).
          const stored = readInsurance(data)[payerId];
          const entry = writeInsurance({
            [payerId]: { ...paperEntry, policyNumber: paperEntry.policyNumber || stored?.policyNumber || "" },
          })[payerId];
          if (entry && !sameEntry(stored, entry)) {
            tx.update(patientRef, { [`insurance.${payerId}`]: stripUndefined(entry) });
          }
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
        const claim = claimFromExtraction({ payerId, extraction, patientId: patientRef.id, patientName, status, treatedDate, doc: docFacts });
        tx.create(claimRef, {
          ...stripUndefined(claim),
          sentAt: null,
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
        return { kind: "saved" };
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
    if (outcome.kind === "no_patient") return fail(404, "That patient was not found.");
    return NextResponse.json({ ok: true, claimId, patientId: patientRef.id }, { status: 201 });
  } catch (error) {
    reportServerError("Insurance claim save failed:", error);
    return fail(500, "Saving the claim failed. Please try again.");
  }
}

/**
 * Edits a saved claim.
 *
 * PATCH { clinicId, claimId, patch: { status?, treatedDate?, patientId?, lines?, metlife? } } → 200 { ok: true }
 *
 * Only those five keys; anything else is a 400, so a typo never silently does nothing. `lines` and
 * `metlife` go through the reader's own normaliser and the totals are recomputed from the lines.
 * `status: "sent"` stamps `sentAt`; a new `patientId` re-snapshots the patient's name (404 when the
 * patient does not exist). Every edit stamps `updatedAt`/`updatedBy`. The hard checks are not re-run
 * here: a treated claim may legitimately claim less than the paper approved.
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

    const changes: Record<string, unknown> = {};
    if ("status" in patch) {
      if (!isClaimStatus(patch.status)) return fail(400, 'status must be "approved", "treated", "sent" or "cancelled".');
      changes.status = patch.status;
    }
    if ("treatedDate" in patch) {
      if (patch.treatedDate !== null && !isIsoDate(patch.treatedDate)) return fail(400, "treatedDate must be a yyyy-mm-dd date or null.");
      changes.treatedDate = patch.treatedDate;
    }
    let newPatientId = "";
    if ("patientId" in patch) {
      newPatientId = segment(patch.patientId);
      if (!newPatientId) return fail(400, "patientId must name a patient.");
    }
    let lines: MetlifeLine[] | null = null;
    if ("lines" in patch) {
      if (!Array.isArray(patch.lines) || patch.lines.length === 0 || patch.lines.length > MAX_LINES) {
        return fail(400, "lines must be a list of 1 to 100 service lines.");
      }
      lines = normalizeMetlife({ lines: patch.lines }).lines;
      if (lines.length === 0) return fail(400, "lines must hold at least one service line.");
    }
    if ("metlife" in patch && !isRecord(patch.metlife)) return fail(400, "metlife must be an object.");

    // --- who --------------------------------------------------------------------------------
    const authz = await requireStaffPermission(req, clinicId, PERMISSION);
    if (!authz.ok) return authz.response;

    // --- add-on -----------------------------------------------------------------------------
    if (!(await clinicHasFeature(clinicId, "insurance"))) {
      return fail(403, "Insurance is not part of this clinic's subscription.", { reason: "feature_locked" });
    }

    const claimRef = adminClinicDoc(clinicId, CLAIMS_COLLECTION, claimId);
    const result = await adminDb().runTransaction(async (tx): Promise<"ok" | "no_claim" | "no_patient"> => {
      const claimSnap = await tx.get(claimRef);
      if (!claimSnap.exists) return "no_claim";
      const stored = claimSnap.data() ?? {};
      const update: Record<string, unknown> = { ...changes };

      if (newPatientId) {
        const patientSnap = await tx.get(adminClinicDoc(clinicId, "patients", newPatientId));
        if (!patientSnap.exists) return "no_patient";
        update.patientId = newPatientId;
        update.patientName = typeof patientSnap.get("name") === "string" ? patientSnap.get("name") : "";
      }
      if (isRecord(patch.metlife)) {
        // Over what is stored, in the split shape (employer/physician present), through the reader's normaliser.
        const header = { employer: "", physician: "", ...(isRecord(stored.metlife) ? stored.metlife : {}), ...patch.metlife };
        update.metlife = claimMetlifeFrom(normalizeConfirmed({ header, lines: [] }).header);
      }
      if (lines) {
        update.lines = lines;
        update.totals = claimTotals(lines);
      }

      tx.update(claimRef, {
        ...stripUndefined(update),
        ...(changes.status === "sent" ? { sentAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: authz.uid,
      });
      return "ok";
    });

    if (result === "no_claim") return fail(404, "That claim was not found.");
    if (result === "no_patient") return fail(404, "That patient was not found.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportServerError("Insurance claim edit failed:", error);
    return fail(500, "Saving the change failed. Please try again.");
  }
}
