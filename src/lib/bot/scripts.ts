import type { BotScript } from "@/types/whatsapp";
import { has, normalize } from "./quickAnswers";

/**
 * The clinic's own scripts, matched the same way the built-in keyword answers are.
 *
 * A script is a list of trigger words and the exact reply. Both sides go through the same
 * normaliser as the built-in intents (ى→ي, ة→ه, digits, spacing), so a trigger typed "على" still
 * matches a message typed "علي" — the trap that silently killed keyword routes before. Matching is
 * whole-word containment, never substring: "تقويم" must not fire on "التقويمات" … it does, because
 * the leading ال is not split; but it must never fire inside an unrelated word.
 *
 * When several scripts match, the one whose matching trigger is LONGEST wins: "تقويم شفاف" is more
 * specific than "تقويم", and the clinic wrote the longer one for exactly this message.
 */
export function matchScript(text: string, scripts: readonly BotScript[] | undefined): BotScript | null {
  if (!scripts?.length) return null;
  const norm = stripArticle(normalize(text));
  if (!norm) return null;

  let best: { script: BotScript; length: number } | null = null;
  for (const script of scripts) {
    if (script.enabled === false) continue;
    if (!script.reply?.trim()) continue;
    for (const trigger of script.triggers ?? []) {
      const t = stripArticle(normalize(trigger));
      if (!t) continue;
      if (!has(norm, [t])) continue;
      if (!best || t.length > best.length) best = { script, length: t.length };
    }
  }
  return best?.script ?? null;
}

/**
 * Drops the definite article from every word, on both the message and the trigger.
 *
 * A clinic types the trigger "تقويم"; the patient types "التقويم بكام". Whole-word matching sees
 * two different words and the script never fires — the same trap the built-in lists fell into
 * before each of them was written out twice. Only words with at least two letters after the
 * article are touched, so "ألم" (pain) and "ألف" (thousand) keep their shape.
 */
function stripArticle(text: string): string {
  return text.replace(/(^|\s)(?:و)?ال(?=\S{2,})/g, "$1");
}

/** "تقويم, تقويم اسنان، braces" → ["تقويم", "تقويم اسنان", "braces"]. Commas of either script or new lines. */
export function parseTriggers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,،\n]+/)) {
    const t = piece.trim();
    if (!t) continue;
    const key = normalize(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Drops scripts that could never fire, so a half-filled row in the editor is not saved as live.
 * Builds each object without undefined keys: Firestore rejects a write that carries one, and in
 * the browser that failure looks exactly like a permissions problem.
 */
export function cleanScripts(scripts: readonly BotScript[] | undefined): BotScript[] {
  const out: BotScript[] = [];
  for (const s of scripts ?? []) {
    const triggers = (s.triggers ?? []).map((t) => t.trim()).filter(Boolean);
    const reply = (s.reply ?? "").trim();
    if (!s.id || triggers.length === 0 || !reply) continue;
    const clean: BotScript = { id: s.id, triggers, reply };
    const title = s.title?.trim();
    if (title) clean.title = title;
    if (s.enabled === false) clean.enabled = false;
    out.push(clean);
  }
  return out;
}
