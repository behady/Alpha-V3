import type { BotScript } from "@/types/whatsapp";

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
