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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Search, Settings2, X } from "lucide-react";
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
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /**
   * Every move between sections goes through here, so unsaved work gets a question rather than a
   * silent discard. The old screen swapped panels on click and whatever was typed went with them.
   */
  const go = useCallback(
    async (route: string) => {
      setIsPickerOpen(false);
      if (route === pathname) return;
      if (!(await confirmLeave())) return;
      router.push(route);
    },
    [confirmLeave, pathname, router]
  );

  const txt = {
    title: language === "ar" ? "الإعدادات" : "Settings",
    subtitle:
      language === "ar"
        ? "كل ما يمكن ضبطه في العيادة، في مكان واحد."
        : "Everything you can configure, in one place.",
    search: language === "ar" ? "ابحث في الإعدادات" : "Search settings",
    noResults: language === "ar" ? "لا يوجد قسم بهذا الاسم" : "No section by that name",
    clear: language === "ar" ? "امسح البحث" : "Clear search",
    readOnly:
      language === "ar"
        ? "اشتراك العيادة منتهي — يمكنك الاطلاع دون حفظ."
        : "This clinic's subscription has ended — you can look, but not save.",
  };

  const ActiveIcon = active ? (SETTINGS_ICONS[active.id] ?? Settings2) : Settings2;
  const activeLabel = active
    ? language === "ar"
      ? active.labelAr
      : active.labelEn
    : txt.title;

  return (
    <div
      className="max-w-[1600px] w-full mx-auto p-4 md:p-8 pb-24 md:pb-10 font-sans text-slate-800 animate-in fade-in"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <header className="flex items-center gap-4 bg-white p-6 rounded-[2rem] border border-slate-200/60 shadow-sm mb-6">
        <div className="bg-accent-tint p-3.5 rounded-2xl text-accent shrink-0">
          <ActiveIcon size={26} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight truncate">
            {activeLabel}
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">{txt.subtitle}</p>
        </div>
      </header>

      {isReadOnly && (
        <p className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
          {txt.readOnly}
        </p>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-72 shrink-0">
          {/* Mobile section picker */}
          <div className="lg:hidden relative mb-6" ref={pickerRef}>
            <button
              onClick={() => setIsPickerOpen((open) => !open)}
              aria-expanded={isPickerOpen}
              className="w-full bg-white border border-slate-200 px-5 py-4 rounded-2xl flex items-center justify-between font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
              <span className="flex items-center gap-2 min-w-0">
                <ActiveIcon size={18} className="text-accent-soft shrink-0" />
                <span className="truncate">{activeLabel}</span>
              </span>
              <ChevronDown
                size={18}
                className={`text-slate-400 transition-transform shrink-0 ${isPickerOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isPickerOpen && (
              <div
                className={`absolute top-[calc(100%+8px)] ${isRTL ? "left-0" : "right-0"} w-full bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95`}
              >
                <div className="max-h-[60vh] overflow-y-auto py-2 custom-scrollbar">
                  {sections.map((section) => {
                    const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
                    const isActive = active?.id === section.id;
                    return (
                      <button
                        key={section.id}
                        onClick={() => void go(section.route)}
                        data-tour={section.tourAnchor}
                        className={`w-full flex items-center gap-3 px-5 py-3 text-sm font-bold transition-colors ${
                          isActive ? "bg-accent-tint text-accent" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Icon size={18} className={isActive ? "text-accent" : "text-slate-400"} />
                        {language === "ar" ? section.labelAr : section.labelEn}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Desktop sidebar */}
          <nav
            aria-label={txt.title}
            className="hidden lg:flex flex-col gap-6 bg-slate-50/50 p-6 rounded-[2.5rem] border border-slate-200/60 shadow-sm sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto custom-scrollbar"
          >
            <div className="relative">
              <Search
                size={16}
                className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={txt.search}
                aria-label={txt.search}
                className={`w-full py-3 bg-white rounded-2xl border border-slate-200/60 text-sm font-semibold text-slate-900 outline-none focus:border-accent-soft transition-all ${
                  isRTL ? "pr-10 pl-9" : "pl-10 pr-9"
                }`}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label={txt.clear}
                  className={`absolute top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 ${isRTL ? "left-3" : "right-3"}`}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {results.length === 0 && (
              <p className="px-3 text-sm font-semibold text-slate-400">{txt.noResults}</p>
            )}

            {SETTINGS_GROUP_ORDER.map((group) => {
              const inGroup = results.filter((section) => section.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group}>
                  <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-3">
                    {SETTINGS_GROUP_LABELS[group][language === "ar" ? "ar" : "en"]}
                  </h2>
                  <div className="flex flex-col gap-1">
                    {inGroup.map((section) => {
                      const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
                      const isActive = active?.id === section.id;
                      return (
                        <button
                          key={section.id}
                          onClick={() => void go(section.route)}
                          data-tour={section.tourAnchor}
                          aria-current={isActive ? "page" : undefined}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-2xl transition-all text-start ${
                            isActive
                              ? "bg-white text-accent shadow-sm border border-slate-200/60"
                              : "text-slate-600 hover:bg-white/60 hover:text-slate-900 border border-transparent"
                          }`}
                        >
                          <Icon
                            size={18}
                            className={`shrink-0 ${isActive ? "text-accent" : "text-slate-400"}`}
                          />
                          <span className="truncate">
                            {language === "ar" ? section.labelAr : section.labelEn}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="flex-1 min-w-0 bg-white rounded-[2.5rem] border border-slate-200/60 shadow-sm p-4 md:p-8 min-h-[600px]">
          {children}
        </div>
      </div>
    </div>
  );
}
