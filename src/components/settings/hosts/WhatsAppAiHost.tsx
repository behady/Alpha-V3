"use client";

import WhatsAppSettings from "@/components/settings/WhatsAppSettings";

/**
 * The old AI Assistant section (/settings/whatsapp-ai). The AI's settings now live inside the
 * WhatsApp page's Auto-reply tab, so this renders the same single screen as the Bot host; the
 * section's own route forwards to /chats/bot?step=ai and normally never shows this.
 */
export default function WhatsAppAiHost() {
  return <WhatsAppSettings section="bot" />;
}
