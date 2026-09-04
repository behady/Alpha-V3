"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle, Newspaper, Sparkles, UserCheck } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import PermissionGuard from "@/components/PermissionGuard";
import BriefPanel from "@/components/ai/BriefPanel";
import MessageQueuePanel from "@/components/ai/MessageQueuePanel";
import NoShowPanel from "@/components/ai/NoShowPanel";

/**
 * One page for everything the system worked out on its own.
 *
 * These were three separate rail icons — the brief, the WhatsApp send queue and patient no-shows —
 * which is three clicks to answer one question ("what needs me today?") and three entries in a
 * rail that had already grown past what anyone could scan. They are one page with three tabs now,
 * and the rail carries a single icon for it, at the bottom.
 *
 * The old URLs still work: /ai/briefing, /messages and /ai/attendance redirect here with the
 * matching tab already open, so bookmarks, the assistant's navigate tool and anything that linked
 * to them land where they used to.
 *
 * Tabs are filtered by permission rather than shown-and-blocked, because a tab that only ever
 * produces an access-denied screen is worse than no tab. The permissions are the same ones the
 * three pages guarded on before.
 */

type TabKey = "brief" | "messages" | "noshows";

/** Query values the old routes redirect with. Kept short — these end up in people's bookmarks. */
const TAB_FROM_QUERY: Record<string, TabKey> = {
  brief: "brief",
  briefing: "brief",
  messages: "messages",
  noshows: "noshows",
  attendance: "noshows",
};

export default function IntelligencePage() {
  // useSearchParams needs a Suspense boundary above it or the build refuses to prerender the route.
  return (
    <Suspense fallback={null}>
      <IntelligenceHub />
    </Suspense>
  );
}

function IntelligenceHub() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { isAdmin } = useClinic();
  const router = useRouter();
  const searchParams = useSearchParams();

  const can = (permission: string) => isAdmin || !!user?.permissions?.includes(permission);

  // Rebuilt every render rather than memoized: it is three objects, and hand-memoizing it only
  // gives the React Compiler a dependency list to disagree with.
  const tabs = [
    {
      key: "brief" as const,
      permission: "dashboard.view",
      icon: Newspaper,
      label: isAr ? "الملخص" : "The Brief",
      heading: isAr ? "الملخص" : "The Brief",
      blurb: isAr
        ? "الأرقام والأسماء التي تحتاجها لإدارة اليوم: الحسابات، الإنتاج، فريق العمل، وما سيضيع إن لم يتحرك أحد. كل رقم مقروء من سجلاتك، وليس تقديراً."
        : "The numbers and names it takes to run the place: money, production, the floor, and what slips if nobody acts. Every figure is read from your records — nothing is estimated.",
    },
    {
      key: "messages" as const,
      permission: "access.patients",
      icon: MessageCircle,
      label: isAr ? "الرسايل" : "Messages",
      heading: isAr ? "رسائل للإرسال" : "Messages to send",
      blurb: isAr
        ? "الرسايل اللي النظام كتبها ومستنية حد يبعتها. اضغط على أي واحدة يفتح واتساب والكلام مكتوب."
        : "Messages the system wrote, waiting for a person to send. Click one and WhatsApp opens with the words already typed.",
    },
    {
      key: "noshows" as const,
      permission: "dashboard.view",
      icon: UserCheck,
      label: isAr ? "غياب المرضى" : "No-Shows",
      heading: isAr ? "غياب المرضى" : "Patient No-Shows",
      blurb: isAr
        ? "أغلق المواعيد السابقة التي لم يُسجَّل ما حدث فيها. هذا وحده ما يجعل أرقام الغياب ذات معنى."
        : "Close out past appointments nobody answered for. That is the only thing that makes attendance figures mean anything.",
    },
  ].filter((tab) => can(tab.permission));

  /**
   * The URL decides which tab is open until somebody clicks one, and only then does state take
   * over. Seeding state from the query instead would lose the deep link: `tabs` is empty on the
   * first render, while the user's permissions are still loading, so arriving at ?tab=messages
   * would seed "no valid tab" and settle on the brief a moment later.
   */
  const requested = TAB_FROM_QUERY[searchParams.get("tab") || ""];
  const [clicked, setClicked] = useState<TabKey | null>(null);
  const current = tabs.find((t) => t.key === (clicked ?? requested)) ?? tabs[0];

  // No tab this person may open. Rather than an empty page, hand them the same access-denied
  // screen every other guarded page shows.
  if (!current) {
    return (
      <PermissionGuard permission="dashboard.view">
        <div />
      </PermissionGuard>
    );
  }

  const selectTab = (key: TabKey) => {
    setClicked(key);
    // Reflected in the URL so the tab survives a reload and can be shared, but with replace so
    // the back button still leaves the page instead of walking the tabs.
    router.replace(`/ai?tab=${key}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-5">
        <div>
          <div className="flex items-center gap-2 text-violet-600">
            <Sparkles size={16} />
            <span className="text-[11px] font-black uppercase tracking-widest">
              {isAr ? "ذكاء ألفا" : "Alpha Intelligence"}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-ink tracking-tight mt-1">
            {current.heading}
          </h1>
          <p className="text-sm font-medium text-ink-muted mt-1 max-w-2xl">{current.blurb}</p>
        </div>

        {/* One tab is not a choice — hide the strip rather than show a single dead pill. */}
        {tabs.length > 1 && (
          <div className="inline-flex items-center gap-1 rounded-full bg-surface border border-slate-200/60 p-1 shadow-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = current.key === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => selectTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold transition-colors ${
                    isActive ? "bg-ink-slab text-white" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {current.key === "brief" && <BriefPanel />}
        {current.key === "messages" && <MessageQueuePanel />}
        {current.key === "noshows" && <NoShowPanel />}
      </div>
    </div>
  );
}
