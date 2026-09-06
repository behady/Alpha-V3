import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { adminDb } from "@/lib/firebaseAdmin";
import { hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * What the assistant remembers about each patient between conversations.
 *
 * The model sees the last sixteen lines of the current thread and nothing before them, so a
 * patient who asked about braces two weeks ago is a stranger the next time they write. This
 * nightly job reads every thread that moved since its last memory was written and distils it
 * into a few lines — who they are, what they asked, what they were quoted, what held them back,
 * where it was left — stored on the conversation and read at the start of the next one.
 *
 * Not charged to the clinic's credits: it is housekeeping the clinic did not ask for by the
 * message, the way the playbook is.
 */

const MODEL = "gemini-flash-latest";
const LOOKBACK_MS = 36 * 60 * 60 * 1000;
const MAX_PER_RUN = 60;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function authorize(request: Request) {
  if (isCronAuthorized(request)) return { ok: true as const, cron: true as const };
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff;
  return { ok: true as const, cron: false as const, uid: staff.uid };
}

async function runForClinic(clinicId: string): Promise<{ updated: number; skipped: number }> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { updated: 0, skipped: 0 };
  /*
   * The same gate every other AI feature answers to. Without it this sent every clinic's patient
   * conversations to the model every night — including clinics with no AI on their plan and
   * clinics that had switched the assistant off — and charged nobody for it.
   */
  const settings = ((await adminClinicDoc(clinicId, "settings", "whatsapp").get()).data() || {}) as Record<string, unknown>;
  if (settings.botEnabled !== true) return { updated: 0, skipped: 0 };
  if (settings.botAiEnabled !== true && settings.botMode !== "ai_first") return { updated: 0, skipped: 0 };
  const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
  if (!clinicSnap.exists || !hasFeature({ id: clinicSnap.id, ...clinicSnap.data() } as Clinic, "aiChat")) {
    return { updated: 0, skipped: 0 };
  }
  const since = Date.now() - LOOKBACK_MS;
  const snap = await adminClinicCollection(clinicId, "whatsapp_conversations").where("lastMessageAt", ">=", since).limit(500).get();
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL, generationConfig: { temperature: 0.2, maxOutputTokens: 1024 } });

  let updated = 0;
  let skipped = 0;
  for (const d of snap.docs) {
    if (updated >= MAX_PER_RUN) break;
    const c = d.data() || {};
    if (d.id.startsWith("play_")) continue;
    const last = Number(c.lastMessageAt) || 0;
    if ((Number(c.memoryAt) || 0) >= last) { skipped += 1; continue; }
    const msgs = await d.ref.collection("messages").orderBy("at", "desc").limit(40).get();
    const lines = msgs.docs
      .map((m) => m.data() || {})
      .reverse()
      .filter((m) => m.author !== "system")
      .map((m) => `${m.author === "patient" ? "المريض" : m.author === "staff" ? "الموظف" : "العيادة"}: ${String(m.text || "").replace(/\s+/g, " ").slice(0, 220)}`);
    if (lines.length < 2) { skipped += 1; continue; }

    const prompt = [
      "دي محادثة واتساب بين عيادة أسنان ومريض. اكتب \"ذاكرة\" قصيرة عن المريض ده عشان الموظف اللي هيكلمه المرة الجاية يبدأ من مكان ما وقفوا.",
      "من 3 لـ 5 سطور بالعامية المصرية، حقائق بس من المحادثة، من غير تخمين:",
      "- مين هو (الاسم لو اتقال) وإيه اللي مهتم بيه",
      "- إيه الأسعار أو العروض اللي اتقالتله",
      "- إيه اللي كان مأخره أو معترض عليه",
      "- المحادثة وقفت فين وإيه الخطوة الجاية المنطقية",
      c.memory ? `\nذاكرة قديمة (حدّثها، متكررش اللي اتغير):\n${String(c.memory).slice(0, 600)}` : "",
      "\nالمحادثة:",
      lines.join("\n"),
    ].join("\n");
    try {
      const result = await model.generateContent(prompt);
      const memory = result.response.text().trim().slice(0, 900);
      if (!memory) { skipped += 1; continue; }
      await d.ref.set({ memory, memoryAt: Date.now(), memoryUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      updated += 1;
    } catch {
      skipped += 1;
    }
  }
  return { updated, skipped };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      return NextResponse.json({ ok: true, clinicId, ...(await runForClinic(clinicId)) });
    }
    const clinics = await forEachActiveClinic((clinicId) => runForClinic(clinicId));
    return NextResponse.json({ ok: true, clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, ...(c.result || {}) })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
