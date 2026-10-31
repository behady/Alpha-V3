/**
 * Which brain answers a WhatsApp conversation: the standard one (answerWithAi) or the Pro one.
 *
 * Pro needs all three: the clinic chose it (botAiBrain is exactly "pro"), the whatsappPro add-on
 * is unlocked for the clinic, and the clinic runs AI-first. Anything else is the standard brain,
 * so a clinic that never touched the setting behaves exactly as before.
 */
export type AiBrain = "standard" | "pro";

export function aiBrainOf(settings: Record<string, unknown>, proUnlocked: boolean): AiBrain {
  if (!proUnlocked) return "standard";
  if (settings.botMode !== "ai_first") return "standard";
  return settings.botAiBrain === "pro" ? "pro" : "standard";
}
