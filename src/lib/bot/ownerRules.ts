/**
 * Three things clinic owners asked the WhatsApp bot to stop, that came from code rather than from
 * the model — so no amount of coaching text could fix them:
 *
 *   1. dentist names in the booking/cancel cards, the slot labels and the AI's replies
 *      (settings/whatsapp `botHideDoctorNames`, default off);
 *   2. the "clinic is closed, we open at…" note under every hand-off (`botClosedNote`, default
 *      off — gated in respond.ts, nothing here);
 *   3. a second branch neither brain had ever been told about.
 *
 * The pure pieces live here so they can be tested: respond.ts itself cannot be imported by a
 * test. With the switch off and a single-branch clinic, everything below returns exactly what
 * respond.ts produced before it existed.
 *
 * Run: npm run test:bot-owner-rules
 */
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import type { ClinicBranch } from "@/lib/clinicLocations";

/** How an appointment reads in a chat message; `hideDoctor` drops the dentist line. */
export function appointmentLine(a: { date: string; time: string; doctor: string }, hideDoctor = false): string {
  const parts = [`📅 ${arabicDayLabel(a.date)}`, `⏰ ${arabicTimeLabel(a.time)}`];
  if (!hideDoctor && a.doctor && a.doctor.toLowerCase() !== "any") parts.push(`👨‍⚕️ ${a.doctor}`);
  return parts.join("\n");
}

/**
 * The clinic's branches as prompt lines, for a clinic that has more than one.
 *
 * Empty for no branches or one (the single address line already says it), and empty when no
 * branch has anything to say — an empty string keeps both prompts byte-identical to before.
 */
export function branchesTextOf(branches: ClinicBranch[] | undefined): string {
  if (!branches || branches.length < 2) return "";
  return branches
    .map((b) => {
      const name = String(b.name || "").trim();
      const address = String(b.address || "").trim();
      const phone = String(b.phone || "").trim();
      if (!address && !phone) return "";
      return `• ${name}${address ? `: ${address}` : ""}${phone ? ` — ت: ${phone}` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * The branch list as a source of allowed numbers: each phone collapsed to its digits.
 *
 * The number guards read every digit run in their sources as allowed, so "+20 100 123 4567"
 * would have let 20, 100, 123 and 4567 through on their own — as prices, too. Collapsed, only
 * the whole phone is allowed; the addresses' own numbers ("عمارة 12") stay as they are.
 */
export function branchNumbersOf(branchesText: string): string {
  if (!branchesText) return "";
  return branchesText
    .split("\n")
    .map((line) => line.replace(/ — ت: (.+)$/, (_m, phone: string) => ` — ت: ${phone.replace(/\D/g, "")}`))
    .join("\n");
}

/**
 * A title written before a name, in either script: "د. ", "دكتور ", "الدكتورة ", "للدكتور ",
 * "Dr. ", "Doctor ". The "ل" form is "ل" + "الدكتور" with its alef dropped.
 */
const TITLE_SOURCE = String.raw`(?:(?:ال|ل)?دكتور[ةه]?|د\s*[./]|dr\.?|doctor)\s*`;
const TITLE_AT_START = new RegExp(`^${TITLE_SOURCE}`, "iu");
/** Harakat and other combining marks: never part of a name's identity. */
const MARKS = /\p{M}/gu;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (s: string) => s.replace(MARKS, "").trim().toLowerCase();

export type StripDoctorOptions = {
  /** Text that is never rewritten where it appears whole: the clinic's name, address, branches. */
  protect?: string[];
  /** The patient's own name: a bare match made only of its words is the patient, not a dentist. */
  patientName?: string;
};

/**
 * The model's words with every dentist's name replaced by "الدكتور" ("the doctor" in a reply
 * written mostly in Latin letters). A backstop for the prompt rule, used only while names are
 * hidden, and only on what the model wrote — never on the clinic's own cards.
 *
 * Whole words only, any case, any spacing between the name's words, harakat ignored, and a title
 * in front of the name goes with it ("د. محمد سمير" → "الدكتور"). An Arabic conjunction stuck to
 * the front is kept ("ود. محمد" → "والدكتور", "للدكتور محمد" → "للدكتور").
 *
 * What it must not touch, because the same words are often somebody or something else:
 * - a span equal to anything in `protect` ("عيادة د. أحمد سمير", "شارع محمد علي");
 * - a match with no title in front that is made only of the patient's own name's words
 *   ("أهلاً يا أحمد" when the patient is Ahmed);
 * - a single word with no title in front, unless the clinic stored that dentist as that bare
 *   single word: "د. أحمد" stored means "أحمد" alone could be anybody.
 */
export function stripDoctorNames(text: string, doctors: string[], opts: StripDoctorOptions = {}): { text: string; stripped: boolean } {
  const seen = new Set<string>();
  const entries = doctors
    .map((d) => {
      const stored = String(d || "").replace(MARKS, "").trim();
      const core = stored.replace(TITLE_AT_START, "").trim();
      return { core, words: core.split(/\s+/), titledStore: core !== stored };
    })
    .filter((e) => e.core.length >= 2 && !seen.has(bare(e.core)) && seen.add(bare(e.core)))
    .sort((a, b) => b.core.length - a.core.length);
  if (!entries.length || !text) return { text, stripped: false };

  const latin = (text.match(/[A-Za-z]/g) || []).length > (text.match(/[؀-ۿ]/g) || []).length;
  const doctor = latin ? "the doctor" : "الدكتور";
  const patientWords = new Set(bare(opts.patientName || "").split(/\s+/).filter((w) => w.length >= 2));
  const protect = (opts.protect || []).map((p) => String(p || "").trim().toLowerCase()).filter((p) => p.length >= 2);

  /** Where the protected text sits in `s` right now, as [start, end) ranges. */
  const guarded = (s: string): Array<[number, number]> => {
    const lower = s.toLowerCase();
    const out: Array<[number, number]> = [];
    for (const p of protect) for (let i = lower.indexOf(p); i >= 0; i = lower.indexOf(p, i + 1)) out.push([i, i + p.length]);
    return out;
  };

  let out = text;
  let stripped = false;
  for (const e of entries) {
    const ranges = guarded(out);
    // Every letter may carry harakat: "مُحَمَّد" and "محمدٌ" are both "محمد".
    const words = e.words.map((w) => [...w].map((ch) => `${escapeRegExp(ch)}\\p{M}*`).join("")).join(String.raw`\s+`);
    const re = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}])([وفبل]?)(${TITLE_SOURCE})?${words}(?![\p{L}\p{N}\p{M}])`, "giu");
    out = out.replace(re, (match: string, prefix: string, title: string | undefined, offset: number) => {
      const end = offset + match.length;
      if (ranges.some(([a, b]) => offset < b && end > a)) return match;
      if (!title) {
        const said = bare(match.slice(prefix.length)).split(/\s+/);
        if (said.every((w) => patientWords.has(w))) return match;
        if (e.words.length === 1 && e.titledStore) return match;
      }
      stripped = true;
      // ل + الدكتور is written للدكتور; the others simply join.
      return !latin && prefix === "ل" ? "للدكتور" : `${prefix}${doctor}`;
    });
  }
  if (stripped) {
    // "الدكتور د. محمد" → "الدكتور الدكتور" → "الدكتور".
    out = out
      .replace(/((?:[وفب]?ال|لل)دكتور)\s+الدكتور(?![\p{L}\p{N}\p{M}])/gu, "$1")
      .replace(/\b(the doctor)\s+the doctor\b/giu, "$1");
  }
  return { text: out, stripped };
}
