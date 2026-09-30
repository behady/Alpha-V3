/**
 * What the three ortho AI routes share: the gate, the credit meter, the patient's pictures by
 * id, the clinic's coaching (lessons, norms, landmark tally), and one way of asking Gemini for
 * JSON. Server only — Admin SDK and the model SDK live here so lib/orthoAi.ts can stay pure.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { isFullAccessRole } from "@/lib/permissions";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { getAiCreditLimit } from "@/lib/subscriptions";
import { createUsageMeter, type AiUsageMeter } from "@/lib/aiCreditLog";
import { reportServerError } from "@/lib/server/reportError";
import {
  normalizeLandmarkBias,
  normalizeNormOverrides,
  type CephNormOverrides,
  type LandmarkBiasStats,
} from "@/lib/orthoCeph";
import {
  normalizeLesson,
  ORTHO_AI_FEATURE_KEY,
  ORTHO_COACHING_BIAS_DOC,
  ORTHO_COACHING_COLLECTION,
  ORTHO_COACHING_NORMS_DOC,
  ORTHO_LESSON_MAX_COUNT,
  type Lang,
  type OrthoLesson,
} from "@/lib/orthoAi";

export type OrthoAuthz = { uid: string; role: string; permissions: string[]; name: string };

/**
 * Signed-in staff with a clinical role or `access.ortho`/`access.clinical`, in a clinic whose
 * subscription carries the ortho AI add-on. Same shape of answer as the x-ray route so the
 * client's error handling is one function.
 */
export async function gateOrthoAi(req: Request, clinicId: string, language: Lang): Promise<{ ok: true; authz: OrthoAuthz } | { ok: false; response: NextResponse }> {
  const authz = await requireStaffUser(req, clinicId);
  if (!authz.ok) return { ok: false, response: authz.response };
  const clinical =
    isFullAccessRole(authz.role) ||
    authz.role === "Dentist" ||
    authz.permissions.includes("access.ortho") ||
    authz.permissions.includes("access.clinical");
  if (!clinical) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Orthodontic AI needs clinical access." }, { status: 403 }) };
  }
  if (!(await clinicHasFeature(clinicId, ORTHO_AI_FEATURE_KEY))) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: language === "ar" ? "الذكاء الاصطناعي للتقويم غير مفعّل في اشتراك العيادة." : "AI orthodontics is not part of this clinic's subscription.",
          reason: "feature_locked",
        },
        { status: 403 }
      ),
    };
  }
  return { ok: true, authz: { uid: authz.uid, role: authz.role, permissions: authz.permissions, name: authz.name } };
}

/**
 * Checks the month's credits against the plan and hands back the charge to run once — and only
 * once — a usable answer exists. Nothing is debited for a failed call.
 */
export async function reserveOrthoCredits(clinicId: string, requiredCredits: number): Promise<{ ok: true; charge: () => Promise<void> } | { ok: false; response: NextResponse }> {
  try {
    const db = adminDb();
    const clinicSnap = await db.collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) return { ok: false, response: NextResponse.json({ ok: false, error: "Clinic not found." }, { status: 404 }) };
    const clinicData = { id: clinicSnap.id, ...clinicSnap.data() } as any;
    const monthKey = new Date().toISOString().slice(0, 7);
    const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
    const usageSnap = await usageRef.get();
    const currentUsed = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;
    const limit = getAiCreditLimit(clinicData);
    if (limit > 0 && currentUsed + requiredCredits > limit) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: `Monthly AI credits limit reached (${currentUsed} / ${limit} credits used).`, reason: "no_credits" },
          { status: 429 }
        ),
      };
    }
    return {
      ok: true,
      charge: async () => {
        await usageRef.set(
          { monthKey, creditsUsed: FieldValue.increment(requiredCredits), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      },
    };
  } catch (err) {
    reportServerError("Ortho AI quota check failed:", err);
    return { ok: false, response: NextResponse.json({ ok: false, error: "Could not verify your AI plan or usage. Please try again." }, { status: 503 }) };
  }
}

