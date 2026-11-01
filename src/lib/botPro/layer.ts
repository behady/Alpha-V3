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
import { strayDrugNames } from "@/lib/bot/drugGuard";
import { moneyFigures, neverSayHits } from "./checks";

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
  breaks: Array<{ caseId: string; q: string; reply: string; rules: string[] }>;
  ms: number;
};

export type DroppedLine = { text: string; why: "price" | "medicine" };

export function isEmptyLayer(l: ClinicLayer): boolean {
  return !l.rules.length && !l.handoffWhen.length && !l.neverSay.length && !l.promptSection.trim();
}

/** Why a text may not be in the layer, or null when it is clean. */
function whyNot(text: string): DroppedLine["why"] | null {
  if (moneyFigures(text).length > 0) return "price";
  if (strayDrugNames(text, "").length > 0) return "medicine";
  return null;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/** A list of short strings: trimmed, no empties or duplicates, no price or medicine, capped. */
function cleanList(raw: unknown, max: number, minChars: number, maxChars: number, dropped: DroppedLine[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = clean(item);
    if (text.length < minChars || seen.has(text)) continue;
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
  return text.split(/(?<=[.؟!?])|\n/).map(clean).filter(Boolean);
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
  const neverSay = cleanList(r.neverSay, L.neverSay, L.phraseMin, L.phraseMax, dropped);

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
