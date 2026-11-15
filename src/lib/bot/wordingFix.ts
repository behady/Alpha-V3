/**
 * How a receptionist in Egypt writes — on the model's own words.
 *
 * 14/11/2026: of 56 model replies that opened with a greeting, 45 said "أهلاً بك" — the textbook
 * form nobody at a clinic desk says — and the offer was "متاح بالفعل", a word-for-word "already
 * available". On a later turn the model sometimes greeted again, so a patient three messages into
 * a booking read a fresh "أهلاً بك" (and stripRepeatIntro, which removes "معاك سارة من …" but
 * keeps the greeting, left it standing alone as "أهلاً بك.").
 *
 * The prompt now shows the Egyptian opening, but the model follows soft rules only some of the
 * time, so the three habits are corrected here:
 *   1. "أهلاً بك / بكِ" becomes "أهلاً بحضرتك" (right for a man and a woman alike);
 *   2. "بالفعل" is dropped after "متاح / موجود / شغال", and anywhere else becomes "فعلاً";
 *   3. on a later turn of the same sitting, a greeting that opens the reply and ends there is
 *      dropped — unless the patient has just greeted again, or too little would be left.
 *
 * Arabic only: an English or Franco reply matches nothing and passes through untouched. Called on
 * the model's text only (respond.ts, right after the doctor-name check, for either brain), never
 * on the code's own fixed lines. A reply none of this applies to comes back exactly as it went in.
 */

/** Arabic LETTERS only. "،" and "؟" sit in the same Unicode block and must count as a word's end. */
const AR = "ء-يٱ-ۓ";
const NOT_AFTER = `(?![${AR}])`;
const NOT_BEFORE = `(?<![${AR}])`;

/** "أهلاً" / "أهلا" / "اهلاً" / "أهلًا" / "مرحباً" … (the tanween is written before or after the alif). */
const HELLO = "(?:[أا]هل|مرحب)(?:اً|ًا|ا)";
/** "… وسهلاً" / "… و سهلا". */
const AND_WELCOME = "\\s+و\\s*سهل(?:اً|ًا|ا)";
const FILLER = "(?:بالفعل|فعل(?:اً|ًا|ا))";
const AVAILABLE = "(?:متاحة|متاح|موجودة|موجود|شغالة|شغال)";

/** "أهلاً بك" / "وأهلاً وسهلاً بكِ" / "مرحباً بك" — the formal second person. Not "بكم", not "بيك". */
const FORMAL_WELCOME = new RegExp(`${NOT_BEFORE}(و?)${HELLO}(${AND_WELCOME})?\\s+بكِ?${NOT_AFTER}`, "g");

/**
 * Who the greeting is addressed to: "يا فندم", "يا أستاذ خميس", "يا مدام منى عبد الله" — a title
 * and at most two names ("عبد …" counts as one). Never a sentence: with any 30 characters allowed,
 * "أهلاً يا أستاذ أحمد الميعاد اتلغى. تحب نحجزلك ميعاد تاني؟" lost "the appointment is cancelled"
 * along with the greeting, because the model often writes no comma after "يا فندم".
 */
const TITLE = "(?:أستاذة|أستاذ|استاذة|استاذ|دكتورة|دكتوره|دكتور|مدام|آنسة|انسة|حاجة|حاج|بشمهندسة|بشمهندس|كابتن)";
const NAME_WORD = "(?:عبد\\s*)?[^\\s،,.!؟?]+";
const VOCATIVE = `(?:\\s+يا\\s+(?:${TITLE}\\s+)?${NAME_WORD}(?:\\s+${NAME_WORD})?)?`;

/**
 * A greeting at the very start of the reply that ENDS there: "أهلاً بيك 🙏 …", "أهلاً بحضرتك يا
 * أستاذ خميس، …", "أهلاً بك.\n\n…". "أهلاً بحضرتك وبأهل بلبيس" goes on with "و", so it never
 * matches; neither does "وعليكم السلام" (answering the patient's own salaam) or a greeting inside
 * the text ("العفو، وأهلاً بيك …").
 */
const OPENING_GREETING = new RegExp(
  `^\\s*${HELLO}(?:${AND_WELCOME})?(?:\\s+(?:بحضرتك|بيكي|بيكم|بيك|بكم|بكِ|بك))?${NOT_AFTER}` +
    // "… يا أستاذ خميس" / "… يا فندم"
    VOCATIVE +
    // …and then it ends: punctuation, an emoji, or the end of the line.
    "(?:\\s*[!.،,]+|\\s*(?:🙏|👋|🌟|😊|🌸|✨|🤍|💙)+|[ \\t]*(?=\\n|$))" +
    "[ \\t]*(?:🙏|👋|🌟|😊|🌸|✨|🤍|💙)*\\s*"
);

/** The patient greeted in this message: answering in kind is what a person does, so it stays. */
const PATIENT_GREETS = new RegExp(
  `${NOT_BEFORE}و?(?:[أا]هل[اً]|مرحب|السلام|سلام|[اإ]زي(?:ك|كم|كو|كي)?${NOT_AFTER}|صباح الخير|صباح النور|مساء الخير|مساء النور|مسا الخير)` +
    "|\\b(?:hi|hello|hey|salam|good morning|good evening)\\b",
  "i"
);

/** Below this many letters, what is left after the greeting is not worth sending on its own. */
const MIN_LEFT = 12;

export function tidyModelWording(text: string, o: { laterTurn: boolean; patientText?: string }): string {
  const raw = String(text || "");
  if (!raw.trim()) return raw;

  // 1. "أهلاً بك" → "أهلاً بحضرتك" (and "أهلاً وسهلاً بك" → "أهلاً وسهلاً بحضرتك").
  let out = raw.replace(FORMAL_WELCOME, (_m, and: string, sahlan: string | undefined) => `${and}أهلاً${sahlan ? " وسهلاً" : ""} بحضرتك`);

  // 2. The translated "بالفعل".
  out = out
    // "العرض متاح بالفعل، كشف …" → "العرض متاح، كشف …"
    .replace(new RegExp(`${NOT_BEFORE}(${AVAILABLE})\\s+${FILLER}${NOT_AFTER}`, "g"), "$1")
    // "العرض متاح وفعلاً بيشمل …" → "العرض متاح وبيشمل …"
    .replace(new RegExp(`${NOT_BEFORE}(${AVAILABLE})\\s+و${FILLER}\\s+(?=[${AR}])`, "g"), "$1 و")
    // Anywhere else: the Egyptian word.
    .replace(new RegExp(`${NOT_BEFORE}(و?)بالفعل${NOT_AFTER}`, "g"), "$1فعلاً");

  // 3. One welcome per sitting.
  if (o.laterTurn && !PATIENT_GREETS.test(o.patientText || "")) {
    const stripped = out.replace(OPENING_GREETING, "").trim();
    if (stripped !== out.trim() && stripped.replace(/[\s.،,!؟?]/g, "").length >= MIN_LEFT) out = stripped;
  }
  return out;
}
