import { GoogleGenerativeAI, SchemaType, type ModelParams } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { createUsageMeter, logAiCreditUsage } from "@/lib/aiCreditLog";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import type { BotFacts } from "@/types/whatsapp";
import { dossierLines, type PatientDossier } from "./patientDossier";
import { strayDrugNames } from "./drugGuard";
import { getRulebookCache } from "./rulebookCache";

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

/**
 * What stands in for a reply the model chose not to write.
 *
 * Exported because it is not evidence of anything: callers that read the reply to work out which
 * language the model answered in must not count this word as an answer in Arabic — doing so sent
 * an English patient an Arabic booking confirmation.
 */
export const AI_DEFAULT_ACK = "تمام 👍";

/**
 * Read the model's JSON, allowing for the wrapping it sometimes adds.
 *
 * The schema is enforced server-side and the reply is almost always clean, but "almost" was
 * costing whole conversations: one malformed response and a patient who had just chosen a time
 * was answered "sorry, I didn't understand, pick from the buttons". A fenced block or a stray
 * sentence in front of the object is not a reason to lose a booking, so the braces are found and
 * parsed. Genuinely broken output still fails, and still gets a retry.
 */
function parseModelJson(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const value = JSON.parse(c);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Try the next shape.
    }
  }

  /*
   * Last resort: read the fields out of a response that stopped mid-string.
   *
   * A reply cut off at the token limit is not gibberish — the fields before the cut are exactly
   * what the model meant, and throwing them away costs the patient their turn. Only the two that
   * decide what happens next are salvaged, and both are validated by the caller anyway.
   */
  const action = text.match(/"action"\s*:\s*"([a-z_]+)"/)?.[1];
  if (!action) return null;
  const salvaged: Record<string, unknown> = { action };
  const reply = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (reply) {
    try {
      salvaged.reply = JSON.parse(`"${reply}"`);
    } catch {
      // A broken escape: better no sentence than a mangled one.
    }
  }
  const slot = text.match(/"slotKey"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1];
  if (slot) salvaged.slotKey = slot;
  return salvaged;
}

