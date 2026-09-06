/**
 * A woman addressed as a woman, every time.
 *
 * Egyptian Arabic marks the person it is speaking to in almost every sentence, and the prompt's
 * instruction to use the feminine loses often enough to notice: the model is reading a system
 * prompt written throughout in the masculine, because that prompt addresses the assistant rather
 * than the patient. Over a long conversation one masculine "معاك" lands among twenty correct
 * lines, and a slip like that reads worse than a consistent mistake would.
 *
 * The list is deliberately tiny, and every entry can only be second person — the word the
 * assistant uses to address whoever it is writing to. Anything that might describe a third party
 * (a dentist, the clinic, the patient's husband) is left alone: a reply saying "الدكتور يقدر
 * يشوفك" must pass through untouched, and it does, because nothing here matches it.
 *
 * Applied only for a patient the clinic records as female. Masculine is the default everywhere
 * else, and guessing from a name is the mistake this file exists to keep out of sight.
 */

const ARABIC = "؀-ۿ";

/**
 * A whole word in Arabic.
 *
 * `\b` is defined against ASCII word characters, so it matches the empty space beside every
 * Arabic word and never the word itself — a needle written with `\b` silently matches nothing.
 */
function word(needle: string): RegExp {
  return new RegExp(`(?<![${ARABIC}])${needle}(?![${ARABIC}])`, "g");
}

/** Second-person forms, masculine → feminine. Longer needles first. */
const PAIRS: Array<[RegExp, string]> = [
  // Address particles: "معاك سارة"، "الميعاد ده ليك"، "مستنينك"
  [word("معاك"), "معاكي"],
  [word("مستنينك"), "مستنينكي"],
  [word("مستنيك"), "مستنياكي"],
  [word("ليك"), "ليكي"],
  [word("بيك"), "بيكي"],
  // Second-person verbs the assistant only ever aims at the patient.
  [/تحب تحجز/g, "تحبي تحجزي"],
  [/تحب نحجز/g, "تحبي نحجز"],
  [/تحب نظبط/g, "تحبي نظبط"],
  [/تحب تشوف/g, "تحبي تشوفي"],
  [/لو حبيت(?![يى])/g, "لو حبيتي"],
  [word("حابب"), "حابة"],
  [word("متعود"), "متعودة"],
  [word("ابعت"), "ابعتي"],
  [word("ابعتلي"), "ابعتيلي"],
  [word("ابعتلنا"), "ابعتيلنا"],
  [word("اختار"), "اختاري"],
  // "تقدر" on its own can describe something other than the patient, so only the pairings that
  // cannot: "you can take", "you can book", "you can come".
  [/تقدر تاخد/g, "تقدري تاخدي"],
  [/تقدر تحجز/g, "تقدري تحجزي"],
  [/تقدر تيجي/g, "تقدري تيجي"],
  [/تقدر تعملي?/g, "تقدري تعملي"],
];

/**
 * Rewrite the second-person forms in a reply for a female patient.
 *
 * Returns the text untouched for any other gender, and for an empty reply.
 */
export function feminizeAddress(text: string, gender: "male" | "female" | "unknown" | undefined): string {
  if (gender !== "female") return String(text || "");
  let out = String(text || "");
  if (!out.trim()) return out;
  for (const [re, to] of PAIRS) out = out.replace(re, to);
  return out;
}
