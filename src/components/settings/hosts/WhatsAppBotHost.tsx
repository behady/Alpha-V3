"use client";

import WhatsAppSettings from "@/components/settings/WhatsAppSettings";

/** WhatsApp → Auto-reply (was Settings → Bot): pick who answers patients, then that mode's steps. */
export default function WhatsAppBotHost() {
  return <WhatsAppSettings section="bot" />;
}
