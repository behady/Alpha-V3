import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI, type ResponseSchema } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminBucket } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { createUsageMeter, logAiCreditUsage } from "@/lib/aiCreditLog";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { findPayer, parsePayers, PRIVATE_PAYER_ID } from "@/lib/payers";
import { matchPatient, nameSimilarity, type PatientLite } from "@/lib/insurance/matchPatient";
import {
  buildMetlifePrompt,
  checkMetlife,
  METLIFE_RESPONSE_SCHEMA,
  normalizeMetlife,
  type MetlifeExtraction,
} from "@/lib/insurance/metlife";
import { claimDocId, CLAIMS_COLLECTION } from "@/lib/insurance/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MODEL = "gemini-flash-latest";
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 72_000;
const MAX_PATIENTS = 5000;
const FEATURE = "insurance_read";
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** Thrown inside the model step so every way the model can fail ends in the same 502. */
class ModelFailure extends Error {}

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/**
 * One path segment as it arrived in the body: present, short, and unable to step out of the
 * folder it is meant to name.
 */
function segment(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 200) return "";
  if (s === "." || s === ".." || /[/\\]/.test(s) || /[\u0000-\u001f]/.test(s)) return "";
  return s;
}

/**
 * Reads a scanned insurer approval with Gemini and says what it found. Nothing is saved as a claim:
 * the desk confirms the reading on a card and saves it through /api/insurance/claims.
 *
 * POST { clinicId, payerId, docId, docPath }
 *
 * The browser has already uploaded the file to Storage at `insuranceDocPath(clinicId, docId, name)`.
 * The server downloads it itself by that path — never by a URL the client supplies — after checking
 * the path sits in THIS clinic's `insurance_docs/{docId}/` folder, so a caller cannot have another
 * clinic's file read by naming it.
 *
 * Gates, in order: body → staff with `patients.edit` (full-access roles pass) → the `insurance`
 * add-on → the payer exists, is active and has a document format → the path → the file (≤ 8 MB, a
 * PDF or an image, by the type Storage recorded) → the model.
 *
 * Writes only `insurance_docs/{docId}` (which file, which payer, who) and a usage-log row at 0
 * credits so the token cost is visible to us. A model failure is a 502 with `retryable: true`; the
 * file stays in Storage so the desk can try again or type the approval in by hand.
 *
 * Not enforced: the design's 4-page cap. Counting PDF pages needs a parser this project does not
 * carry; the PDF is sent whole and the 8 MB cap bounds it.
 */
