import { normalizeReplyText } from "@/lib/patientMessaging";

/**
 * What a patient meant, when the buttons were not tapped.
 *
 * The assistant used to have exactly two free doors: a tapped button and a typed digit. Everything
 * else — every greeting, every thank-you, every "where are you", every "I want to book" typed as
 * words — fell through to the AI, which costs a credit and is capped at three answers per
 * conversation. So a patient who opened the way Egyptians actually open ("لو سمحت" … "ازيك" … then
 * the real question) spent two thirds of the budget on courtesy and hit the give-up ladder with
 * their actual question. That is measured, not theoretical: the live test conversation spent one
 * of its three answers on the word "Hello".
 *
 * This layer sits between the digits and the model. Everything it recognises is answered from data
 * the clinic already has, for free, instantly — which leaves the paid path for the questions that
 * genuinely need judgement. It is a deliberately dumb keyword matcher, and that is the point: it
 * must never be the reason a message is misread, so anything it is not sure about it declines and
 * passes on down the chain.
 */

export type QuickIntent =
  /** "I want to talk to a person." Escapes every state, including a stuck booking loop. */
  | "human"
  /** Cancelling. Time-critical and currently thrown away. */
  | "cancel"
  /** Moving an appointment. */
  | "reschedule"
  /** Running late — a message with a fifteen-minute shelf life. */
  | "late"
  /** A question about an appointment they already have. */
  | "my_appointment"
  /** Wants to book. */
  | "booking"
  /** "Are you open right now" — needs the clock, not just the hours. */
  | "open_now"
  /** Opening hours. */
  | "hours"
  /** Where the clinic is. */
  | "location"
  /** Wants the price list, with no service named. */
  | "price_list"
  /*
   * The questions no part of the system stored an answer to, until the clinic wrote one.
   *
   * Each of these reached a receptionist every single time — or reached the model, which had no
   * data and either handed off after charging a credit or answered from general dentistry
   * knowledge in the clinic's voice. With the matching fact filled in they are free and instant;
   * with it empty they still hand off, so an unconfigured clinic is no worse off than before.
   */
  | "walk_in"
  | "installments"
  | "offers"
  | "parking"
  | "insurance"
  | "duration"
  | "aftercare"
  /** "OK", "sure", a thumbs-up. Confirmation of something the clinic said. */
  | "ack"
  /** Thanks, praise, a closing. */
  | "thanks"
  /** A bare greeting with no question attached. */
  | "greeting";

