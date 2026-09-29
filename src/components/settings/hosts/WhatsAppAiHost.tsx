"use client";

import WhatsAppSettings from "@/components/settings/WhatsAppSettings";

/** WhatsApp → AI (was Settings → AI Assistant): the model's name, coaching, reply cap and pacing. Spends credits. */
export default function WhatsAppAiHost() {
  return <WhatsAppSettings section="ai" />;
}
