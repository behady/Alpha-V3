/**
 * The questions asked before the assistant names a medicine, and how its answer is read.
 *
 * The clinic decides WHICH medicines may be named and writes the exact words for each; this file
 * decides WHEN. A dentist saying "an ordinary painkiller is fine after a filling" means it for the
 * patient in front of them, and a WhatsApp thread does not know whether the person typing is
 * pregnant, six years old, on blood thinners, or asking on behalf of their mother.
 *
 * So one message goes out first, once per conversation, and the reply is read here — never by the
 * model, which is the part that must not be talked round. The reading is deliberately lopsided:
 * anything that looks like a risk goes to the dentist, and only a clear "no, nothing" proceeds.
 * An ambiguous answer is treated as a risk, because the cost of the two mistakes is not equal.
 */

/** Used when the clinic has not written its own. Deliberately one message, and short enough to answer. */
export const DEFAULT_SCREENING =
  "قبل ما أقولك، محتاج أطمن على كام حاجة بسرعة 🙏\n" +
  "الدوا لحضرتك شخصياً ولا لحد تاني؟ وفي حمل أو رضاعة؟ وفي حساسية من أي دوا؟ وبتاخد أدوية باستمرار أو عندك سكر أو ضغط أو قرحة أو مشكلة في الكلى أو الكبد؟\n" +
  "لو مفيش أي حاجة من دول قولي \"مفيش\" وأنا هقولك.";

const ARABIC = "؀-ۿ";

function normalize(text: string): string {
  return String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    // Punctuation becomes a space rather than nothing: the Arabic comma sits inside the Arabic
    // letter range, so "لا، الدوا ليا" hid its own "لا" from a whole-word needle.
    .replace(/[.!؟?,،"'«»()[\]{}:;\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * A word, with the leniency pointed in the safe direction.
 *
 * Arabic attaches its prepositions: "لبنتي" is "for my daughter" written as one token, and a
 * strict whole-word needle for "بنتي" misses it — which would let a parent asking on behalf of a
 * child straight through. So when looking for a RISK the attached و/ل/ب/ف/ك/ال are allowed in
 * front, and when looking for PERMISSION they are not: over-matching a risk costs a handoff
 * nobody needed, over-matching a "no" costs somebody the wrong medicine.
 */
function whole(needle: string, lenient = false): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[a-z0-9\s']+$/.test(needle)) return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  const prefix = lenient ? "[ولبفك]?(?:ال)?" : "";
  return new RegExp(`(?<![${ARABIC}])${prefix}${escaped}(?![${ARABIC}])`);
}

/** Anything here ends the screening: the dentist answers, not the assistant. */
const RISK = [
  "حامل", "حمل", "مرضع", "مرضعه", "برضع", "رضاعه", "رضاعة",
  "طفل", "طفله", "طفلي", "بنتي", "ابني", "ولدي", "رضيع", "بيبي",
  "حساسيه", "حساسية", "الرجيه", "allergy", "allergic",
  "سكر", "ضغط", "قلب", "قرحه", "قرحة", "معده", "معدة", "كلي", "كليه", "كبد", "ربو", "صرع", "غسيل",
  "pregnant", "pregnancy", "breastfeeding", "nursing", "my son", "my daughter", "my kid", "my child", "my mother", "my wife", "my husband", "for her", "for him",
  "diabetes", "diabetic", "blood pressure", "heart", "ulcer", "kidney", "liver", "asthma", "epilepsy",
  "بتاخد", "باخد", "بستخدم", "ادويه", "أدوية", "علاج مستمر", "سيولة", "سيوله",
  // Someone volunteering that they take anything at all is telling us to ask the dentist.
  "warfarin", "blood thinner", "blood thinners", "i take", "i'm on", "i am on", "medication", "tablets",
  "لماما", "لامي", "لابويا", "لجوزي", "لمراتي", "لاختي", "لاخويا", "لجدتي",
];

/** A clean answer. Nothing more than these is required, but nothing less will do. */
const CLEAR = [
  "مفيش", "مافيش", "لا", "لاء", "ولا حاجه", "ولا حاجة", "محدش", "مش بتناول", "مش باخد", "مبخدش",
  "كله تمام", "الحمد لله", "لا شكرا", "no", "none", "nothing", "nope", "not really", "im fine", "i'm fine",
];

export type ScreeningVerdict = "risk" | "clear" | "unclear";

/**
 * What did they just tell us?
 *
 * `risk` and `unclear` both mean "a person answers this"; they are kept apart only so the reply
 * can be honest about which one happened — being told "I'll ask the dentist because you mentioned
 * you're pregnant" is a different sentence from "I didn't follow that".
 */
export function readScreeningAnswer(raw: string): ScreeningVerdict {
  const text = normalize(raw);
  if (!text.trim()) return "unclear";
  if (RISK.some((r) => whole(normalize(r), true).test(text))) return "risk";
  // A negative anywhere in a short answer is a clear answer; in a long one it is a sentence about
  // something else, and the assistant should not be reading paragraphs for permission.
  if (text.length <= 120 && CLEAR.some((c) => whole(normalize(c)).test(text))) return "clear";
  return "unclear";
}
