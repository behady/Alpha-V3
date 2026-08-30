import { normalizeReplyText } from "@/lib/patientMessaging";

/**
 * Deciding whether a patient's message belongs to a person rather than to a menu.
 *
 * This is the bot's one safety-critical branch, and it used to be a list of words checked with
 * `text.includes(word)`. That is wrong in Arabic in a way that is easy to miss and expensive to
 * leave: the normaliser folds `ألم` (pain) to `الم`, which is also the definite article `ال`
 * followed by any noun starting with `م`. So `المواعيد` (the appointments), `الميعاد` (the
 * appointment), `المكان` (the place) and `المبلغ` (the amount) — four of the most common words in a
 * clinic's inbox — were each read as a patient in pain, answered with the emergency script, and
 * followed by permanent silence. Measured against the real code, 22 of 28 ordinary messages were
 * caught this way. `دم` (blood) did the same from inside `خدمة` (service) and `مقدما` (in advance),
 * so "thanks in advance" was a bleeding emergency.
 *
 * It failed in the other direction at the same time, which is the half that actually matters: the
 * list held the dictionary forms and patients type the spoken ones. `كسر` never matched `مكسور`,
 * `بينزف` never matched the feminine `بتنزف`, nothing at all matched franco-Arabic, and none of
 * `اتفكك`, `مخلخل` or a knocked-out child's tooth appeared anywhere. Those messages got the
 * cheerful booking menu.
 *
 * So matching is on whole words, and the word lists carry the forms people actually type. The rule
 * behind every judgement below is unchanged and deliberately lopsided: handing a booking question
 * to a receptionist wastes a minute, and handing a swollen face to a menu is the failure this
 * clinic cannot have. When the two readings are close, the person wins.
 */

