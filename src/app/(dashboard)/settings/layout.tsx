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
      className="mx-auto w-full max-w-[1400px] p-4 pb-24 font-sans animate-in fade-in duration-500 md:p-8 md:pb-10"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="mb-8 overflow-hidden rounded-[2.5rem] border border-line bg-surface shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col gap-4 px-6 pt-6 pb-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <div className="flex min-w-0 items-center gap-4">
            {active ? (
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${
                  SETTINGS_GROUP_TONE[active.group]?.tile ?? "bg-accent text-white"
                } bg-gradient-to-br from-white/20 to-transparent`}
              >
                <ActiveIcon size={24} className="drop-shadow-sm" />
              </span>
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm bg-gradient-to-br from-ink-strong to-ink text-white">
                <Settings2 size={24} className="drop-shadow-sm" />
              </span>
            )}
            <h1 className="truncate font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">
              {activeLabel}
            </h1>
          </div>

          {/* Search spans every group: "where do I change X" is not a question you can answer by
              picking a group first. */}
          <div className="relative w-full shrink-0 sm:w-72">
            <div className="absolute inset-y-0 start-0 flex items-center ps-4 pointer-events-none">
              <Search size={16} className="text-ink-muted" />
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={txt.search}
              aria-label={txt.search}
              className="block w-full rounded-2xl border-0 bg-surface-muted py-3 pe-10 ps-11 text-[14px] font-medium text-ink ring-1 ring-inset ring-line/50 transition-all hover:bg-surface-subtle focus:bg-surface focus:ring-2 focus:ring-inset focus:ring-accent focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={txt.clear}
                className="absolute end-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-line/50 hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Groups. Hidden while searching, because a search already crosses all of them. */}
        {!searching && (
          <div className="flex justify-start sm:justify-center border-t border-line/50 bg-gradient-to-b from-surface-subtle/80 to-surface-muted/30 px-4 pt-4 md:px-8">
            {/* A segmented control, not four coloured pills: one grey track, one white segment
                that moves. The colour it used to carry now lives only in the tiles. */}
            <div className="inline-flex gap-1.5 overflow-x-auto rounded-2xl bg-surface-muted/80 p-1.5 shadow-inner no-scrollbar w-full sm:w-auto">
              {SETTINGS_GROUP_ORDER.filter((g) => sections.some((s) => s.group === g)).map((group) => {
                const GroupIcon = SETTINGS_GROUP_ICONS[group] ?? Settings2;
                const isShown = group === shownGroup;
                return (
                  <button
                    key={group}
                    onClick={() => setBrowsingGroup(group)}
                    aria-current={isShown ? "true" : undefined}
                    className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-2.5 whitespace-nowrap rounded-xl px-5 py-2.5 text-[14px] font-semibold transition-all duration-300 ${
                      isShown
                        ? "bg-surface text-ink shadow-[0_2px_8px_rgba(0,0,0,0.06)] scale-100"
                        : "text-ink-body hover:bg-line/30 hover:text-ink scale-[0.98] hover:scale-100"
                    }`}
                  >
                    <GroupIcon size={16} className={`transition-colors duration-300 ${isShown ? "text-ink" : "text-ink-muted"}`} />
                    {SETTINGS_GROUP_LABELS[group][language === "ar" ? "ar" : "en"]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sections in the open group, or everything the search matched. Each chip's icon carries
            its group's tone, so a search result across groups still says where it lives. */}
        <div className={`flex flex-wrap justify-start sm:justify-center gap-2 bg-gradient-to-b from-surface-muted/30 to-surface-subtle/10 p-4 md:px-8 pb-6 ${searching ? "border-t border-line/50 pt-6" : "pt-4"}`}>
          {listed.length === 0 && (
            <div className="flex w-full flex-col items-center justify-center gap-3 py-8 text-center animate-in fade-in zoom-in-95">
              <Search size={32} className="text-ink-faint/50" />
              <p className="text-[14px] font-semibold text-ink-muted">{txt.noResults}</p>
            </div>
          )}
          {listed.map((section, index) => {
            const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
            const isActive = active?.id === section.id;
            return (
              <button
                key={section.id}
                onClick={() => void go(section.route)}
                data-tour={section.tourAnchor}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-2.5 rounded-xl px-4 py-2 text-[14px] transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
                  isActive
                    ? "bg-surface font-bold text-ink shadow-sm ring-1 ring-line"
                    : "font-medium text-ink-body bg-transparent hover:bg-surface hover:text-ink hover:shadow-sm"
                }`}
                style={{ animationDelay: `${index * 30}ms`, animationFillMode: 'both' }}
              >
                <Icon size={16} className={`transition-colors duration-300 ${isActive ? "text-ink" : "text-ink-muted"}`} />
                {language === "ar" ? section.labelAr : section.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {isReadOnly && (
        <div className="mb-8 flex items-center gap-4 rounded-2xl border border-warn/30 bg-gradient-to-r from-warn-tint to-warn-tint/50 px-6 py-4 shadow-sm animate-in fade-in">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn/10 text-warn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <p className="text-[15px] font-bold text-warn">
            {txt.readOnly}
          </p>
        </div>
      )}

      <div className="min-h-[600px] overflow-hidden rounded-[2.5rem] border border-line bg-surface shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
        <div className="h-full bg-gradient-to-br from-surface to-surface-subtle/30 p-5 md:p-10">
          {children}
        </div>
      </div>
    </div>
  );
}
