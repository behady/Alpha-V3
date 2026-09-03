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
import { SETTINGS_GROUP_ICONS, SETTINGS_GROUP_TONE, SETTINGS_ICONS } from "@/components/settings/panels";
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
        <div className="flex flex-col gap-3 px-5 pt-4 pb-3 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {active && (
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] ${
                  SETTINGS_GROUP_TONE[active.group]?.tile ?? "bg-accent text-white"
                }`}
              >
                <ActiveIcon size={17} />
              </span>
            )}
            <h1 className="truncate font-display text-xl font-bold tracking-tight text-ink md:text-2xl">
              {activeLabel}
            </h1>
          </div>

          {/* Search spans every group: "where do I change X" is not a question you can answer by
              picking a group first. */}
          <div className="relative w-full shrink-0 sm:w-64">
            <Search size={15} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={txt.search}
              aria-label={txt.search}
              className="w-full rounded-xl border border-line bg-surface-subtle py-2.5 pe-8 ps-9 text-[13px] font-semibold text-ink outline-none transition-colors focus:border-accent focus:bg-surface"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={txt.clear}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Groups. Hidden while searching, because a search already crosses all of them. */}
        {!searching && (
          <div className="flex justify-center border-t border-line bg-surface-subtle/60 px-3 pt-3 md:px-6">
            {/* A segmented control, not four coloured pills: one grey track, one white segment
                that moves. The colour it used to carry now lives only in the tiles. */}
            <div className="inline-flex gap-1 overflow-x-auto rounded-xl bg-surface-muted p-1 no-scrollbar">
              {SETTINGS_GROUP_ORDER.filter((g) => sections.some((s) => s.group === g)).map((group) => {
                const GroupIcon = SETTINGS_GROUP_ICONS[group] ?? Settings2;
                const isShown = group === shownGroup;
                return (
                  <button
                    key={group}
                    onClick={() => setBrowsingGroup(group)}
                    aria-current={isShown ? "true" : undefined}
                    className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm transition-all ${
                      isShown
                        ? "bg-surface font-semibold text-ink shadow-sm"
                        : "font-medium text-ink-body hover:text-ink"
                    }`}
                  >
                    <GroupIcon size={15} className={isShown ? "text-ink" : "text-ink-muted"} />
                    {SETTINGS_GROUP_LABELS[group][language === "ar" ? "ar" : "en"]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sections in the open group, or everything the search matched. Each chip's icon carries
            its group's tone, so a search result across groups still says where it lives. */}
        <div className={`flex flex-wrap justify-center gap-1.5 bg-surface-subtle/60 p-3 md:px-6 ${searching ? "border-t border-line" : "pt-2"}`}>
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
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition-all ${
                  isActive
                    ? "bg-surface font-semibold text-ink shadow-sm"
                    : "font-medium text-ink-body hover:text-ink"
                }`}
              >
                <Icon size={15} className={isActive ? "text-ink" : "text-ink-muted"} />
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
