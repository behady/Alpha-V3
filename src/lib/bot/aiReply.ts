import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import type { BotFacts } from "@/types/whatsapp";

/**
 * The model's voice on the clinic's WhatsApp — receptionist by default, salesperson when the
 * clinic switches it on.
 *
 * Two modes share this one call. "assisted" is the original fallback: rare, cheap, three answers
 * per conversation, runs only after every free route failed. "sales" is the mode a clinic
 * chooses when it wants the model to carry the whole conversation: it sees the thread, the
 * patient's record, the clinic's own words, the owner's coaching notes, the answers staff have
 * given before, and the playbook distilled from what actually led to bookings — and it may
 * decide the moment has come to open the booking. Even then it books nothing itself: it hands
 * that decision to the deterministic flow, which is the only thing that writes to a calendar.
 *
 * In both modes the red lines are the same and are in the prompt verbatim: prices as ranges,
 * nothing medical, nothing invented, complaints and named dentists to a person.
 */

const MODEL = "gemini-flash-latest";
/** One WhatsApp answer costs one credit — same unit the in-app assistant charges. */
const CREDITS_PER_ANSWER = 1;
/** Measured tail latency runs past 12s; nobody waits on this since the webhook answers first. */
const TIMEOUT_MS = 25000;

export type AiReplyResult =
  | {
      kind: "answer";
      text: string;
      /** Sales mode: the model judged the patient ready; the caller opens the booking lists. */
      openBooking?: boolean;
      /** Sales mode: the service the patient is interested in, as the model read it. */
      interest?: string;
    }
  /** The model classified the message as something a human must handle. */
  | { kind: "handoff"; topic: "medical" | "complaint" | "staff" | "other" }
  /** No key, no plan, no credits, timeout, or model error — caller falls back to the old path. */
  | { kind: "unavailable"; reason: string };

export interface AiThreadLine {
  author: "patient" | "bot" | "staff" | "system";
  text: string;
}

export interface AiPatientContext {
  /** Somebody on file, or a stranger who has never been to the clinic. */
  known: boolean;
  name?: string;
  gender?: "male" | "female" | "unknown";
  /** "الثلاثاء 9/9 الساعة 5:00 م مع د. أحمد", when they have one coming. */
  upcomingAppointment?: string;
  /** YYYY-MM-DD of their last completed visit, when known. */
  lastVisit?: string;
}

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
    ["ليه تختارنا", facts.whyUs],
    ["الكشف", facts.consultation],
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

const HARD_RULES = [
  "قواعد صارمة لا تُكسر أبداً:",
  "- جاوب فقط من المعلومات المكتوبة تحت. لو المعلومة مش موجودة، اختار handoff_other — ممنوع التخمين أو الاختراع.",
  "- أي سؤال طبي (ألم، ورم، دواء، تشخيص، هل ده طبيعي): اختار handoff_medical.",
  "- أي شكوى أو زعل أو كلام عن تجربة سيئة: اختار handoff_complaint.",
  "- أي سؤال عن طبيب معيّن بالاسم (شطارته، مواعيده الشخصية، رأيك فيه): اختار handoff_staff.",
  "- الأسعار: جاوب من القايمة تحت بصيغة \"يبدأ من\"، ودايماً اختم بأن الاستقبال بيأكد السعر النهائي. لو المريض سأل عن حاجة ليها خدمة مشابهة أو قريبة في القايمة (مثلاً سأل عن التقويم والقايمة فيها \"تقويم معدن\") اعتبرها موجودة وجاوب بسعرها. بس لو مفيش أي خدمة قريبة منها خالص: handoff_other.",
  "- أسئلة \"بتعملوا كذا؟\": لو الخدمة أو حاجة قريبة منها في القايمة، الإجابة أيوه مع السعر. متحوّلش سؤال تقدر تجاوبه.",
  "- أي خدمة مكتوبة في \"خدمات إحنا مش بنعملها\" الإجابة عنها لأ بوضوح، وممنوع تديله سعر خدمة قريبة منها.",
  "- مدة العلاج، عدد الجلسات، الضمان، مدة ما العلاج بيفضل: جاوب بس لو مكتوبة تحت حرفياً. لو مش مكتوبة اختار handoff_other — ممنوع تقول رقم من معلوماتك العامة عن طب الأسنان.",
  "- ممنوع تخترع خصم أو عرض أو تقسيط مش مكتوب تحت. ممنوع توعد بنتيجة علاج.",
  "- متقولش انك انسان لو اتسألت. متحددش مواعيد بنفسك — الحجز بيتم من النظام.",
  "- رد بنفس لغة المريض: لو كتب عربي رد بالعامية المصرية، لو كتب إنجليزي رد بإنجليزي بسيط، لو كتب فرانكو (عربي بحروف إنجليزية زي \"3ayez a7gez\") رد بالفرانكو بنفس الأسلوب.",
];