export interface LoadedMedia {
  id: string;
  url: string;
  category: string;
  filename: string;
  takenAt: Date | null;
  mimeType: string;
  bytes: Buffer;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The pictures, by `patient_media` id, each checked against this patient and downloaded here.
 * Never by URL: a client that could hand over a URL could bill a reading against any picture
 * on the internet, or read another clinic's file if it had the link.
 */
export async function loadPatientMedia(clinicId: string, patientId: string, mediaIds: string[]): Promise<{ ok: true; media: LoadedMedia[] } | { ok: false; response: NextResponse }> {
  const bad = (error: string, status = 400) => ({ ok: false as const, response: NextResponse.json({ ok: false, error }, { status }) });
  const snaps = await Promise.all(mediaIds.map((id) => adminClinicDoc(clinicId, "patient_media", id).get()));
  const media: LoadedMedia[] = [];
  for (const snap of snaps) {
    const d = snap.data() as Record<string, unknown> | undefined;
    if (!snap.exists || !d || String(d.patientId || "") !== patientId) return bad("One of the images does not belong to this patient.");
    const url = String(d.url || "");
    if (!/^https:\/\/firebasestorage\.googleapis\.com\//.test(url)) return bad("One of the images has no readable file.");
    const res = await fetch(url);
    if (!res.ok) return bad("Could not download one of the images.", 502);
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return bad("Only image files can be read (PDF and DICOM are not supported yet).");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return bad("One of the images is larger than 8 MB.");
    media.push({
      id: snap.id,
      url,
      category: String(d.category || ""),
      filename: String(d.filename || d.fileName || ""),
      takenAt: (d.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null,
      mimeType,
      bytes,
    });
  }
  return { ok: true, media };
}

export function mediaSnapshot(m: LoadedMedia) {
  return { id: m.id, url: m.url, category: m.category, filename: m.filename, takenAt: m.takenAt ? m.takenAt.toISOString() : "" };
}

export function inlineImage(m: LoadedMedia) {
  return { inlineData: { data: m.bytes.toString("base64"), mimeType: m.mimeType } };
}

export interface OrthoCoaching {
  lessons: OrthoLesson[];
  norms: CephNormOverrides;
  bias: LandmarkBiasStats;
}

/** Everything the clinic has taught the model. A missing collection is an empty lesson book. */
export async function loadOrthoCoaching(clinicId: string): Promise<OrthoCoaching> {
  const out: OrthoCoaching = { lessons: [], norms: {}, bias: {} };
  try {
    const snap = await adminClinicCollection(clinicId, ORTHO_COACHING_COLLECTION).get();
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (doc.id === ORTHO_COACHING_NORMS_DOC) out.norms = normalizeNormOverrides(data.norms);
      else if (doc.id === ORTHO_COACHING_BIAS_DOC) out.bias = normalizeLandmarkBias(data.stats);
      else {
        const lesson = normalizeLesson(doc.id, data);
        if (lesson) out.lessons.push(lesson);
      }
    }
    out.lessons.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    out.lessons = out.lessons.slice(-ORTHO_LESSON_MAX_COUNT);
  } catch (err) {
    reportServerError("Ortho coaching load failed:", err);
  }
  return out;
}

export class OrthoAiTimeout extends Error {
  constructor() {
    super("ortho_timeout");
  }
}

/**
 * One structured call. The model and the schema are decided by the caller; the answer comes back
 * parsed, or null when it was not JSON. Usage is added to the meter so the credit log can show
 * what the credits bought.
 */
export async function askGeminiJson(opts: {
  apiKey: string;
  modelName: string;
  systemInstruction: string;
  parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[];
  schema: unknown;
  meter: AiUsageMeter;
  timeoutMs: number;
  maxOutputTokens?: number;
}): Promise<unknown> {
  const model = new GoogleGenerativeAI(opts.apiKey).getGenerativeModel({
    model: opts.modelName,
    systemInstruction: opts.systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      // Plain data in lib/orthoAi.ts; the SDK's ResponseSchema wants its own enum for `type`, but
      // the wire format is identical.
      responseSchema: opts.schema as any,
      temperature: 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    },
  });
  const result = await Promise.race([
    model.generateContent(opts.parts),
    new Promise<never>((_, reject) => setTimeout(() => reject(new OrthoAiTimeout()), opts.timeoutMs)),
  ]);
  opts.meter.add(result.response);
  try {
    return JSON.parse(result.response.text().replace(/```json/g, "").replace(/```/g, "").trim());
  } catch {
    return null;
  }
}

export function newMeter(modelName: string) {
  return createUsageMeter(modelName);
}

/** The model for a request: Pro in deep mode, Flash otherwise. Never a name the client sent. */
export function pickModel(deep: boolean): string {
  return deep ? "gemini-pro-latest" : "gemini-flash-latest";
}

export function cleanIds(raw: unknown, max: number): string[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return [...new Set(list.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()))].slice(0, max);
}
