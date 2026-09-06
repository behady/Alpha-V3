"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useWelcome } from "@/context/WelcomeContext";

/**
 * "Your trial ends in three days."
 *
 * Trials genuinely expire now — signup stamps `expiresAt` from the platform policy, and both
 * `firestore.rules` and `lib/clinicStatus.ts` refuse writes once it passes. That makes this banner
 * part of the feature rather than decoration around it: a clinic that arrives one morning to find
 * it cannot book a patient, with no prior warning, is a support call and a cancelled subscription.
 * The read-only banner that appears afterwards explains what happened; this one is the chance to
 * do something about it beforehand.
 *
 * It sits in the same slot as that read-only banner and the two are mutually exclusive by
 * construction: `trialWarning` returns `warn: false` the moment the clinic is past its date,
 * which is exactly when the read-only banner takes over.
 *
 * Not dismissible, and deliberately so. It appears only inside the window the superadmin
 * configured (three days by default), only for a clinic whose access really is about to stop, and
 * it is one line. A dismiss button on a notice this consequential mostly serves the person who
 * would most regret dismissing it.
 */
export default function TrialCountdownBanner() {
  const { trialEnding } = useWelcome();
  const { language, isRTL } = useLanguage();
  const pathname = usePathname();

  if (!trialEnding.warn) return null;

  const isAr = language === "ar";
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;
  const days = trialEnding.daysLeft;

  // The last day is the one that reads wrong in a plural — and it is the day people act on.
  const countEn = days === 1 ? "1 day" : `${days} days`;
  const countAr = days === 1 ? "يوم واحد" : days === 2 ? "يومين" : `${days} أيام`;

  return (
    <div
      className="relative z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2.5 shadow-sm"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <Clock size={17} className="shrink-0 text-amber-600" />
      <p className="text-sm font-bold text-amber-900">
        {isAr
          ? `فترة التجربة بتنتهي بعد ${countAr}. بعد كده هتقدر تقرا كل السجلات، لكن الإضافات الجديدة هتقف لحد ما تشترك.`
          : `Your free trial ends in ${countEn}. After that your records stay readable, but new entries stop until you subscribe.`}
      </p>
      {/* Only off the guide itself — pointing someone at the page they are already reading is
          the kind of detail that makes a banner feel automated rather than written. */}
      {pathname !== "/welcome" && (
        <Link
          href="/welcome"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-white/70 px-3 py-1 text-xs font-black text-amber-800 transition-colors hover:bg-white"
        >
          {isAr ? "شوف خطوات البداية" : "See your setup steps"}
          <ArrowIcon size={12} />
        </Link>
      )}
    </div>
  );
}
