import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { adminBucket, adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, parsePayers, PRIVATE_PAYER_ID, type CommissionRates } from "@/lib/payers";
import { isFullAccessRole } from "@/lib/permissions";
import { buildManualEntryRow } from "@/lib/ledgerWrite";
import { recordMoneyChange } from "@/lib/server/ledgerAudit";
import { afterLedgerCreate } from "@/lib/alerts/moneyAlerts";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { writeInsurance } from "@/lib/patientInsurance";
import { stripUndefined } from "@/lib/server/recycleBinStore";
import { nameSimilarity } from "@/lib/insurance/matchPatient";
import { checkMetlife, hasHardFailure, normalizeMetlife, type Check } from "@/lib/insurance/metlife";
import {
  claimDocId,
  claimExtraction,
  claimFromExtraction,
  claimMetlifeFrom,
  claimTotals,
  CLAIMS_COLLECTION,
  DOCS_COLLECTION,
  insuranceEntryToWrite,
  isClaimStatus,
  isIsoDate,
  normalizeConfirmed,
  parseClaim,
  treatedDateAfter,
  WORDING_DOC,
  type ClaimStatus,
  type InsuranceClaim,
  applyDentistPicks,
  type ShareCollected,
} from "@/lib/insurance/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION = "patients.edit";
const MAX_LINES = 100;
const MAX_NAME = 200;
const MAX_WORDING = 200;
const PATCH_KEYS = new Set(["status", "treatedDate", "patientId", "lines", "metlife", "dentists", "collectShare"]);
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
    const paperEntry = { certificateNumber: h.certificateNumber, dependentCode: h.dependentCode, policyNumber: h.policyNumber, memberNumber: "" };

    type Outcome =
      | { kind: "duplicate"; savedAt: string | null }
      | { kind: "doc_taken"; claimId: string }
      | { kind: "no_patient" }
      | { kind: "saved" };
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
        const linked = docsSnap.get("claimId");
        if (typeof linked === "string" && linked && linked !== claimId) return { kind: "doc_taken", claimId: linked };

        const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: authz.uid };
        let patientName = newName;

        if (patientSnap) {
          const data = patientSnap.data() ?? {};
          patientName = typeof data.name === "string" ? data.name : "";
          // Only when missing or different; a dotted path, so other payers' entries are untouched.
          const entry = insuranceEntryToWrite(payerId, paperEntry, data);
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
    if (outcome.kind === "doc_taken") {
      return fail(409, "This document is already attached to another claim.", { claimId: outcome.claimId });
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
 * Only those five keys; anything else is a 400, so a typo never silently does nothing.
 *
 * - `lines` / `metlife`: laid over the stored claim, read through the reader's own normaliser, and the
 *   hard checks run again with the same context as a save (400 { ok: false, error, checks } on a hard
 *   failure; nothing written). Totals are recomputed from the lines. To claim less than the paper
 *   approved, the printed totals in `metlife` are edited along with the lines.
 * - `status`: `approved` clears the treated date; `treated` without a date keeps the stored one or takes
 *   the approval date; `sent` stamps `sentAt`.
 * - `patientId`: re-snapshots the patient's name (404 when the patient does not exist) and writes
 *   `insurance.{payerId}` on that patient when missing or different, as a save does. A `metlife` edit
 *   is never pushed to the patient: the patient's own editor owns that.
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
    // The patient's share taken as cash. The ledger row and the claim's stamp are written in ONE
    // transaction here — two separate calls left a stray cash row whenever the second one failed.
    const collectShare = patch.collectShare === true;
    if ("collectShare" in patch && !collectShare) return fail(400, "collectShare must be true.");

    // --- who --------------------------------------------------------------------------------
    const authz = await requireStaffPermission(req, clinicId, PERMISSION);
    if (!authz.ok) return authz.response;
    // Cash into the ledger is the finance permission's business, exactly as a manual income row is.
    if (collectShare && !(isFullAccessRole(authz.role) || authz.permissions.includes("finance.add"))) {
      return fail(403, "Recording the patient's share needs the finance permission.");
    }

    // --- add-on -----------------------------------------------------------------------------
    if (!(await clinicHasFeature(clinicId, "insurance"))) {
      return fail(403, "Insurance is not part of this clinic's subscription.", { reason: "feature_locked" });
    }

    const claimRef = adminClinicDoc(clinicId, CLAIMS_COLLECTION, claimId);
    type PatchOutcome =
      | { kind: "ok" }
      | { kind: "no_claim" }
      | { kind: "unreadable" }
      | { kind: "no_patient" }
      | { kind: "no_staff"; ids: string[] }
      | { kind: "already_collected"; share: ShareCollected }
      | { kind: "nothing_to_collect" }
      | { kind: "ok_collected"; ledgerId: string; amount: number; row: Record<string, unknown> }
      | { kind: "checks"; checks: Check[] };
    const result = await adminDb().runTransaction(async (tx): Promise<PatchOutcome> => {
      // Reads first: the claim, the new patient, the payer's provider code.
      const claimSnap = await tx.get(claimRef);
      if (!claimSnap.exists) return { kind: "no_claim" };
      const claim = parseClaim(claimId, claimSnap.data());
      if (!claim) return { kind: "unreadable" };
      const patientRef = newPatientId ? adminClinicDoc(clinicId, "patients", newPatientId) : null;
      const patientSnap = patientRef ? await tx.get(patientRef) : null;
      if (patientSnap && !patientSnap.exists) return { kind: "no_patient" };
      const reshape = rawLines !== undefined || rawMetlife !== undefined;
      const payersSnap = reshape || collectShare ? await tx.get(adminClinicDoc(clinicId, "settings", "payers")) : null;
      // The staff records behind the picks, read inside the transaction so the stamped rate is the
      // one on file at this moment.
      const staffById = new Map<string, { id: string; name: string } & CommissionRates>();
      if (picks) {
        const ids = [...new Set(Object.values(picks).filter((v): v is string => typeof v === "string"))];
        const snaps = await Promise.all(ids.map((id) => tx.get(adminClinicDoc(clinicId, "staff", id))));
        snaps.forEach((snap, i) => {
          if (!snap.exists) return;
          const d = snap.data() ?? {};
          staffById.set(ids[i], {
            id: ids[i],
            name: typeof d.name === "string" ? d.name : "",
            // Raw: commissionRateFor coerces, and a rate stored as "25" must not stamp as 0%.
            commissionPercentage: d.commissionPercentage as number | null | undefined,
            commissionByPayer: isRecord(d.commissionByPayer) ? d.commissionByPayer : null,
          });
        });
      }
      if (collectShare && claim.shareCollected) return { kind: "already_collected", share: claim.shareCollected };
      if (collectShare && claim.totals.patientShare <= 0) return { kind: "nothing_to_collect" };

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
      if (reshape) {
        const merged = claimExtraction(claim, { lines: rawLines, metlife: rawMetlife });
        const payer = findPayer(parsePayers(payersSnap?.data()), claim.payerId);
        const checks = checkMetlife(merged, {
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
          update.lines = merged.lines;
          update.totals = claimTotals(merged.lines);
        }
      }

      if (picks) {
        const applied = applyDentistPicks({ lines: rawLines !== undefined ? claimExtraction(claim, { lines: rawLines }).lines : claim.lines, dentists: claim.dentists, payerId: claim.payerId }, picks, staffById);
        if (applied.unknownStaff.length) return { kind: "no_staff", ids: applied.unknownStaff };
        update.dentists = applied.dentists;
      }
      // The patient's share as one income row: clinic money, nobody's balance, filed under a
      // readable category so the finance screens and the owner's briefing show it as what it is.
      let collected: { ledgerId: string; amount: number; row: Record<string, unknown> } | null = null;
      if (collectShare) {
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

      // Writes.
      if (patientRef && patientSnap) {
        const entry = insuranceEntryToWrite(claim.payerId, metlife, patientSnap.data() ?? {});
        if (entry) tx.update(patientRef, { [`insurance.${claim.payerId}`]: stripUndefined(entry) });
      }
      tx.update(claimRef, {
        ...stripUndefined(update),
        ...(status === "sent" ? { sentAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: authz.uid,
      });
      return collected ? { kind: "ok_collected", ...collected } : { kind: "ok" };
    });

    if (result.kind === "no_claim") return fail(404, "That claim was not found.");
    if (result.kind === "unreadable") return fail(500, "That claim could not be read. Please contact support.");
    if (result.kind === "no_patient") return fail(404, "That patient was not found.");
    if (result.kind === "no_staff") return fail(404, `Staff not found: ${result.ids.join(", ")}.`);
    if (result.kind === "already_collected") return fail(409, "The patient's share was already collected.", { shareCollected: result.share });
    if (result.kind === "nothing_to_collect") return fail(400, "This approval has no patient share to collect.");
    if (result.kind === "ok_collected") {
      // The same trail a manual income row leaves: the money audit, the activity log, the owner's alerts.
      const actor = { uid: authz.uid, name: authz.name, role: authz.role };
      await recordMoneyChange({
        entry: { clinicId, action: "create", collection: "ledger", documentId: result.ledgerId, after: result.row, actor, via: "insurance/claims:collect-share" },
        action: "Finance Entry Created",
        details: `INCOME ${result.amount} EGP - ${String(result.row.description)}`,
      }).catch((err) => reportServerError("Insurance share audit failed:", err));
      void afterLedgerCreate(clinicId, result.row, actor);
      return NextResponse.json({ ok: true, shareCollected: { ledgerId: result.ledgerId, amount: result.amount } });
    }
    if (result.kind === "checks") {
      return fail(400, "The edit does not add up. Fix the marked fields and save again.", { checks: result.checks });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportServerError("Insurance claim edit failed:", error);
    return fail(500, "Saving the change failed. Please try again.");
  }
}