function normalize(raw: string): string {
  return normalizeReplyText(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[:؛;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whole-word or whole-phrase containment, with a leading و split off so `وعايز` still matches.
 *
 * Both sides go through the same normaliser. That is not a detail: the normaliser folds ى→ي and
 * ة→ه, so a keyword written the correct way — `على مرات` — could never match the folded text
 * `علي مرات`, and the intent silently never fired. Normalising the needle here means the lists
 * can be written in ordinary Arabic and still work.
 */
function has(text: string, needles: string[]): boolean {
  const loose = text.replace(/(^|\s)و(?=\S{2,})/g, "$1و ");
  for (const raw of needles) {
    const n = normalize(raw);
    if (!n) continue;
    if (` ${text} `.includes(` ${n} `)) return true;
    if (` ${loose} `.includes(` ${n} `)) return true;
  }
  return false;
}

/** Emoji that mean "received, thanks" and nothing else. */
const ACK_EMOJI = /^[\p{Extended_Pictographic}‍️\s]+$/u;
const ACK_EMOJI_ALLOWED = ["👍", "👌", "✅", "🙏", "❤", "❤️", "😊", "🌹", "💐", "🤝", "☺"];

const HUMAN = [
  "عايز اكلم حد", "عاوز اكلم حد", "اكلم حد", "عايز حد", "عاوز حد", "حد يكلمني", "حد يرد عليا",
  "عايز اتكلم", "ممكن اكلم حد", "موظف", "الاستقبال", "حد من الاستقبال", "بشري", "مش عايز بوت",
  "عايز ادكتور", "الدكتور", "customer service", "talk to someone", "human", "agent", "operator",
];
const CANCEL = [
  "مش هعرف اجي", "مش هقدر اجي", "مش هاجي", "مش جاي", "مش هينفع اجي", "هلغي", "الغي الحجز",
  "الغي الميعاد", "عايز الغي", "عاوز الغي", "معتذر", "اعتذر", "الغاء الحجز", "الغاء الميعاد",
  "cancel my appointment", "cant come", "can not come", "cancel booking",
];
const RESCHEDULE = [
  "اجل", "نأجل", "ناجل", "اجله", "اجلها", "تأجيل", "تاجيل", "عايز اغير الميعاد", "اغير الميعاد",
  "اغير المعاد", "نغير الميعاد", "عايز اعدل الميعاد", "ممكن نقدم الميعاد", "ممكن نأخر الميعاد",
  "بدل الميعاد", "reschedule", "postpone", "change my appointment", "move my appointment",
];
const LATE = [
  "هتأخر", "هتاخر", "هوصل متأخر", "هوصل متاخر", "متأخر شويه", "متاخر شويه", "هتأخر شويه",
  "هتاخر شويه", "في زحمه هتأخر", "running late", "will be late", "im late",
];
const MY_APPOINTMENT = [
  "ميعادي", "معادي", "موعدي", "حجزي", "ميعادي امتى", "الميعاد بتاعي", "المعاد بتاعي",
  "الموعد بتاعي", "الحجز بتاعي", "معايا ميعاد", "معايا حجز", "عندي ميعاد", "عندي حجز",
  "ميعادي الساعه كام", "ميعادي امتي", "اكد الميعاد", "تأكدولي الميعاد", "تاكدولي الميعاد",
  "my appointment", "my booking",
];
const BOOKING = [
  "احجز", "حجز", "اححز", "عايز احجز", "عاوز احجز", "ممكن احجز", "نفسي احجز", "ابغى احجز",
  "عايز ميعاد", "عاوز ميعاد", "ممكن ميعاد", "عايز موعد", "ممكن موعد", "عايز اتكشف", "عايز كشف",
  "مواعيد فاضيه", "مواعيد فاضية", "ميعاد فاضي", "اقرب ميعاد", "اقرب موعد", "امتى فاضي",
  "المواعيد المتاحه", "المواعيد المتاحة", "في مواعيد", "احجزلي", "احجزلى",
  "book", "booking", "appointment", "a7gz", "ahgz", "3ayez a7gz", "3awz a7gz",
];
const OPEN_NOW = [
  "فاتحين دلوقتي", "فاتحين دلوقت", "مفتوح دلوقتي", "شغالين دلوقتي", "شغالين دلوقت",
  "انتو فاتحين", "انتوا فاتحين", "العياده فاتحه", "العياده مفتوحه", "فاتحين النهارده",
  "open now", "are you open", "still open",
];
const HOURS = [
  "مواعيد العمل", "مواعيدكم", "المواعيد بتاعتكم", "مواعيد العياده", "بتفتحوا", "بتقفلوا",
  "بتسكروا", "لحد امتى", "لحد امتي", "بتشتغلوا", "شغالين امتى", "الساعه كام بتفتحوا",
  "امتى بتفتحوا", "مواعيد الشغل", "بتفتحوا الجمعه", "اجازتكم", "الاجازه",
  "opening hours", "working hours", "what time do you open", "what time do you close",
];
const LOCATION = [
  "فين العياده", "فين العيادة", "فين مكانكم", "العنوان", "عنوانكم", "عنوان العياده",
  "مكانكم فين", "المكان فين", "فين بالظبط", "لوكيشن", "اللوكيشن", "لوكيشن العياده",
  "ابعتلي اللوكيشن", "ابعتلي العنوان", "جوجل ماب", "google map", "location", "address",
  "where are you", "where is the clinic", "pin",
];
const PRICE_LIST = [
  "قايمه الاسعار", "قائمة الاسعار", "الاسعار", "اسعاركم", "قائمه الاسعار", "ابعتلي الاسعار",
  "عايز الاسعار", "الاسعار عندكم", "price list", "your prices",
];
const WALK_IN = [
  "من غير ميعاد", "من غير حجز", "من غير معاد", "لازم ميعاد", "لازم حجز", "لازم معاد",
  "اجي على طول", "اجي مباشره", "ينفع اجي دلوقتي", "من غير ما احجز", "walk in", "walkin",
  "without appointment", "without booking",
];
const INSTALLMENTS = [
  "تقسيط", "بالتقسيط", "على مرات", "على دفعات", "دفعات", "اقساط", "قسط", "بالاقساط",
  "ادفع على مرتين", "instalment", "installment", "instalments", "installments", "payment plan",
];
const OFFERS = [
  "خصم", "خصومات", "تخفيض", "تخفيضات", "عرض", "عروض", "في عرض", "في خصم", "اوفر",
  "discount", "offer", "offers", "promotion",
];
const PARKING = [
  "باركن", "باركنج", "ركنه", "اركن", "مكان للعربيه", "جراج", "جراچ", "parking", "park my car",
];
const INSURANCE = [
  "تامين", "تأمين", "التامين", "بتتعاملوا مع تامين", "شركة تامين", "تامين طبي", "كارت طبي",
  "insurance", "insured", "medical card",
];
const DURATION = [
  "بياخد قد ايه", "بتاخد قد ايه", "بياخد وقت", "بتاخد وقت", "قد ايه وقت", "الجلسه قد ايه",
  "هقعد قد ايه", "بياخد كام ساعه", "المده", "مده الجلسه", "كام جلسه", "كام جلسات",
  "how long does it take", "how long", "how many sessions",
];
const AFTERCARE = [
  "بعد الحشو", "بعد التنظيف", "بعد التركيب", "بعد الجلسه", "ينفع اكل بعد", "اكل ايه بعد",
  "اشرب بعد", "اغسل سناني بعد", "تعليمات بعد", "after the filling", "after treatment",
];

const ACK = [
  "تمام", "اوك", "ok", "okay", "ماشي", "حاضر", "اكيد", "ايوه", "ايوة", "اه", "هحضر",
  "هاجي", "هجي", "ان شاء الله", "انشاءالله", "تمام شكرا", "اوك ماشي", "تمام يا فندم",
  "طيب", "تم", "عظيم", "noted", "sure", "fine", "will do",
];
const THANKS = [
  "شكرا", "شكرآ", "متشكر", "متشكره", "مشكور", "تسلم", "تسلمو", "تسلم ايدك", "تسلم ايديكم",
  "ربنا يخليك", "ربنا يكرمك", "جزاكم الله خيرا", "الله يكرمكم", "شكرا جزيلا", "شكرا ليكم",
  "thanks", "thank you", "thx", "appreciated",
];
const GREETING = [
  "السلام عليكم", "سلام عليكم", "سلام", "صباح الخير", "مساء الخير", "صباح النور", "اهلا",
  "اهلين", "هاي", "هلا", "مرحبا", "ازيك", "ازيكم", "عامل ايه", "الو", "السلام",
  "hi", "hello", "hey", "good morning", "good evening", "salam", "asalamo 3alikom",
];

/**
 * The intent behind a free-text message, or null to let the rest of the chain decide.
 *
 * Order is the whole design. A message can honestly contain several of these — "تمام هحجز بكره"
 * is an acknowledgement AND a booking — and the one that costs the patient most to have missed
 * wins. So a request for a person outranks everything, the time-critical ones (cancelling, running
 * late) come next because they expire, and courtesy comes last because it is the only category
 * where being wrong costs nothing.
 */
export function quickIntent(raw: string): QuickIntent | null {
  const text = normalize(raw);
  if (!text) return null;

  // A message made only of friendly emoji is an acknowledgement, not a question. Before this it
  // was free text, so a thumbs-up was billed as one of the conversation's three AI answers.
  if (ACK_EMOJI.test(raw.trim()) && ACK_EMOJI_ALLOWED.some((e) => raw.includes(e))) return "ack";

  if (has(text, HUMAN)) return "human";
  if (has(text, CANCEL)) return "cancel";
  if (has(text, LATE)) return "late";
  if (has(text, RESCHEDULE)) return "reschedule";

  /*
   * "My appointment" before "an appointment". Both contain the same noun and they need opposite
   * answers: one is a lookup, the other opens the booking flow. Reading "الميعاد بتاعي بكره صح؟"
   * as a booking request would offer a patient who already has a slot a second one.
   */
  if (has(text, MY_APPOINTMENT)) return "my_appointment";

  /*
   * Walking in before booking, because "من غير حجز" and "لازم ميعاد" contain the booking words
   * and mean the opposite of booking. Reading them as a booking request opens the day list at a
   * patient who was asking whether they need one at all.
   */
  if (has(text, WALK_IN)) return "walk_in";
  if (has(text, BOOKING)) return "booking";

  // "Now" before "hours": they share every word, and only one of them needs a clock.
  if (has(text, OPEN_NOW)) return "open_now";
  if (has(text, HOURS)) return "hours";
  if (has(text, LOCATION)) return "location";
  if (has(text, PARKING)) return "parking";

  // Money questions before the generic price list: "في تقسيط" is not a request for prices.
  if (has(text, INSTALLMENTS)) return "installments";
  if (has(text, OFFERS)) return "offers";
  if (has(text, INSURANCE)) return "insurance";
  if (has(text, PRICE_LIST)) return "price_list";

  if (has(text, AFTERCARE)) return "aftercare";
  if (has(text, DURATION)) return "duration";

  /*
   * Courtesy last, and only when it is the whole message. "شكرا" alone is a closing; "شكرا، التقويم
   * بكام؟" is a price question wearing a polite hat, and answering the hat would waste the turn.
   */
  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length <= 4) {
    if (has(text, ACK)) return "ack";
    if (has(text, THANKS)) return "thanks";
    if (has(text, GREETING)) return "greeting";
  }
  // A greeting with a long tail is a greeting plus a question we could not read: let the model see
  // it whole rather than answering the "hello" and dropping the rest.
  return null;
}
