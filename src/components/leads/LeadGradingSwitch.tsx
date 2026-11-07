"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { Flame, Loader2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { currentClinicId, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { headerButtonGhost } from "@/components/dashboard/PageHeader";

/**
 * AI lead grading, on or off, from the Leads page itself.
 *
 * The full card (learning stage, weekly drafts, the approved flow) lives in Settings → Lead
 * grading. An owner who only wants the assistant to stop reading every lead should not have to
 * find it there: this is the same switch, next to the leads it grades. Writes through
 * /api/leads/grading-flow like the card does (admins only, Admin SDK), so turning it off stops
 * both the silent grading and the credit each model grade costs.
 */
export default function LeadGradingSwitch({ className = "" }: { className?: string }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { showToast } = useUI();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        getClinicDoc("settings", "lead_grading"),
        (snap) => setEnabled(((snap.data() as { enabled?: boolean } | undefined) || {}).enabled !== false),
        () => setEnabled(null)
      ),
    []
  );

  const toggle = async () => {
    if (enabled === null || busy) return;
    setBusy(true);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/leads/grading-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId: currentClinicId() || "", action: "toggle", enabled: !enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || "Failed"));
      showToast(
        data.enabled
          ? isAr ? "تقييم العملاء بالذكاء الاصطناعي اتفتح" : "AI lead grading is on"
          : isAr ? "تقييم العملاء بالذكاء الاصطناعي اتقفل — مفيش تقييم آلي ولا تعلّم" : "AI lead grading is off — no AI grading and no learning",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) return null;
  return (
    <button
      type="button"
      data-tour="leads-ai-grading"
      onClick={() => void toggle()}
      disabled={busy}
      title={
        enabled
          ? isAr ? "المساعد بيقيّم كل عميل محتمل من المحادثة. اضغط عشان توقفه." : "The assistant grades every lead from the chat. Click to stop it."
          : isAr ? "التقييم الآلي واقف. اضغط عشان تشغّله." : "AI grading is stopped. Click to turn it on."
      }
      className={`${headerButtonGhost} ${className}`}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Flame size={16} className={enabled ? "text-[#FACC15]" : "text-white/40"} />}
      {enabled ? (isAr ? "تقييم AI: شغال" : "AI grading: on") : isAr ? "تقييم AI: مقفول" : "AI grading: off"}
    </button>
  );
}