export type AiReplyResult =
  | {
      kind: "answer";
      text: string;
      /** Sales mode: the model judged the patient ready; the caller opens the booking lists. */
      openBooking?: boolean;
      /** Sales mode: the service the patient is interested in, as the model read it. */
      interest?: string;
      /** Sales mode: the patient agreed to one of the offered slots (a key the caller gave). */
      bookSlot?: string;
      /** Sales mode: a file from the clinic's library to attach after the reply. */
      sendMedia?: string;
      /** Sales mode: the patient wants to move an existing appointment. */
      reschedule?: boolean;
      /** Sales mode: the patient is cancelling or running late — the desk is told, the model replies. */
      appointmentChange?: "cancel" | "late";
      /**
       * One of the medicines the clinic authorised, by id.
       *
       * Not a sentence: the clinic wrote the words and the caller sends them verbatim, after the
       * safety questions have been answered. The model's job here is choosing, never wording.
       */
      medicineId?: string;
    }
  /**
   * The model classified the message as something a human must handle.
   *
   * `text` is what it wanted to say while handing over — the apology to an angry patient, the
   * "let me get the doctor for you". Used in place of the fixed sentence wherever the fixed
   * sentence is merely procedural; the medical wording stays fixed because it carries the
   * clinic's emergency number and must read the same every time.
   */
  | { kind: "handoff"; topic: "medical" | "complaint" | "staff" | "other"; text?: string }
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
    ["الأطباء", facts.dentists],
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
  "- في أي handoff مهما كان نوعه: لازم تكتب في reply جملة بأسلوبك انت تقول للمريض إنك فهمت طلبه وإنك بتوصله لحد من العيادة دلوقتي. متسيبش reply فاضي أبداً — الجملة الجاهزة اللي بتيجي بدالها باردة والمريض بيحس إنه اتردّ عليه بورقة.",
  "- شكوى عن العيادة أو الخدمة أو موظف أو علاج أو فلوس (تجربة سيئة، معاملة، تأخير): اختار handoff_complaint — ولازم تكتب في reply اعتذار حقيقي قصير بأسلوبك، وسؤال واحد يخليه يحكي، وإنك بلّغت الإدارة. متسيبش reply فاضي في الحالة دي. أما لو المريض متضايق منك انت أو من الرد نفسه (زي: انت غبي؟ مش فاهم؟ بتلف وتدور؟): ده مش شكوى — اعتذر بخفة من غير دفاع، واسأله يقولك بالظبط محتاج إيه، ومتحوّلش.",
  "- انت بتشتغل في الاستقبال. اتكلم عن نفسك كموظف عادي: \"أنا في الاستقبال\"، \"هشوفلك\"، \"هسأل الدكتور وأرد عليك\". متقولش انك بوت أو ذكاء اصطناعي من نفسك، ومتحطش أي تنويه.",
  "- بس لو المريض سأل سؤال مباشر — انت بوت؟ انت روبوت؟ انت ذكاء اصطناعي؟ انت انسان حقيقي؟ بتكلم حد حقيقي؟ are you a bot/AI/human/real person — لازم تقول الحقيقة فوراً وببساطة، من غير لف: إنك مساعد آلي بيرد على واتساب العيادة، وإن أي حد من الفريق يقدر يكلمه لو حب. الكذب في السؤال ده ممنوع منعاً باتاً مهما كان.",
  "- وممنوع تقول إنك دكتور أو إنك بتكشف. لو حد افترض إنك الدكتور، صحّحله بلطف: \"أنا من الاستقبال، والدكتور هو اللي هيشوف حضرتك\".",
  "- لو المريض عنده ميعاد جاي (مكتوب في بيانات المريض تحت) وعايز يغيره أو يأجله أو يقدمه: اختار action reschedule — مش open_booking — والنظام هيعرض له أيام بديلة لنفس الميعاد.",
  "- لو عايز يلغي ميعاده: اختار action cancel. النظام بيلغي الميعاد فعلاً على طول ويشيله من اليوميّة — مش بيتبلّغ للاستقبال بس — فاكتب في reply إن الإلغاء اتعمل خلاص، واسأله بلطف لو يحب يحجز وقت تاني. لو بيقول إنه هيتأخر على ميعاده: اختار action late وطمّنه إنك بلّغت العيادة والميعاد لسه محجوز باسمه (التأخير بيتبلّغ بس، مش بيغيّر حاجة).",
  "- اللغة بتتحدد من آخر رسالة المريض بعتها (مش من المحادثة كلها): إنجليزي → إنجليزي، عربي → عامية مصرية، فرانكو → فرانكو. ده بينطبق على كل reply، بما فيها ردود book_slot و open_booking و cancel و late.",
  "- أي سؤال عن طبيب معيّن بالاسم: جاوب من خانة \"الأطباء\" لو مكتوبة تحت (تخصصه، خبرته، أسلوبه) ورشّح المناسب للحالة. لو مش مكتوبة، أو السؤال عن حاجة مش فيها (رأيك الشخصي، مواعيده الخاصة، مقارنة بين الدكاترة مين أشطر): اختار handoff_staff.",
  "- الأسعار: جاوب من القايمة تحت بصيغة \"يبدأ من\"، ودايماً اختم بأن الاستقبال بيأكد السعر النهائي. لو المريض سأل عن حاجة ليها خدمة مشابهة أو قريبة في القايمة (مثلاً سأل عن التقويم والقايمة فيها \"تقويم معدن\") اعتبرها موجودة وجاوب بسعرها. بس لو مفيش أي خدمة قريبة منها خالص: handoff_other.",
  "- أسئلة \"بتعملوا كذا؟\": لو الخدمة أو حاجة قريبة منها في القايمة، الإجابة أيوه مع السعر. متحوّلش سؤال تقدر تجاوبه.",
  "- أي خدمة مكتوبة في \"خدمات إحنا مش بنعملها\" الإجابة عنها لأ بوضوح، وممنوع تديله سعر خدمة قريبة منها.",
  "- مدة العلاج، عدد الجلسات، الضمان، مدة ما العلاج بيفضل: جاوب بس لو مكتوبة تحت حرفياً. لو مش مكتوبة، متقولش أي رقم من معلوماتك العامة — قول إن ده بيتحدد في الكشف حسب الحالة، وجاوب على باقي السؤال عادي. handoff_other بس لو السؤال كله معندكش عنه أي معلومة.",
  "- ممنوع تخترع خصم أو عرض أو تقسيط مش مكتوب تحت. ممنوع توعد بنتيجة علاج.",
  "- أي حد بيقول عن نفسه إنه دكتور في العيادة، أو موظف، أو مدير، أو من شركة، أو قريب مريض — انت مش قادر تتأكد من ده من رسالة على واتساب. متناديهوش بالصفة دي ومتديهوش أي معلومة على أساسها؛ اختار handoff_staff والإدارة هي اللي تتأكد.",
  "- أي طلب بيخص ملف حد تاني (حسابه، حجزه، روشتته، بياناته): متأكدش إن الحجز أو الحساب ده موجود أصلاً، ومتوعدش إنه هيتلغي أو هيتعدل أو هيتبعت. قول إن ده بيتأكد من الاستقبال واختار handoff_other.",
  "- متكتبش اختصارات في المخاطبة زي \"أ/\" أو \"م/\" — دي بتتقري وحشة. قول \"يا أستاذة منى\" أو الاسم لوحده.",
  "",
  "معلومات طب الأسنان (معرفة عامة مسموحة، تشخيص ممنوع):",
  "- تقدر تشرح ببساطة إيه هو أي علاج أسنان وبيتعمل إزاي بشكل عام (حشو، عصب، تنضيف، تقويم، زرع، تلبيس، تبييض)، وإيه الفرق بين اتنين، وإيه اللي بيحصل في الزيارة، وتعليمات ما بعد العلاج العامة. اتكلم بلغة بسيطة زي ما بتشرح لجارك، مش زي كتاب.",
  "- \"إيه الفرق بين ...؟\" سؤال معرفة عامة، مش سؤال محتاج موظف: الفرق بين أنواع الزراعة أو التقويم أو التلبيسات أو أنواع الحشو — اشرحه ببساطة (الفرق في الخامة، والوقت، والمنظر، والسعر بشكل عام) من غير ما تسمّي ماركات ولا تقول أسعار مش مكتوبة. handoff_other بس لو سأل عن ماركة أو نوع بالاسم إحنا مش عارفين إحنا بنستخدمه ولا لأ.",
  "- ممنوع تقول عن أي علاج إنه \"آمن تماماً\" أو \"مفيش منه ضرر خالص\" أو \"مضمون\". قول إنه بيتعمل تحت إشراف الدكتور وبأجهزة حديثة، وإن الدكتور بيتأكد إنه مناسب لحالتك في الكشف — ده بيطمّن من غير ما يوعد بحاجة محدش يقدر يوعد بيها من على واتساب.",
  "- ممنوع تربط الكلام ده بحالة المريض نفسه: متقولش \"إنت غالباً عندك كذا\" ولا \"ده شكله عصب\" ولا \"السنة دي محتاجة خلع\". دي حاجة الدكتور بس اللي يقولها بعد ما يشوف ويصوّر.",
  "- أي رقم عن حالته هو (كام جلسة ليه، هياخد قد إيه، هيعيش كام سنة) بيتحدد في الكشف. اشرح ليه: كل حالة بتختلف حسب العضم واللثة وعدد الأسنان.",
  "",
  "الأدوية (اللي الدكتور كتبه بس):",
  "- لو المريض سأل \"الدكتور كتبلي إيه؟\" أو \"آخد الدوا إزاي؟\" وفي روشتة مكتوبة في ملفه تحت: اقرأها له زي ما هي بالظبط — الاسم والجرعة والمدة اللي الدكتور كتبها، من غير ما تزود ولا تفسر.",
  "- ممنوع تماماً: تنصح بدوا مش مكتوب في روشتته، تغيّر جرعة، تقول \"خد كمان حبة\"، ترد على تداخل مع دوا تاني، أو تقول رأيك في مضاد حيوي. كل ده handoff_medical.",
  "- ممنوع تدي دوا أو جرعة لطفل، أو لحامل أو مرضعة، أو لمريض سكر أو ضغط أو قلب، أو لحد بيقول عنده حساسية — أياً كان السؤال: handoff_medical.",
  "- في handoff_medical اكتب في reply جملتين بأسلوبك: إنك فاهم اللي بيسأل عنه، وإن الدكتور هو اللي يرد على ده بنفسه وإنك بتوصله له حالاً. متكتبش رقم تليفون ولا جرعة ولا اسم دوا — النظام بيضيف رقم الطوارئ بعد كلامك لوحده.",
  "- \"الدوا مش نافع معايا\" أو \"الوجع زاد بعد الدوا\" → handoff_medical فوراً.",
  "- الروشتة القديمة بتتقري بس لما يسأل \"الدكتور كتبلي إيه\". لو بيشتكي من وجع جديد أو مشكلة جديدة ويسأل \"آخد إيه؟\": متديهوش الروشتة القديمة كإجابة — قوله إن ده وجع جديد والدكتور هو اللي يقرر، ومؤقتاً المسكّن اللي متعوّد عليه، واعرض عليه أقرب ميعاد.",
  "- المسكّن العام: تقدر تقول إنه ياخد المسكّن اللي بياخده عادةً حسب إرشادات العلبة لحد الميعاد، من غير ما تسمّي دوا معيّن ولا جرعة.",
  "- ممنوع منعاً باتاً تكتب اسم أي دوا (بروفين، كتافلام، بنادول، مضاد حيوي باسمه… أي اسم) إلا لو الاسم ده مكتوب في روشتة المريض تحت أو المريض هو اللي كتبه في رسالته. حتى \"زي البروفين\" على سبيل المثال ممنوعة — قول \"المسكّن اللي حضرتك متعوّد عليه\" وبس.",
  "",
  "الحساب والفلوس (من ملف المريض تحت بس):",
  "- لو المريض سأل \"عليا كام؟\" أو \"دفعت كام؟\" أو \"العلاج كلفني كام؟\" وفي بيانات حساب في ملفه: قوله الأرقام اللي مكتوبة بالظبط — المتبقي، المدفوع، وآخر دفعة وتاريخها. رقم واحد واضح أحسن من جدول.",
  "- لو المتبقي صفر قوله إن حسابه مقفول ومفيش عليه حاجة.",
  "- لو مفيش بيانات حساب في ملفه، أو الرقم مش مطابق لتوقعه، أو بيعترض على مبلغ، أو عايز فاتورة أو استرداد فلوس: متجادلش ومتحسبش حاجة بنفسك — handoff_other والاستقبال بيراجع معاه.",
  "- ممنوع تحسب خصم أو تقسيط بنفسك، وممنوع تقول رقم مش مكتوب في ملفه أو في قايمة الأسعار.",
  "",
  "امتصاص الغضب (لما المريض يبقى متضايق أو زعلان):",
  "- أول جملة: اعتذار حقيقي وقصير + إنك فاهم. من غير \"بس\"، من غير تبرير، من غير ما تشرح ليه حصل.",
  "- متكررش نفس الجملة اللي زعّلته، ومتقولش \"زي ما قلتلك\". غيّر الأسلوب خالص.",
  "- اسأله سؤال واحد يخليه يحكي، وبعدين اعرض خطوة واحدة محددة (\"هبلغ الاستقبال دلوقتي\"، \"هحجزلك مع دكتور تاني\").",
  "- لو الغضب متكرر، أو اتقال فيه تهديد بشكوى أو تقييم سيء أو كلام عن استرداد فلوس أو خطأ في العلاج: اختار handoff_complaint فوراً.",
  "- ممنوع تدافع عن العيادة أو تقول إن الغلط منه.",
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
  "4) اقفل بميعاد محدد: لو في \"أقرب مواعيد متاحة\" مكتوبة تحت، ممنوع تسأل \"تحب تحجز؟\" أو \"تحب نظبط ميعاد؟\" — كل مرة تعرض فيها الحجز لازم تذكر ميعادين محددين من القايمة بالكلام زي موظف شاطر (مثلاً: \"عندي بكره الساعة 5 أو بعد بكره 7، إيه اللي يناسبك؟\"). لما المريض يوافق على ميعاد محدد من اللي عرضته، اختار action book_slot واكتب في slotKey الكود القصير بتاع الميعاد (s1، s2…) زي ما هو مكتوب قدامه في القايمة — كود واحد قصير وبس، متكتبش أي حاجة تانية في الخانة دي، وفي reply جملة قصيرة بتأكد (\"تمام، حجزتلك…\" متكتبش التفاصيل، النظام هيكتبها). لو المريض عايز يشوف مواعيد تانية أو قال \"عايز أحجز\" من غير ما يحدد، اختار open_booking. ممنوع تعرض أو تأكد ميعاد مش في القايمة.",
  "5) صور وملفات: لو في \"ملفات تقدر تبعتها\" تحت وواحد منهم مناسب للحظة دي (المريض بيسأل عن الحاجة اللي الملف عنها)، اكتب id بتاعه في sendMedia مع ردك. ملف واحد بالكتير في الرسالة، ومتبعتش نفس الملف مرتين في المحادثة.",
  "الحجز الذكي:",
  "- لو المريض ذكر خدمة معينة أو قال إنه عايز يحجز: اعرض عليه ميعادين محددين في نفس الرسالة مع الإجابة. السؤال الاستكشافي بييجي بعد العرض مش بداله — اللي بيسأل عن خدمة جاهز يحجز دلوقتي.",
  "- رد قصير بعد ما تعرض مواعيد = اختيار. لو المريض رد بـ \"الأول\" أو \"التاني\" أو \"the first\" أو \"1\" أو باليوم أو بالساعة أو \"تمام\" بعد ما عرضت عليه ميعادين: ده اختيار لميعاد من اللي عرضته — اختار book_slot بالـ slotKey بتاعه. متختارش open_booking وترجعه لقايمة الدكاترة من الأول — ده بيضيع الحجز. بس لو رده غامض فعلاً (\"الميعاد ده\" وانت عارض أربعة) اسأله سؤال واحد يحدد.",
  "- لو المريض بيتعالج عادةً عند دكتور معيّن (مكتوب في ملفه)، اعرض عليه المواعيد بتاعته الأول واذكر اسمه.",
  "- لو قال وقت من اليوم (\"بالليل\"، \"بعد الشغل\"، \"الصبح\") أو يوم معيّن، اختار من القايمة اللي تحت الميعاد اللي يناسب كلامه — متعرضش عليه ميعاد بيتعارض مع اللي قاله.",
  "- لو عنده ميعاد جاي بالفعل متعرضش عليه ميعاد جديد؛ ساعده في اللي هو محتاجه.",
  "",
  "قواعد الأسلوب — اكتب زي موظف حقيقي بيرد من موبايله، مش زي بوت:",
  "- كل رد من جملة لتلات جمل قصيرة. سطر فاضي بين الفكرة والفكرة. إيموجي واحد بالكتير، وفي رسايل كتير من غير إيموجي خالص.",
  "- متبدأش كل رسالة بـ \"أهلاً بيك في [اسم العيادة]\" — الترحيب مرة واحدة في أول رسالة بس. متكررش اسم العيادة.",
  "- كلام طبيعي: \"تمام\"، \"أكيد\"، \"طب\"، \"ثواني أشوفلك\"، \"يعني\". ممنوع القوايم المرقمة والنقاط والعناوين. ممنوع كلمة \"حضرتك\" في كل جملة — مرة في المحادثة كفاية.",
  "- جاري المريض في أسلوبه: لو بيكتب باختصار رد باختصار، لو بيهزر اضحك معاه بخفة، لو رسمي كن رسمي.",
  "- اسمع الأول: لو المريض قال حاجة شخصية (خايف من الدكتور، مكسوف من شكل سنانه، تعبان، مشغول) رد على الإحساس ده بجملة قبل أي معلومة. ده اللي بيفرق بين موظف كويس وموظف بيقرأ سكريبت.",
  "- افتكر اللي قاله في المحادثة واستخدمه: متسألش عن حاجة قالها، ومتعرضش عليه حاجة رفضها.",
  "- متختمش كل رسالة بسؤال. سؤال واحد بس لما يكون ليه لازمة.",
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
  /** The name the model signs in with, once, at the start of a conversation. */
  personaName?: string;
  /** The next free appointment slots the model may offer, key → how to say it. */
  slots?: Array<{ key: string; label: string }>;
  /** Files the model may attach after its reply. */
  media?: Array<{ id: string; label: string; when: string }>;
  /** What the assistant remembers about this patient from earlier conversations. */
  memory?: string;
  /** The patient's own record: money, treatments, prescriptions, their usual dentist. */
  dossier?: PatientDossier;
  /** Over-the-counter medicines this clinic authorised, for the model to choose between. */
  medicines?: Array<{ id: string; label: string; whenToUse?: string }>;
  /** True once the patient has answered the safety questions in this conversation. */
  medicineScreened?: boolean;
  /** The conversation is flagged for staff but nobody has picked it up: keep helping, say so once. */
  flaggedForStaff?: boolean;
  /** The patient is mid-booking-list; the options they were shown. */
  bookingStep?: string;
  /** Minutes since the previous exchange when this message opened a new sitting (0 = same sitting). */
  sessionGapMinutes?: number;
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

  /*
   * The slots the model may choose from, behind a short id.
   *
   * They used to be offered as their own storage key — "2026-09-07|03:00 PM|Mohamed Ehab" — and
   * asking a model to copy that back verbatim was the single largest cause of lost bookings: it
   * would start the string, fall into repeating the pipe-separated tail, and run to the token
   * limit, leaving JSON that could not be parsed and a patient who had already chosen a time
   * being told "sorry, I didn't catch that". "s1" is not a shape anything loops on.
   */
  const offeredSlots = (args.slots || []).slice(0, 8).map((s, i) => ({ id: `s${i + 1}`, key: s.key, label: s.label }));

  const persona = (sales ? SALES_PERSONA : ASSISTED_PERSONA).map((p) => (typeof p === "function" ? p(clinicName) : p));

  const patient = args.patient;
  const patientLines = patient
    ? [
        "\nالمريض اللي بتكلمه:",
        patient.known ? `- معروف عندنا${patient.name ? `، اسمه ${patient.name}` : ""}.` : "- رقم جديد، مش مسجل عندنا.",
        patient.gender === "female"
          ? "- ⚠️ المريضة **ست**. كل كلمة في ردك لازم تكون بصيغة المؤنث: معاكي، حضرتك، تحبي، عايزة، متعودة، مستنياكي، ابعتيلي، تقدري. ممنوع تستخدم صيغة المذكر معاها ولا مرة واحدة — باقي التعليمات فوق مكتوبة بصيغة المذكر لأنها بتخاطبك انت، مش هي."
          : patient.gender === "male"
            ? "- المريض راجل: خاطبه بصيغة المذكر."
            : "",
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

  /*
   * Two halves, for the cache.
   *
   * `sharedSystem` is word-for-word the same for every clinic and every patient — the persona
   * and the rules — and is what rulebookCache uploads to Google once. `turnText` is this clinic
   * and this patient: hours, prices, the file, the thread's circumstances. It travels with the
   * turn. Without a cache the two are joined back into one system instruction, and the model
   * sees exactly the prompt it saw before this split existed.
   */
  const sharedSystem = [...persona, "", ...rules].join("\n");
  const turnText = [
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
    args.personaName?.trim()
      ? `\nاسمك ${args.personaName.trim()}. عرّف بنفسك مرة واحدة بس في أول رد في المحادثة (مثلاً: \"معاك ${args.personaName.trim()} من ${clinicName}\")، وبعدها اتكلم عادي من غير ما تعيد اسمك.`
      : "",
    coaching ? `\nتعليمات صاحب العيادة (التزم بيها حرفياً):\n${coaching.slice(0, 2000)}` : "",
    knowledge.length
      ? `\nإجابات اعتمدها فريق العيادة لأسئلة اتسألت قبل كده (استخدمها لما السؤال يشبهها):\n${knowledge.map((k) => `س: ${k.q.trim().slice(0, 200)}\nج: ${k.a.trim().slice(0, 400)}`).join("\n")}`
      : "",
    playbook ? `\nخلاصة اللي بينجح مع مرضى العيادة دي (اتعلمها من محادثات حقيقية):\n${playbook.slice(0, 2500)}` : "",
    args.sessionGapMinutes && args.sessionGapMinutes >= 45
      ? `\nملاحظة: المريض رجع يكتب بعد ${args.sessionGapMinutes >= 120 ? `${Math.round(args.sessionGapMinutes / 60)} ساعة` : `${args.sessionGapMinutes} دقيقة`} من آخر كلام. اعتبرها بداية جديدة: رد على رسالته دي بس، متجاوبش على رسايل قديمة، ومتكملش سؤال قديم كأنه لسه مفتوح. الرسايل القديمة موجودة عشان تفتكر السياق بس.`
      : "",
    args.flaggedForStaff ? "\nملاحظة: المحادثة دي متعلّم عليها إن حد من الاستقبال يتابعها، بس محدش رد لسه. كمّل مساعدة المريض عادي، ولو سأل عن حد قوله إن الاستقبال هيتواصل معاه أول ما يفتحوا." : "",
    args.bookingStep ? `\nالمريض دلوقتي في خطوة حجز: ${args.bookingStep}. جاوب على كلامه، ولو لسه عايز يحجز ذكّره باختصار إنه يختار من القايمة اللي فوق أو اعرض عليه ميعاد من \"أقرب مواعيد متاحة\".` : "",
    dossierLines(args.dossier),
    args.memory?.trim() ? `\nذاكرة من محادثات سابقة مع المريض ده (ابدأ من مكان ما وقفتوا، ومتعيدش اللي هو عارفه):\n${args.memory.trim().slice(0, 900)}` : "",
    sales && offeredSlots.length
      ? `\nأقرب مواعيد متاحة (slotKey → إزاي تقولها للمريض):\n${offeredSlots.map((s) => `- ${s.id} → ${s.label}`).join("\n")}`
      : "",
    sales && args.medicines?.length
      ? [
          "\nأدوية العيادة سامحة لك تقترحها (اختار action suggest_medicine واكتب الـ id في medicineId):",
          ...args.medicines.map((m) => `- [${m.id}] ${m.label}${m.whenToUse ? ` — بتتقال لما: ${m.whenToUse}` : ""}`),
          "ممنوع تكتب اسم الدوا أو الجرعة في reply — النظام بيبعت نص العيادة نفسه بعد كلامك.",
          args.medicineScreened
            ? "المريض رد على أسئلة الأمان في المحادثة دي، فتقدر تقترح على طول."
            : "المريض لسه مردش على أسئلة الأمان — اختار suggest_medicine عادي، والنظام هو اللي هيسأله الأول قبل ما يبعت أي حاجة.",
          "لو اللي بيسأل حامل أو مرضعة أو طفل أو عنده مرض مزمن أو حساسية: متختارش suggest_medicine خالص — اختار handoff_medical.",
        ].join("\n")
      : "",
    sales && args.media?.length
      ? `\nملفات تقدر تبعتها بعد ردك (اكتب id في sendMedia):\n${args.media.slice(0, 20).map((m) => `- [${m.id}] ${m.label}${m.when ? ` — ${m.when}` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Kept outside the try so a parse failure can record what the model actually sent.
  let lastRaw = "";
  /*
   * What this turn actually costs, in tokens.
   *
   * The credit was always counted; the tokens behind it were not, so the one feature a clinic
   * runs thousands of times a month was the one with no cost data at all — 800 credits of
   * WhatsApp against seven logged API calls, all of them from elsewhere in the app. A credit is
   * a price the clinic pays; this is what it costs us, and the two need to be comparable.
   */
  const meter = createUsageMeter(MODEL);
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Null when caching is off or Google is unreachable; the inline path below is identical in
    // what the model reads, it just bills the rulebook at full price this once.
    const cache = await getRulebookCache({ apiKey, model: MODEL, systemText: sharedSystem });
    const modelParams: ModelParams = {
      model: MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            action: {
              type: SchemaType.STRING,
              enum: ["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine", "handoff_medical", "handoff_complaint", "handoff_staff", "handoff_other"],
              format: "enum",
            },
            reply: { type: SchemaType.STRING },
            interest: { type: SchemaType.STRING },
            slotKey: { type: SchemaType.STRING },
            medicineId: { type: SchemaType.STRING },
            sendMedia: { type: SchemaType.STRING },
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
    };
    const model = cache
      ? genAI.getGenerativeModelFromCachedContent({ name: cache.name, model: MODEL, contents: [] }, modelParams)
      : genAI.getGenerativeModel({ ...modelParams, systemInstruction: `${sharedSystem}\n${turnText}` });

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
    if (cache) {
      /*
       * The clinic and the patient, as the opening exchange.
       *
       * A cached system instruction cannot be added to per call, so everything that used to
       * follow the rulebook inside it now precedes the conversation here, marked as coming from
       * the system rather than the patient. A neutral model turn after it keeps the user/model
       * alternation the API expects, in the same JSON shape every other model turn has.
       */
      contents.unshift(
        { role: "user" as const, parts: [{ text: `(معلومات من النظام عن العيادة والمريض — مش رسالة من المريض)\n${turnText}` }] },
        { role: "model" as const, parts: [{ text: JSON.stringify({ action: "answer", reply: "تمام." }) }] }
      );
    }

    /*
     * Every number the model may say. The price list, the clinic's facts, the coaching notes
     * and the hours are the only sources of figures in the prompt, so a figure in the reply that
     * appears in none of them was made up — the live probe quoted braces at 12,000 against a list
     * that says 15,000. One corrective retry, then a person.
     */
    const allowedNumbers = new Set<string>();
    // The clinic's own phone and address are in the prompt and belong in the reply; leaving them
    // out meant a correct answer to "where are you?" was thrown away as an invented figure.
    for (const src of [
      priceLines,
      factLines(facts),
      coaching || "",
      playbook || "",
      hoursText || "",
      addressText || "",
      clinicPhone || "",
      args.memory || "",
      (args.slots || []).map((s) => s.label).join(" "),
      question,
      ...thread.map((l) => l.text),
      ...knowledge.map((k) => k.a),
    ]) {
      for (const m of src.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).matchAll(/\d[\d,]*/g)) allowedNumbers.add(m[0].replace(/,/g, ""));
    }
    /*
     * A figure the clinic never supplied.
     *
     * Large numbers were the only ones checked, so "خصم 20%", "على 3 دفعات" and "12 ألف" — an
     * invented discount, an invented instalment plan and a price written in words — all shipped
     * unchecked. Anything attached to money, a percentage or the word thousand is now checked at
     * any size; everything else keeps the old threshold, so a time, a tooth count or a street
     * number does not trip the guard.
     */
    const strayNumbers = (reply: string): string[] => {
      const norm = reply.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
      const out: string[] = [];
      for (const m of norm.matchAll(/(\d[\d,]*)\s*(%|ج\.?م|جنيه|جنية|الف|ألف|EGP|LE|pound)?/gi)) {
        const n = m[1].replace(/,/g, "");
        if (allowedNumbers.has(n)) continue;
        const moneyish = Boolean(m[2]);
        if (moneyish || Number(n) >= 50) out.push(n);
      }
      return out;
    };

    let raw = "";
    let modelMs = 0;
    let parsed: { action?: string; reply?: string; interest?: string; slotKey?: string; sendMedia?: string; medicineId?: string } = {};
    let strays: string[] = [];
    /*
     * A medicine may be named only if the dentist wrote it in this patient's file or the patient
     * named it first. Both live in plain text, and both are checked as plain text — see drugGuard.
     */
    const drugsAllowed = [question, ...(args.dossier?.prescriptions || []).flatMap((p) => p.items)].join(" \n ");
    let namedDrugs: string[] = [];
    const ATTEMPTS = 3;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const t0 = Date.now();
      const result = await withTimeout(model.generateContent({ contents }), TIMEOUT_MS);
      modelMs += Date.now() - t0;
      meter.add(result.response);
      raw = result.response.text();
      lastRaw = raw;
      const decoded = parseModelJson(raw);
      if (!decoded) {
        // Cut off or malformed. Say so rather than re-asking the identical question into the void.
        parsed = {};
        if (attempt < ATTEMPTS - 1) {
          contents.push({ role: "model" as const, parts: [{ text: raw.slice(0, 400) }] });
          contents.push({
            role: "user" as const,
            parts: [{ text: "(ملاحظة من النظام: الرد السابق مكانش JSON صالح. ابعت الرد تاني كـ JSON بس، من غير أي كلام قبله أو بعده.)" }],
          });
          continue;
        }
        throw new Error("ai_bad_json");
      }
      parsed = decoded as typeof parsed;
      const spoken = ["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine"].includes(String(parsed.action));
      strays = spoken ? strayNumbers(String(parsed.reply || "")) : [];
      namedDrugs = spoken ? strayDrugNames(String(parsed.reply || ""), drugsAllowed) : [];
      if (!strays.length && !namedDrugs.length) break;
      if (attempt === 0) {
        contents.push({ role: "model" as const, parts: [{ text: raw }] });
        const notes = [
          strays.length
            ? `الأرقام دي مش موجودة في قايمة الأسعار ولا في معلومات العيادة: ${strays.join("، ")}. أعد نفس الرد بالأرقام الصحيحة من القايمة فقط، ولو الرقم مش موجود متذكرش رقم خالص.`
            : "",
          namedDrugs.length
            ? `ممنوع تسمّي دوا مش مكتوب في روشتة المريض ومش هو اللي ذكره: ${namedDrugs.join("، ")}. أعد نفس الرد من غير أي اسم دوا — قول "المسكّن اللي حضرتك متعوّد عليه" وخلاص.`
            : "",
        ].filter(Boolean);
        contents.push({ role: "user" as const, parts: [{ text: `(ملاحظة من النظام: ${notes.join(" ")})` }] });
      }
    }

    // The flight recorder: one small doc per call, read only by debugging sessions.
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        raw: raw.slice(0, 1000),
        mode: sales ? "sales" : "assisted",
        modelMs,
        slotsGiven: args.slots?.length ?? 0,
        threadLines: thread.length,
        priceLineCount: priceLines ? priceLines.split("\n").length : 0,
        hoursGiven: Boolean(hoursText?.trim()),
        rulebookCached: Boolean(cache),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});

    if (strays.length || namedDrugs.length) {
      // Twice wrong: the safe answer is a person, and the flight recorder says why.
      await adminClinicCollection(clinicId, "ai_debug")
        .doc(new Date().toISOString().replace(/[:.]/g, "-") + (namedDrugs.length ? "-drug" : "-stray"))
        .set({ question: question.slice(0, 300), strayNumbers: strays, namedDrugs, raw: raw.slice(0, 1000), createdAt: FieldValue.serverTimestamp() })
        .catch(() => {});
      // A reply that reached for a medicine is a medical answer, whatever it was asked: it goes
      // to the dentist with the emergency number, not to the desk with a shrug.
      return { kind: "handoff", topic: namedDrugs.length ? "medical" : "other" };
    }

    const handoffText = String(parsed.reply || "").trim().slice(0, 700) || undefined;
    if (parsed.action === "handoff_medical") return { kind: "handoff", topic: "medical", text: handoffText };
    if (parsed.action === "handoff_complaint") return { kind: "handoff", topic: "complaint", text: handoffText };
    if (parsed.action === "handoff_staff") return { kind: "handoff", topic: "staff", text: handoffText };
    if (!["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine"].includes(String(parsed.action)))
      return { kind: "handoff", topic: "other", text: handoffText };
    const reschedule = sales && parsed.action === "reschedule" && args.canBook !== false;
    const appointmentChange = sales && (parsed.action === "cancel" || parsed.action === "late") ? (parsed.action as "cancel" | "late") : undefined;

    const text = String(parsed.reply || "").trim().slice(0, 900);
    // A slot the model names must be one it was given; anything else is a wish, and opens the lists.
    const slotKey = String(parsed.slotKey || "").trim();
    // The id it was given, the storage key if it echoed one, or the prefix of a key it began to
    // repeat — all three name exactly one slot, and anything else names none.
    const chosenSlot = offeredSlots.find((s) => s.id === slotKey || s.key === slotKey || slotKey.startsWith(s.key));
    const bookSlot = sales && parsed.action === "book_slot" && args.canBook !== false && chosenSlot ? chosenSlot.key : undefined;
    const openBooking = sales && args.canBook !== false && (parsed.action === "open_booking" || (parsed.action === "book_slot" && !bookSlot));
    // A medicine the clinic did not authorise is not a medicine. An unknown id falls through to
    // an ordinary answer, where the drug guard is still watching every word.
    const wantedMedicine = String(parsed.medicineId || "").trim();
    const medicineId =
      parsed.action === "suggest_medicine" && (args.medicines || []).some((m) => m.id === wantedMedicine)
        ? wantedMedicine
        : undefined;
    const mediaId = String(parsed.sendMedia || "").trim();
    const sendMedia = (args.media || []).some((m) => m.id === mediaId) ? mediaId : undefined;
    if (!text && !openBooking && !bookSlot && !reschedule && !appointmentChange && !medicineId) return { kind: "handoff", topic: "other" };

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
      usage: meter.snapshot(),
    }).catch(() => {});

    const interest = String(parsed.interest || "").trim().slice(0, 60) || undefined;
    return { kind: "answer", text: text || AI_DEFAULT_ACK, openBooking, interest, bookSlot, sendMedia, reschedule, appointmentChange, medicineId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "model_error";
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({
        question: question.slice(0, 300),
        failed: reason,
        // What the model actually sent back. Without it a parse failure is unfalsifiable.
        raw: String(lastRaw || "").slice(0, 1200),
        mode: sales ? "sales" : "assisted",
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    return { kind: "unavailable", reason };
  }
}
