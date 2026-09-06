/**
 * Which of the times the assistant just spoke did the patient mean?
 *
 * The model is asked to answer a pick with `book_slot`, and about half the time it answers with
 * `open_booking` instead — so a patient who said "the first one" was shown the dentist menu and
 * started over, and a new patient was registered with no appointment at all. Reading the pick here
 * costs nothing and does not depend on the model agreeing.
 *
 * Deliberately narrow: it only ever returns one of the keys the assistant itself offered, and only
 * for an answer short enough to be a choice rather than a sentence. "the first", "التاني", a bare
 * "10:00", the day named back, or plain agreement when only one time was on the table. Anything
 * else returns null and the model's own judgement stands.
 */

const ARABIC = "؀-ۿ";

/** Alef spellings and Arabic-Indic digits vary by keyboard; the needle must not. */
function normalize(text: string): string {
  return String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ى/g, "ي")
    .toLowerCase();
}

/**
 * A whole word, for a script JavaScript's `\b` does not understand.
 *
 * `\b` is defined against ASCII word characters, so `\bالاول\b` matches the empty space beside
 * every Arabic word and never the word itself — the first version of this file silently matched
 * nothing at all in Arabic, which is the only language most of these patients write in.
 */
function whole(needle: string): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^[a-z0-9\s]+$/.test(needle)
    ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i")
    : new RegExp(`(?<![${ARABIC}])${escaped}(?![${ARABIC}])`);
}

const ORDINALS: Array<[string[], number]> = [
  [["الاول", "الاولاني", "الاولانيه", "الاوله", "first", "1", "واحد"], 0],
  [["التاني", "الثاني", "التانيه", "الثانيه", "second", "2", "اتنين"], 1],
  [["التالت", "الثالث", "third", "3", "تلاته"], 2],
];

const AGREEMENT = ["تمام", "ماشي", "اوك", "اوكي", "ok", "okay", "yes", "ايوه", "ايوة", "حلو", "موافق", "موافقه", "يناسبني", "مناسب"];

export function resolveSpokenPick(text: string, slots: Array<{ key: string; label: string }>): string | null {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 60 || !slots.length) return null;
  const t = normalize(raw);

  for (const [needles, index] of ORDINALS) {
    if (!slots[index]) continue;
    if (needles.some((n) => whole(normalize(n)).test(t))) return slots[index].key;
  }

  // A clock the patient repeated back. The hour alone is enough when only one slot carries it.
  const clock = t.match(/(\d{1,2})(?::(\d{2}))?/);
  if (clock) {
    const [, hour, minutes] = clock;
    const matches = slots.filter((s) => {
      const m = s.label.match(/(\d{1,2}):(\d{2})/);
      return Boolean(m) && m![1] === hour && (!minutes || m![2] === minutes);
    });
    if (matches.length === 1) return matches[0].key;
  }

  // A day named back, when that day appears once in the offer.
  const named = slots.filter((s) => {
    const day = normalize(s.label.match(/^(\S+)/)?.[1] || "");
    return day.length > 2 && t.includes(day);
  });
  if (named.length === 1) return named[0].key;

  // Plain agreement, but only when there is nothing to be ambiguous about.
  if (slots.length === 1 && AGREEMENT.some((a) => whole(normalize(a)).test(t))) return slots[0].key;
  return null;
}
