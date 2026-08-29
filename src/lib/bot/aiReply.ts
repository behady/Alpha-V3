import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

/**
 * The AI fallback for the WhatsApp assistant — the receptionist's voice for the questions the
 * buttons cannot answer.
 *
 * It exists to be CHEAP and RARE: buttons and digits handle the bulk of traffic for free, and
 * this runs only when a message matched nothing — which is also why it draws from the clinic's
 * existing AI credit pool at one credit per answer instead of needing its own meter. The caps
 * around it (three answers per conversation, the hourly reply budget) are enforced by the caller;
 * this module enforces the two limits that belong to it alone: the plan gate and the credit pool.
 *
 * It answers questions. It performs nothing. An AI that can write to a calendar is an AI that can
 * wreck one, so booking stays with the deterministic flow and the model is not offered a single
 * tool — the strongest sandbox is an empty toolbox.
 */

const MODEL = "gemini-flash-latest";
/** One WhatsApp answer costs one credit — same unit the in-app assistant charges. */
const CREDITS_PER_ANSWER = 1;
/** A stuck model call must degrade to the old reprompt, not hold the webhook hostage. */
const TIMEOUT_MS = 9000;

export type AiReplyResult =
  | { kind: "answer"; text: string }
  /** The model classified the message as something a human must handle. */
  | { kind: "handoff"; topic: "medical" | "complaint" | "staff" | "other" }
  /** No key, no plan, no credits, timeout, or model error — caller falls back to the old path. */
  | { kind: "unavailable"; reason: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ai_timeout")), ms)),
  ]);
}