/**
 * What the AI does with a symptom when the clinic has switched dentist mode on.
 *
 * Written as the desk dentist would talk, not as a textbook: one question at a time, comfort
 * that is safe for anyone, and the appointment as the answer — because it is. The red-flag
 * list is the boundary the clinic drew and the model may not cross: those messages still reach
 * a person with the emergency number, whatever the setting says.
 */
const DENTIST_RULES = [
  "المريض ده بيشتكي من عرَض (وجع، ورم، حساسية، كسر، نزيف بسيط). اتعامل معاه زي طبيب الأسنان اللي واقف على الاستقبال — مش موظف بيوعد بمكالمة:",
  "1) طمّنه بجملة قصيرة وخد الموضوع بجدية.",
  "2) اسأل سؤال واحد بس عشان تفهم (فين بالظبط؟ بقاله قد إيه؟ فيه ورم أو سخونية؟ الوجع مع السخن/الساقع ولا لوحده؟). لو هو جاوب على سؤال قبل كده في المحادثة، متعيدوش.",
  "3) نصايح عامة آمنة بس: مسكّن من الصيدلية حسب إرشاداتها، مضمضة بمية دافية وملح، ابعد عن السخن والساقع جداً، متحطش أسبرين على اللثة، ومفيش مضاد حيوي من غير كشف. ممنوع تشخّص، ممنوع تسمّي دوا بعينه أو جرعة، ممنوع تقول «ده عصب» أو «ده خراج».",
  "4) الميعاد هو العلاج الحقيقي: من أول رد قول إن أحسن حاجة الدكتور يشوفه، وبعد ما يجاوب على سؤالك (أو لو قال «ماشي»، «تمام»، «طب إمتى»، «عايز أحجز») اختار open_booking واكتب في reply جملة قصيرة زي «تمام، هختارلك أقرب ميعاد متاح عشان الدكتور يشوفك 👇». متكتبش مواعيد بنفسك.",
  "5) علامات الخطر → handoff_medical فوراً وبدون نصايح: نزيف مش بيقف، ورم في الوش أو الرقبة مع سخونية، صعوبة بلع أو تنفس، إصابة أو وقعة أو سنة اتخلعت من مكانها، وجع بعد بنج أو عملية النهاردة، مريض سكر أو ضغط أو حامل بتشتكي من ورم.",
  "- الرد من جملتين لأربع جمل، دافي ومحترم، وبنفس لغة المريض.",
];

const ASSISTED_PERSONA = [
  (clinicName: string) => `انت موظف استقبال ودود في عيادة أسنان اسمها "${clinicName}" وبترد على واتساب العيادة بالعامية المصرية.`,
  "- الرد قصير: جملتين لتلاتة بالكتير.",
  "- متختمش الرد بدعوة للحجز أو بسؤال \"تحب تحجز؟\" — الأزرار تحت الرسالة بتعمل ده.",
];

