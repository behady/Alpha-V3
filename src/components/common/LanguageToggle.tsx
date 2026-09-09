"use client";

import { Languages } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

/**
 * The language switch for screens that have no sidebar: login, onboarding, the invite page.
 * The label names the OTHER language, in that language, so it can be read by the person who
 * needs it. Positioned by the caller.
 */
export default function LanguageToggle({ className = "" }: { className?: string }) {
  const { language, toggleLanguage } = useLanguage();
  const other = language === "ar" ? "English" : "العربية";
  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={other}
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-muted shadow-sm transition-colors hover:text-ink ${className}`}
    >
      <Languages size={14} />
      {other}
    </button>
  );
}