export async function answerWithAi(args: {
  clinicId: string;
  clinicName: string;
  question: string;
  patientName?: string;
  hoursText?: string;
  /** Prior AI exchanges in this conversation, oldest first, for continuity. */
  history: Array<{ q: string; a: string }>;
}): Promise<AiReplyResult> {
  const { clinicId, clinicName, question, patientName, hoursText, history } = args;

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { kind: "unavailable", reason: "no_api_key" };

  const db = adminDb();

  // The same plan gate and meter the in-app assistant answers to. One pool, one explanation.
  const clinicSnap = await db.collection("clinics").doc(clinicId).get();
  if (!clinicSnap.exists) return { kind: "unavailable", reason: "no_clinic" };
  const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
  if (!hasFeature(clinic, "aiChat")) return { kind: "unavailable", reason: "plan" };

  const monthKey = new Date().toISOString().slice(0, 7);
  const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
  const usageSnap = await usageRef.get();
  const used = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;
  const limit = getAiCreditLimit(clinic);
  if (limit > 0 && used + CREDITS_PER_ANSWER > limit) {
    return { kind: "unavailable", reason: "no_credits" };
  }

  /*
   * Price context: names and starting prices from the clinic's own service list. The model is
   * ordered to speak in ranges ("يبدأ من") and to ALWAYS say reception confirms the final price —
   * the clinic's decision, made explicitly: a quoted-exact price that drifted from reality
   * arrives in a patient's hand as a promise the clinic never made.
   */
  let priceLines = "";
  try {
    const servicesSnap = await adminClinicCollection(clinicId, "services").limit(200).get();
    priceLines = servicesSnap.docs
      .map((d) => {
        const s = (d.data() || {}) as Record<string, unknown>;
        const name = String(s.name || "").trim();
        const price = Number(s.price) || 0;
        return name && price > 0 ? `${name}: يبدأ من ${price.toLocaleString("en-US")} ج.م` : "";
      })
      .filter(Boolean)
      .slice(0, 80)
      .join("\n");
  } catch {
    /* no prices in context simply means the model must refuse price questions */
  }

  const system = [
    `انت موظف استقبال ودود في عيادة أسنان اسمها "${clinicName}" وبترد على واتساب العيادة بالعامية المصرية.`,
    "قواعد صارمة لا تُكسر أبداً:",
    "- جاوب فقط من المعلومات المكتوبة تحت. لو المعلومة مش موجودة، اختار handoff_other — ممنوع التخمين أو الاختراع.",
    "- أي سؤال طبي (ألم، ورم، دواء، تشخيص، هل ده طبيعي): اختار handoff_medical.",
    "- أي شكوى أو زعل أو كلام عن تجربة سيئة: اختار handoff_complaint.",
    "- أي سؤال عن طبيب معيّن بالاسم (شطارته، مواعيده الشخصية، رأيك فيه): اختار handoff_staff.",
    "- الأسعار: جاوب من القايمة تحت بصيغة \"يبدأ من\"، ودايماً اختم بأن الاستقبال بيأكد السعر النهائي. لو المريض سأل عن حاجة ليها خدمة مشابهة أو قريبة في القايمة (مثلاً سأل عن التقويم والقايمة فيها \"تقويم معدن\") اعتبرها موجودة وجاوب بسعرها. بس لو مفيش أي خدمة قريبة منها خالص: handoff_other.",
    "- أسئلة \"بتعملوا كذا؟\": لو الخدمة أو حاجة قريبة منها في القايمة، الإجابة أيوه مع السعر. متحوّلش سؤال تقدر تجاوبه.",
    "- متقولش انك انسان. متوعدش بحاجة. متحددش مواعيد — الحجز بيتم من الأزرار.",
    "- الرد قصير: جملتين لتلاتة بالكتير.",
    "",
    "معلومات العيادة:",
    hoursText?.trim() ? `مواعيد العمل:\n${hoursText.trim()}` : "مواعيد العمل: غير متوفرة هنا (حوّل لو اتسألت).",
    priceLines ? `\nقائمة الخدمات والأسعار:\n${priceLines}` : "\nقائمة الأسعار: غير متوفرة (حوّل أي سؤال سعر).",
    patientName ? `\nاسم المريض: ${patientName}` : "",
  ].join("\n");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: system,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            action: {
              type: SchemaType.STRING,
              enum: ["answer", "handoff_medical", "handoff_complaint", "handoff_staff", "handoff_other"],
              format: "enum",
            },
            reply: { type: SchemaType.STRING },
          },
          required: ["action"],
        },
        maxOutputTokens: 400,
        temperature: 0.3,
      },
    });

    const contents = [
      ...history.flatMap((h) => [
        { role: "user" as const, parts: [{ text: h.q }] },
        { role: "model" as const, parts: [{ text: JSON.stringify({ action: "answer", reply: h.a }) }] },
      ]),
      { role: "user" as const, parts: [{ text: question }] },
    ];

    const result = await withTimeout(model.generateContent({ contents }), TIMEOUT_MS);
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as { action?: string; reply?: string };

    if (parsed.action === "handoff_medical") return { kind: "handoff", topic: "medical" };
    if (parsed.action === "handoff_complaint") return { kind: "handoff", topic: "complaint" };
    if (parsed.action === "handoff_staff") return { kind: "handoff", topic: "staff" };
    if (parsed.action !== "answer") return { kind: "handoff", topic: "other" };

    const text = String(parsed.reply || "").trim().slice(0, 700);
    if (!text) return { kind: "handoff", topic: "other" };

    // Charged only for a delivered answer, after the model produced one — the same
    // bill-on-success rule the in-app assistant follows. Handoffs cost the clinic nothing.
    await usageRef.set(
      { monthKey, creditsUsed: FieldValue.increment(CREDITS_PER_ANSWER), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logAiCreditUsage({
      clinicId,
      feature: "whatsapp_bot",
      credits: CREDITS_PER_ANSWER,
      userId: "whatsapp_bot",
      userName: "WhatsApp Bot",
      detail: question.slice(0, 120),
    }).catch(() => {});

    return { kind: "answer", text };
  } catch (e) {
    return { kind: "unavailable", reason: e instanceof Error ? e.message : "model_error" };
  }
}
