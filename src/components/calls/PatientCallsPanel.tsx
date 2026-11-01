"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { ChevronDown, PhoneCall } from "lucide-react";
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

// Yellow for the call still waiting (the one thing to act on); the rest stay quiet.
const STATUS_PILL: Record<CallReminder["status"], string> = {
  open: "bg-accent text-ink-on-accent",
  done: "bg-emerald-50 text-emerald-700",
  rescheduled: "bg-amber-50 text-amber-800",
  booked: "bg-surface-subtle text-ink-body",
};

export default function PatientCallsPanel({ patientId }: { patientId: string }) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const [rows, setRows] = useState<CallReminder[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [openNotes, setOpenNotes] = useState<Set<string>>(() => new Set());

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
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4 max-md:mt-2.5 max-md:p-3" aria-label={isAr ? "المكالمات" : "Calls"}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-black text-ink">
          <PhoneCall size={15} aria-hidden="true" /> {isAr ? "المكالمات" : "Calls"}
        </h3>
        {next && (
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-ink-on-accent">
            {isAr ? `مكالمة ${dayText(next)}` : `Call: ${dayText(next)}`}
          </span>
        )}
      </div>
      <ul className="divide-y divide-line">
        {sorted.map((r, i) => {
          const noteOpen = openNotes.has(r.id);
          return (
          // Stacked, not side by side: on a phone the date and the name used to fall off the edge
          // and a mixed Arabic/English reason was squeezed into a sliver. Phones show only the first
          // call (the next planned one, else the latest) until "Show all" is tapped.
          <li key={r.id} className={`flex w-full min-w-0 flex-col gap-1.5 overflow-hidden py-2.5 ${i > 0 && !showAll ? "max-md:hidden" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-figure text-xs font-semibold text-ink-body">{dayText(r)}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[r.status]}`}>
                {isAr ? STATUS_WORDS[r.status][1] : STATUS_WORDS[r.status][0]}
              </span>
            </div>
            {/* <bdi> keeps a mixed Arabic/English reason in its own order while the line still
                aligns with the rest of the card; tap a clamped reason to read all of it. */}
            <button
              type="button"
              onClick={() => setOpenNotes((prev) => {
                const next = new Set(prev);
                if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                return next;
              })}
              aria-expanded={noteOpen}
              className={`w-full break-words text-start text-sm font-medium text-ink ${noteOpen ? "" : "line-clamp-2"}`}
            >
              <bdi>{r.reason}</bdi>
            </button>
            <p className="truncate text-xs font-semibold text-ink-muted">
              {isAr ? "بواسطة" : "By"} {recipientLabel(r.recipient, isAr)}
            </p>
            {(r.note || r.handledBy) && (
              <p className="w-full break-words text-xs font-semibold text-ink-muted">
                {r.handledBy?.name ? `${r.handledBy.name}: ` : ""}
                <bdi>{r.note || ""}</bdi>
              </p>
            )}
          </li>
          );
        })}
      </ul>
      {sorted.length > 1 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-subtle hover:text-ink md:hidden"
        >
          {showAll
            ? (isAr ? "اخفي المكالمات القديمة" : "Hide past calls")
            : (isAr ? `عرض كل المكالمات (${sorted.length})` : `Show all ${sorted.length} calls`)}
          <ChevronDown size={14} className={`transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
