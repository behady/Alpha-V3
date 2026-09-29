"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BrainCircuit, Lock, MessageCircle, MessageSquareWarning, Users, type LucideIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import FeatureGate from "@/components/FeatureGate";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { canViewSection } from "@/lib/settingsAccess";
import { isAnyUnlocked, type FeatureKey } from "@/lib/featureCatalog";

/**
 * The WhatsApp page: everything about the clinic's WhatsApp in one place, one tab each.
 *
 * The chats, the WhatsApp leads, how the bot answers, what the AI may say, and what the bot could
 * not answer used to live in four places — the Front Desk menu, the Leads board, two entries in
 * Settings and a tab of the Intelligence page. The owner asked for them together (2026-09-29).
 * The number itself and the automatic-message wording stay in Settings → WhatsApp setup, by his
 * choice: that is set up once, while these tabs are worked every week.
 *
 * Each tab is its own address rather than a `?tab=`. The chats must fill the screen with nothing
 * scrolling but the threads (the dashboard layout locks `/chats` to the viewport height), while
 * every other tab is an ordinary page that grows — and a push notification's `/chats?chat=` link
 * keeps landing on the inbox without anything on the server changing.
 *
 * A tab the person may not open is not shown. One the clinic has not bought is shown to an admin
 * with a lock, the same rule the top menu follows, so the owner can see what exists.
 */

type HubTab = {
  key: "chats" | "leads" | "bot" | "ai" | "misses";
  href: string;
  icon: LucideIcon;
  en: string;
  ar: string;
  /** Unset: part of the WhatsApp add-ons the whole page already requires. */
  feature?: FeatureKey | FeatureKey[];
  /** May this person open it at all, add-on aside. */
  allowed: boolean;
};

const section = (id: string) => SETTINGS_SECTIONS.find((s) => s.id === id)!;

export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FeatureGate feature={["whatsappIntegration", "whatsappBot"]}>
      <WhatsAppHub>{children}</WhatsAppHub>
    </FeatureGate>
  );
}

function WhatsAppHub({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();

  const can = (permission: string) => isAdmin || !!user?.permissions?.includes(permission);
  const viewer = { isAdmin, isReadOnly, role: user?.role, permissions: user?.permissions };

  const all: HubTab[] = [
    { key: "chats", href: "/chats", icon: MessageCircle, en: "Chats", ar: "المحادثات", allowed: can("access.patients") },
    { key: "leads", href: "/chats/leads", icon: Users, en: "Leads", ar: "العملاء المحتملين", feature: "leads", allowed: can("access.patients") },
    { key: "bot", href: "/chats/bot", icon: Bot, en: "Bot", ar: "البوت", feature: "whatsappBot", allowed: canViewSection(section("whatsapp_bot"), viewer).allowed },
    { key: "ai", href: "/chats/ai", icon: BrainCircuit, en: "AI", ar: "الذكاء الاصطناعي", feature: "aiChat", allowed: canViewSection(section("whatsapp_ai"), viewer).allowed },
    // Not an add-on of its own, and empty without a bot to miss anything — so hidden rather than
    // locked when there is none; the Bot tab's lock already says what to buy.
    { key: "misses", href: "/chats/misses", icon: MessageSquareWarning, en: "Bot misses", ar: "اللي البوت معرفش يرد عليه", allowed: can("access.patients") && isAnyUnlocked(clinic, ["whatsappBot", "aiChat"]) },
  ];

  const tabs = all
    .filter((t) => t.allowed)
    .map((t) => ({ ...t, locked: !!t.feature && !isAnyUnlocked(clinic, t.feature) }))
    .filter((t) => !t.locked || isAdmin);

  const isChats = pathname === "/chats";
  const current = tabs.find((t) => (t.key === "chats" ? isChats : pathname?.startsWith(t.href))) ?? null;

  return (
    <div className={isChats ? "flex h-full min-h-0 flex-col" : "min-h-full"} dir={isRTL ? "rtl" : "ltr"}>
      {/* One tab is not a choice — reception with only the chats sees no strip at all. */}
      {tabs.length > 1 && (
        <div className={isChats ? "shrink-0 px-3 pt-3 md:px-5 lg:px-6" : "mx-auto max-w-7xl px-3 pt-5 sm:px-6 sm:pt-8 xl:px-10"}>
          <nav
            data-tour="whatsapp-tabs"
            aria-label={isAr ? "أقسام واتساب" : "WhatsApp sections"}
            className="flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-full border border-line bg-surface p-1 shadow-sm w-fit"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = current?.key === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  replace
                  scroll={false}
                  data-tour={`whatsapp-tab-${tab.key}`}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition-colors ${
                    active ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <Icon size={14} />
                  {isAr ? tab.ar : tab.en}
                  {tab.locked && <Lock size={11} className={active ? "text-white/60" : "text-ink-faint"} />}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
      {isChats ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
    </div>
  );
}
