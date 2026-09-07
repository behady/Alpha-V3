/**
 * What time of day the patient asked for, and which free slots to actually offer them.
 *
 * The bot never searches the calendar itself. It is handed a short list of times and told, in so
 * many words, never to offer an appointment that is not on it. So the list IS the answer: a slot
 * missing from it is a slot the clinic does not have, as far as the patient is concerned.
 *
 * That list used to be the two EARLIEST free times of each day. For a clinic open 12pm–10pm it
 * meant 12:00 and 12:30, every time, and every evening slot in the diary was invisible. A patient
 * asking for 9pm on Tuesday was told Tuesday had nothing — with Tuesday 9pm free and bookable on
 * the clinic's own screen. Reported from a real conversation on 2026-09-07.
 *
 * Two things are fixed here, and both are pure functions so they can be tested without a model,
 * a database or a network:
 *
 *   `readTimePreference` — reads "بالليل", "بعد الشغل", "الساعة ٩", "9 pm", "3ayez 9 bl leil"
 *   `pickOfferedTimes`   — chooses times that SPAN the day instead of clustering at opening
 */

/** Minutes from midnight. The rest of the codebase speaks this dialect too. */
export type Minutes = number;

export type DayWindow = "morning" | "afternoon" | "evening";

/** Windows are defined against the clock, not the clinic: a clinic that opens at noon has no morning. */
const WINDOW_BOUNDS: Record<DayWindow, [Minutes, Minutes]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

export type TimePreference =
  /** "بالليل", "بعد الشغل", "الصبح" — a part of the day. */
  | { kind: "window"; window: DayWindow }
  /** "الساعة ٩", "9 pm", "at 7:30" — a specific hour, which beats a window. */
  | { kind: "at"; minutes: Minutes }
  | null;

const AR_DIGITS = /[٠-٩]/g;
const toLatinDigits = (s: string) => s.replace(AR_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/*
 * Word lists, deliberately written as whole words with the definite article optional.
 *
 * "مسا" is a substring of nothing dangerous, but "صبح" is a substring of "أصبح" and "يصبح", which
 * appear in ordinary sentences — so morning words are matched with a boundary. See the Arabic
 * matching traps this codebase has hit before: a bare `includes` is how "إيقاف" once matched
 * inside an unrelated word.
 */
const EVENING_WORDS = ["بالليل", "الليل", "ليلا", "ليلاً", "المسا", "مسا", "المساء", "مساء", "مساءً", "بعد الشغل", "بعد العمل", "بعد ما اخلص", "بعد ما أخلص", "اخر اليوم", "آخر اليوم", "evening", "night", "tonight", "after work", "bl leil", "belleil", "belil", "bilel", "masa2", "masa"];
const AFTERNOON_WORDS = ["بعد الضهر", "بعد الظهر", "الضهر", "الظهر", "العصر", "afternoon", "noon", "midday", "el doher", "eldohr", "doher", "3asr"];
const MORNING_WORDS = ["الصبح", "الصباح", "صباحا", "صباحاً", "صباح", "بدري", "بكري", "morning", "early", "sob7", "sobh", "el sob7", "badri"];

/**
 * Whole-word containment, with Arabic proclitics allowed in front.
 *
 * A bare `includes` matches "صبح" inside "أصبح" and "مسا" inside "مساعدة", which is how an
 * ordinary sentence turns into a booking preference. A strict word boundary is wrong in the
 * other direction: Arabic glues ب/ل/ك/و/ف onto the front of a word, so "بالمسا" and "والصبح"
 * are the same request as "المسا" and "الصبح" and must still match.
 *
 * So: nothing may follow the needle inside the word, and what precedes it must be either a
 * boundary or one of those single-letter prefixes sitting on a boundary itself.
 */
const PROCLITICS = new Set(["ب", "ل", "ك", "و", "ف"]);

function mentions(haystack: string, needle: string): boolean {
  const isWordChar = (c: string | undefined) => c !== undefined && /[ء-يa-zA-Z0-9]/.test(c);
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return false;
    if (!isWordChar(haystack[i + needle.length])) {
      const before = haystack[i - 1];
      if (!isWordChar(before)) return true;
      if (PROCLITICS.has(before) && !isWordChar(haystack[i - 2])) return true;
    }
    from = i + 1;
  }
}

/**
 * Read a time-of-day preference out of what the patient wrote.
 *
 * `dayBounds` disambiguates a bare hour. "الساعة 9" at a clinic open 12pm–10pm means 9 in the
 * evening, not 9 in the morning, because 9am is not a time this clinic can offer; without the
 * bounds an evening request would be read as a morning one and the patient told to come at a
 * time the clinic is shut.
 */
