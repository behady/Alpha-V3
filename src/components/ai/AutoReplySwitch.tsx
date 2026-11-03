"use client";

import { useEffect, useState } from "react";
import { onSnapshot, setDoc } from "firebase/firestore";
import { getClinicDoc } from "@/lib/db-utils";
import { isUnlocked } from "@/lib/featureCatalog";
import { logActivity } from "@/lib/logger";
import { chosenAnswerMode } from "@/lib/setupWizard";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

/**
 * The one switch that lets automatic replies reach patients: `settings/whatsapp.botEnabled`, the
 * field every door already obeys (the reply engine, voice-note and photo reading, the quiet
 * nudge, the memory sweep). It writes nothing else, so the mode the owner picked on Auto-reply
 * (Bot / AI only / Both, Standard or Pro) is kept while it is off — and the test chat keeps
 * answering, which is how a mode is set up and rehearsed before patients ever see it.
 *
 * Everyone sees the state; only an Admin or Owner can flip it (the settings rule's own line).
 */
export default function AutoReplySwitch({ className = "" }: { className?: string }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { clinic, clinicId, isAdmin, isReadOnly } = useClinic();
  const { showToast, confirm } = useUI();
  const [doc, setDocState] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !clinicId) return;
    return onSnapshot(
      getClinicDoc("settings", "whatsapp"),
      (snap) => setDocState(snap.data() ?? {}),
      () => setDocState({})
    );
  }, [user, clinicId]);

  // Without the bot add-on nothing answers whatever this says; a switch that does nothing is worse
  // than no switch.
  if (!doc || !isUnlocked(clinic, "whatsappBot")) return null;

  const on = doc.botEnabled === true;
  const canFlip = isAdmin && !isReadOnly && !saving;
  const mode = chosenAnswerMode(doc);
  const modeName =
    mode === "ai" ? (isAr ? "الذكاء الاصطناعي بس" : "AI only") : mode === "both" ? (isAr ? "البوت + الذكاء الاصطناعي" : "Bot + AI") : isAr ? "البوت بس" : "Bot only";

  const flip = async () => {
    if (!canFlip) return;
    const next = !on;
    if (next) {
      const ok = await confirm(
        isAr
          ? `المرضى هيبدأوا ياخدوا ردود تلقائية من "${modeName}" على أي رسالة جديدة. تشغّل؟`
          : `Patients will start getting automatic replies from "${modeName}" on every new message. Turn it on?`,
        { title: isAr ? "تشغيل الرد التلقائي" : "Turn auto-reply on", confirmLabel: isAr ? "شغّل" : "Turn on" }
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", "whatsapp"), { botEnabled: next }, { merge: true });
      await logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, next ? "Auto-reply turned on" : "Auto-reply turned off", "settings/whatsapp");
      showToast(
        next
          ? isAr ? "الرد التلقائي شغال ✓" : "Auto-reply is on ✓"
          : isAr ? "الرد التلقائي مقفول — الفريق بيرد بنفسه، وتقدر تجرّب في محادثة الاختبار" : "Auto-reply is off — staff reply by hand; the test chat still works",
        "success"
      );
    } catch {
      showToast(isAr ? "ماقدرناش نغيّر الرد التلقائي" : "Could not change auto-reply", "error");
    } finally {
      setSaving(false);
    }
  };

  const title = canFlip
    ? on
      ? isAr ? "اقفل الرد التلقائي على المرضى" : "Stop automatic replies to patients"
      : isAr ? "شغّل الرد التلقائي على المرضى" : "Start automatic replies to patients"
    : isAr ? "الأدمن بس يقدر يغيّر الرد التلقائي" : "Only an Admin can change auto-reply";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => void flip()}
      disabled={!canFlip}
      title={title}
      data-tour="auto-reply-switch"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black whitespace-nowrap transition-colors disabled:cursor-default ${
        on ? "border-ok/30 bg-ok-tint text-ok" : "border-line bg-surface-muted text-ink-muted"
      } ${canFlip ? "hover:brightness-95" : ""} ${className}`}
    >
      <span aria-hidden className={`relative inline-block h-4 w-7 rounded-full transition-colors ${on ? "bg-ok" : "bg-ink-muted/40"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "start-3.5" : "start-0.5"}`} />
      </span>
      {on ? (isAr ? "الرد التلقائي شغال" : "Auto-reply on") : isAr ? "الرد التلقائي مقفول" : "Auto-reply off"}
    </button>
  );
}