/** Digits, spacing and orthography folded; the shared normaliser plus Arabic-Indic numerals. */
function normalize(raw: string): string {
  return normalizeReplyText(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Dashes and slashes join words that are separate; underscores arrive from copied text.
    .replace(/[-_/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Leading particles that fuse onto an Arabic word. Every stripped form is also tested. */
const PREFIXES = ["وبال", "فبال", "وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك"];

/**
 * Inflectional endings a stem may carry and still be the same word: وجع → وجعني, ورم → ورمها.
 *
 * Short and closed on purpose. This is the whole reason `المواعيد` no longer matches `الم` — the
 * leftover `واعيد` is not an ending, so the word is not a form of "pain".
 */
const SUFFIXES = ["", "ي", "ه", "ها", "هم", "هما", "ك", "كي", "كم", "نا", "ني", "ات", "ين", "ون"];

/**
 * Symptoms, as stems. A token matches when it is the stem plus one of the endings above.
 *
 * Nouns and adjectives only — verbs conjugate too far for stemming and are listed whole below.
 */
const SYMPTOM_STEMS = ([
  "الم", "الام", "وجع", "وجعان", "موجوع",
  "ورم", "وارم", "متورم", "تورم", "منتفخ", "انتفاخ",
  "نزيف", "صديد", "خراج", "التهاب", "ملتهب",
  "حراره", "سخونه", "سخونيه", "مسخن",
  "مكسور", "مكسوره", "متكسر", "كسر",
  "حساسيه", "مخدر", "خدر",
] as string[]).map(normalize);

/**
 * Everything matched as a complete word only.
 *
 * These are the ambiguous ones. `دم` is a real word and also two letters inside a dozen innocent
 * ones; `مسكن` is a painkiller and also somebody's home (`مسكني` = "my home", which is why no
 * endings are allowed here); `حمل` is pregnancy and also `احمل` = "I upload". Whole-word matching
 * is what makes each of them safe to keep.
 */
const EXACT_WORDS = new Set(([
  // Blood and bleeding, in the forms people write.
  "دم", "دمي", "نزف", "بينزف", "بتنزف", "ينزف", "تنزف", "بنزف", "نازف", "بيندف",
  /*
   * Pain, conjugated — and note which forms are absent. `بيوجعني` ("it hurts ME") is a report;
   * bare `بيوجع` is the question "does it hurt?", which a nervous patient asks BEFORE treatment.
   * Blocking that one cost the clinic the booking too, because the bot then went silent. The bare
   * forms live in the distress list below instead, where they need a mouth word beside them —
   * so "ضرسي بيوجع" is still caught and "هو بيوجع؟" reaches an answer.
   */
  "بيوجعني", "بتوجعني", "وجعني", "وجعتني", "يوجعني", "توجعني",
  "بيعورني", "عورني", "بيالمني", "مؤلم", "مولم",
  // A feverish child is the commonest paediatric emergency and `سخونه` never matched `سخن`.
  "سخن", "سخنه", "سخانه", "سخنانه",
  // Medication.
  "مسكن", "مسكنات", "مضاد", "بنسلين", "ابيمول", "بروفين", "كتافلاست",
  // Mobility and trauma — none of this was caught before.
  "اتفكك", "اتفك", "اتخلخل", "مخلخل", "بيتحرك", "اتحرك", "اتخبط", "اتخبطت", "اتكسر", "اتكسرت",
  "انكسر", "اتشرخ", "مشروخ", "وقعت", "طلعت", "اتقلع", "بلعت", "ابتلعت",
  // Short symptom stems, spelled out because the stemmer will not extend three letters.
  "المي", "المه", "وجعه", "وجعها", "ورمي", "ورمه", "ورمها", "خدرت",
  // States that need a person.
  "حامل", "حمل", "طوارئ", "طواري", "اسعاف", "مستعجله",
  // English, whole words.
  "pain", "painful", "hurts", "hurting", "hurt", "ache", "aching", "toothache",
  "swollen", "swelling", "swell", "bleeding", "bleed", "bleeds", "blood",
  "pus", "abscess", "fever", "infection", "infected", "inflamed",
  "emergency", "urgent", "broke", "broken", "cracked", "chipped", "knocked", "loose",
  "pregnant", "pregnancy", "allergic", "allergy", "numb", "numbness", "antibiotic", "painkiller",
  // Franco-Arabic. A large share of under-35 Cairo WhatsApp, and previously invisible here.
  "waga3", "wag3", "wga3", "waga3ni", "beywga3", "beywga3ni", "byoga3", "bywga3ni",
  "wagaa", "alam", "warm", "waram", "warem", "mowaram", "mowarram",
  "nazif", "nazeef", "dam", "kasr", "maksour", "maksoor", "maksoura",
  "sokhoneya", "so5oneya", "7arara", "harara", "mesaken", "moskin", "khoraag",
  // Normalised on the way in, for the same reason phrases are: a word written with ء, ة or ى
  // would otherwise never equal the folded token it is meant to catch.
] as string[]).map(normalize));

/**
 * Phrases that only mean something medical together.
 *
 * `سكر` and `ضغط` used to be bare entries, so "what time do you close" (`بتسكروا`) and "press the
 * link" (`اضغط`) were medical emergencies. As phrases they still catch the disclosure that matters
 * — a diabetic or hypertensive patient before an extraction — without eating ordinary words.
 */
const PHRASES = [
  "مضاد حيوي", "مضاد حيوى",
  "عندي سكر", "مريض سكر", "مرض السكر", "السكر عندي", "سكر وضغط", "عندى سكر",
  "ضغط عالي", "عندي ضغط", "الضغط عندي", "ضغط الدم", "ضغط مرتفع",
  "طلعت من مكانها", "طلع من مكانه", "خرجت من مكانها",
  "مش حاسس", "مش حاسه", "مش قادر افتح", "مش قادر انام", "مش عارف انام",
  // Not being able to eat or sleep is a symptom on its own, whichever tooth it is about.
  "مش عارف اكل", "مش عارفه اكل", "مش قادر اكل", "مش قادره اكل", "مش قادر اشرب", "مش عايز ياكل",
  "ريحه وحشه", "ريحة وحشة", "طعم غريب", "ريحه كريهه",
  // Swallowing and anaesthetic reactions: rare, and the two where a menu is worst.
  "مش عارف ابلع", "مش قادر ابلع", "صعوبه في البلع", "بعد البنج", "من البنج",
  "قلبي بيدق", "قلبي بيضرب", "دايخ", "بدوخ",
  "تعبان اوي", "تعبانه اوي", "تعبان جدا", "حالتي وحشه",
  "blood pressure", "wisdom tooth pain", "cant sleep", "can not sleep", "cant swallow",
];

/**
 * Words for the mouth, and words for distress. Neither is clinical alone; together they are.
 *
 * This is the net under the word lists. "حاسس بحاجه غريبه في ضرسي" and "بقالي يومين مش عارف اكل
 * على الناحية اليمين" contain no symptom word in any list anyone would think to write, and both
 * are plainly a patient describing something wrong with their mouth. Requiring one word from each
 * column keeps it from firing on "ضرس العقل بكام".
 */
const MOUTH_WORDS = [
  "سن", "سني", "سنه", "سنتي", "سنانى", "سناني", "ضرس", "ضرسي", "ضروسي", "الضرس",
  "لثه", "لثتي", "اللثه", "بقي", "بوقي", "فمي", "وشي", "خدي", "لساني", "فكي",
  "تلبيسه", "التلبيسه", "طربوش", "الطربوش", "حشوه", "الحشوه", "طقم", "زرعه",
  "tooth", "teeth", "gum", "gums", "jaw", "crown", "filling",
];
const DISTRESS_WORDS = [
  "غريب", "غريبه", "وحش", "وحشه", "مش طبيعي", "مش طبيعيه", "تعبان", "تعبانه",
  "مش قادر", "مش قادره", "مش عارف اكل", "مش عارفه اكل", "بقالي", "بقالى",
  "مضايق", "مزعج", "حاله", "مشكله", "خايف", "خايفه", "اتعورت", "بيقطع",
  // Safe only as the second half of the pair: "وقع" is "it fell out" beside a crown and "he fell"
  // beside a child, but it is also an ordinary word, so it never triggers alone.
  "وقع", "وقعت", "خرج", "خرجت", "بيوجع", "بتوجع", "بيعور", "بيلعب", "بينزل",
  "strange", "weird", "not normal", "cant eat", "can not eat", "worried", "fell", "fell out",
];

/**
 * Words that mean the patient is shopping, not suffering.
 *
 * `خلع` is the name of a service the clinic sells and the name of a thing that goes wrong. Alone
 * it stays clinical — "الاكل بعد الخلع" is a post-op question and belongs to a person. Next to a
 * price or a booking it is a customer naming a treatment, and answering that with the emergency
 * script loses the enquiry AND writes a false clinical flag on the record.
 */
const PROCEDURE_WORDS = new Set(([
  "خلع", "الخلع", "خلعه", "اخلع", "نخلع", "خلعت", "بيتخلع", "تخلع", "khal3", "khale3",
] as string[]).map(normalize));
const COMMERCE_WORDS = [
  "بكام", "كام", "سعر", "السعر", "اسعار", "الاسعار", "تمن", "التمن", "تكلفه", "التكلفه",
  "احجز", "حجز", "الحجز", "ميعاد", "موعد", "مواعيد", "احجزلي", "عايز احجز", "تقسيط",
  "price", "cost", "how much", "book", "booking", "appointment",
];


/** A token plus every form left after removing one leading particle. */
function candidates(token: string): string[] {
  const out = [token];
  for (const p of PREFIXES) {
    if (token.length > p.length + 1 && token.startsWith(p)) out.push(token.slice(p.length));
  }
  return out;
}

/**
 * A three-letter stem is too short to carry endings safely.
 *
 * `الم` plus the ending `هم` is `المهم` — "the important thing" — and plus `ها` is a name. The same
 * accident as the original substring bug, one size smaller, so short stems must match exactly and
 * their real inflections are spelled out in EXACT_WORDS instead.
 */
const MIN_STEM_FOR_SUFFIX = 4;

function matchesStem(candidate: string): boolean {
  for (const stem of SYMPTOM_STEMS) {
    if (!candidate.startsWith(stem)) continue;
    const rest = candidate.slice(stem.length);
    if (!rest) return true;
    if (stem.length >= MIN_STEM_FOR_SUFFIX && SUFFIXES.includes(rest)) return true;
  }
  return false;
}

/**
 * Does the normalised text contain this phrase as whole words?
 *
 * The phrase is normalised too. The normaliser folds ى→ي and ة→ه, so a phrase written the correct
 * way — `ريحة وحشة` — would never match the folded text `ريحه وحشه`, and would sit in the list
 * looking like protection that was never once applied.
 *
 * Also tested against a copy where a leading `و` ("and") is split off each token: Egyptians write
 * `ومش عارف انام` as one word, and the phrase `مش عارف انام` would otherwise slide straight past
 * the very message it exists to catch.
 */
function hasPhrase(text: string, rawPhrase: string): boolean {
  const phrase = normalize(rawPhrase);
  if (!phrase) return false;
  if (` ${text} `.includes(` ${phrase} `)) return true;
  const split = text.replace(/(^|\s)و(?=\S{2,})/g, "$1و ");
  return ` ${split} `.includes(` ${phrase} `);
}

/** Needles are normalised here too — see hasPhrase for why that is not optional. */
function hasAnyWord(tokens: string[], words: string[]): boolean {
  const set = new Set(tokens);
  return words.some((w) => {
    const n = normalize(w);
    return n && !n.includes(" ") && set.has(n);
  });
}

function hasAny(text: string, tokens: string[], words: string[]): boolean {
  return words.some((w) => {
    const n = normalize(w);
    if (!n) return false;
    return n.includes(" ") ? hasPhrase(text, n) : tokens.includes(n);
  });
}

export interface TriageResult {
  needsHuman: boolean;
  /** Why, for the conversation log — a false handoff should be explainable after the fact. */
  reason?: "symptom" | "phrase" | "mouth_distress";
  /** The word or phrase that decided it. */
  matched?: string;
}

/** The full judgement, with its evidence. `needsHuman` is the thin wrapper the engine calls. */
export function triageMessage(raw: string): TriageResult {
  const text = normalize(raw);
  if (!text) return { needsHuman: false };
  const tokens = text.split(" ").filter(Boolean);

  for (const phrase of PHRASES) {
    if (hasPhrase(text, phrase)) return { needsHuman: true, reason: "phrase", matched: phrase };
  }

  const shopping = hasAny(text, tokens, COMMERCE_WORDS);

  for (const token of tokens) {
    for (const candidate of candidates(token)) {
      // A treatment named next to a price or a booking is a service, not a symptom.
      if (PROCEDURE_WORDS.has(candidate)) {
        if (!shopping) return { needsHuman: true, reason: "symptom", matched: candidate };
        continue;
      }
      if (EXACT_WORDS.has(candidate) || matchesStem(candidate)) {
        return { needsHuman: true, reason: "symptom", matched: candidate };
      }
    }
  }

  // The net: something about their mouth, and something wrong with it.
  if (hasAnyWord(tokens, MOUTH_WORDS) && hasAny(text, tokens, DISTRESS_WORDS)) {
    return { needsHuman: true, reason: "mouth_distress" };
  }

  return { needsHuman: false };
}

/** Does this message need a human clinician rather than a menu? */
export function needsHuman(text: string): boolean {
  return triageMessage(text).needsHuman;
}