export async function POST(req: Request) {
  const meter = createUsageMeter(MODEL);
  let usageLogged = false;
  let usageContext: { clinicId: string; uid: string; name: string } | null = null;
  const logUsage = async (detail: string, patient?: { id: string; name: string }) => {
    if (usageLogged || !usageContext || meter.apiCalls === 0) return;
    usageLogged = true;
    await logAiCreditUsage({
      clinicId: usageContext.clinicId,
      feature: FEATURE,
      credits: 0,
      userId: usageContext.uid,
      userName: usageContext.name,
      patientId: patient?.id,
      patientName: patient?.name,
      detail,
      usage: meter.snapshot(),
    });
  };

  try {
    // --- body -------------------------------------------------------------------------------
    const body = await req.json().catch(() => ({}));
    const clinicId = segment(body?.clinicId);
    const payerId = segment(body?.payerId);
    const docId = segment(body?.docId);
    const docPath = typeof body?.docPath === "string" ? body.docPath.trim() : "";
    if (!clinicId || !payerId || !docId || !docPath) {
      return fail(400, "clinicId, payerId, docId and docPath are required.");
    }

    // --- who --------------------------------------------------------------------------------
    const authz = await requireStaffPermission(req, clinicId, "patients.edit");
    if (!authz.ok) return authz.response;
    usageContext = { clinicId, uid: authz.uid, name: authz.name };

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

    // --- the path: this clinic's folder for this document, one file name below it ---------
    const prefix = `clinics/${clinicId}/insurance_docs/${docId}/`;
    const fileName = docPath.startsWith(prefix) ? docPath.slice(prefix.length) : "";
    if (!segment(fileName) || fileName !== fileName.trim()) {
      return fail(400, "That document is not in this clinic's insurance folder.");
    }

    // --- the file ---------------------------------------------------------------------------
    const file = adminBucket().file(docPath);
    let contentType = "";
    let declaredBytes = 0;
    try {
      const [meta] = await file.getMetadata();
      contentType = String(meta.contentType || "").split(";")[0].trim().toLowerCase();
      declaredBytes = Number(meta.size) || 0;
    } catch (err) {
      if ((err as { code?: unknown })?.code === 404) return fail(404, "The uploaded document was not found. Upload it again.");
      throw err;
    }
    if (!ACCEPTED_TYPES.has(contentType)) {
      return fail(400, "Only a PDF or a JPG, PNG, WebP or HEIC picture can be read.");
    }
    if (declaredBytes > MAX_BYTES) return fail(400, "The document is larger than 8 MB.");
    let data: Buffer;
    try {
      [data] = await file.download();
    } catch (err) {
      if ((err as { code?: unknown })?.code === 404) return fail(404, "The uploaded document was not found. Upload it again.");
      throw err;
    }
    if (!data.length) return fail(400, "The uploaded document is empty.");
    if (data.length > MAX_BYTES) return fail(400, "The document is larger than 8 MB.");

    // --- the model --------------------------------------------------------------------------
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      reportServerError("Insurance read: GEMINI_API_KEY is missing.", new Error("GEMINI_API_KEY is missing."));
      return fail(500, "Document reading is not configured on this server.");
    }
    let extraction: MetlifeExtraction;
    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: MODEL,
        generationConfig: {
          responseMimeType: "application/json",
          // Plain data in lib/insurance/metlife.ts (so tests can import it without the SDK); the
          // SDK's ResponseSchema type wants its own enum for `type`, but the wire format is identical.
          responseSchema: METLIFE_RESPONSE_SCHEMA as unknown as ResponseSchema,
          temperature: 0.2,
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        model.generateContent([{ text: buildMetlifePrompt() }, { inlineData: { data: data.toString("base64"), mimeType: contentType } }]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ModelFailure("The reading took too long.")), TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      meter.add(result.response);
      let parsed: unknown;
      try {
        // text() throws when the answer was blocked or empty; both are model failures.
        parsed = JSON.parse(result.response.text().replace(/```json/g, "").replace(/```/g, "").trim());
      } catch {
        throw new ModelFailure("The model's answer was not readable.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ModelFailure("The model's answer was not readable.");
      }
      extraction = normalizeMetlife(parsed);
    } catch (err) {
      reportServerError("Insurance read: model step failed:", err);
      await logUsage("read failed");
      return fail(502, "The document could not be read this time. Try again, or type the approval in by hand.", {
        retryable: true,
      });
    }
    const h = extraction.header;

    // --- patient match ----------------------------------------------------------------------
    const patientsSnap = await adminClinicCollection(clinicId, "patients").select("name", "insurance").limit(MAX_PATIENTS).get();
    const patients: PatientLite[] = patientsSnap.docs.map((d) => {
      const p = d.data() as { name?: unknown; insurance?: unknown };
      return { id: d.id, name: typeof p.name === "string" ? p.name : "", insurance: p.insurance };
    });
    const match = matchPatient(
      { payerId, certificateNumber: h.certificateNumber, dependentCode: h.dependentCode, paperPatientName: h.paperPatientName },
      patients,
    );
    const matched = match.kind === "exact" ? patients.find((p) => p.id === match.patientId) : undefined;

    // --- checks -----------------------------------------------------------------------------
    const checks = checkMetlife(extraction, {
      today: ymdInTimeZone(clinicTimeZone()),
      providerCode: payer.providerCode,
      ...(matched ? { matchedPatientName: matched.name, nameScore: nameSimilarity(h.paperPatientName, matched.name) } : {}),
    });

    // --- already saved? ---------------------------------------------------------------------
    let duplicate: { claimId: string; savedAt: string | null } | null = null;
    if (h.approvalNumber.replace(/[^a-z0-9]/gi, "")) {
      const claimId = claimDocId(payer.format, h.approvalNumber);
      const claimSnap = await adminClinicDoc(clinicId, CLAIMS_COLLECTION, claimId).get();
      if (claimSnap.exists) {
        const createdAt = (claimSnap.get("createdAt") as { toDate?: () => Date } | undefined)?.toDate?.();
        duplicate = { claimId, savedAt: createdAt ? createdAt.toISOString() : null };
      }
    }

    // --- the clinic's own Arabic wording for each code --------------------------------------
    const wordingSnap = await adminClinicDoc(clinicId, "settings", "insurance_wording").get();
    const stored = wordingSnap.get("metlife") as Record<string, unknown> | undefined;
    const wording: Record<string, string | null> = Object.fromEntries(
      [...new Set(extraction.lines.map((l) => l.code).filter(Boolean))].map((code) => {
        const entry = stored && typeof stored === "object" && Object.hasOwn(stored, code) ? stored[code] : undefined;
        const ar = entry && typeof entry === "object" ? (entry as { ar?: unknown }).ar : undefined;
        return [code, typeof ar === "string" && ar.trim() ? ar.trim() : null];
      }),
    );

    // --- bookkeeping: which file, which payer, who -----------------------------------------
    // create() first so a re-read of the same document never clears the claim it was saved as.
    const docRef = adminClinicDoc(clinicId, "insurance_docs", docId);
    const fileFacts = { path: docPath, contentType, bytes: data.length, pages: null, payerId };
    try {
      await docRef.create({ ...fileFacts, uploadedAt: FieldValue.serverTimestamp(), uploadedBy: authz.uid, claimId: null });
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      if (code !== 6 && code !== "already-exists" && code !== "ALREADY_EXISTS") throw err;
      // A row already linked to its claim keeps the facts it was saved with: the claim points at them.
      const existing = await docRef.get();
      if (existing.get("claimId") == null) await docRef.set(fileFacts, { merge: true });
    }

    await logUsage(
      [payer.name, h.approvalNumber || "no approval number", `${extraction.lines.length} line${extraction.lines.length === 1 ? "" : "s"}`].join(" · "),
      matched ? { id: matched.id, name: matched.name } : undefined,
    );

    return NextResponse.json({ ok: true, docId, format: "metlife", extraction, checks, match, duplicate, wording });
  } catch (error) {
    reportServerError("Insurance read failed:", error);
    // The tokens were spent even if a later step fell over.
    await logUsage("read failed after the model answered").catch(() => {});
    return fail(500, "Reading the approval failed. Please try again.");
  }
}
