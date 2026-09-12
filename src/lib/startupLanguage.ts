/**
 * Which language the app opens in, the first time.
 *
 * It always opened in English and waited for the person to find the switch — on a sidebar they
 * could not yet see, because they were on the login page. An Egyptian owner whose phone is in
 * Arabic read an English sign-up form and an English error message before anything else.
 *
 * The rule: a choice the person made (saved by the switch) wins; otherwise the browser's own
 * language decides, Arabic for any Arabic locale (`ar`, `ar-EG`, `ar-SA`…) and English for the
 * rest. Only the person's own choice is ever saved, so someone auto-started in Arabic who
 * switches to English is remembered, and someone who never touched the switch follows their
 * browser if that changes.
 */

export type StartupLanguage = "en" | "ar";

export function pickStartupLanguage(
  saved: unknown,
  browserLanguages: readonly string[] | null | undefined
): StartupLanguage {
  if (saved === "ar" || saved === "en") return saved;
  for (const tag of browserLanguages || []) {
    if (typeof tag !== "string") continue;
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (primary === "ar") return "ar";
    if (primary) return "en";
  }
  return "en";
}
