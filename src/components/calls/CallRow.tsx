"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Loader2, Phone, RotateCcw, Trash2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { daysLate, quickDate, recipientLabel, type CallReminder } from "@/lib/callReminders";
import { callReminderErrorText, markCallDone, rescheduleCall } from "@/lib/callRemindersApi";

/**
 * One call to make, with what can be done about it: done (with a note), call again on another
 * day, or book. Used by the dashboard card and the Calls page.
 */

const RESCHEDULE_CHIPS: { id: "tomorrow" | "3days" | "week"; ar: string; en: string }[] = [
  { id: "tomorrow", ar: "بكرة", en: "Tomorrow" },
  { id: "3days", ar: "بعد ٣ أيام", en: "In 3 days" },
  { id: "week", ar: "بعد أسبوع", en: "In a week" },
];

const INPUT = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-ink";

export default function CallRow({
  reminder,
  meUid,
  todayYmd,
  onBook,
  onDelete,
  highlighted = false,
}: {
  reminder: CallReminder;
  meUid: string;
  todayYmd: string;
  onBook: (r: CallReminder) => void;
  /** Offered only to whoever may delete it (its creator, or an Owner/Admin). */
  onDelete?: (r: CallReminder) => void;
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
    <li id={`call-${reminder.id}`} className={`py-3 ${highlighted ? "rounded-xl bg-accent/15 px-2" : ""}`}>
      <div className="flex items-start gap-3">
        {reminder.patientPhone ? (
          <a
            href={`tel:${reminder.patientPhone}`}
            aria-label={isAr ? `كلّم ${reminder.patientName}` : `Call ${reminder.patientName}`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-white"
          >
            <Phone size={16} />
          </a>
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-subtle text-ink-faint" aria-hidden="true">
            <Phone size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/patients/${encodeURIComponent(reminder.patientId)}`} className="font-bold text-ink hover:underline">
              {reminder.patientName}
            </Link>
            {reminder.time && <span className="font-figure text-xs font-bold text-ink-muted">{reminder.time}</span>}
            {late > 0 && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                {isAr ? `متأخرة منذ ${late === 1 ? "يوم" : late === 2 ? "يومين" : `${late} أيام`}` : `${late} day${late === 1 ? "" : "s"} late`}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-ink-body">{reminder.reason}</p>
          <p className="text-xs font-bold text-ink-muted">
            {orphan ? (isAr ? "مالهاش حد" : "Nobody assigned") : recipientLabel(r, isAr)}
            {mine && <span className="ms-1.5 rounded-full bg-accent px-1.5 py-px text-[var(--accent-ink)]">{isAr ? "ليك" : "yours"}</span>}
          </p>
        </div>
      </div>

      {mode === "idle" && (
        <div className="mt-2 flex flex-wrap gap-2 ps-[52px]">
          <button type="button" onClick={() => setMode("done")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-sm font-bold text-white">
            <Check size={14} /> {isAr ? "تم" : "Done"}
          </button>
          <button type="button" onClick={() => setMode("again")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-bold text-ink">
            <RotateCcw size={14} /> {isAr ? "كلّمه تاني" : "Call again"}
          </button>
          <button type="button" onClick={() => onBook(reminder)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-bold text-ink">
            <CalendarPlus size={14} /> {isAr ? "احجز" : "Book"}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(reminder)}
              aria-label={isAr ? "امسح التذكير" : "Delete reminder"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}

      {mode !== "idle" && (
        <div className="mt-2 space-y-2 ps-[52px]">
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
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${date === value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink"}`}
                  >
                    {isAr ? c.ar : c.en}
                  </button>
                );
              })}
              <input type="date" value={date} min={todayYmd} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-ink" />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                mode === "done"
                  ? void run(() => markCallDone(reminder.id, note.trim() || undefined), isAr ? "المكالمة اتقفلت" : "Call closed")
                  : void run(() => rescheduleCall(reminder.id, date, reminder.time, note.trim() || undefined), isAr ? "اتحدد يوم تاني" : "Set for another day")
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {isAr ? "احفظ" : "Save"}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-9 rounded-full px-3 text-sm font-bold text-ink-muted">
              {isAr ? "إلغاء" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