const SALES_PERSONA = [
  (clinicName: string) =>
    `انت أشطر موظف استقبال ومبيعات في عيادة أسنان اسمها "${clinicName}"، وبتكلم المرضى على واتساب العيادة بالعامية المصرية. هدفك إن المريض يطمّن ويحجز كشف — من غير ما تكذب ومن غير ما تضغط عليه.`,
  "أسلوبك في البيع (اتبعه بالترتيب على مدار المحادثة، مش كله في رسالة واحدة):",
  "1) اسمع وافهم: أول ما حد يسأل، جاوب على سؤاله الأول بوضوح، وبعدين اسأل سؤال واحد بس يفهّمك احتياجه (الحالة إيه؟ بقاله قد إيه؟ الهدف تجميلي ولا علاجي؟). سؤال واحد في الرسالة، مش استبيان.",
  "2) اعرض القيمة: اربط إجابتك باللي يهم المريض ده (راحته، شكله، وقته، فلوسه) واستخدم \"ليه تختارنا\" و\"الكشف\" لو مكتوبين تحت. جملة أو اتنين، مش خطبة.",
  "3) عالج الاعتراض: \"غالي\" → التقسيط وقيمة اللي بياخده لو مكتوبين. \"هفكر\" → طبيعي، سيبله الباب مفتوح من غير إلحاح. \"في أرخص\" → متهاجمش حد، قول إحنا بنتميز في إيه لو مكتوب.",
  "4) اقفل: لما تحس إن المريض مرتاح أو قال كلمة توافق (تمام، ماشي، طب إمتى، عايز أحجز، ممكن ميعاد)، اختار open_booking واكتب في reply جملة قصيرة بتمهّد للمواعيد (مثلاً: \"تمام، هختارلك أقرب المواعيد المتاحة 👇\"). النظام هيعرض له الأيام والساعات بنفسه — متكتبش مواعيد أنت.",
  "قواعد الأسلوب:",
  "- كل رد من جملتين لأربع جمل. سطر فاضي بين الفكرة والفكرة. إيموجي واحد بالكتير.",
  "- استخدم اسم المريض مرة واحدة في المحادثة لو معروف، مش في كل رسالة. لو بنت أو ست خاطبها بصيغة المؤنث.",
  "- متكررش كلام قلته قبل كده في المحادثة (شوف الرسايل اللي فاتت). لو المريض سأل نفس السؤال تاني، جاوب باختصار وامشي خطوة لقدام.",
  "- لو المريض عنده ميعاد جاي بالفعل، متبعش له كشف جديد — ساعده في اللي هو محتاجه.",
  "- لو المريض غريب (مش معروف)، open_booking برضه شغال: النظام هيسأله اسمه الأول.",
  "- في خانة interest اكتب اسم الخدمة اللي المريض مهتم بيها لو واضحة (زي \"تبييض\" أو \"تقويم\")، وإلا سيبها فاضية.",
];

