"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { onSnapshot } from "firebase/firestore";
import { Loader2, PhoneCall, X } from "lucide-react";
import { getClinicCollection } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { REASON_MAX, REMINDER_ROLES, quickDate, recipientLabel, type ReminderRecipient, type ReminderRole, type ReminderSource } from "@/lib/callReminders";
import { callReminderErrorText, createCallReminder } from "@/lib/callRemindersApi";

/**
 * "Call this patient on Thursday": the one window for setting a call, opened from the patient
 * file, the booking pop-up and a treatment card. The day is required, the time optional (blank
 * means the clinic's morning time), the reason is free text, and it goes to one person or a role.
 */

type StaffOption = { uid: string; name: string };

const CHIPS: { id: "tomorrow" | "3days" | "week" | "month"; ar: string; en: string }[] = [
  { id: "tomorrow", ar: "بكرة", en: "Tomorrow" },
  { id: "3days", ar: "بعد ٣ أيام", en: "In 3 days" },
  { id: "week", ar: "بعد أسبوع", en: "In a week" },
  { id: "month", ar: "بعد شهر", en: "In a month" },
];

const INPUT =
  "w-full rounded-xl border border-line bg-surface-subtle px-3.5 py-2.5 text-[15px] font-semibold text-ink outline-none transition-colors focus:border-ink focus:bg-surface";

export default function CallReminderDialog({
  isOpen,
  onClose,
  patient,
  source,
  sourceNoteId,
  initialReason = "",
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  patient: { id: string; name: string };
  source: ReminderSource;
  sourceNoteId?: string;
  initialReason?: string;
  onSaved?: (id: string) => void;
}) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const today = ymdInTimeZone(clinicTimeZone(), new Date());

  const [date, setDate] = useState(() => quickDate(today, "tomorrow"));
  const [time, setTime] = useState("");
  const [reason, setReason] = useState(initialReason);
  const [to, setTo] = useState(user?.uid ? `person:${user.uid}` : "role:Receptionist");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A fresh form every time the window opens.
  useEffect(() => {
    if (!isOpen) return;
    setDate(quickDate(today, "tomorrow"));
    setTime("");
    setReason(initialReason);
    setTo(user?.uid ? `person:${user.uid}` : "role:Receptionist");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    return onSnapshot(
      getClinicCollection("staff"),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ uid: String(d.data().uid || ""), name: String(d.data().name || "") }))
          .filter((s) => s.uid && s.name);
        setStaff(rows.sort((a, b) => a.name.localeCompare(b.name)));
      },
      () => setStaff([]),
    );
  }, [isOpen]);

  // The person creating it is always on the list, staff row or not (an owner may have none).
  const people = useMemo(() => {
    const list = [...staff];
    if (user?.uid && !list.some((s) => s.uid === user.uid)) list.unshift({ uid: user.uid, name: user.name || (isAr ? "أنا" : "Me") });
    return list;
  }, [staff, user?.uid, user?.name, isAr]);

  if (!isOpen) return null;

  const recipient = (): ReminderRecipient => {
    const [kind, value] = to.split(":");
    if (kind === "role") return { kind: "role", role: value as ReminderRole };
    const person = people.find((p) => p.uid === value);
    return { kind: "person", uid: value, name: person?.name || "" };
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const id = await createCallReminder({
        patientId: patient.id,
        date,
        time: time || null,
        reason,
        recipient: recipient(),
        source,
        ...(sourceNoteId ? { sourceNoteId } : {}),
      });
      showToast(isAr ? "التذكير اتحفظ" : "Reminder saved", "success");
      onSaved?.(id);
      onClose();
    } catch (e) {
      setError(callReminderErrorText(e, isAr));
    } finally {
      setSaving(false);
    }
  };

  // Portalled to the page: opened from inside the booking pop-up, whose animated container would
  // otherwise become the frame a `fixed` child is positioned in.
  return createPortal(
    // Above the booking pop-up (z-200), which can open this window.
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-reminder-title"
        dir={isAr ? "rtl" : "ltr"}
        className="max-h-[90dvh] overflow-y-auto w-full max-w-md rounded-t-3xl bg-surface p-5 shadow-2xl sm:rounded-3xl pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="call-reminder-title" className="flex items-center gap-2 text-lg font-black text-ink">
              <PhoneCall size={18} aria-hidden="true" /> {isAr ? "تذكير بمكالمة" : "Call reminder"}
            </h2>
            <p className="truncate text-sm font-semibold text-ink-muted">{patient.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={isAr ? "إغلاق" : "Close"} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle">
            <X size={18} />
          </button>
        </div>

        <label className="mb-1.5 block text-sm font-bold text-ink">{isAr ? "اليوم" : "Day"}</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => {
            const value = quickDate(today, c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setDate(value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-bold transition-colors ${date === value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-surface-subtle"}`}
              >
                {isAr ? c.ar : c.en}
              </button>
            );
          })}
        </div>
        <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={`${INPUT} mb-4`} />

        <label className="mb-1.5 block text-sm font-bold text-ink">
          {isAr ? "الساعة" : "Time"} <span className="font-semibold text-ink-muted">{isAr ? "(اختياري)" : "(optional)"}</span>
        </label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={INPUT} />
        <p className="mb-4 mt-1 text-xs font-semibold text-ink-muted">
          {isAr ? "لو سبتها فاضية التذكير هيوصل الصبح، في ميعاد الصبح بتاع العيادة." : "Left blank, it arrives at the clinic's morning time."}
        </p>

        <label className="mb-1.5 block text-sm font-bold text-ink">{isAr ? "السبب" : "Reason"}</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REASON_MAX}
          rows={2}
          placeholder={isAr ? "مثلاً: سعر التركيبة، قالت هتفكر" : "e.g. crown price, she will think about it"}
          className={`${INPUT} mb-4 resize-none`}
        />

        <label className="mb-1.5 block text-sm font-bold text-ink">{isAr ? "لمين" : "Who calls"}</label>
        <select value={to} onChange={(e) => setTo(e.target.value)} className={`${INPUT} mb-4`}>
          <optgroup label={isAr ? "شخص" : "A person"}>
            {people.map((p) => (
              <option key={p.uid} value={`person:${p.uid}`}>
                {p.uid === user?.uid ? `${p.name} (${isAr ? "أنا" : "me"})` : p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={isAr ? "كل اللي في" : "Everyone in"}>
            {REMINDER_ROLES.map((role) => (
              <option key={role} value={`role:${role}`}>
                {recipientLabel({ kind: "role", role }, isAr)}
              </option>
            ))}
          </optgroup>
        </select>

        {error && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !reason.trim() || !date}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[15px] font-bold text-white transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {isAr ? "احفظ التذكير" : "Save reminder"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
