"use client";

import { useMemo } from "react";
import { useLanguage } from "@/context/LanguageContext";
import {
  settingsText,
  type SettingsTextSection,
  type SETTINGS_TEXT,
} from "@/config/settingsText";

/**
 * One settings section's labels, in the reader's language.
 *
 * Panels keep calling `txt.something` exactly as before; only where the strings live has changed.
 * They were spliced into the markup one at a time as `language === "ar" ? "..." : "..."`, which
 * meant nobody could read the Arabic without reading the components — see src/config/settingsText.ts.
 *
 * Returns a plain object rather than a lookup function on purpose: a missing key is then a
 * compile error at the call site, not a blank label discovered by a clinic.
 */
export function useSettingsText<K extends SettingsTextSection>(
  section: K
): Record<keyof (typeof SETTINGS_TEXT)[K], string> {
  const { language } = useLanguage();
  return useMemo(() => settingsText(section, language), [section, language]);
}
