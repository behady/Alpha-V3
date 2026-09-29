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
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { SETTINGS_ICONS } from "@/components/settings/panels";
import { useSettingsText } from "@/lib/useSettingsText";
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
  const txt = useSettingsText("shell");
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
  const ar = language === "ar";
  // The settings a clinic comes back to most. Only the ones this person can open are shown.
  const common = COMMON.map((id) => sections.find((s) => s.id === id)).filter(
    (s): s is (typeof sections)[number] => Boolean(s)
  );

  // Beside the side list on a wide screen. On a phone the list is the page and this stays hidden.
  return (
    <div className="max-w-xl">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">{txt.pick}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{txt.searchTip}</p>

      {common.length > 0 && (
        <>
          <h3 className="mb-2 mt-10 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            {txt.common}
          </h3>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {common.map((section) => {
              const Icon = SETTINGS_ICONS[section.id] ?? Settings2;
              return (
                <li key={section.id}>
                  <Link
                    href={section.route}
                    className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-muted"
                  >
                    <Icon size={18} className="shrink-0 text-ink-muted group-hover:text-ink" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-ink">
                        {ar ? section.labelAr : section.labelEn}
                      </span>
                      <span className="block truncate text-[12.5px] text-ink-muted">
                        {ar ? section.hintAr : section.hintEn}
                      </span>
                    </span>
                    <Chevron size={16} className="shrink-0 text-ink-faint group-hover:text-ink" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

const COMMON = ["clinical", "services", "users", "whatsapp", "general"];
