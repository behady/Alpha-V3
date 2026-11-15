/**
 * The clinic layer: what the owner teaches Pro about how this clinic talks and sells.
 *
 * It is text the owner agreed to, added AFTER the fixed rulebook. It can never change the red
 * lines: prices, medicines, times and booking stay code (checks.ts), so the sanitiser here keeps
 * any price or medicine out of the layer altogether, and the only check the layer adds is the
 * owner's own never-say list (neverSayHits, enforced by checkReply).
 *
 * Pure: no Firestore, no model. checks.ts must not import this file (it owns the matching and
 * this file re-exports it), so there is no import cycle.
 *
 * Run: npm run test:pro-layer
 */
import type { UnavailableKind } from "./replayVerdict";
import { strayDrugNames } from "@/lib/bot/drugGuard";
import { moneyFigures, neverSayHits, normalizeNeverSay } from "./checks";

export { neverSayHits };

export type ClinicLayer = {
  /** How we talk and sell: one instruction per line. */
  rules: string[];
  /** Situations where the chat goes to the team. */
  handoffWhen: string[];
  /** Phrases the bot must never say; a reply containing one is rejected by checkReply. */
  neverSay: string[];
  /** Free text about the clinic's style, already stripped of prices and medicines. */
  promptSection: string;
};

export const EMPTY_LAYER: ClinicLayer = { rules: [], handoffWhen: [], neverSay: [], promptSection: "" };

export const LAYER_LIMITS = { rules: 30, handoffWhen: 15, neverSay: 20, lineChars: 300, phraseMin: 3, phraseMax: 80, promptChars: 2000 } as const;

/** What a replay of the test conversations found (defined here so the store can type versions). */
export type ReplaySummary = {
  passed: boolean;
  turns: number;
  unavailable: number;
  actionMisses: number;
  /**
   * Turns that ended with a hand-off to the team where the conversation expected no hand-off.
   * Optional only so versions saved before it existed still read; runReplay always sets it.
   */
  unexpectedHandoffs?: number;
  breaks: Array<{ caseId: string; q: string; reply: string; rules: string[] }>;
  ms: number;
  /** The run hit its deadline; the turns it never reached are counted unavailable. */
  timedOut?: boolean;
  /** Why Pro could not answer, counted by kind (replayVerdict.unavailableKind). Set when unavailable > 0. */
  unavailableReasons?: Partial<Record<UnavailableKind, number>>;
  /** The first raw failure message of the run, for the activity log. Never shown to patients. */
  unavailableSample?: string;
  /** Turns tried a second time after a failure that may pass on its own (rate limit, unreachable, timeout). */
  retries?: number;
};

/**
 * Why a line was kept out of the layer: a money figure ("price"), a medicine, or a bare number of
 * two or more digits that is not a duration or count ("number": often a price written without a
 * currency, but the owner may also have meant a time or a count, so the screen asks for a reword).
 */
export type DroppedLine = { text: string; why: "price" | "medicine" | "number" };

export function isEmptyLayer(l: ClinicLayer): boolean {
  return !l.rules.length && !l.handoffWhen.length && !l.neverSay.length && !l.promptSection.trim();
}

/*
 * A price as an owner writes it: "الكشف بـ 300", "السعر ٣٠٠", "الحشو ب 500 ج". Often there is no
 * currency word, so moneyFigures (a unit or % attached) is not enough here. In a layer line, a
 * standalone number of two or more digits is kept out (reason "number") unless a duration or count
 * word follows it ("خلال 15 دقيقة", "بعد 14 يوم"). Phones, full dates and clock times are not figures.
 */
const DURATION_AFTER =
  /^\s*(?:يوم|ايام|أيام|شهر|شهور|سنة|سنه|سنين|دقيقة|دقيقه|دقايق|دقائق|ساعة|ساعه|ساعات|مرة|مره|مرات|اسبوع|أسبوع|جلسة|جلسه|جلسات|days?|weeks?|months?|minutes?|hours?|sessions?|times?)/iu;
const LAYER_PHONE = /(?<![\d+])(?:\+\s?20[\s-]?|0)\d(?:[\s-]?\d){8,10}(?!\d)/g;
const LAYER_DATE = /(?<!\d)(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})(?!\d)/g;
const LAYER_CLOCK = /(?<!\d)\d{1,2}:\d{2}(?!\d)/g;
const foldDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** A standalone number of two or more digits with no duration or count word after it. */
function bareNumber(text: string): boolean {
  const t = foldDigits(text).replace(LAYER_PHONE, " ").replace(LAYER_DATE, " ").replace(LAYER_CLOCK, " ");
  for (const m of t.matchAll(/(?<!\p{N})\d[\d,]*(?:\.\d+)?/gu)) {
    if (m[0].replace(/\D/g, "").length < 2) continue;
    if (DURATION_AFTER.test(t.slice((m.index ?? 0) + m[0].length))) continue;
    return true;
  }
  return false;
}

/** Why a text may not be in the layer, or null when it is clean (a price or number is reported before a medicine). */
function whyNot(text: string): DroppedLine["why"] | null {
  if (moneyFigures(text).length > 0) return "price";
  if (bareNumber(text)) return "number";
  if (strayDrugNames(text, "").length > 0) return "medicine";
  return null;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * A list of short strings: trimmed, no empties or duplicates, no price or medicine, capped.
 * `longEnough` (default: at least minChars) decides whether an item is kept at all.
 */
function cleanList(
  raw: unknown,
  max: number,
  minChars: number,
  maxChars: number,
  dropped: DroppedLine[],
  longEnough: (text: string) => boolean = (text) => text.length >= minChars,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = clean(item);
    if (!longEnough(text) || seen.has(text)) continue;
    seen.add(text);
    const why = whyNot(text);
    if (why) {
      dropped.push({ text, why });
      continue;
    }
    if (out.length < max) out.push(text.slice(0, maxChars));
  }
  return out;
}

/** Sentences with their ending mark kept: split after . ؟ ! and at line breaks. */
function sentences(text: string): string[] {
  return text.split(/(?<=[؟!?])|(?<=\D\.)|(?<=\d\.)(?!\d)|\n/).map(clean).filter(Boolean);
}

/**
 * Whatever came back from the model or the database, made safe to store and to prompt with.
 * Anything that is not the expected shape becomes empty rather than throwing.
 */
export function sanitizeLayer(raw: unknown): { layer: ClinicLayer; dropped: DroppedLine[] } {
  const dropped: DroppedLine[] = [];
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const L = LAYER_LIMITS;

  const rules = cleanList(r.rules, L.rules, 1, L.lineChars, dropped);
  const handoffWhen = cleanList(r.handoffWhen, L.handoffWhen, 1, L.lineChars, dropped);
  // A never-say phrase is matched in normalizeNeverSay spelling, so it is measured there too: a
  // phrase that folds to under phraseMin letters would be found in almost any reply.
  const neverSay = cleanList(r.neverSay, L.neverSay, L.phraseMin, L.phraseMax, dropped, (text) => text.length >= L.phraseMin && normalizeNeverSay(text).length >= L.phraseMin);

  const kept: string[] = [];
  if (typeof r.promptSection === "string") {
    for (const s of sentences(r.promptSection)) {
      const why = whyNot(s);
      if (why) dropped.push({ text: s, why });
      else kept.push(s);
    }
  }
  const promptSection = kept.join(" ").slice(0, L.promptChars).trim();

  return { layer: { rules, handoffWhen, neverSay, promptSection }, dropped };
}
