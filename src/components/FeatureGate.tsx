"use client";

import React from "react";
import { Lock, MessageCircle } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { featureInfo, isAnyUnlocked, SUPPORT_WHATSAPP, type FeatureKey } from "@/lib/featureCatalog";

/**
 * What a clinic sees when it opens something its subscription does not include.
 *
 * Not an upgrade form and not a price list: the platform sells by conversation, so the one
 * action on the screen is a WhatsApp button to the person who switches add-ons on. The screen
 * names the add-on so the message the clinic writes already says what they want.
 */
export function FeatureLocked({ feature }: { feature: FeatureKey }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const info = featureInfo(feature);
  const name = isAr ? info.labelAr : info.labelEn;
  const desc = isAr ? info.descAr : info.descEn;

  const message = isAr
    ? `أهلاً، عايز أفعّل "${info.labelAr}" في عيادتي على ألفا.`
    : `Hi, I would like to activate "${info.labelEn}" for my clinic on Alpha.`;
  const href = `https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4 md:p-8" dir={isAr ? "rtl" : "ltr"}>
      <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        <div className="bg-ink-slab px-8 py-9 text-white">
          <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-white/15 bg-white/5">
            <Lock size={22} />
          </div>
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/50">
            {isAr ? "غير مفعّل في اشتراكك" : "Not in your subscription"}
          </p>
          <h2 className="font-display text-3xl font-black tracking-tight">{name}</h2>
          {desc && <p className="mt-3 text-[15px] leading-relaxed text-white/70">{desc}</p>}
        </div>

        <div className="space-y-5 px-8 py-7">
          <p className="text-[15px] leading-relaxed text-ink-body">
            {isAr
              ? "الخاصية دي إضافة بتتفعّل لكل عيادة على حدة. كلّم فريق ألفا وهنفعّلها لك في نفس اليوم."
              : "This is an add-on switched on per clinic. Write to the Alpha team and it is activated the same day."}
          </p>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 rounded-xl bg-accent px-6 py-3.5 text-[15px] font-black text-ink-on-accent transition-colors hover:bg-accent-strong"
          >
            <MessageCircle size={18} />
            {isAr ? "كلّمنا على واتساب" : "Contact us on WhatsApp"}
          </a>
          <p className="font-display text-sm font-bold tracking-wide text-ink-muted" dir="ltr">
            {SUPPORT_WHATSAPP}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps a page (or a panel) in a subscription check.
 *
 * Renders nothing until the clinic document has arrived — `hasFeature(null, …)` is false, and a
 * locked screen that flashes for a moment on every cold load teaches people the switch is
 * flaky. Put it OUTSIDE a component's hooks (around the page's JSX, or as the page's parent),
 * never as an early return between hooks; see the note in attendance/page.tsx for the crash
 * that ordering caused.
 */
export default function FeatureGate({ feature, children }: { feature: FeatureKey | FeatureKey[]; children: React.ReactNode }) {
  const { clinic } = useClinic();
  if (!clinic) return null;
  // A list means any-of: the WhatsApp inbox belongs to both WhatsApp add-ons. The locked screen
  // then names the first one, which is the one the list is ordered to lead with.
  if (!isAnyUnlocked(clinic, feature)) return <FeatureLocked feature={Array.isArray(feature) ? feature[0] : feature} />;
  return <>{children}</>;
}
