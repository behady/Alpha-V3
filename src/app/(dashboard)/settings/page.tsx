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
import { SETTINGS_ICONS } from "@/components/settings/panels";
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
    <div className="space-y-10 animate-in fade-in">
      <p className="max-w-xl text-sm font-semibold text-ink-muted">
        {language === "ar"
          ? "اختر قسماً للبدء. ما تراه هنا هو ما تسمح لك صلاحياتك بفتحه."
          : "Pick a section to get started. You are seeing everything your access lets you open."}
      </p>

      {SETTINGS_GROUP_ORDER.map((group) => {
        const inGroup = sections.filter((section) => section.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className="space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-ink-muted">
              {SETTINGS_GROUP_LABELS[group][language === "ar" ? "ar" : "en"]}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {inGroup.map((section) => {
                const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
                return (
                  <Link
                    key={section.id}
                    href={section.route}
                    className="group flex items-center gap-4 rounded-3xl border border-line bg-surface-subtle p-5 transition-all hover:border-line-strong hover:bg-surface hover:shadow-sm"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-ink-muted shadow-sm transition-colors group-hover:text-accent">
                      <Icon size={20} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                      {language === "ar" ? section.labelAr : section.labelEn}
                    </span>
                    <Chevron size={16} className="shrink-0 text-ink-muted" />
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
