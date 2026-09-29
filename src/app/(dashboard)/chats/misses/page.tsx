"use client";

import PermissionGuard from "@/components/PermissionGuard";
import PageHeader from "@/components/dashboard/PageHeader";
import BotMissesPanel from "@/components/ai/BotMissesPanel";
import { useLanguage } from "@/context/LanguageContext";

/**
 * WhatsApp → Bot misses: real patient questions the assistant handed to a person.
 *
 * It was the Intelligence page's "The Bot" tab until 2026-09-29; /ai?tab=bot forwards here. It
 * belongs beside the Bot tab, where the answer to a repeated miss is actually written.
 */
export default function WhatsAppMissesPage() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  return (
    <PermissionGuard permission="access.patients">
      <div className="mx-auto max-w-7xl px-3 pb-24 pt-5 sm:px-6 sm:pt-6 lg:pb-10 xl:px-10">
        <PageHeader
          title={isAr ? "واتساب" : "WhatsApp"}
          subtitle={
            isAr
              ? "أسئلة المرضى الحقيقية اللي المساعد حوّلها لموظف. اللي بيتكرر هنا هو اللي يستاهل إجابة جاهزة أو كلمة جديدة."
              : "Real patient questions the assistant handed to a person. Whatever repeats here is worth a ready answer or a new keyword."
          }
        />
        <div className="max-w-5xl">
          <BotMissesPanel />
        </div>
      </div>
    </PermissionGuard>
  );
}
