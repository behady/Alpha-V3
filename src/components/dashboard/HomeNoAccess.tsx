"use client";

import { Lock } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import PageHeader from "@/components/dashboard/PageHeader";
import HomeViewTabs from "@/components/dashboard/HomeViewTabs";

/**
 * A home screen this person may not open: the band with the three tabs, so they can go back, and
 * an otherwise empty page. Nothing of the screen itself is loaded or drawn.
 */
export default function HomeNoAccess() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  return (
    <div className="min-h-full pb-24 lg:pb-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 md:p-6 lg:p-5">
        <PageHeader title={isAr ? "مقفول" : "Locked"}>
          <HomeViewTabs />
        </PageHeader>
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-muted text-ink-muted">
            <Lock size={28} />
          </div>
          <p className="max-w-md text-lg font-bold text-ink">
            {isAr ? "محتاج إذن من صاحب العيادة عشان تفتح الصفحة دي." : "You need permission from the owner to access this page."}
          </p>
        </div>
      </div>
    </div>
  );
}
