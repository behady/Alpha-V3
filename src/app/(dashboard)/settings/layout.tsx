"use client";

/**
 * The settings shell: header, side list, search, and the guard that asks before losing your work.
 *
 * Every section shown here comes from the registry (src/config/settingsRegistry.ts) and every
 * access decision from one function (src/lib/settingsAccess.ts). That is the whole point of the
 * rebuild — the old screen kept a tabs array and three separate sidebar filter lists, and nothing
 * held them in step:
 *
 *   - Recall, Recently Deleted and AI Credits were in the tabs array and in none of the filters,
 *     so on a desktop they could not be reached at all.
 *   - The Clinic Management group was wrapped in an admin check, so someone holding
 *     `access.settings` never saw the sections that permission is for — while the mobile dropdown
 *     and a typed `?tab=` still let them in.
 *
 * A section can no longer exist and be unreachable, because there is only one list to be on.
 *
 * The list is one column down the side with every group open at once. The version before it put
 * four group tabs above a wrap of section buttons, and it failed in three ways the clinic owner
 * named: you had to guess which tab held a setting before you could see it, the Clinic tab alone
 * was a wall of thirteen buttons, and the menus filled the screen so the setting itself started
 * below the fold. Here nothing is hidden behind a tab, and the setting sits beside the list.
 *
 * On a phone there is no room for both, so it works like a phone's own Settings: /settings is the
 * list, a section is a page of its own, and the back arrow in the black band returns to the list.
 */

import { useCallback, useMemo, useState } from "react";
import PageHeader from "@/components/dashboard/PageHeader";
import { useSettingsText } from "@/lib/useSettingsText";
import { usePathname, useRouter } from "next/navigation";
import { Search, Settings2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/context/UnsavedChangesContext";
import {
  SETTINGS_GROUP_LABELS,
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/config/settingsRegistry";
import { SETTINGS_ICONS } from "@/components/settings/panels";
import { visibleSections } from "@/lib/settingsAccess";
import { isAnyUnlocked, type FeatureKey } from "@/lib/featureCatalog";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <SettingsShell>{children}</SettingsShell>
    </UnsavedChangesProvider>
  );
}

