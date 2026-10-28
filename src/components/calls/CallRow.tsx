"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Loader2, Pencil, Phone, RotateCcw, Trash2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { callDayParts, daysLate, quickDate, recipientLabel, type CallReminder } from "@/lib/callReminders";
import { callReminderErrorText, markCallDone, rescheduleCall } from "@/lib/callRemindersApi";

/**
 * One call to make, with what can be done about it: done (with a note), call again on another
 * day, or book. Used by the dashboard card and the Calls page.
 *
 * Monochrome on purpose: the date block leads, the actions are quiet outlines, and "Done" is the
 * one yellow thing on the row. Late calls are the only other colour.
 */

const RESCHEDULE_CHIPS: { id: "tomorrow" | "3days" | "week"; ar: string; en: string }[] = [
  { id: "tomorrow", ar: "بكرة", en: "Tomorrow" },
  { id: "3days", ar: "بعد ٣ أيام", en: "In 3 days" },
  { id: "week", ar: "بعد أسبوع", en: "In a week" },
];

const INPUT = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-ink";
const PILL =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-bold text-ink transition-colors hover:border-ink-muted hover:bg-surface-subtle";
const ICON =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors hover:border-ink-muted hover:text-ink";
const YELLOW = "bg-accent text-ink-on-accent";

export default function CallRow({
  reminder,
  meUid,
  todayYmd,
  onBook,
  onDelete,
  onEdit,
  highlighted = false,
}: {
  reminder: CallReminder;
  meUid: string;
  todayYmd: string;
  onBook: (r: CallReminder) => void;
  /** Offered only to whoever may delete it (its creator, or an Owner/Admin). */
  onDelete?: (r: CallReminder) => void;
  /** Offered to the same people as delete: its creator, or an Owner/Admin. */
  onEdit?: (r: CallReminder) => void;
  highlighted?: boolean;
}) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const [mode, setMode] = useState<"idle" | "done" | "again">("idle");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(quickDate(todayYmd, "tomorrow"));
  const [busy, setBusy] = useState(false);

  const late = daysLate(reminder, todayYmd);
  const r = reminder.recipient;
  const mine = r.kind === "person" && r.uid === meUid;
  const orphan = reminder.deliveryError === "nobody";
  const day = callDayParts(reminder.date, todayYmd, isAr);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      showToast(ok, "success");
      setMode("idle");
      setNote("");
    } catch (e) {
      showToast(callReminderErrorText(e, isAr), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li id={`call-${reminder.id}`} className={`py-4 ${highlighted ? "rounded-2xl bg-accent/15 px-3" : ""}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {/* The date block: when, before who. */}
          <div
            className={`flex w-[68px] shrink-0 flex-col items-center rounded-2xl border px-1 py-2 text-center ${late > 0 ? "border-rose-200 bg-rose-50/60" : "border-line bg-surface-subtle"}`}
          >
            <span className={`max-w-full truncate text-[11px] font-bold ${late > 0 ? "text-rose-700" : "text-ink-muted"}`}>{day.top}</span>
            <span className="font-figure text-2xl font-semibold leading-none text-ink">{day.day}</span>
            <span className="text-[11px] font-semibold text-ink-muted">{day.month}</span>
            {reminder.time && <span className="mt-1 font-figure text-xs font-bold text-ink">{reminder.time}</span>}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/patients/${encodeURIComponent(reminder.patientId)}`} className="text-[15px] font-bold text-ink hover:underline">
                {reminder.patientName}
              </Link>
              {late > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                  {isAr ? `متأخرة ${late === 1 ? "يوم" : late === 2 ? "يومين" : `${late} أيام`}` : `${late} day${late === 1 ? "" : "s"} late`}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm font-semibold text-ink-body">{reminder.reason}</p>
            {reminder.previousNote && (
              <p className="mt-0.5 text-xs font-semibold text-ink-muted">
                {isAr ? "المرة اللي فاتت:" : "Last time:"} {reminder.previousNote}
              </p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-ink-muted">
              {orphan ? (isAr ? "مالهاش حد" : "Nobody assigned") : recipientLabel(r, isAr)}
              {mine && <span className={`rounded-full px-1.5 py-px ${YELLOW}`}>{isAr ? "ليك" : "yours"}</span>}
            </p>
          </div>
        </div>

        {mode === "idle" && (
          <div className="flex flex-wrap items-center justify-center gap-2 md:shrink-0 md:justify-end">
            {reminder.patientPhone && (
              <a href={`tel:${reminder.patientPhone}`} aria-label={isAr ? `كلّم ${reminder.patientName}` : `Call ${reminder.patientName}`} className={ICON}>
                <Phone size={16} />
              </a>
            )}
            <button type="button" onClick={() => setMode("done")} className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-bold transition-[filter] hover:brightness-95 ${YELLOW}`}>
              <Check size={15} /> {isAr ? "تم" : "Done"}
            </button>
            <button type="button" onClick={() => setMode("again")} className={PILL}>
              <RotateCcw size={14} /> {isAr ? "كلّمه تاني" : "Call again"}
            </button>
            <button type="button" onClick={() => onBook(reminder)} className={PILL}>
              <CalendarPlus size={14} /> {isAr ? "احجز" : "Book"}
            </button>
            {onEdit && (
              <button type="button" onClick={() => onEdit(reminder)} aria-label={isAr ? "عدّل التذكير" : "Edit reminder"} className={ICON}>
                <Pencil size={15} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(reminder)}
                aria-label={isAr ? "امسح التذكير" : "Delete reminder"}
                className={`${ICON} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {mode !== "idle" && (
        <div className="mx-auto mt-3 max-w-xl space-y-2 rounded-2xl border border-line bg-surface-subtle p-3 md:ms-[84px] md:me-0">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "done" ? (isAr ? "حصل إيه؟ (اختياري)" : "What happened? (optional)") : isAr ? "ليه هنكلّمه تاني؟ (اختياري)" : "Why call again? (optional)"}
            className={INPUT}
          />
          {mode === "again" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {RESCHEDULE_CHIPS.map((c) => {
                const value = quickDate(todayYmd, c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setDate(value)}
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${date === value ? `border-transparent ${YELLOW}` : "border-line bg-surface text-ink"}`}
                  >
                    {isAr ? c.ar : c.en}
                  </button>
                );
              })}
              <input type="date" value={date} min={todayYmd} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-ink" />
            </div>
          )}
          <div className="flex justify-center gap-2 md:justify-start">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                mode === "done"
                  ? void run(() => markCallDone(reminder.id, note.trim() || undefined), isAr ? "المكالمة اتقفلت" : "Call closed")
                  : void run(() => rescheduleCall(reminder.id, date, reminder.time, note.trim() || undefined), isAr ? "اتحدد يوم تاني" : "Set for another day")
              }
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-5 text-sm font-bold disabled:opacity-50 ${YELLOW}`}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {isAr ? "احفظ" : "Save"}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-9 rounded-full px-3 text-sm font-bold text-ink-muted hover:text-ink">
              {isAr ? "إلغاء" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
