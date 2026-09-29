"use client";

import PageHeader from "@/components/dashboard/PageHeader";
import SettingsSectionView from "@/components/settings/SettingsSectionView";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { useLanguage } from "@/context/LanguageContext";

/**
 * A settings section shown as a tab of the WhatsApp page — the Bot and the AI, which moved out of
 * Settings to sit beside the chats they shape. Rendered through the same view Settings uses, so
 * the add-on lock, the admin-only rule and the read-only notice are exactly what they were there.
 */
export default function WhatsAppSettingsTab({ sectionId }: { sectionId: "whatsapp_bot" | "whatsapp_ai" }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId)!;

  return (
    <div className="mx-auto max-w-7xl px-3 pb-24 pt-5 sm:px-6 sm:pt-6 lg:pb-10 xl:px-10">
      <PageHeader title={isAr ? "واتساب" : "WhatsApp"} subtitle={isAr ? section.hintAr : section.hintEn} />
      <div className="max-w-5xl">
        <SettingsSectionView section={section} />
      </div>
    </div>
  );
}
