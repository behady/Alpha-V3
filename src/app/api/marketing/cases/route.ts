import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminBucket } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser, requireAdminUser } from "@/lib/apiStaffAuth";
import { hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Two photos ride in the request body as base64 — give the upload room to breathe. */
export const maxDuration = 120;

/**
 * Consent and the case library — the legal spine of every before/after the clinic will
 * ever publish, and the raw material of the video-first content engine.
 *
 * The rules, decided in planning and enforced here rather than in good intentions:
 *  - No case exists without a signed consent recorded FIRST. The API refuses, not the UI.
 *  - Face usage is opt-in per patient (smile-crop default); the case snapshots the consent's
 *    face permission at creation so a later revoke doesn't silently rewrite history.
 *  - Photos are uploaded server-side to Storage (client rules were never provisioned in this
 *    project, and this keeps write access exactly as narrow as every other server path).
 */

type ConsentBody = {
  action?: "consent" | "revoke";
  clinicId?: string;
  patientId?: string;
  faceAllowed?: boolean;
  signatureDataUrl?: string;
};

type CaseBody = {
  action?: "create_case" | "delete_case";
  clinicId?: string;
  patientId?: string;
  caseId?: string;
  procedure?: string;
  description?: string;
  beforeImage?: string;
  afterImage?: string;
};

const bad = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

/** Accepts a small data-URL image, returns its buffer + type — or null when it isn't one. */
function parseDataUrl(raw: unknown, maxBytes: number): { buffer: Buffer; contentType: string } | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length === 0 || buffer.length > maxBytes) return null;
  return { buffer, contentType: m[1] };
}

/** Long-lived read URL (v2 signing accepts far-future expiry, unlike v4's 7-day cap). */
async function uploadImage(path: string, buffer: Buffer, contentType: string): Promise<string> {
  const file = adminBucket().file(path);
  await file.save(buffer, { contentType, metadata: { cacheControl: "public, max-age=31536000" } });
  const [url] = await file.getSignedUrl({ action: "read", expires: "2500-01-01" });
  return url;
}

/**
 * Streams a case photo to the browser. Exists because the composer must draw photos onto an
 * exportable canvas, and the bucket's signed URLs don't carry CORS headers (bucket config is
 * locked behind the project's billing state). Same-origin + staff-authed beats loosening the
 * bucket anyway. The path check pins reads inside the clinic's own marketing-cases folder.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const clinicId = url.searchParams.get("c")?.trim() || "";
  const path = url.searchParams.get("path")?.trim() || "";
  if (!clinicId || !path) return bad("c and path are required", 400);

  const authz = await requireStaffUser(request, clinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;

  if (!path.startsWith(`clinics/${clinicId}/marketing-cases/`) || path.includes("..")) {
    return bad("Invalid path", 400);
  }

  try {
    const [buffer] = await adminBucket().file(path).download();
    const type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    reportServerError("[MarketingCases] photo read failed", e);
    return bad("Photo not found", 404);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ConsentBody & CaseBody;
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) return bad("clinicId is required", 400);

  const action = body.action;
  try {
    // Authenticate before touching any clinic data — an anonymous caller learns nothing,
    // not even whether a clinic id exists.
    const staffAuthz = await requireStaffUser(request, clinicId);
    if (!staffAuthz.ok) return staffAuthz.response;

    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) return bad("Clinic not found", 404);
    const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
    if (!hasFeature(clinic, "marketingText")) {
      return bad("The case library is part of the Marketing add-on.", 403);
    }

    // ---- record / revoke consent ----
    if (action === "consent" || action === "revoke") {
      const authz = staffAuthz;

      const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
      if (!patientId) return bad("patientId is required", 400);
      const patientSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
      if (!patientSnap.exists) return bad("Patient not found", 404);

      const ref = adminClinicDoc(clinicId, "marketing_consents", patientId);

      if (action === "revoke") {
        await ref.set(
          { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: authz.uid },
          { merge: true }
        );
        return NextResponse.json({ ok: true, status: "revoked" });
      }

      // The signature is optional (clinic's choice): a verbal consent is still recorded with
      // who took it and when. When a signature IS sent, it must be a valid small image.
      const hasSignature = typeof body.signatureDataUrl === "string" && body.signatureDataUrl.length > 0;
      if (hasSignature && !parseDataUrl(body.signatureDataUrl, 300 * 1024)) {
        return bad("The signature image is not valid.", 400);
      }

      await ref.set({
        status: "granted",
        method: hasSignature ? "signed" : "verbal",
        patientId,
        patientName: String(patientSnap.data()?.name || ""),
        faceAllowed: body.faceAllowed === true,
        signatureDataUrl: hasSignature ? body.signatureDataUrl : "",
        signedAt: FieldValue.serverTimestamp(),
        recordedBy: authz.uid,
      });
      return NextResponse.json({ ok: true, status: "granted" });
    }

    // ---- create a case ----
    if (action === "create_case") {
      const authz = staffAuthz;

      const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
      if (!patientId) return bad("patientId is required", 400);

      const consentSnap = await adminClinicDoc(clinicId, "marketing_consents", patientId).get();
      const consent = consentSnap.exists ? consentSnap.data() || {} : null;
      if (!consent || consent.status !== "granted") {
        return bad("This patient has not signed the marketing photo consent.", 403);
      }

      const before = parseDataUrl(body.beforeImage, 3 * 1024 * 1024);
      const after = parseDataUrl(body.afterImage, 3 * 1024 * 1024);
      if (!before || !after) return bad("Both photos are required (JPEG/PNG, reasonable size).", 400);

      const procedure = typeof body.procedure === "string" ? body.procedure.trim().slice(0, 120) : "";
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 600) : "";
      if (!procedure) return bad("Name the procedure this case shows.", 400);

      const caseRef = adminClinicCollection(clinicId, "marketing_cases").doc();
      const ext = (t: string) => (t === "image/png" ? "png" : t === "image/webp" ? "webp" : "jpg");
      const base = `clinics/${clinicId}/marketing-cases/${caseRef.id}`;
      const [beforeUrl, afterUrl] = await Promise.all([
        uploadImage(`${base}/before.${ext(before.contentType)}`, before.buffer, before.contentType),
        uploadImage(`${base}/after.${ext(after.contentType)}`, after.buffer, after.contentType),
      ]);

      await caseRef.set({
        patientId,
        patientName: String(consent.patientName || ""),
        procedure,
        description,
        beforeUrl,
        afterUrl,
        beforePath: `${base}/before.${ext(before.contentType)}`,
        afterPath: `${base}/after.${ext(after.contentType)}`,
        /** Snapshot, not live lookup — the permission that existed when this case was made. */
        faceAllowed: consent.faceAllowed === true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: authz.uid,
      });

      return NextResponse.json({ ok: true, caseId: caseRef.id });
    }

    // ---- delete a case (admin: it may already be published material) ----
    if (action === "delete_case") {
      const authz = await requireAdminUser(request, clinicId);
      if (!authz.ok) return authz.response;

      const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
      if (!caseId) return bad("caseId is required", 400);
      const ref = adminClinicDoc(clinicId, "marketing_cases", caseId);
      const snap = await ref.get();
      if (!snap.exists) return bad("Case not found", 404);

      const d = snap.data() || {};
      await Promise.all(
        [d.beforePath, d.afterPath]
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .map((p) => adminBucket().file(p).delete().catch(() => {}))
      );
      await ref.delete();
      return NextResponse.json({ ok: true });
    }

    return bad("Unknown action", 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Case request failed";
    reportServerError("[MarketingCases] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