export async function answerWithAi(args: {
  clinicId: string;
  clinicName: string;
  question: string;
  patientName?: string;
  hoursText?: string;
  addressText?: string;
  clinicPhone?: string;
  facts?: BotFacts;
  /** Prior AI exchanges in this conversation, oldest first — the assisted mode's memory. */
  history: Array<{ q: string; a: string }>;
  /** "sales" lets the model lead the conversation and open bookings; default "assisted". */
  mode?: "assisted" | "sales";
  /** The whole recent thread, oldest first, every voice — sales mode's memory. */
  thread?: AiThreadLine[];
  patient?: AiPatientContext;
  /** The owner's standing instructions, verbatim. */
  coaching?: string;
  /** Answers staff gave that the owner approved for reuse. */
  knowledge?: Array<{ q: string; a: string }>;
  /** What has worked with this clinic's patients, distilled weekly (or edited by the owner). */
  playbook?: string;
  /** Whether the caller can actually open a booking if asked to. */
  canBook?: boolean;
  /**
   * The message is a symptom and the clinic chose dentist mode. The medical hand-off rule is
   * replaced by the dentist's script: ask, reassure, then offer the earliest appointment. The
   * emergency red flags still hand off.
   */
  clinical?: boolean;
}): Promise<AiReplyResult> {
  const { clinicId, clinicName, question, patientName, hoursText, addressText, clinicPhone, facts, history } = args;
  const sales = args.mode === "sales";

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

  const persona = (sales ? SALES_PERSONA : ASSISTED_PERSONA).map((p) => (typeof p === "function" ? p(clinicName) : p));

  const patient = args.patient;
  const patientLines = patient
    ? [
        "\nالمريض اللي بتكلمه:",
        patient.known ? `- معروف عندنا${patient.name ? `، اسمه ${patient.name}` : ""}.` : "- رقم جديد، مش مسجل عندنا.",
        patient.gender === "female" ? "- أنثى: خاطبيها بصيغة المؤنث." : "",
        patient.upcomingAppointment ? `- عنده ميعاد جاي: ${patient.upcomingAppointment}` : "- معندوش ميعاد جاي.",
        patient.lastVisit ? `- آخر زيارة: ${patient.lastVisit}` : "",
      ].filter(Boolean)
    : patientName
      ? [`\nاسم المريض: ${patientName}`]
      : [];

  const coaching = args.coaching?.trim();
  const knowledge = (args.knowledge || []).filter((k) => k.q?.trim() && k.a?.trim()).slice(0, 40);
  const playbook = args.playbook?.trim();

  // Dentist mode swaps the one rule that sends every symptom to a person for the dentist's
  // script; everything else — prices, facts, no invention — stays exactly as strict.
  const rules = args.clinical ? HARD_RULES.filter((r) => !r.startsWith("- أي سؤال طبي")) : HARD_RULES;

  const system = [
    ...persona,
    "",
    ...rules,
    ...(args.clinical ? ["", ...DENTIST_RULES] : []),
    ...(sales && args.canBook === false ? ["- الحجز مش متاح للرقم ده دلوقتي: متختارش open_booking، ولو المريض عايز يحجز اختار handoff_other."] : []),
    "",
    "معلومات العيادة:",
    hoursText?.trim() ? `مواعيد العمل:\n${hoursText.trim()}` : "مواعيد العمل: غير متوفرة هنا (حوّل لو اتسألت).",
    addressText?.trim() ? `العنوان: ${addressText.trim()}` : "",
    clinicPhone?.trim() ? `تليفون العيادة: ${clinicPhone.trim()}` : "",
    priceLines ? `\nقائمة الخدمات والأسعار:\n${priceLines}` : "\nقائمة الأسعار: غير متوفرة (حوّل أي سؤال سعر).",
    factLines(facts),
    ...patientLines,
    coaching ? `\nتعليمات صاحب العيادة (التزم بيها حرفياً):\n${coaching.slice(0, 2000)}` : "",
    knowledge.length
      ? `\nإجابات اعتمدها فريق العيادة لأسئلة اتسألت قبل كده (استخدمها لما السؤال يشبهها):\n${knowledge.map((k) => `س: ${k.q.trim().slice(0, 200)}\nج: ${k.a.trim().slice(0, 400)}`).join("\n")}`
      : "",
    playbook ? `\nخلاصة اللي بينجح مع مرضى العيادة دي (اتعلمها من محادثات حقيقية):\n${playbook.slice(0, 2500)}` : "",
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
              enum: ["answer", "open_booking", "handoff_medical", "handoff_complaint", "handoff_staff", "handoff_other"],
              format: "enum",
            },
            reply: { type: SchemaType.STRING },
            interest: { type: SchemaType.STRING },
          },
          required: ["action"],
        },
        // Arabic is token-hungry and the reply travels inside JSON; 1500 leaves margin, and the
        // hard length guard on `reply` below caps what a rambling answer can cost regardless.
        // Gemini 2.5 counts its own thinking against this budget: at 1500 a reply was cut off
        // mid-word ("Unterminated string in JSON") after ~250 characters. Thinking is switched
        // off — a receptionist's reply needs no scratchpad — and the ceiling raised regardless.
        maxOutputTokens: 4096,
        temperature: sales ? 0.35 : 0.3,
        ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
      },
    });

    /*
     * Memory. Sales mode replays the real thread — every voice, including the bot's own menus
     * and a staff member's replies — so the model knows what has already been said and does not
     * quote the price a third time. Assisted mode keeps its cheap three-exchange memory.
     */
    const thread = (args.thread || []).filter((l) => l.text?.trim());
    const contents =
      sales && thread.length
        ? [
            ...thread.slice(-16).map((l) => ({
              role: l.author === "patient" ? ("user" as const) : ("model" as const),
              parts: [{ text: l.author === "patient" ? l.text : JSON.stringify({ action: "answer", reply: l.text.slice(0, 600) }) }],
            })),
            ...(thread[thread.length - 1]?.author === "patient" && thread[thread.length - 1]?.text.trim() === question.trim()
              ? []
              : [{ role: "user" as const, parts: [{ text: question }] }]),
          ]
        : [
            ...history.flatMap((h) => [
              { role: "user" as const, parts: [{ text: h.q }] },
              { role: "model" as const, parts: [{ text: JSON.stringify({ action: "answer", reply: h.a }) }] },
            ]),
            { role: "user" as const, parts: [{ text: question }] },
          ];
    // Gemini requires the first turn to be the user's; a thread that opens with a bot line
    // (a reminder, a template) is trimmed to the first patient message.
    while (contents.length && contents[0].role !== "user") contents.shift();
    if (!contents.length) contents.push({ role: "user" as const, parts: [{ text: question }] });

    /*
     * Every number the model may say. The price list, the clinic's facts, the coaching notes
     * and the hours are the only sources of figures in the prompt, so a figure in the reply that
     * appears in none of them was made up — the live probe quoted braces at 12,000 against a list
     * that says 15,000. One corrective retry, then a person.
     */
    const allowedNumbers = new Set<string>();
    for (const src of [priceLines, factLines(facts), coaching || "", playbook || "", hoursText || "", ...knowledge.map((k) => k.a)]) {
      for (const m of src.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).matchAll(/\d[\d,]*/g)) allowedNumbers.add(m[0].replace(/,/g, ""));
    }
    const strayNumbers = (reply: string): string[] =>
      [...reply.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).matchAll(/\d[\d,]*/g)]
        .map((m) => m[0].replace(/,/g, ""))
        .filter((n) => Number(n) >= 50 && !allowedNumbers.has(n));

    let raw = "";
    let parsed: { action?: string; reply?: string; interest?: string } = {};
    let strays: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await withTimeout(model.generateContent({ contents }), TIMEOUT_MS);
      raw = result.response.text();
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        // A cut-off or malformed JSON: one more try before the fallback ladder.
        parsed = {};
        if (attempt === 0) continue;
        throw new Error("ai_bad_json");
      }
      strays = parsed.action === "answer" || parsed.action === "open_booking" ? strayNumbers(String(parsed.reply || "")) : [];
      if (!strays.length) break;
      if (attempt === 0) {
        contents.push({ role: "model" as const, parts: [{ text: raw }] });
        contents.push({
          role: "user" as const,
          parts: [{ text: `(ملاحظة من النظام: الأرقام دي مش موجودة في قايمة الأسعار ولا في معلومات العيادة: ${strays.join("، ")}. أعد نفس الرد بالأرقام الصحيحة من القايمة فقط، ولو الرقم مش موجود متذكرش رقم خالص.)` }],
        });
      }
    }

    // The flight recorder: one small doc per call, read only by debugging sessions.
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        raw: raw.slice(0, 1000),
        mode: sales ? "sales" : "assisted",
        threadLines: thread.length,
        priceLineCount: priceLines ? priceLines.split("\n").length : 0,
        hoursGiven: Boolean(hoursText?.trim()),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});

    if (strays.length) {
      // Twice wrong: the safe answer is a person, and the flight recorder says why.
      await adminClinicCollection(clinicId, "ai_debug")
        .doc(new Date().toISOString().replace(/[:.]/g, "-") + "-stray")
        .set({ question: question.slice(0, 300), strayNumbers: strays, raw: raw.slice(0, 1000), createdAt: FieldValue.serverTimestamp() })
        .catch(() => {});
      return { kind: "handoff", topic: "other" };
    }

    if (parsed.action === "handoff_medical") return { kind: "handoff", topic: "medical" };
    if (parsed.action === "handoff_complaint") return { kind: "handoff", topic: "complaint" };
    if (parsed.action === "handoff_staff") return { kind: "handoff", topic: "staff" };
    if (parsed.action !== "answer" && parsed.action !== "open_booking") return { kind: "handoff", topic: "other" };

    const text = String(parsed.reply || "").trim().slice(0, 900);
    const openBooking = sales && parsed.action === "open_booking" && args.canBook !== false;
    if (!text && !openBooking) return { kind: "handoff", topic: "other" };

    // Charged only for a delivered answer, after the model produced one. Handoffs cost nothing.
    await usageRef.set(
      { monthKey, creditsUsed: FieldValue.increment(CREDITS_PER_ANSWER), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logAiCreditUsage({
      clinicId,
      feature: sales ? "whatsapp_sales" : "whatsapp_bot",
      credits: CREDITS_PER_ANSWER,
      userId: "whatsapp_bot",
      userName: "WhatsApp Bot",
      detail: question.slice(0, 120),
    }).catch(() => {});

    const interest = String(parsed.interest || "").trim().slice(0, 60) || undefined;
    return { kind: "answer", text: text || "تمام 👍", openBooking, interest };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "model_error";
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        failed: reason,
        mode: sales ? "sales" : "assisted",
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    return { kind: "unavailable", reason };
  }
}
