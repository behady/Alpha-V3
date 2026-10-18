"use client";

import PageHeader from "@/components/dashboard/PageHeader";
import FeatureGate from "@/components/FeatureGate";
import BroadcastPanel from "@/components/whatsapp/BroadcastPanel";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";

/**
 * WhatsApp → Broadcast: one message to the whole patient list, sent slowly from the clinic's
 * own linked number. Admins only — it reads every patient and messages all of them.
 * See components/whatsapp/BroadcastPanel and lib/broadcast.
 */
export default function WhatsAppBroadcastPage() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { isAdmin } = useClinic();
  return (
    <FeatureGate feature="whatsappIntegration">
      <div className="mx-auto max-w-7xl px-3 pb-24 pt-5 sm:px-6 sm:pt-6 lg:pb-10 xl:px-10">
        <PageHeader
          title={isAr ? "رسالة لكل المرضى" : "Message all patients"}
          subtitle={
            isAr
              ? "اكتب رسالة واحدة، والسيستم يبعتها لمرضاك على مهل من رقم العيادة — بالسرعة اللي متقفلش الرقم."
              : "Write one message and the system sends it to your patients slowly, from the clinic's own number — at a pace that keeps the number safe."
          }
        />
        {isAdmin ? (
          <BroadcastPanel />
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-muted">
            {isAr ? "الصفحة دي لمدير العيادة بس." : "Only the clinic's admins can send to all patients."}
          </p>
        )}
      </div>
    </FeatureGate>
  );
}
