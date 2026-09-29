"use client";

import LeadsBoard from "@/components/leads/LeadsBoard";

/** WhatsApp → Leads: the Leads board, narrowed to the people who wrote in on WhatsApp. */
export default function WhatsAppLeadsPage() {
  return <LeadsBoard whatsappOnly />;
}