export function readTimePreference(text: string, dayBounds?: { start: Minutes; end: Minutes }): TimePreference {
  const raw = toLatinDigits(String(text || "")).toLowerCase();
  if (!raw.trim()) return null;

  const explicit = readExplicitHour(raw, dayBounds);
  if (explicit !== null) return { kind: "at", minutes: explicit };

  if (EVENING_WORDS.some((w) => mentions(raw, w))) return { kind: "window", window: "evening" };
  if (AFTERNOON_WORDS.some((w) => mentions(raw, w))) return { kind: "window", window: "afternoon" };
  if (MORNING_WORDS.some((w) => mentions(raw, w))) return { kind: "window", window: "morning" };
  return null;
}

/**
 * A clock time in the message, as minutes from midnight — or null.
 *
 * Deliberately conservative: a number is only read as a time when something marks it as one (a
 * "الساعة"/"at"/"o'clock" in front, a am/pm/ص/م marker, or a `:` in it). "عندي 3 اسنان بتوجعني"
 * is not a request for three o'clock.
 */
function readExplicitHour(raw: string, dayBounds?: { start: Minutes; end: Minutes }): Minutes | null {
  /*
   * The am/pm marker, in the shapes it reaches WhatsApp in — including with the definite article
   * and the ب- prefix glued on, because "الساعة 10 الصبح" and "٧ بالليل" are how people write.
   * Longest alternatives first: "صباحاً" must win over "ص" at the same position.
   */
  const AM = "صباحاً|صباحا|الصباح|الصبح|صباح|بدري|بكري|am|ص";
  const PM = "بالمساء|مساءً|المساء|بالمسا|مساء|المسا|بالليل|الليل|مسا|pm|م";
  const MARKER = `${AM}|${PM}`;
  const patterns = [
    new RegExp(`(?:الساعه|الساعة|ساعه|ساعة|el sa3a|elsa3a|sa3a|at|around)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(${MARKER})?`),
    new RegExp(`(\\d{1,2})(?:[:.](\\d{2}))?\\s*(${MARKER})(?![ء-يa-zA-Z0-9])`),
    /(\d{1,2}):(\d{2})/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const hour = Number(m[1]);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    const minute = Number(m[2] || 0);
    if (!Number.isFinite(minute) || minute > 59) continue;
    const marker = m[3] || "";
    const isPm = new RegExp(`^(?:${PM})$`).test(marker);
    const isAm = new RegExp(`^(?:${AM})$`).test(marker);

    if (hour > 12) return hour * 60 + minute;
    if (isPm) return ((hour % 12) + 12) * 60 + minute;
    if (isAm) return (hour % 12) * 60 + minute;

    // No marker: pick the reading the clinic could actually honour, preferring the later one —
    // an afternoon clinic hears "9" as 9pm, a morning clinic hears it as 9am.
    const asAm = (hour % 12) * 60 + minute;
    const asPm = ((hour % 12) + 12) * 60 + minute;
    if (!dayBounds) return asPm;
    const fits = (v: Minutes) => v >= dayBounds.start && v < dayBounds.end;
    if (fits(asPm)) return asPm;
    if (fits(asAm)) return asAm;
    return asPm;
  }
  return null;
}

/** Which part of the day a time falls in. */
export function windowOf(minutes: Minutes): DayWindow {
  for (const w of ["morning", "afternoon", "evening"] as DayWindow[]) {
    const [lo, hi] = WINDOW_BOUNDS[w];
    if (minutes >= lo && minutes < hi) return w;
  }
  return "evening";
}

/**
 * Choose which of a day's free times to actually put in front of the patient.
 *
 * `free` arrives ascending and can be forty entries long; the patient gets two or three. The old
 * code took the head of the list, which is why a clinic open 12pm–10pm only ever offered noon.
 *
 * Rules, in order:
 *   1. An explicit hour wins: offer that exact time when it is free, and the nearest free time
 *      to it either way after that.
 *   2. A window ("بالليل") filters the day; if the day has nothing in that window, the day
 *      contributes nothing rather than a wrong-window time — the caller decides what to do when
 *      no day can satisfy it.
 *   3. Otherwise SPREAD: evenly spaced picks across the whole day, so the last slot of the
 *      evening is always as reachable as the first slot of the morning.
 */
export function pickOfferedTimes(free: Minutes[], count: number, preference: TimePreference): Minutes[] {
  const times = [...free].sort((a, b) => a - b);
  if (!times.length || count <= 0) return [];

  if (preference?.kind === "at") {
    const target = preference.minutes;
    const byDistance = [...times].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    return byDistance.slice(0, count).sort((a, b) => a - b);
  }

  const pool =
    preference?.kind === "window"
      ? times.filter((t) => {
          const [lo, hi] = WINDOW_BOUNDS[preference.window];
          return t >= lo && t < hi;
        })
      : times;
  if (!pool.length) return [];
  return spread(pool, count);
}

/** `count` items sampled evenly across the list, always including its first and last. */
function spread(list: Minutes[], count: number): Minutes[] {
  if (count >= list.length) return [...list];
  if (count === 1) return [list[0]];
  const out: Minutes[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (list.length - 1)) / (count - 1));
    const v = list[idx];
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
