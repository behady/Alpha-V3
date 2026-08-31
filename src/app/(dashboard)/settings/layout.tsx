"use client";

/**
 * The settings shell: header, sidebar, search, and the guard that asks before losing your work.
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
 */

import { useCallback, useMemo, useState } from "react";
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
  type SettingsGroup,
  type SettingsSection,
} from "@/config/settingsRegistry";
import { SETTINGS_ICONS } from "@/components/settings/panels";
import { visibleSections } from "@/lib/settingsAccess";
import { hasFeature } from "@/lib/subscriptions";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <SettingsShell>{children}</SettingsShell>
    </UnsavedChangesProvider>
  );
}

function SettingsShell({ children }: { children: React.ReactNode }) {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();
  const { confirmLeave } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  /**
   * Which group's sections are listed. Null means "follow the section you are on", which is the
   * normal case — picking a group is only for looking around without leaving where you are.
   */
  const [browsingGroup, setBrowsingGroup] = useState<SettingsGroup | null>(null);

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
        hasFeature(clinic, feature as Parameters<typeof hasFeature>[1])
      ),
    [clinic, viewer]
  );

  const active = useMemo(
    () => sections.find((s) => s.route === pathname) ?? null,
    [pathname, sections]
  );

  // Search matches either language, so an Arabic-speaking receptionist can find a section by the
  // English name a colleague used on the phone, and the other way round.
  const matches = useCallback(
    (section: SettingsSection) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        section.labelEn.toLowerCase().includes(needle) ||
        section.labelAr.includes(query.trim())
      );
    },
    [query]
  );

  const results = useMemo(() => sections.filter(matches), [sections, matches]);

  /**
   * Every move between sections goes through here, so unsaved work gets a question rather than a
   * silent discard. The old screen swapped panels on click and whatever was typed went with them.
   */
  const go = useCallback(
    async (route: string) => {
      if (route === pathname) return;
      if (!(await confirmLeave())) return;
      router.push(route);
    },
    [confirmLeave, pathname, router]
  );


  const txt = useSettingsText("shell");

  const ActiveIcon = active ? (SETTINGS_ICONS[active.id] ?? Settings2) : Settings2;
  const activeLabel = active
    ? language === "ar"
      ? active.labelAr
      : active.labelEn
    : txt.title;

  // The group whose sections are listed: whatever you are browsing, else the one you are in.
  const shownGroup: SettingsGroup = browsingGroup ?? active?.group ?? SETTINGS_GROUP_ORDER[0];
  const searching = query.trim().length > 0;
  const listed = searching ? results : sections.filter((s) => s.group === shownGroup);

  return (
    <div
      className="max-w-[1600px] w-full mx-auto p-4 md:p-8 pb-24 md:pb-10 font-sans animate-in fade-in"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="mb-6 rounded-[2rem] border border-line bg-surface shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="shrink-0 rounded-2xl bg-accent-tint p-3 text-accent">
              <ActiveIcon size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black tracking-tight text-ink md:text-2xl">
                {activeLabel}
              </h1>
              <p className="mt-0.5 text-[13px] font-medium text-ink-muted">{txt.subtitle}</p>
            </div>
          </div>

          {/* Search spans every group: "where do I change X" is not a question you can answer by
              picking a group first. */}
          <div className="relative w-full shrink-0 sm:w-64">
            <Search
              size={15}
              className={`absolute top-1/2 -translate-y-1/2 text-ink-faint ${isRTL ? "right-3.5" : "left-3.5"}`}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={txt.search}
              aria-label={txt.search}
              className={`w-full rounded-xl border border-line bg-surface-subtle py-2.5 text-[13px] font-semibold text-ink outline-none transition-colors focus:border-accent-soft focus:bg-surface ${
                isRTL ? "pr-9 pl-8" : "pl-9 pr-8"
              }`}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={txt.clear}
                className={`absolute top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink ${isRTL ? "left-2.5" : "right-2.5"}`}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Groups. Hidden while searching, because a search already crosses all of them. */}
        {!searching && (
          <div className="border-t border-line px-5 md:px-6">
            <div className="-mb-px flex gap-5 overflow-x-auto no-scrollbar">
              {SETTINGS_GROUP_ORDER.filter((g) => sections.some((s) => s.group === g)).map((group) => (
                <button
                  key={group}
                  onClick={() => setBrowsingGroup(group)}
                  aria-current={group === shownGroup ? "true" : undefined}
                  className={`whitespace-nowrap border-b-2 pb-2.5 pt-3 text-[13px] font-bold transition-colors ${
                    group === shownGroup
                      ? "border-accent text-ink"
                      : "border-transparent text-ink-muted hover:text-ink-body"
                  }`}
                >
                  {SETTINGS_GROUP_LABELS[group][language === "ar" ? "ar" : "en"]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sections in the open group, or everything the search matched. */}
        <div className="flex flex-wrap gap-1.5 border-t border-line bg-surface-subtle/60 p-3 md:px-6">
          {listed.length === 0 && (
            <p className="px-2 py-1.5 text-[13px] font-semibold text-ink-muted">{txt.noResults}</p>
          )}
          {listed.map((section) => {
            const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
            const isActive = active?.id === section.id;
            return (
              <button
                key={section.id}
                onClick={() => void go(section.route)}
                data-tour={section.tourAnchor}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-bold transition-all ${
                  isActive
                    ? "bg-surface text-accent shadow-sm ring-1 ring-line"
                    : "text-ink-body hover:bg-surface hover:text-ink"
                }`}
              >
                <Icon size={15} className={isActive ? "text-accent" : "text-ink-faint"} />
                {language === "ar" ? section.labelAr : section.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {isReadOnly && (
        <p className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
          {txt.readOnly}
        </p>
      )}

      <div className="min-h-[600px] rounded-[2.5rem] border border-line bg-surface p-4 shadow-sm md:p-8">
        {children}
      </div>
    </div>
  );
}
