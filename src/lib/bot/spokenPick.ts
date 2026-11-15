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

import { shiftDateKey } from "./relativeDay";

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

/**
 * Which of the offered times a reply actually said out loud, in the order it said them.
 *
 * "The first one" counts in the order the patient heard, so this list is what a pick resolves
 * against. A clock alone is not an identifier — "6:30" is on offer on Saturday AND Sunday — so
 * each clock is tied to the day or date mentioned nearest BEFORE it in the sentence. The earlier
 * rule accepted a slot when its day appeared anywhere in the reply, so "السبت 6:30 أو الأحد 3:00"
 * also stored Sunday 6:30, a time nobody had offered, and the positions shifted under the
 * patient's answer. With no day in front of it, a clock counts only when one slot carries it.
 */
export function spokenSlots(said: string, offer: Array<{ key: string; label: string }>, todayKey?: string): string[] {
  const text = normalize(said);
  const slots = offer
    .map((s) => ({
      key: s.key,
      // The digits only: the assistant says "10:30 بالليل" as often as "10:30 م".
      clock: s.label.match(/\d{1,2}:\d{2}/)?.[0] || "",
      date: s.label.match(/\d{1,2}\/\d{1,2}/)?.[0] || "",
      day: normalize(s.label.match(/^(\S+)/)?.[1] || ""),
    }))
    .filter((s) => s.clock);

  const positions = (needle: string): number[] => {
    const out: number[] = [];
    if (!needle) return out;
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      // "3:00" inside "13:00", or "4/11" inside "14/11", is not a mention of its own.
      if (/\d/.test(needle[0]) && /\d/.test(text[at - 1] || "")) continue;
      out.push(at);
    }
    return out;
  };

  const marks: Array<{ at: number; day?: string; date?: string }> = [];
  for (const day of new Set(slots.map((s) => s.day).filter((d) => d.length > 2))) for (const at of positions(day)) marks.push({ at, day });
  for (const date of new Set(slots.map((s) => s.date).filter(Boolean))) for (const at of positions(date)) marks.push({ at, date });
  // "النهارده 3:00 أو بكره 6:30": the day word names a date as surely as "14/11" does, once today
  // is known. Slot keys start with their date ("2026-11-14|03:00 PM|…"). Without today: as before.
  if (todayKey && /^\d{4}-\d{2}-\d{2}$/.test(todayKey)) {
    for (const m of text.matchAll(/(?<![ء-ي])[وف]?(بعد\s+بكر[هةا]|بكر[هةا]|ال?نهارد[هة])(?![ء-ي])/g)) {
      const target = shiftDateKey(todayKey, /^بعد/.test(m[1]) ? 2 : /^بكر/.test(m[1]) ? 1 : 0);
      const date = slots.find((s) => s.key.startsWith(target))?.date;
      if (date) marks.push({ at: m.index ?? 0, date });
    }
  }

  const hits: Array<{ key: string; at: number }> = [];
  for (const clock of new Set(slots.map((s) => s.clock))) {
    const sameClock = slots.filter((s) => s.clock === clock);
    for (const at of positions(clock)) {
      const before = marks.filter((m) => m.at < at).sort((a, b) => b.at - a.at)[0];
      let chosen = before ? sameClock.filter((s) => (before.day ? s.day === before.day : s.date === before.date)) : [];
      if (chosen.length !== 1 && sameClock.length === 1) chosen = sameClock;
      if (chosen.length === 1 && !hits.some((h) => h.key === chosen[0].key)) hits.push({ key: chosen[0].key, at });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.key);
}

/**
 * Is this message agreement and nothing else — "تمام", "ماشي 👍", "اوك تمام"?
 *
 * After two times were offered, that says yes to booking without saying which. The model was
 * asked to settle it and either booked the first one itself or lost the thread and greeted the
 * patient again, so the caller asks "this one or that one?" in code.
 */
export function isBareAgreement(text: string): boolean {
  const words = normalize(text)
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.length > 3) return false;
  const agree = new Set(AGREEMENT.map(normalize));
  return words.every((w) => agree.has(w));
}
