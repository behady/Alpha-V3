import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { SchemaType } from "@google/generative-ai";
import { GEMINI_MODELS, backgroundGeminiModel, hasGeminiKey } from "@/lib/gemini";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A sales manager's morning review of yesterday's chats.
 *
 * The playbook waits for fifty settled conversations; a clinic that just switched the
 * salesperson on cannot wait that long to learn what it is getting wrong. Every morning this
 * reads yesterday's AI-led threads, grades them, and proposes two or three coaching lines —
 * short, concrete, in the owner's voice — that land on the Bot tab as suggestions. One tap adds
 * a line to the coaching notes the model reads on every turn; one tap dismisses it. Nothing
 * changes the bot until a person says so.
 */

const MODEL = GEMINI_MODELS.flash;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_THREADS = 15;

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

async function runForClinic(clinicId: string): Promise<{ threads: number; suggestions: number; skipped?: string }> {
  if (!hasGeminiKey()) return { threads: 0, suggestions: 0, skipped: "no_api_key" };
  const settings = ((await adminClinicDoc(clinicId, "settings", "whatsapp").get()).data() || {}) as Record<string, unknown>;
  if (settings.botMode !== "ai_first" && settings.botAiEnabled !== true) return { threads: 0, suggestions: 0, skipped: "ai_off" };

  const since = Date.now() - DAY_MS;
  const snap = await adminClinicCollection(clinicId, "whatsapp_conversations").where("lastMessageAt", ">=", since).limit(300).get();
  const rows = snap.docs.filter((d) => !d.id.startsWith("play_") && (d.data() || {}).aiUsed === true).slice(0, MAX_THREADS);
  if (rows.length < 2) return { threads: rows.length, suggestions: 0, skipped: "too_few" };

  const threads: string[] = [];
  for (const d of rows) {
    const c = d.data() || {};
    const msgs = await d.ref.collection("messages").orderBy("at", "asc").limit(30).get();
    const lines = msgs.docs
      .map((m) => m.data() || {})
      .filter((m) => m.author !== "system")
      .map((m) => `${m.author === "patient" ? "المريض" : m.author === "staff" ? "الموظف" : "البوت"}: ${String(m.text || "").replace(/\s+/g, " ").slice(0, 200)}`);
    if (lines.length < 2) continue;
    threads.push(`--- محادثة (${c.outcome === "booked" ? "اتحجزت" : c.outcome === "handoff" ? "اتحولت لموظف" : "من غير حجز"}) ---\n${lines.join("\n")}`);
  }
  if (threads.length < 2) return { threads: threads.length, suggestions: 0, skipped: "too_few" };

  const existing = String(settings.botCoaching || "").trim();
  const model = backgroundGeminiModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          suggestions: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: { line: { type: SchemaType.STRING }, why: { type: SchemaType.STRING } },
              required: ["line", "why"],
            },
          },
        },
        required: ["suggestions"],
      },
      temperature: 0.3,
      maxOutputTokens: 1500,
    },
  }, { feature: "bot_coach" });
  const prompt = [
    "انت مدير مبيعات بيراجع محادثات امبارح بين بوت واتساب عيادة أسنان والمرضى. البوت بيشتغل بتعليمات مكتوبة من صاحب العيادة.",
    "اقرأ المحادثات واقترح من 2 لـ 3 تعليمات جديدة قصيرة (سطر واحد لكل تعليمة، بالعامية المصرية، بصيغة الأمر للبوت) تحسّن خدمة العملاء أو نسبة الحجز.",
    "شروط: كل تعليمة لازم تبقى مبنية على حاجة حصلت فعلاً في المحادثات دي (اذكرها في why). ممنوع تقترح خصومات أو أسعار أو معلومات طبية أو أي حاجة مش موجودة في المحادثات. متكررش تعليمة موجودة بالفعل.",
    existing ? `\nالتعليمات الموجودة حالياً:\n${existing.slice(0, 1500)}` : "",
    "\nالمحادثات:",
    threads.join("\n\n"),
  ].join("\n");

  const result = await model.generateContent(prompt);
  // No credit — the clinic never asked for this — but the Google bill is real and goes on the record.
  void logAiCreditUsage({ clinicId, feature: "bot_coach", credits: 0, userId: "system", userName: "Nightly coach", usage: model.meter.snapshot() });
  const parsed = JSON.parse(result.response.text()) as { suggestions?: Array<{ line?: string; why?: string }> };
  const list = (parsed.suggestions || []).map((s) => ({ line: String(s.line || "").trim().slice(0, 240), why: String(s.why || "").trim().slice(0, 300) })).filter((s) => s.line).slice(0, 3);

  // One open suggestion per wording; yesterday's unanswered one is not repeated today.
  const open = await adminClinicCollection(clinicId, "bot_coach_suggestions").where("status", "==", "pending").limit(50).get();
  const openLines = new Set(open.docs.map((d) => String((d.data() || {}).line || "").trim()));
  let written = 0;
  for (const s of list) {
    if (openLines.has(s.line) || existing.includes(s.line)) continue;
    await adminClinicCollection(clinicId, "bot_coach_suggestions").add({ ...s, status: "pending", atMs: Date.now(), createdAt: FieldValue.serverTimestamp(), threads: threads.length });
    written += 1;
  }
  return { threads: threads.length, suggestions: written };
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
