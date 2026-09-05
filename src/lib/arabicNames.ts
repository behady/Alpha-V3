import { normalizeReplyText } from "@/lib/patientMessaging";

/**
 * Guessing whether to address a patient as a man or a woman, from the name on their record.
 *
 * Arabic verbs and pronouns are gendered, and the assistant addressed every patient as a man:
 * `معاك`, `ابعت`, `مستنيك`. In a specialty where most adult patients are women, that reads the way
 * it would in any language — as a form letter. The patient record carries no gender field, but an
 * Egyptian first name is gendered with near-certainty, and getting it right costs nothing.
 *
 * The rule when unsure is to stay neutral rather than guess male: `حضرتك` is the same for
 * everyone and is what a receptionist says to a stranger anyway.
 */

export type Gender = "female" | "male" | "unknown";

/** Honorifics and titles that precede the name on a record. */
const TITLES = new Set(["د", "دكتور", "دكتوره", "دكتورة", "استاذ", "استاذه", "استاذة", "مدام", "انسه", "انسة", "سيد", "سيده", "سيدة", "الحاج", "الحاجه", "الحاجة", "حاج", "حاجه", "حاجة", "مهندس", "مهندسه", "مهندسة", "dr", "mr", "mrs", "ms", "miss", "eng"]);

/** Common Egyptian women's names, normalised the way normalizeReplyText writes them. */
const FEMALE = new Set([
  "فاطمه", "فاطمة", "مريم", "نور", "نورا", "نوره", "ساره", "سارة", "ساره", "هبه", "هبة", "منه", "منة",
  "ايه", "اية", "آيه", "هنا", "هنى", "دينا", "رنا", "ريم", "ريهام", "شيماء", "اسماء", "هناء", "سناء",
  "دعاء", "الاء", "اسراء", "وفاء", "صفاء", "علياء", "رحاب", "ايمان", "امنيه", "امنية", "امل", "امال",
  "منى", "مني", "منال", "نهى", "نهي", "نهال", "هدى", "هدي", "هاله", "هالة", "هدير", "هايدي", "ياسمين",
  "ياسمينا", "جنى", "جني", "جنه", "جنة", "لينا", "لين", "ليلى", "ليلي", "لمياء", "لبنى", "لبني",
  "سلمى", "سلمي", "سما", "سميه", "سمية", "سميره", "سميرة", "سهير", "سهام", "سهى", "سهي", "شهد",
  "شروق", "شيرين", "شاهيناز", "غاده", "غادة", "غنى", "غني", "عبير", "عزه", "عزة", "عائشه", "عائشة",
  "عايده", "عايدة", "فريده", "فريدة", "فرح", "فيروز", "كريمه", "كريمة", "كاميليا", "مروه", "مروة",
  "مرام", "مي", "مها", "مياده", "ميادة", "ميرنا", "ميران", "ميار", "ملك", "ندى", "ندي", "نجلاء",
  "نجوى", "نجوي", "نادين", "ناديه", "نادية", "نانسي", "نرمين", "نسرين", "نيره", "نيرة", "نيفين",
  "هايدي", "هيام", "ورده", "وردة", "يارا", "يمنى", "يمني", "زينب", "زهره", "زهرة", "رقيه", "رقية",
  "رانيا", "راندا", "رشا", "روان", "روضه", "روضة", "رويدا", "رضوى", "رضوي", "بسمه", "بسمة", "بسنت",
  "بثينه", "بثينة", "تسنيم", "تقى", "تقي", "تهاني", "جهاد", "جيهان", "جميله", "جميلة", "حبيبه", "حبيبة",
  "حنان", "حنين", "حياه", "حياة", "خديجه", "خديجة", "خلود", "دنيا", "دلال", "داليا", "دارين", "ابتسام",
  "اسمهان", "الهام", "انجي", "ايرين", "ايناس", "ايفون", "بوسي", "سلوى", "سلوي", "سوسن", "شادية", "شاديه",
  "صباح", "عفاف", "عواطف", "فاديه", "فادية", "فايزه", "فايزة", "كوثر", "لطيفه", "لطيفة", "ماجده", "ماجدة",
  "مديحه", "مديحة", "نعمه", "نعمة", "نوال", "نيللي", "هويدا", "وسام", "ولاء", "يسرا", "يسريه", "يسرية",
  "ماريان", "مارينا", "مارتينا", "مونيكا", "كريستين", "فيفيان", "ميريت", "مادونا", "ساندرا", "جاكلين",
  "روز", "روزا", "لوجين", "لوجي", "جودي", "ليان", "تاليا", "ريتاج", "ريناد", "لارا", "كنزي", "كنزى",
  "ملاك", "جوري", "جورى", "بيسان", "سيلا", "ايلا", "لمار", "ميرال", "رتيل", "جومانا", "هيا",
]);

/** Men's names that end in ة/ه and would otherwise be read as women's. */
const MALE_WITH_TA = new Set([
  "اسامه", "اسامة", "حمزه", "حمزة", "معاويه", "معاوية", "طلحه", "طلحة", "عبيده", "عبيدة", "عطيه", "عطية",
  "عرفه", "عرفة", "جمعه", "جمعة", "خليفه", "خليفة", "عقبه", "عقبة", "ربيعه", "ربيعة", "حذيفه", "حذيفة",
  "طه", "عطا", "بهاء", "ضياء", "علاء", "رجاء", "زكريا", "يحيى", "يحيي", "عيسى", "عيسي", "موسى", "موسي",
  "مصطفى", "مصطفي", "رضا", "نجا", "عطيه",
]);

/** The name's first word, with any title in front of it removed. */
function firstName(fullName: string): string {
  const words = normalizeReplyText(fullName).split(" ").filter(Boolean);
  while (words.length && TITLES.has(words[0].replace(/\./g, ""))) words.shift();
  return words[0] || "";
}

export function guessGender(fullName: string | undefined | null): Gender {
  const name = firstName(String(fullName || ""));
  if (!name) return "unknown";
  if (MALE_WITH_TA.has(name)) return "male";
  if (FEMALE.has(name)) return "female";
  // The ending ة (folded to ه) and the ending اء are overwhelmingly feminine in Egyptian names once
  // the known masculine ones above are excluded.
  if (/[هء]$/.test(name) && name.length >= 3) return "female";
  return "unknown";
}

/**
 * The gendered words a reply needs, chosen once from the name.
 *
 * `unknown` takes the masculine forms — the Arabic default for an unnamed addressee — and the
 * copy leans on `حضرتك`, which is the same for everyone, wherever it can.
 */
export interface Voice {
  /** "with you": معاك / معاكي */
  withYou: string;
  /** "you (obj.)": ليك / ليكي */
  forYou: string;
  /** "we are waiting for you": مستنينك / مستنينكي */
  waitingForYou: string;
  /** "welcome": أهلاً بيك / أهلاً بيكي */
  welcome: string;
  /** "send (imperative)": ابعت / ابعتي */
  send: string;
  /** "choose (imperative)": اختار / اختاري */
  choose: string;
  /** "you want": تحب / تحبي */
  youWant: string;
}

export function voiceFor(gender: Gender): Voice {
  if (gender === "female") {
    return {
      withYou: "معاكي",
      forYou: "ليكي",
      waitingForYou: "مستنينكي",
      welcome: "أهلاً بيكي",
      send: "ابعتي",
      choose: "اختاري",
      youWant: "تحبي",
    };
  }
  return {
    withYou: "معاك",
    forYou: "ليك",
    waitingForYou: "مستنينك",
    welcome: "أهلاً بيك",
    send: "ابعت",
    choose: "اختار",
    youWant: "تحب",
  };
}
