"use client";

import { useEffect, useState } from "react";
import { onSnapshot, setDoc } from "firebase/firestore";
import { CalendarClock, Loader2, RotateCcw, Save } from "lucide-react";
import { getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { countedNoun } from "@/lib/arabicCount";
import { logActivity } from "@/lib/logger";
import { useSettingsDraft } from "@/lib/settingsDraft";

/**
 * Recall and reactivation intervals.
 *
 * These exist because nothing in the system expressed "this patient is due for a check-up" — the
 * concept had no home. Any feature that flags overdue patients has to read a number the clinic
 * actually stated, otherwise it is presenting a developer's guess as the practice's own policy.
 *
 * Recall keeps that promise: lib/automation/recallDue.ts refuses to run without an interval.
 * Reactivation does not, quite — api/ai/reactivation falls back to 180 days and labels the source
 * "default" — so this screen says so rather than letting the reassuring banner cover for it.
 */

const RECALL_DOC = { collection: "settings", docId: "recall" };
const REACTIVATION_DOC = { collection: "settings", docId: "reactivation" };

/** What the reactivation route falls back to when the clinic has stated nothing. */
const FALLBACK_REACTIVATION_DAYS = 180;

/** Both intervals are edited together and saved together, so they share one draft. */
type RecallDraft = { recallMonths: string; reactivationMonths: string };

/** Module-level so the fallback keeps its identity between renders. */
const EMPTY_RECALL_DRAFT: RecallDraft = { recallMonths: "", reactivationMonths: "" };

/** Months is the friendly unit; the dormancy scan reasons in days. One place, both directions. */
const DAYS_PER_MONTH = 30;
const monthsFromDays = (days: number) => Math.round(days / DAYS_PER_MONTH);

const INPUT =
  "w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 font-bold text-ink outline-none " +
  "transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10";

export default function RecallSettings() {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { user } = useAuth();
  const isAr = language === "ar";
  const txt = useSettingsText("recall");

  const [stored, setStored] = useState<RecallDraft | null>(null);
  const [recallSet, setRecallSet] = useState(false);
  const [reactivationSet, setReactivationSet] = useState(false);
  /**
   * The exact stored threshold, kept so an untouched value survives a save.
   *
   * The screen asks in months and stores in days, and 400 days shows as 13 months. Opening the
   * screen and pressing Save used to write 390 back — the policy moved ten days because somebody
   * looked at it. If the months box still reads what the stored days say, the stored days go back
   * out unchanged.
   */
  const [storedThresholdDays, setStoredThresholdDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Two documents, one screen, one Save — so one draft. Both listeners are live, and without this
  // an update to either would overwrite a half-typed interval. See lib/settingsDraft.ts.
  const {
    value: draft,
    setValue: setDraft,
    isDirty,
    discard,
    markSaved,
  } = useSettingsDraft<RecallDraft>("recall", stored, EMPTY_RECALL_DRAFT);
  const { recallMonths, reactivationMonths } = draft;
  const setRecallMonths = (value: string) => setDraft((current) => ({ ...current, recallMonths: value }));
  const setReactivationMonths = (value: string) =>
    setDraft((current) => ({ ...current, reactivationMonths: value }));

  useEffect(() => {
    const unsubRecall = onSnapshot(getClinicDoc(RECALL_DOC.collection, RECALL_DOC.docId), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (d?.intervalMonths) {
        setStored((current) => ({
          ...(current ?? EMPTY_RECALL_DRAFT),
          recallMonths: String(d.intervalMonths),
        }));
        setRecallSet(true);
      } else {
        setStored((current) => current ?? EMPTY_RECALL_DRAFT);
        setRecallSet(false);
      }
      setLoading(false);
    });
    const unsubReact = onSnapshot(getClinicDoc(REACTIVATION_DOC.collection, REACTIVATION_DOC.docId), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      const days = Number(d?.thresholdDays);
      if (Number.isFinite(days) && days > 0) {
        setStoredThresholdDays(days);
        setStored((current) => ({
          ...(current ?? EMPTY_RECALL_DRAFT),
          reactivationMonths: String(monthsFromDays(days)),
        }));
        setReactivationSet(true);
      } else {
        setStoredThresholdDays(null);
        setReactivationSet(false);
      }
    });
    return () => {
      unsubRecall();
      unsubReact();
    };
  }, []);

  const save = async () => {
    const recall = Number(recallMonths);
    const reactivation = Number(reactivationMonths);

    if (!Number.isFinite(recall) || recall <= 0) {
      showToast(txt.recallInvalid, "error");
      return;
    }
    if (!Number.isFinite(reactivation) || reactivation <= 0) {
      showToast(txt.lapsedInvalid, "error");
      return;
    }

    // An untouched months box writes the days it came from, not a re-derived approximation.
    const thresholdDays =
      storedThresholdDays !== null && monthsFromDays(storedThresholdDays) === reactivation
        ? storedThresholdDays
        : Math.round(reactivation * DAYS_PER_MONTH);

    setSaving(true);
    try {
      await setDoc(
        getClinicDoc(RECALL_DOC.collection, RECALL_DOC.docId),
        { intervalMonths: recall, configuredAt: new Date().toISOString() },
        { merge: true }
      );
      await setDoc(
        getClinicDoc(REACTIVATION_DOC.collection, REACTIVATION_DOC.docId),
        { thresholdDays, configuredAt: new Date().toISOString() },
        { merge: true }
      );
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Settings Updated",
        `Recall interval set to ${recall} months; reactivation threshold ${thresholdDays} days.`
      );
      setRecallSet(true);
      setReactivationSet(true);
      markSaved();
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-ink-muted" size={22} />
      </div>
    );
  }

  const months = (n: number) =>
    countedNoun(n, isAr, { one: txt.monthOne, two: txt.monthTwo, few: txt.monthFew, many: txt.monthMany });

  const recallNum = Number(recallMonths);
  const lapsedNum = Number(reactivationMonths);
  const bothStated = recallSet && Number.isFinite(recallNum) && recallNum > 0;

  // The policy read back as a sentence. Two numbers in two boxes never said what they add up to.
  const headline = bothStated
    ? isAr
      ? `المريض بيبقى محتاج كشف بعد ${months(recallNum)} من آخر زيارة${
          Number.isFinite(lapsedNum) && lapsedNum > 0 ? `، وبيتحسب منقطع بعد ${months(lapsedNum)}` : ""
        }.`
      : `A patient is due for a check-up ${months(recallNum)} after their last visit${
          Number.isFinite(lapsedNum) && lapsedNum > 0 ? `, and counts as lapsed after ${months(lapsedNum)}` : ""
        }.`
    : txt.notStated;

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* Two numbers in two boxes never said what they add up to. This is the policy, read back. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <CalendarClock size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {headline}
            </p>
          </div>

          <span
            className={`inline-flex shrink-0 items-center gap-2 self-start rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
              bothStated ? "bg-white/12 text-white" : "bg-amber-400/20 text-amber-200"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${bothStated ? "bg-emerald-400" : "bg-amber-400"}`} />
            {bothStated ? txt.active : txt.notSet}
          </span>
        </div>
      </div>

      <section>
        <div className="grid grid-cols-1 gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-6 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-ink-muted">
              {txt.recallLabel}
            </label>
            <input
              type="number"
              min={1}
              value={recallMonths}
              onChange={(e) => setRecallMonths(e.target.value)}
              placeholder={txt.recallPlaceholder}
              className={INPUT}
            />
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-ink-muted">{txt.recallHint}</p>
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-ink-muted">
              {txt.lapsedLabel}
            </label>
            <input
              type="number"
              min={1}
              value={reactivationMonths}
              onChange={(e) => setReactivationMonths(e.target.value)}
              placeholder={txt.lapsedPlaceholder}
              className={INPUT}
            />
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-ink-muted">{txt.lapsedHint}</p>
          </div>
        </div>
      </section>

      {/* Two different silences, said apart. Recall genuinely stays off; reactivation quietly runs
          on a number nobody here chose, and a banner that implies otherwise is worse than none. */}
      {!recallSet && (
        <p className="rounded-2xl border border-warn/25 bg-warn-tint px-5 py-4 text-[12px] font-semibold leading-relaxed text-warn">
          {txt.recallOff}
        </p>
      )}
      {!reactivationSet && (
        <p className="rounded-2xl border border-line bg-surface-subtle px-5 py-4 text-[12px] font-semibold leading-relaxed text-ink-body">
          {txt.lapsedFallback.replace(
            "{months}",
            months(monthsFromDays(FALLBACK_REACTIVATION_DAYS))
          )}
        </p>
      )}

      {isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {txt.discard}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
