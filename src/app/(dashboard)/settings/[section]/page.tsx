"use client";

/**
 * One settings section.
 *
 * Every section route resolves through here: the registry says which panel to load and who may
 * open it, and this file is the only thing that renders one. There is no per-section page file
 * to forget to guard.
 *
 * The access check is the same function the sidebar uses, so a section that is hidden from the
 * menu cannot be opened by typing its address either. That mattered: hiding a tab's button used
 * to hide nothing at all — typing ?tab=services, ?tab=users or ?tab=locations opened that panel
 * for anyone who could reach Settings, and the clinic's prices, staff list and messaging
 * configuration were all readable that way.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { SETTINGS_PANELS } from "@/components/settings/panels";
import SettingsSectionView from "@/components/settings/SettingsSectionView";

export default function SettingsSectionPage() {
  const params = useParams<{ section: string }>();
  const router = useRouter();

  const segment = typeof params?.section === "string" ? params.section : "";
  const section = SETTINGS_SECTIONS.find((s) => s.route === `/settings/${segment}`);

  // A section that moved out of Settings (the WhatsApp Bot and AI tabs) forwards to its new home;
  // the promo scripts and people's bookmarks still carry the old address.
  const movedTo = section?.movedTo;
  useEffect(() => {
    if (movedTo) router.replace(movedTo);
  }, [movedTo, router]);

  if (movedTo) {
    return <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden="true" />;
  }

  if (!section || !SETTINGS_PANELS[section.id]) return <NotFound />;

  return <SettingsSectionView section={section} />;
}

function NotFound() {
  const { language } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
      <div className="w-20 h-20 bg-surface-muted text-ink-muted rounded-[1.75rem] flex items-center justify-center mb-6">
        <SearchX size={34} />
      </div>
      <h2 className="text-2xl font-black text-ink mb-2 tracking-tight">
        {language === "ar" ? "لا يوجد قسم هنا" : "No settings section here"}
      </h2>
      <p className="max-w-md text-sm font-semibold text-ink-muted mb-6">
        {language === "ar"
          ? "الرابط قد يكون قديماً. اختر قسماً من القائمة."
          : "That link may be out of date. Pick a section from the list."}
      </p>
      <Link
        href="/settings"
        className="rounded-2xl bg-accent px-6 py-3 text-sm font-bold text-ink-on-accent transition-all active:scale-95"
      >
        {language === "ar" ? "كل الإعدادات" : "All settings"}
      </Link>
    </div>
  );
}
