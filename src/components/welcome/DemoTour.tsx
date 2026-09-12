"use client";

import { useState } from "react";
import { Eye, Loader2, ArrowLeft, ArrowRight, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { homeClinicFor, isDemoClinic } from "@/lib/demoTour";

/**
 * The two faces of the sample-clinic tour.
 *
 * `DemoTourCard` sits on the welcome page of a real clinic and offers the tour. `DemoTourBanner`
 * sits above every page while the sample clinic is open, says so, and offers the way back. Both
 * talk to /api/demo/tour; neither writes anything itself.
 */
async function callTour(action: "start" | "leave") {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("no session");
  const res = await fetch("/api/demo/tour", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || "request failed");
  return data as { clinicId: string; name?: string; home?: string | null };
}

export function DemoTourCard() {
  const { clinic } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const [starting, setStarting] = useState(false);
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  // Already inside the sample clinic: the banner is the control, not this card.
  if (isDemoClinic(clinic)) return null;

  const start = async () => {
    setStarting(true);
    try {
      const data = await callTour("start");
      try {
        sessionStorage.setItem("preferredClinicId", data.clinicId);
      } catch {
        /* optional */
      }
      // A full load: the new role has to be read before ClinicContext decides where we are.
      window.location.assign("/");
    } catch {
      showToast(isAr ? "تعذّر فتح العيادة التجريبية. جرّب تاني." : "Couldn't open the sample clinic. Try again.", "error");
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-tour="demo-tour">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-tint text-accent">
          <Eye size={17} />
        </div>
        <div>
          <p className="text-sm font-black text-ink">{isAr ? "شوف النظام بعيادة فيها بيانات" : "See it with sample data"}</p>
          <p className="mt-0.5 text-[12.5px] font-medium leading-relaxed text-ink-muted">
            {isAr
              ? "عيادة تجريبية فيها مرضى ومواعيد وحسابات أسبوع كامل. اتفرّج براحتك — مفيش حاجة فيها ليك، ومفيش حاجة تتغيّر."
              : "A sample clinic with a full week of patients, appointments and takings. Look around freely — nothing in it is yours, and nothing can be changed."}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ink-slab px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-ink disabled:opacity-60"
      >
        {starting ? <Loader2 size={15} className="animate-spin" /> : <ArrowIcon size={15} />}
        {isAr ? "افتح العيادة التجريبية" : "Open the sample clinic"}
      </button>
    </div>
  );
}

export function DemoTourBanner() {
  const { clinic, clinicId, setClinicId } = useClinic();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const [leaving, setLeaving] = useState(false);

  if (!clinicId || !isDemoClinic(clinic)) return null;
  // The seeded team's own admin is not touring; they get no banner.
  if (user?.clinicRoles?.[clinicId] !== "Assistant") return null;

  const home = homeClinicFor(user?.clinicRoles, user?.defaultClinicId, clinicId);

  const back = () => {
    if (home) setClinicId(home);
  };

  const remove = async () => {
    setLeaving(true);
    try {
      const data = await callTour("leave");
      try {
        sessionStorage.setItem("preferredClinicId", data.home || home || "");
      } catch {
        /* optional */
      }
      window.location.assign("/");
    } catch {
      showToast(isAr ? "تعذّر إزالة العيادة التجريبية." : "Couldn't remove the sample clinic.", "error");
      setLeaving(false);
    }
  };

  return (
    <div className="relative z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-warn/25 bg-warn-tint px-4 py-2.5 text-sm">
      <p className="font-bold text-ink">
        <Eye size={14} className="me-1.5 inline -mt-0.5 text-warn" />
        {isAr
          ? "انت في العيادة التجريبية. كل اللي هنا بيانات وهمية، ومفيش حاجة بتتغيّر."
          : "You're in the sample clinic. Everything here is made up, and nothing can be changed."}
      </p>
      <span className="flex items-center gap-2">
        {home && (
          <button type="button" onClick={back} className="rounded-lg bg-ink-slab px-3 py-1.5 text-xs font-bold text-white hover:bg-ink">
            {isAr ? "ارجع لعيادتي" : "Back to my clinic"}
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={leaving}
          className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-muted hover:text-ink disabled:opacity-60"
        >
          {leaving ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          {isAr ? "شيل العيادة التجريبية" : "Remove sample clinic"}
        </button>
      </span>
    </div>
  );
}
