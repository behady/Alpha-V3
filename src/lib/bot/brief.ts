import type { BotBrief, BotFacts } from "@/types/whatsapp";
import type { AnswerMode } from "@/lib/setupWizard";

export type { BotBrief };

/**
 * The Auto-reply brief: what the owner tells the AI beyond the facts, as pure helpers.
 *
 * The brief only ever makes the AI stricter or changes its voice — it never unlocks anything. And
 * a default brief is the same as no brief: `cleanBrief` drops empty and default values, and
 * `briefLines` of an empty brief is the empty string, so a clinic that never opens the tab gets
 * today's prompt byte-for-byte. Nothing here writes `undefined`, which Firestore rejects.
 */

const TEXT_CAP = 500;
const FACT_CAP = 1000;

/** The 14 clinic facts, in the order the editor shows them. */
export const BOT_FACT_KEYS: readonly (keyof BotFacts)[] = [
  "whyUs",
  "consultation",
  "dentists",
  "walkIn",
  "durations",
  "sessions",
  "installments",
  "offers",
  "offersUntil",
  "insurance",
  "notOffered",
  "aftercare",
  "parking",
  "mapsUrl",
];

const BRIEF_TEXT_KEYS = ["focus", "neverSay", "handoffWhen"] as const;
const BRIEF_KEYS = ["focus", "tone", "prices", "neverSay", "handoffWhen"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown, cap: number): string {
  return typeof v === "string" ? v.trim().slice(0, cap).trim() : "";
}

/** Trim, cap, and drop everything that is empty, default, invalid or unknown. */
export function cleanBrief(b: unknown): BotBrief {
  const out: BotBrief = {};
  if (!isRecord(b)) return out;
  for (const k of BRIEF_TEXT_KEYS) {
    const v = text(b[k], TEXT_CAP);
    if (v) out[k] = v;
  }
  if (b.tone === "formal" || b.tone === "short") out.tone = b.tone;
  if (b.prices === "consult") out.prices = "consult";
  return out;
}

/** The lines appended to the AI prompt. Empty for an empty or default brief. */
export function briefLines(b: BotBrief | undefined): string {
  const c = cleanBrief(b);
  const lines: string[] = [];
  if (c.focus) lines.push(`- ركّز في كلامك على: ${c.focus}. اقترحها لما يكون مناسب، من غير ضغط.`);
  if (c.tone === "formal") lines.push("- اتكلم بأسلوب رسمي ومحترم، من غير هزار ولا إيموجي.");
  if (c.tone === "short") lines.push("- خلي ردودك قصيرة ومباشرة: جملة أو اتنين.");
  if (c.prices === "consult") {
    lines.push("- العيادة مش بتقول أسعار على واتساب. لو اتسألت عن سعر، قول إن الدكتور بيحدد السعر بعد الكشف واعرض تحجز كشف.");
  }
  if (c.neverSay) lines.push(`- ممنوع تتكلم في: ${c.neverSay}.`);
  if (c.handoffWhen) lines.push(`- حوّل للاستقبال دايماً لما: ${c.handoffWhen}.`);
  return lines.length ? `\nتفضيلات صاحب العيادة:\n${lines.join("\n")}` : "";
}

/** The badge on the Brief step: focus, tone, prices, never-say, handoff, and the free-text coaching. */
export function briefFilled(b: BotBrief | undefined, coaching: string | undefined): { filled: number; total: 6 } {
  const c = cleanBrief(b);
  const filled =
    (c.focus ? 1 : 0) +
    (c.tone ? 1 : 0) +
    (c.prices ? 1 : 0) +
    (c.neverSay ? 1 : 0) +
    (c.handoffWhen ? 1 : 0) +
    (coaching?.trim() ? 1 : 0);
  return { filled, total: 6 };
}

export function factsFilled(f: BotFacts | undefined): { filled: number; total: 14 } {
  const filled = BOT_FACT_KEYS.filter((k) => text(f?.[k], FACT_CAP)).length;
  return { filled, total: 14 };
}

export type AutoReplyStep = "clinic" | "replies" | "brief" | "behaviour" | "test";

/** Which setup steps each answer mode shows, in order. Only the AI-only "replies" step is optional. */
export function stepsForMode(mode: AnswerMode): Array<{ id: AutoReplyStep; optional: boolean }> {
  const step = (id: AutoReplyStep, optional = false) => ({ id, optional });
  switch (mode) {
    case "bot":
      return [step("clinic"), step("replies"), step("behaviour"), step("test")];
    case "ai":
      return [step("clinic"), step("brief"), step("behaviour"), step("test"), step("replies", true)];
    case "both":
      return [step("clinic"), step("replies"), step("brief"), step("behaviour"), step("test")];
    default:
      return [];
  }
}

/** What the "tell the AI about my clinic" interview proposes: facts and brief fields, nothing else. */
export type BriefDraft = { facts: Partial<Record<keyof BotFacts, string>>; brief: BotBrief };

/** Keep only known fact keys (trimmed, <= 1,000 chars, non-empty) and a cleaned brief. */
export function sanitizeDraft(raw: unknown): BriefDraft {
  const facts: BriefDraft["facts"] = {};
  const r = isRecord(raw) ? raw : {};
  if (isRecord(r.facts)) {
    for (const k of BOT_FACT_KEYS) {
      const v = text(r.facts[k], FACT_CAP);
      if (v) facts[k] = v;
    }
  }
  return { facts, brief: cleanBrief(r.brief) };
}

/** One proposed change. `key` is `facts.<k>` or `brief.<k>`; `old` is set when it would replace text. */
export type DraftRow = { key: string; value: string; old?: string };

export function draftRows(d: BriefDraft, facts: BotFacts | undefined, brief: BotBrief | undefined): DraftRow[] {
  const rows: DraftRow[] = [];
  const push = (key: string, value: string | undefined, current: string | undefined) => {
    if (!value) return;
    const cur = current?.trim() ?? "";
    if (cur === value) return;
    rows.push(cur ? { key, value, old: cur } : { key, value });
  };
  for (const k of BOT_FACT_KEYS) push(`facts.${k}`, d.facts[k], facts?.[k]);
  const cur = cleanBrief(brief);
  for (const k of BRIEF_KEYS) push(`brief.${k}`, d.brief[k], cur[k]);
  return rows;
}

/** Apply only the ticked rows on top of what is stored. The result has no empty or undefined keys. */
export function mergeDraft(
  facts: BotFacts | undefined,
  brief: BotBrief | undefined,
  d: BriefDraft,
  ticked: ReadonlySet<string>,
): { botFacts: BotFacts; botBrief: BotBrief } {
  const botFacts: BotFacts = {};
  for (const k of BOT_FACT_KEYS) {
    const v = ticked.has(`facts.${k}`) ? text(d.facts[k], FACT_CAP) || text(facts?.[k], FACT_CAP) : text(facts?.[k], FACT_CAP);
    if (v) botFacts[k] = v;
  }
  const next: Record<string, unknown> = { ...cleanBrief(brief) };
  for (const k of BRIEF_KEYS) {
    if (ticked.has(`brief.${k}`) && d.brief[k]) next[k] = d.brief[k];
  }
  return { botFacts, botBrief: cleanBrief(next) };
}
