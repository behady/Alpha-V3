/**
 * Is this reply a name?
 *
 * The name step used to accept anything that was not a question or a digit, on the theory that
 * the person had just been asked for a name. Then a patient answered it with a voice note —
 * "ازي حضرتك أنا من بلبيس من الشرقية" — and was registered under that sentence, with an
 * appointment on the calendar for somebody who had never said who they were. Voice notes made
 * this likely rather than rare: people speak in sentences where they would type two words.
 *
 * So a name has to look like one: a few words, letters only, none of them the small words every
 * sentence is built from. "اسمي …" and "my name is …" are how a name is SPOKEN, so that lead-in
 * is dropped and the rest is kept. Anything else returns null and the caller decides what to do
 * with a message that was talk — hand it to the model, or ask again.
 *
 * Pure, so the rule is unit-tested rather than discovered on a real patient's file.
 */

const MAX_WORDS = 5;
const MAX_LENGTH = 60;

/** Alef spellings vary by keyboard; the comparison must not. Used for matching only. */
function fold(word: string): string {
  return word
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .toLowerCase();
}

/** How a name is introduced out loud. Longest first, so "انا اسمي" is not left as "اسمي …". */
const LEAD_INS = ["انا اسمي", "اسمي هو", "الاسم هو", "اسمي", "الاسم", "انا", "my name is", "i am", "i'm", "im", "name"];

/**
 * Words a sentence is made of and a name is not. Deliberately the unambiguous ones: "على" and
 * "عن" are left out because one keystroke away sits the name "علي".
 */
const NOT_NAME_WORDS = new Set(
  [
    "ازي", "ازيك", "ازيكم", "حضرتك", "حضرتكم", "من", "في", "فين", "عايز", "عايزه", "عاوز", "عاوزه", "محتاج", "محتاجه",
    "ممكن", "لو", "سمحت", "سمحتي", "السلام", "عليكم", "مساء", "صباح", "الخير", "اهلا", "مرحبا", "شكرا", "تمام", "ماشي",
    "اوك", "اوكي", "ايه", "كام", "بكام", "امتي", "امتى", "ازاي", "هل", "انا", "انت", "انتي", "احنا", "مش", "لا", "ايوه",
    "ايوة", "نعم", "الميعاد", "ميعاد", "حجز", "احجز", "الحجز", "العنوان", "المكان", "السعر", "سعر", "بس", "طيب", "طب",
    "يعني", "عند", "عندي", "عندكم", "مع", "ده", "دي", "كده", "هو", "هي", "بكره", "بكرة", "النهارده", "دلوقتي", "الدكتور",
    "العياده", "العيادة", "عرض", "العرض", "كشف", "الكشف",
    "hi", "hello", "hey", "ok", "okay", "yes", "no", "from", "the", "where", "how", "what", "when", "please", "thanks",
    "thank", "you", "want", "need", "book", "price",
  ].map(fold)
);

/** The name in this reply, tidied, or null when the reply is not a name. */
export function nameFromReply(text: string): string | null {
  let name = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    // Transcripts end in a full stop and typed names sometimes do; neither is part of the name.
    .replace(/[.،,!؛;:]+$/u, "")
    .trim();

  const folded = fold(name);
  for (const lead of LEAD_INS) {
    if (folded.startsWith(`${lead} `) || folded.startsWith(`${lead}:`)) {
      name = name.slice(lead.length).replace(/^[\s:،,-]+/u, "").trim();
      break;
    }
  }

  if (name.length < 2 || name.length > MAX_LENGTH) return null;
  const words = name.split(" ");
  if (words.length > MAX_WORDS) return null;
  // Letters only (any script), with the marks real names carry: "عبد-الله", "O'Neil", "د.".
  if (!words.every((w) => /^[\p{L}\p{M}'’.-]+$/u.test(w) && /\p{L}/u.test(w))) return null;
  if (words.some((w) => NOT_NAME_WORDS.has(fold(w)))) return null;
  return name;
}
