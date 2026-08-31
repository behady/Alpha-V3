"use client";

import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, Loader2, UserRound, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import {
  canRequestReceptionSummon,
  createStaffSummon,
  loadReceptionistOptions,
  subscribeToSummon,
} from "@/lib/staffSummon";
import type { ReceptionistOption } from "@/types/staffSummon";
import { notifySummonPush } from "@/lib/fcmClient";

type SummonUiState = "idle" | "calling" | "seen";

/** Dashboard quick action + picker modal (Patient / Visit / Pay row). */
export default function ReceptionSummonPanel() {
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();

  const [open, setOpen] = useState(false);
  const [receptionists, setReceptionists] = useState<ReceptionistOption[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [activeSummonId, setActiveSummonId] = useState<string | null>(null);
  const [uiState, setUiState] = useState<SummonUiState>("idle");
  const [targetName, setTargetName] = useState("");

  const canSummon = canRequestReceptionSummon(user as any);

  useEffect(() => {
    if (!canSummon) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingList(true);
    void loadReceptionistOptions()
      .then((list) => {
        if (!cancelled) setReceptionists(list);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canSummon]);

  useEffect(() => {
    if (!activeSummonId) return;
    return subscribeToSummon(activeSummonId, (summon) => {
      if (!summon) {
        setUiState("idle");
        setActiveSummonId(null);
        setCallingId(null);
        return;
      }
      if (summon.status === "seen") {
        setUiState("seen");
        setCallingId(null);
      }
    });
  }, [activeSummonId]);

  useEffect(() => {
    if (uiState !== "seen") return;
    const t = window.setTimeout(() => {
      setUiState("idle");
      setActiveSummonId(null);
      setTargetName("");
    }, 4000);
    return () => window.clearTimeout(t);
  }, [uiState]);

  if (!canSummon) return null;

  const txt = {
    button: language === "ar" ? "استقبال" : "Reception",
    title: language === "ar" ? "استدعاء الاستقبال" : "Call reception",
    hint:
      language === "ar"
        ? "اختر اسم موظف الاستقبال"
        : "Tap a receptionist name",
    calling: language === "ar" ? "في انتظار الاطلاع…" : "Waiting for Seen…",
    seen: language === "ar" ? "تم الاطلاع ✓" : "Seen ✓",
    noStaff:
      language === "ar"
        ? "لا يوجد موظف استقبال مرتبط بحساب دخول (Settings → Users)"
        : "No reception user linked (Settings → Users)",
    offline:
      language === "ar"
        ? "هذا الموظف غير مرتبط بحساب دخول"
        : "This staff member has no login linked",
    close: language === "ar" ? "إغلاق" : "Close",
  };

  const handleCall = async (target: ReceptionistOption) => {
    if (!user) return;
    if (!target.uid) {
      showToast(txt.offline, "error");
      return;
    }
    if (callingId) return;

    setCallingId(target.staffId);
    setTargetName(target.name);
    setUiState("calling");
    setOpen(false);

    try {
      const summonId = await createStaffSummon(target, user as any);
      setActiveSummonId(summonId);
      void notifySummonPush(summonId);
      showToast(
        language === "ar" ? `تم استدعاء ${target.name}` : `Calling ${target.name}`,
        "success"
      );
    } catch (e) {
      console.error(e);
      setUiState("idle");
      setCallingId(null);
      setTargetName("");
      showToast(language === "ar" ? "فشل الاستدعاء" : "Call failed", "error");
    }
  };

  const buttonHighlight =
    uiState === "calling"
      ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
      : uiState === "seen"
        ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
        : "border-line hover:bg-violet-50 hover:border-violet-300";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`bg-surface border rounded-xl px-2 flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] transition-all shadow-sm h-full min-h-[5.5rem] lg:min-h-0 relative ${buttonHighlight}`}
        title={txt.title}
      >
        <BellRing
          size={28}
          className={
            uiState === "calling"
              ? "text-amber-600 animate-pulse"
              : uiState === "seen"
                ? "text-emerald-600"
                : "text-violet-600"
          }
        />
        <span className="text-sm font-black uppercase text-ink-muted tracking-wide">{txt.button}</span>
        {uiState === "calling" && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 animate-ping" />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
          dir={isRTL ? "rtl" : "ltr"}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-surface shadow-2xl border border-violet-100 overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-violet-50">
              <div className="flex items-center gap-2">
                <BellRing size={20} className="text-violet-700" />
                <div>
                  <h3 className="text-sm font-black text-ink">{txt.title}</h3>
                  <p className="text-[10px] font-bold text-ink-muted">{txt.hint}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-full hover:bg-surface text-slate-400"
                aria-label={txt.close}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {uiState === "calling" && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900 mb-2">
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <span className="text-xs font-bold">
                    {txt.calling} {targetName}
                  </span>
                </div>
              )}
              {uiState === "seen" && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800 mb-2">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span className="text-xs font-black">
                    {targetName} — {txt.seen}
                  </span>
                </div>
              )}

              {loadingList ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin text-violet-500" size={24} />
                </div>
              ) : receptionists.length === 0 ? (
                <p className="text-xs font-bold text-ink-muted text-center py-6 px-2">{txt.noStaff}</p>
              ) : (
                receptionists.map((r) => (
                  <button
                    key={r.staffId}
                    type="button"
                    disabled={Boolean(callingId)}
                    onClick={() => void handleCall(r)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold text-slate-800 bg-violet-50 border border-violet-100 hover:bg-violet-100 transition-all disabled:opacity-50"
                  >
                    <UserRound size={18} className="text-violet-600 shrink-0" />
                    <span className="text-start flex-1">{r.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
