import type { BotScript } from "@/types/whatsapp";
import { normalize } from "./quickAnswers";

/**
 * The clinic's fixed replies, as stored. The feature that matched them against messages was
 * retired in November 2026; what a clinic wrote is still read, cleaned here, and handed to the
 * brain as knowledge (lib/bot/respond), so nobody's wording was thrown away.
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
