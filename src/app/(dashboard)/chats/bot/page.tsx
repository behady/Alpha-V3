"use client";

import WhatsAppSettingsTab from "@/components/whatsapp/WhatsAppSettingsTab";

/** WhatsApp → Auto-reply: pick who answers patients (bot, AI, both), then that mode's steps. */
export default function WhatsAppBotPage() {
  return <WhatsAppSettingsTab sectionId="whatsapp_bot" />;
}
