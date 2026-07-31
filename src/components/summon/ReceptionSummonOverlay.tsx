"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  acknowledgeStaffSummon,
  fetchPendingSummonForUser,
  isReceptionSummonTarget,
  subscribeToPendingSummonForUser,
} from "@/lib/staffSummon";
import { playSummonAlert, unlockSummonAudio } from "@/lib/staffSummonSound";
import {
  getSummonNotificationPermission,
  requestSummonNotificationPermission,
  showSummonNotification,
} from "@/lib/summonNotifications";
import { enableFcmPushForUser, subscribeFcmForeground } from "@/lib/fcmClient";
import type { StaffSummon } from "@/types/staffSummon";

const REPEAT_MS = 6000;
const POLL_MS = 20000;

export default function ReceptionSummonOverlay() {
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const [pending, setPending] = useState<StaffSummon | null>(null);
  const [ackLoading, setAckLoading] = useState(false);
  const [notifPermission, setNotifPermission] = useState(() => getSummonNotificationPermission());
  const [enablingAlerts, setEnablingAlerts] = useState(false);
  const lastPlayedIdRef = useRef<string | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const isTarget = isReceptionSummonTarget(user as any);

  const alertForSummon = useCallback(
    (summon: StaffSummon, forceSound = false) => {
      const isNew = summon.id !== lastPlayedIdRef.current;
      if (isNew) lastPlayedIdRef.current = summon.id;

      if (isNew || forceSound) {
        void playSummonAlert();
      }

      const title = language === "ar" ? "الطبيب يطلبك" : "Doctor needs you";
      const body =
        language === "ar"
          ? `${summon.requestedByName} يطلب حضورك`
          : `${summon.requestedByName} is calling you to the desk`;

      if (notifPermission === "granted" && (document.hidden || isNew)) {
        showSummonNotification({
          title,
          body,
          summonId: summon.id,
        });
      }

      if (typeof document !== "undefined") {
        const prefix = language === "ar" ? "🔔 طلب استقبال — " : "🔔 Reception call — ";
        document.title = `${prefix}${summon.requestedByName}`;
      }
    },
    [language, notifPermission]
  );

  const clearRepeatTimer = useCallback(() => {
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    if (!user?.uid || !isTarget) {
      setPending(null);
      return;
    }

    const uid = user.uid;

    const unsub = subscribeToPendingSummonForUser(uid, (summon) => {
      setPending(summon);
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchPendingSummonForUser(uid).then((summon) => {
          if (summon) setPending(summon);
        });
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    const pollId = window.setInterval(() => {
      if (document.hidden) {
        void fetchPendingSummonForUser(uid).then((summon) => {
          if (summon) setPending(summon);
        });
      }
    }, POLL_MS);

    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(pollId);
    };
  }, [user?.uid, isTarget]);

  useEffect(() => {
    if (!user?.uid || !isTarget) return;
    let cancelled = false;
    let unsubFcm: (() => void) | undefined;

    void subscribeFcmForeground(() => {
      if (cancelled) return;
      void fetchPendingSummonForUser(user.uid).then((summon) => {
        if (summon) setPending(summon);
      });
    }).then((unsub) => {
      if (cancelled) {
        unsub?.();
        return;
      }
      unsubFcm = unsub ?? undefined;
    });

    return () => {
      cancelled = true;
      unsubFcm?.();
    };
  }, [user?.uid, isTarget]);

  useEffect(() => {
    if (!pending?.id) {
      clearRepeatTimer();
      void releaseWakeLock();
      if (typeof document !== "undefined") {
        document.title = "Alpha Dental";
      }
      return;
    }

    alertForSummon(pending, true);

    repeatTimerRef.current = setInterval(() => {
      alertForSummon(pending, true);
    }, REPEAT_MS);

    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      void (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } })
        .wakeLock?.request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch(() => {
          /* optional — not supported or tab hidden */
        });
    }

    return () => {
      clearRepeatTimer();
      void releaseWakeLock();
    };
  }, [pending?.id, pending?.requestedByName, alertForSummon, clearRepeatTimer, releaseWakeLock]);

  useEffect(() => {
    if (!isTarget || typeof window === "undefined") return;

    const unlockOnInteraction = () => {
      void unlockSummonAudio();
    };

    window.addEventListener("pointerdown", unlockOnInteraction, { once: true });
    window.addEventListener("keydown", unlockOnInteraction, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockOnInteraction);
      window.removeEventListener("keydown", unlockOnInteraction);
    };
  }, [isTarget]);

  useEffect(() => {
    if (!pending) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pending]);

  if (!isTarget) return null;
  const permBanner = null;

  if (!pending) {
    return permBanner;
  }

  const handleSeen = async () => {
    setAckLoading(true);
    try {
      await acknowledgeStaffSummon(pending.id);
      lastPlayedIdRef.current = null;
    } finally {
      setAckLoading(false);
    }
  };

  const txt = {
    title: language === "ar" ? "الطبيب يطلبك" : "Doctor is calling you",
    subtitle:
      language === "ar"
        ? "اضغط «تم الاطلاع» للمتابعة في النظام"
        : "Press Seen to continue using the system",
    seen: language === "ar" ? "تم الاطلاع" : "Seen",
    from: language === "ar" ? "من" : "From",
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/75 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        dir={isRTL ? "rtl" : "ltr"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="summon-title"
      >
        <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl border border-orange-200 overflow-hidden animate-in zoom-in-95 duration-300">
          <div className="bg-gradient-to-br from-orange-500 to-amber-600 px-6 py-8 text-white text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-4 ring-4 ring-white/30 animate-pulse">
              <BellRing size={32} className="text-white" />
            </div>
            <h2 id="summon-title" className="text-2xl font-black tracking-tight">
              {txt.title}
            </h2>
            <p className="text-sm font-bold text-orange-100 mt-2">{txt.subtitle}</p>
          </div>

          <div className="px-6 py-6 text-center space-y-4">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{txt.from}</p>
            <p className="text-xl font-black text-slate-900">{pending.requestedByName}</p>

            <button
              type="button"
              onClick={() => void handleSeen()}
              disabled={ackLoading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg shadow-lg shadow-emerald-600/30 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {ackLoading ? (
                <Loader2 size={22} className="animate-spin" />
              ) : (
                <CheckCircle2 size={22} />
              )}
              {txt.seen}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
