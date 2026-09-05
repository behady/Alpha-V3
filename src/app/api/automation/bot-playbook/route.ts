import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The weekly playbook: what actually led to bookings, written down for the model.
 *
 * Every AI-led conversation ends one of three ways — booked, handed to a person, or quiet — and
 * the conversation document says which. Once a clinic has enough of them to mean anything, this
 * reads a sample of the booked and the quiet threads, asks the model what separated them, and
 * writes a short Arabic playbook the sales prompt includes on every turn. The owner can edit it
 * on the Bot tab; their edit wins over the generated text until the next run replaces the
 * generated text (the edit is kept alongside, never overwritten).
 *
 * Below the threshold nothing is generated — a playbook learned from eight chats is a
 * superstition — but the counts are still written so the Bot tab can show "collecting: 8/50".
 */

const MIN_CONVERSATIONS = 50;
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const QUIET_AFTER_MS = 24 * 60 * 60 * 1000;
const SAMPLE_PER_OUTCOME = 12;
const LINES_PER_THREAD = 12;
const MODEL = "gemini-flash-latest";

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

type Outcome = "booked" | "handoff" | "quiet";

async function threadText(clinicId: string, key: string): Promise<string> {
  const snap = await adminClinicDoc(clinicId, "whatsapp_conversations", key)
    .collection("messages")
    .orderBy("at", "asc")
    .limit(40)
    .get();
  return snap.docs
    .map((d) => d.data() || {})
    .slice(-LINES_PER_THREAD)
    .map((m) => `${m.author === "patient" ? "المريض" : m.author === "staff" ? "الموظف" : "البوت"}: ${String(m.text || "").replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");
}

async function runForClinic(clinicId: string): Promise<{ conversations: number; booked: number; handoff: number; quiet: number; generated: boolean; skipped?: string }> {
  const since = Date.now() - LOOKBACK_MS;
  const snap = await adminClinicCollection(clinicId, "whatsapp_conversations").where("lastMessageAt", ">=", since).limit(2000).get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) } as Record<string, unknown> & { id: string }))
    .filter((c) => c.aiUsed === true);

  const outcomeOf = (c: Record<string, unknown>): Outcome | null => {
    if (c.outcome === "booked") return "booked";
    if (c.outcome === "handoff") return "handoff";
    const last = Number(c.lastMessageAt) || 0;
    return last && Date.now() - last > QUIET_AFTER_MS ? "quiet" : null; // still live: not settled yet
  };
  const settled = rows.map((c) => ({ c, o: outcomeOf(c) })).filter((x): x is { c: typeof rows[number]; o: Outcome } => x.o !== null);
  const stats = {
    conversations: settled.length,
    booked: settled.filter((x) => x.o === "booked").length,
    handoff: settled.filter((x) => x.o === "handoff").length,
    quiet: settled.filter((x) => x.o === "quiet").length,
  };

  const ref = adminClinicDoc(clinicId, "settings", "bot_playbook");
  if (stats.conversations < MIN_CONVERSATIONS) {
    await ref.set({ stats, threshold: MIN_CONVERSATIONS, statsAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ...stats, generated: false, skipped: "below_threshold" };
  }
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { ...stats, generated: false, skipped: "no_api_key" };

  const pick = (o: Outcome) => settled.filter((x) => x.o === o).sort((a, b) => (Number(b.c.lastMessageAt) || 0) - (Number(a.c.lastMessageAt) || 0)).slice(0, SAMPLE_PER_OUTCOME);
  const booked = await Promise.all(pick("booked").map((x) => threadText(clinicId, x.c.id)));
  const quiet = await Promise.all(pick("quiet").map((x) => threadText(clinicId, x.c.id)));

  const prompt = [
    "انت مدير مبيعات بيراجع محادثات واتساب لعيادة أسنان. البوت هو اللي بيرد على المرضى.",
    "تحت مجموعتين من المحادثات: محادثات انتهت بحجز، ومحادثات المريض سكت فيها ومحجزش.",
    "اكتب \"كتيب مبيعات\" قصير بالعامية المصرية للبوت، في شكل نقاط (من 8 لـ 12 نقطة بالكتير)، يجاوب على:",
    "- إيه اللي كان بيتقال في المحادثات اللي اتحجزت وشغّال؟ (صياغات محددة اقتبسها)",
    "- إيه اللي كان بيخلي المريض يسكت؟ (أسئلة كتير، ردود طويلة، سعر من غير قيمة، ...)",
    "- الأسئلة اللي المرضى بيسألوها كتير وإزاي أحسن رد عليها.",
    "- إمتى بالظبط يعرض الحجز.",
    "ممنوع تقترح خصومات أو وعود طبية أو أي معلومة مش موجودة في المحادثات. اكتب النقاط بس من غير مقدمة.",
    "",
    "=== محادثات انتهت بحجز ===",
    booked.map((t, i) => `--- محادثة ${i + 1} ---\n${t}`).join("\n\n"),
    "",
    "=== محادثات المريض سكت فيها ===",
    quiet.map((t, i) => `--- محادثة ${i + 1} ---\n${t}`).join("\n\n"),
  ].join("\n");

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL, generationConfig: { temperature: 0.3, maxOutputTokens: 2000 } });
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim().slice(0, 4000);
  if (!text) return { ...stats, generated: false, skipped: "empty" };

  await ref.set(
    { text, generatedAt: FieldValue.serverTimestamp(), stats, threshold: MIN_CONVERSATIONS, statsAt: FieldValue.serverTimestamp(), sample: { booked: booked.length, quiet: quiet.length } },
    { merge: true }
  );
  return { ...stats, generated: true };
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
