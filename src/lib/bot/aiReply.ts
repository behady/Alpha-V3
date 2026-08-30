import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import type { BotFacts } from "@/types/whatsapp";

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
/**
 * How long to wait for the model before giving the patient the old re-prompt instead.
 *
 * Measured, not guessed: the same question answered in 2.9s, 8.2s and 12.2s on three consecutive
 * calls, so latency here has a long tail that has nothing to do with the prompt. At 9s a third of
 * answers were thrown away and the patient got "معلش مفهمتش" for a question the model had answered
 * perfectly — which reads, correctly, as a broken bot.
 *
 * Nobody waits on this any more: the webhook returns to Meta immediately and the reply is composed
 * afterwards (see the meta-whatsapp route). So the budget is set by what a patient will tolerate
 * between sending a question and hearing back, not by an HTTP deadline. Past this it is better to
 * show the menu than to leave them watching an empty chat.
 */
const TIMEOUT_MS = 25000;

export type AiReplyResult =
  | { kind: "answer"; text: string }
  /** The model classified the message as something a human must handle. */
  | { kind: "handoff"; topic: "medical" | "complaint" | "staff" | "other" }
  /** No key, no plan, no credits, timeout, or model error — caller falls back to the old path. */
  | { kind: "unavailable"; reason: string };

/**
 * The clinic's own written answers, as context lines.
 *
 * Only the fields that were filled in appear. An absent field is not a gap to be filled by the
 * model — the prompt's standing rule is to hand off anything not written below, and `notOffered`
 * exists specifically to stop the "a near-enough service counts as yes" instruction quoting an
 * implant price at a clinic that does no implants.
 */
function factLines(facts?: BotFacts): string {
  if (!facts) return "";
  const rows: Array<[string, string | undefined]> = [
    ["الحضور من غير ميعاد", facts.walkIn],
    ["التقسيط", facts.installments],
    ["العروض والخصومات", facts.offers],
    ["الباركن", facts.parking],
    ["التأمين", facts.insurance],
    ["مدة الجلسات", facts.durations],
    ["عدد الجلسات", facts.sessions],
    ["تعليمات بعد العلاج", facts.aftercare],
    ["خدمات إحنا مش بنعملها", facts.notOffered],
  ];
  const lines = rows
    .filter(([, v]) => v && v.trim())
    .map(([label, v]) => `- ${label}: ${v!.trim()}`);
  return lines.length ? `\nمعلومات كتبتها العيادة بنفسها:\n${lines.join("\n")}` : "";
}

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
  /** Where the clinic is, and how to ring it. Withheld before, so it handed off on "فين العيادة". */
  addressText?: string;
  clinicPhone?: string;
  /** The clinic's own answers to the questions its data cannot supply. */
  facts?: BotFacts;
  /** Prior AI exchanges in this conversation, oldest first, for continuity. */
  history: Array<{ q: string; a: string }>;
}): Promise<AiReplyResult> {
  const { clinicId, clinicName, question, patientName, hoursText, addressText, clinicPhone, facts, history } = args;

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
    "- أي خدمة مكتوبة في \"خدمات إحنا مش بنعملها\" الإجابة عنها لأ بوضوح، وممنوع تديله سعر خدمة قريبة منها.",
    "- مدة العلاج، عدد الجلسات، الضمان، مدة ما العلاج بيفضل: جاوب بس لو مكتوبة تحت حرفياً. لو مش مكتوبة اختار handoff_other — ممنوع تقول رقم من معلوماتك العامة عن طب الأسنان.",
    "- متقولش انك انسان. متوعدش بحاجة. متحددش مواعيد — الحجز بيتم من الأزرار.",
    "- الرد قصير: جملتين لتلاتة بالكتير.",
    "",
    "معلومات العيادة:",
    hoursText?.trim() ? `مواعيد العمل:\n${hoursText.trim()}` : "مواعيد العمل: غير متوفرة هنا (حوّل لو اتسألت).",
    // The address was deliberately withheld before, so the model handed off on "فين العيادة"
    // while the menu two taps away had the answer.
    addressText?.trim() ? `العنوان: ${addressText.trim()}` : "",
    clinicPhone?.trim() ? `تليفون العيادة: ${clinicPhone.trim()}` : "",
    priceLines ? `\nقائمة الخدمات والأسعار:\n${priceLines}` : "\nقائمة الأسعار: غير متوفرة (حوّل أي سؤال سعر).",
    /*
     * What the clinic itself wrote. Anything missing here stays missing: these are exactly the
     * questions — treatment length, session counts, instalments — where a model reaches for
     * textbook dentistry and delivers it in the clinic's voice on the clinic's number.
     */
    factLines(facts),
    patientName ? `\nاسم المريض: ${patientName}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
        // Arabic is token-hungry and the reply travels inside JSON: 400 tokens truncated the
        // first live answer mid-string, and a broken JSON read as "the model refused". Three
        // short sentences of Arabic plus scaffolding fit comfortably in 1500 with margin for the
        // model's own overhead — and the hard length guard on `reply` below caps what a rambling
        // answer can cost regardless.
        maxOutputTokens: 1500,
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

    // The flight recorder. A wrong classification in production is invisible from the outside —
    // the patient just sees a handoff — and the difference between "the model was never shown
    // the price list" and "the model saw it and refused anyway" decides which fix is real.
    // One small doc per call, read only by debugging sessions.
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        raw: raw.slice(0, 1000),
        priceLineCount: priceLines ? priceLines.split("\n").length : 0,
        hoursGiven: Boolean(hoursText?.trim()),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});

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
    const reason = e instanceof Error ? e.message : "model_error";
    /*
     * Failures get a flight-recorder entry too.
     *
     * Only successful calls were recorded before, so a timed-out answer looked from the outside
     * exactly like a model that had refused — the patient saw "معلش مفهمتش" and nothing said why.
     * Finding that the timeout was firing on a third of calls took a live probe and a stopwatch;
     * this line is so the next one takes a query.
     */
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        failed: reason,
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    return { kind: "unavailable", reason };
  }
}
