"use client";

/**
 * /settings — the index, and the redirect that keeps every old link working.
 *
 * Before the rebuild this route WAS the whole settings screen, and other places in the app link
 * into it with `?tab=<id>`: the recalls and reactivation pages both point at `?tab=recall`, which
 * was the only way anyone ever found that section. Those links are a contract
 * (tests/settingsRegistry.test.mts freezes every id), so the query is translated to the section's
 * route here rather than being left to 404.
 *
 * `replace`, not `push`: the redirect should not sit in the history and trap the back button on
 * the section the visitor just left.
 *
 * The query is read during render through `useSearchParams` — hence the Suspense boundary at the
 * bottom of this file, which Next requires for it. Reading it in an effect instead would mean
 * rendering the full index for one frame before replacing it, so anyone following an old link
 * would see the wrong screen flash past.
 */

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  SETTINGS_GROUP_LABELS,
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
} from "@/config/settingsRegistry";
import { SETTINGS_GROUP_ICONS, SETTINGS_GROUP_TONE, SETTINGS_ICONS } from "@/components/settings/panels";
import { visibleSections } from "@/lib/settingsAccess";
import { hasFeature } from "@/lib/subscriptions";

const Skeleton = () => (
  <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden="true" />
);

export default function SettingsIndexPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <SettingsIndex />
    </Suspense>
  );
}

function SettingsIndex() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, isRTL } = useLanguage();
  const { user, loading } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();

  const requested = searchParams.get("tab");
  const legacyTarget = requested
    ? SETTINGS_SECTIONS.find((section) => section.id === requested)
    : undefined;

  useEffect(() => {
    if (legacyTarget) router.replace(legacyTarget.route);
  }, [legacyTarget, router]);

  const sections = useMemo(
    () =>
      visibleSections(
        SETTINGS_SECTIONS,
        { isAdmin, isReadOnly, role: user?.role, permissions: user?.permissions },
        (feature) => hasFeature(clinic, feature as Parameters<typeof hasFeature>[1])
      ),
    [clinic, isAdmin, isReadOnly, user?.role, user?.permissions]
  );

  // An unrecognised ?tab= falls through to the index rather than to a dead end — the link is old,
  // but the person still wanted their settings.
  if (legacyTarget || loading) return <Skeleton />;

  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <div className="max-w-2xl">
        <p className="text-[15px] font-medium text-ink-muted leading-relaxed">
          {language === "ar"
            ? "اختر قسماً للبدء. ما تراه هنا هو ما تسمح لك صلاحياتك بفتحه."
            : "Pick a section to get started. You are seeing everything your access lets you open."}
        </p>
      </div>

      {SETTINGS_GROUP_ORDER.map((group, groupIndex) => {
        const inGroup = sections.filter((section) => section.group === group);
        if (inGroup.length === 0) return null;
        
        return (
          <section key={group} className="space-y-4 animate-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${groupIndex * 75}ms`, animationFillMode: 'both' }}>
            <div className="flex items-center gap-3 px-1">
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${SETTINGS_GROUP_TONE[group]?.tile ?? "bg-accent text-white"} bg-gradient-to-br from-white/20 to-transparent shadow-sm`}>
                {(() => {
                  const GroupIcon = SETTINGS_GROUP_ICONS[group] ?? Settings2;
                  return <GroupIcon size={14} className="drop-shadow-sm" />;
                })()}
              </span>
              <h2 className="font-display text-[13px] font-bold uppercase tracking-widest text-ink-strong">
                {SETTINGS_GROUP_LABELS[group][language === "ar" ? "ar" : "en"]}
              </h2>
            </div>
            
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {inGroup.map((section, index) => {
                const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
                return (
                  <Link
                    key={section.id}
                    href={section.route}
                    className="group relative flex items-center gap-4 rounded-[1.25rem] border border-line bg-surface p-4 shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-1 hover:border-accent/30 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] hover:bg-gradient-to-br hover:from-surface hover:to-surface-subtle"
                    style={{ animationDelay: `${(groupIndex * 100) + (index * 40)}ms`, animationFillMode: 'both' }}
                  >
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md ${
                        SETTINGS_GROUP_TONE[group]?.tile ?? "bg-accent text-white"
                      }`}
                    >
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink transition-colors duration-300 group-hover:text-accent">
                      {language === "ar" ? section.labelAr : section.labelEn}
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted opacity-0 transition-all duration-300 group-hover:bg-accent/10 group-hover:opacity-100">
                      <Chevron size={16} className="text-accent" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
