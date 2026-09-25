/**
 * The insurers an Egyptian dental clinic is most likely to be typing in, and how to draw one.
 *
 * Two jobs, both small, both about the same thing: a clinic should recognise a payer without
 * reading it. The preset list means the common names are picked rather than spelled — "NEXtCARE"
 * and "جلوب ميد" are not words anybody types the same way twice, and a payer's name is stamped on
 * every case recorded under it, so three spellings become three columns in the report that never
 * add up. The badge means the name is recognisable at a glance in a table of forty rows.
 *
 * WHY THERE ARE NO REAL LOGOS HERE. Every one of these is a registered trademark. A clinic using
 * an insurer's logo on its own paperwork is one thing; this product shipping a library of other
 * companies' marks to every customer who buys it is another, and the downside is out of all
 * proportion to the feature. So the badge is a monogram the app draws itself, and a clinic that
 * wants the real mark can upload it against that insurer — its contract, its call.
 *
 * The list is a STARTING POINT, not a gate. Anything can still be typed: a clinic with a private
 * arrangement, a new entrant, a syndicate scheme nobody else has. Presets that refuse the
 * unlisted case are worse than no presets.
 */

export type InsurerGroup = "insurer" | "tpa" | "public";

export type InsurerPreset = {
  name: string;
  nameAr: string;
  group: InsurerGroup;
};

export const INSURER_GROUPS: { id: InsurerGroup; en: string; ar: string; note: { en: string; ar: string } }[] = [
  {
    id: "tpa",
    en: "Networks",
    ar: "شبكات الرعاية",
    // Listed first on purpose: the name printed on a patient's card is usually the administrator,
    // not the insurer behind it, so this is the list a receptionist is actually looking at.
    note: { en: "Usually the name on the patient's card", ar: "دول غالباً اللي مكتوب على كارت المريض" },
  },
  {
    id: "insurer",
    en: "Insurance companies",
    ar: "شركات التأمين",
    note: { en: "The insurer behind the network", ar: "شركة التأمين اللي وراء الشبكة" },
  },
  {
    id: "public",
    en: "Government & syndicates",
    ar: "جهات حكومية ونقابات",
    note: { en: "Schemes rather than insurers, billed the same way", ar: "أنظمة مش شركات، بس بتتحاسب بنفس الطريقة" },
  },
];

export const INSURER_PRESETS: InsurerPreset[] = [
  // --- networks / TPAs ---------------------------------------------------------------------
  { name: "GlobeMed Egypt", nameAr: "جلوب ميد مصر", group: "tpa" },
  { name: "MedNet Egypt", nameAr: "ميدنت مصر", group: "tpa" },
  { name: "NEXtCARE", nameAr: "نكست كير", group: "tpa" },
  { name: "Medmark", nameAr: "ميدمارك", group: "tpa" },

  // --- insurers ------------------------------------------------------------------------------
  { name: "MetLife Egypt", nameAr: "متلايف مصر", group: "insurer" },
  { name: "AXA Egypt", nameAr: "أكسا مصر", group: "insurer" },
  { name: "Allianz Egypt", nameAr: "أليانز مصر", group: "insurer" },
  { name: "Misr Insurance", nameAr: "مصر للتأمين", group: "insurer" },
  { name: "Bupa Egypt", nameAr: "بوبا إيجيبت", group: "insurer" },
  // gig Egypt and AXA Egypt are separate companies and both belong here. The AXA-to-gig rebrand
  // was the Gulf business; AXA Egypt still trades under its own name.
  { name: "gig Egypt", nameAr: "چي آي چي مصر", group: "insurer" },
  { name: "Suez Canal Insurance", nameAr: "قناة السويس للتأمين", group: "insurer" },
  { name: "Wethaq Takaful", nameAr: "وثاق للتأمين التكافلي", group: "insurer" },
  { name: "Delta Insurance", nameAr: "دلتا للتأمين", group: "insurer" },

  // --- public schemes and syndicates ---------------------------------------------------------
  { name: "Health Insurance Organization", nameAr: "الهيئة العامة للتأمين الصحي", group: "public" },
  { name: "Universal Health Insurance", nameAr: "التأمين الصحي الشامل", group: "public" },
  { name: "Engineers' Syndicate", nameAr: "نقابة المهندسين", group: "public" },
  { name: "Doctors' Syndicate", nameAr: "نقابة الأطباء", group: "public" },
  { name: "Lawyers' Syndicate", nameAr: "نقابة المحامين", group: "public" },
  { name: "Teachers' Syndicate", nameAr: "نقابة المعلمين", group: "public" },
  { name: "Armed Forces", nameAr: "القوات المسلحة", group: "public" },
  { name: "Police Hospitals", nameAr: "مستشفيات الشرطة", group: "public" },
];

export function presetsIn(group: InsurerGroup): InsurerPreset[] {
  return INSURER_PRESETS.filter((p) => p.group === group);
}

/* --- the badge ------------------------------------------------------------------------------ */

/**
 * Up to two letters, from whichever script the name is in.
 *
 * Arabic has no case and no uppercase form, so `toUpperCase` is a no-op there rather than wrong —
 * but the FIRST LETTER of an Arabic name is the last character visually, and taking it by index
 * is still correct: the string is stored in logical order and the browser reverses it for display.
 * Getting that wrong would put the wrong letter on every Arabic payer, consistently, which is the
 * kind of thing that looks deliberate.
 */
export function insurerInitials(name: string): string {
  const words = name
    .trim()
    // "Engineers' Syndicate" and "gig Egypt" both want their real first letters, so punctuation
    // between words is a separator rather than a character.
    .split(/[\s\-_/'’.]+/)
    .filter(Boolean)
    /**
     * A trailing country word carries no information — half this list ends in "Egypt".
     *
     * Never the FIRST word, though, and that distinction is the whole of this line: "مصر للتأمين"
     * IS Misr Insurance, so dropping its first word would badge the country's oldest insurer by
     * its second syllable.
     */
    .filter((w, i) => i === 0 || !/^(egypt|مصر)$/i.test(w));
  if (words.length === 0) return "?";

  /**
   * The Arabic definite article is written joined to its noun, so taking the first character of
   * "الهيئة" gives "ا" — and so does every other name that starts with one. A column of
   * badges all reading the same letter distinguishes nothing, which is the failure this whole
   * feature exists to avoid.
   */
  const letterOf = (word: string) => {
    const bare = /^ال.{2,}/.test(word) ? word.slice(2) : word;
    return [...bare][0] ?? "";
  };

  const second = words[1] ? letterOf(words[1]) : "";
  return (letterOf(words[0]) + second).toUpperCase();
}

/**
 * A stable tone per name, from the same muted set the chat avatars use.
 *
 * Colour here is identity, not decoration — the same argument that lets a patient avatar be
 * coloured on a screen whose chrome is deliberately achromatic. It has to be STABLE: an insurer
 * that changed colour between two reports would be read as two insurers, which is worse than no
 * colour at all. Derived from the name rather than stored, so nothing has to be migrated and a
 * renamed insurer simply gets a new tone.
 */
const TONES = ["#6ac2a3", "#7fb3e0", "#e0a97f", "#c39be0", "#e08b8b", "#8bc7e0", "#b8d17f", "#d1a7c4"];

export function insurerTone(name: string): string {
  let hash = 0;
  for (const ch of name.trim()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return TONES[hash % TONES.length];
}

/** Everything a badge needs, so a caller never derives half of it and forgets the rest. */
export function insurerBadge(name: string): { initials: string; tone: string } {
  return { initials: insurerInitials(name), tone: insurerTone(name) };
}
