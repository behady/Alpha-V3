"use client";

import WhatsAppSettings from "@/components/settings/WhatsAppSettings";

/** WhatsApp → Bot (was Settings → Bot): who answers patients, the scripted bot's switches, ready answers, playground. */
export default function WhatsAppBotHost() {
  return <WhatsAppSettings section="bot" />;
}
