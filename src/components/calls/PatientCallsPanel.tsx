"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { PhoneCall } from "lucide-react";
import { getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { CALL_REMINDERS_COLLECTION, callDayLabel, recipientLabel, reminderFromDoc, type CallReminder } from "@/lib/callReminders";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";

/**
 * A patient's planned and past calls, in their file: the next person to ring them sees what was
 * said last time. Hidden when the patient has none.
 */

const STATUS_WORDS: Record<CallReminder["status"], [string, string]> = {
  open: ["Planned", "مستنية"],
  done: ["Done", "اتعملت"],
  rescheduled: ["Call again", "اتأجلت"],
  booked: ["Booked", "اتحجز"],
};

export default function PatientCallsPanel({ patientId }: { patientId: string }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const [rows, setRows] = useState<CallReminder[]>([]);

  useEffect(() => {
    if (!patientId) return;
    return onSnapshot(
      query(getClinicCollection(CALL_REMINDERS_COLLECTION), where("patientId", "==", patientId)),
      (snap) => setRows(snap.docs.map((d) => reminderFromDoc(d.id, d.data()))),
      () => setRows([]),
    );
  }, [patientId]);

  const sorted = useMemo(() => {
    const open = rows.filter((r) => r.status === "open").sort((a, b) => a.fireAtMs - b.fireAtMs);
    const handled = rows.filter((r) => r.status !== "open").sort((a, b) => (b.handledAtMs ?? b.createdAtMs) - (a.handledAtMs ?? a.createdAtMs));
    return [...open, ...handled];
  }, [rows]);

  if (sorted.length === 0) return null;
  const next = sorted[0].status === "open" ? sorted[0] : null;
  const today = ymdInTimeZone(clinicTimeZone(), new Date());
  const dayText = (r: CallReminder) => callDayLabel(r.date, r.time, today, isAr);

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label={isAr ? "المكالمات" : "Calls"}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-black text-ink">
          <PhoneCall size={15} aria-hidden="true" /> {isAr ? "المكالمات" : "Calls"}
        </h3>
        {next && (
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-[var(--accent-ink)]">
            {isAr ? `مكالمة ${dayText(next)}` : `Call: ${dayText(next)}`}
          </span>
        )}
      </div>
      <ul className="divide-y divide-line">
        {sorted.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="font-figure font-bold text-ink">{dayText(r)}</span>
            <span className="min-w-0 flex-1 font-semibold text-ink-body">{r.reason}</span>
            <span className="text-xs font-bold text-ink-muted">
              {recipientLabel(r.recipient, isAr)} · {isAr ? STATUS_WORDS[r.status][1] : STATUS_WORDS[r.status][0]}
            </span>
            {(r.note || r.handledBy) && (
              <p className="w-full text-xs font-semibold text-ink-muted">
                {r.handledBy?.name ? `${r.handledBy.name}: ` : ""}
                {r.note || ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