/**
 * Folds the spellings people type interchangeably into one, so a search does not miss on a hamza,
 * a taa marbuta or a diacritic — "اسعار" has to find "الأسعار".
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function SettingsShell({ children }: { children: React.ReactNode }) {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();
  const { confirmLeave } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();
  const ar = language === "ar";

  const [query, setQuery] = useState("");

  const viewer = useMemo(
    () => ({
      isAdmin,
      isReadOnly,
      role: user?.role,
      permissions: user?.permissions,
    }),
    [isAdmin, isReadOnly, user?.role, user?.permissions]
  );

  const sections = useMemo(
    () =>
      visibleSections(SETTINGS_SECTIONS, viewer, (feature) =>
        isAnyUnlocked(clinic, feature as FeatureKey | FeatureKey[])
      ),
    [clinic, viewer]
  );

  const active = useMemo(
    () => sections.find((s) => s.route === pathname) ?? null,
    [pathname, sections]
  );

  // Search reads the name, the one-line hint and the keywords, in both languages — so an
  // Arabic-speaking receptionist finds a section by the English word a colleague used, and
  // anyone who learned an old name ("Recall", "Payers") still lands on it.
  const needle = fold(query.trim());
  const searching = needle.length > 0;
  const results = useMemo(() => {
    if (!needle) return sections;
    return sections.filter((section) =>
      fold(
        [
          section.labelEn,
          section.labelAr,
          section.hintEn,
          section.hintAr,
          ...section.keywords,
        ].join(" ")
      ).includes(needle)
    );
  }, [needle, sections]);

  /**
   * Every move between sections goes through here, so unsaved work gets a question rather than a
   * silent discard. The old screen swapped panels on click and whatever was typed went with them.
   */
  const go = useCallback(
    async (route: string) => {
      if (route === pathname) return;
      if (!(await confirmLeave())) return;
      setQuery("");
      router.push(route);
    },
    [confirmLeave, pathname, router]
  );

  const txt = useSettingsText("shell");

  const label = (s: SettingsSection) => (ar ? s.labelAr : s.labelEn);
  const hint = (s: SettingsSection) => (ar ? s.hintAr : s.hintEn);

  const renderItem = (section: SettingsSection, showHint: boolean) => {
    const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
    const isActive = active?.id === section.id;
    return (
      <li key={section.id}>
        <button
          type="button"
          onClick={() => void go(section.route)}
          /* The four frozen lesson anchors keep their names; every other item gets one derived
             from its id so Sara's tour can light any section. */
          data-tour={section.tourAnchor ?? `settings-${section.id}`}
          aria-current={isActive ? "page" : undefined}
          title={hint(section)}
          className={`group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-start transition-colors ${
            isActive
              ? "bg-ink-slab text-white"
              : "text-ink-body hover:bg-surface-muted hover:text-ink"
          }`}
        >
          <Icon
            size={17}
            className={`mt-0.5 shrink-0 ${isActive ? "text-white" : "text-ink-muted group-hover:text-ink"}`}
          />
          <span className="min-w-0 flex-1">
            <span className={`block text-[14px] leading-5 ${isActive ? "font-semibold" : "font-medium"}`}>
              {label(section)}
            </span>
            {/* The hint answers "what is this?" before the click. It always shows in a search
                result and in the phone's full-width list; beside a section on a wide screen the
                same sentence is already under the title in the black band. */}
            <span
              className={`${showHint ? "block" : "block md:hidden"} mt-0.5 text-[12.5px] leading-snug ${
                isActive ? "text-white/65" : "text-ink-muted"
              }`}
            >
              {hint(section)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div
      className="mx-auto w-full max-w-[1400px] p-4 pb-24 font-sans md:p-8 md:pb-10"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <PageHeader
        eyebrow={active ? txt.title : undefined}
        title={active ? label(active) : txt.title}
        subtitle={active ? hint(active) : undefined}
        backHref={active ? "/settings" : undefined}
      />

      <div className="md:grid md:grid-cols-[17.5rem_minmax(0,1fr)] md:items-start md:gap-8">
        {/* On a phone the list is the /settings page itself and steps aside inside a section. */}
        <nav
          aria-label={txt.allSettings}
          className={`${active ? "hidden md:block" : "block"} md:sticky md:top-4 md:max-h-[calc(100dvh-13rem)] md:overflow-y-auto md:overscroll-contain no-scrollbar`}
        >
          <div className="relative mb-4">
            <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3.5">
              <Search size={16} className="text-ink-muted" />
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter opens the first match, so "hours ⏎" is the whole trip.
                if (e.key === "Enter" && searching && results[0]) void go(results[0].route);
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={txt.search}
              aria-label={txt.search}
              data-tour="settings-search"
              className="block w-full rounded-xl border-0 bg-surface py-3 pe-10 ps-10 text-[14px] font-medium text-ink ring-1 ring-inset ring-line transition-shadow placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-ink"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={txt.clear}
                className="absolute end-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {searching ? (
            results.length === 0 ? (
              <p className="px-3 py-6 text-[14px] font-medium text-ink-muted">{txt.noResults}</p>
            ) : (
              <ul className="space-y-0.5">{results.map((s) => renderItem(s, true))}</ul>
            )
          ) : (
            <div className="space-y-5 pb-2">
              {SETTINGS_GROUP_ORDER.map((group) => {
                const inGroup = sections.filter((s) => s.group === group);
                if (inGroup.length === 0) return null;
                return (
                  <section key={group}>
                    {/* The tour waits on this anchor before lighting a section in the group. */}
                    <h2
                      data-tour={`settings-group-${group}`}
                      className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted"
                    >
                      {SETTINGS_GROUP_LABELS[group][ar ? "ar" : "en"]}
                    </h2>
                    <ul className="space-y-0.5">{inGroup.map((s) => renderItem(s, false))}</ul>
                  </section>
                );
              })}
            </div>
          )}
        </nav>

        <div className={active ? "block" : "hidden md:block"}>
          {isReadOnly && (
            <p className="mb-6 rounded-2xl border border-warn/30 bg-warn-tint px-5 py-4 text-[14px] font-bold text-warn">
              {txt.readOnly}
            </p>
          )}

          <div className="min-h-[600px] rounded-[2rem] border border-line bg-surface p-5 md:p-10">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
