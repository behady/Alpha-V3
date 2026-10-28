"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, PhoneCall } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { dueOnCard, type CallReminder } from "@/lib/callReminders";
import { useOpenCallReminders } from "@/lib/useOpenCallReminders";
import CallRow from "@/components/calls/CallRow";
import CallBookingHost from "@/components/calls/CallBookingHost";
import CallReminderDialog from "@/components/calls/CallReminderDialog";

/**
 * "مكالمات النهارده": today's calls and the overdue ones, on the desk's dashboard. Everyone at the
 * desk sees every row, so a call does not wait for the one person it was for. Hidden when empty.
 */
export default function CallsTodayCard() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { rows } = useOpenCallReminders();
  const [booking, setBooking] = useState<CallReminder | null>(null);
  const [editing, setEditing] = useState<CallReminder | null>(null);
  const { isAdmin } = useClinic();
  // The clock the card reads. Ticks once a minute and on coming back to the tab, so a desk tab
  // left open overnight moves to the new day by itself.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const timer = window.setInterval(tick, 60_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const today = ymdInTimeZone(clinicTimeZone(), new Date(nowMs));
  const due = dueOnCard(rows, nowMs, today);
  if (due.length === 0 && !booking && !editing) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={isAr ? "مكالمات النهارده" : "Today's calls"}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-black text-ink">
          <PhoneCall size={17} aria-hidden="true" /> {isAr ? "مكالمات النهارده" : "Today's calls"}
          <span className="rounded-full bg-accent px-2 py-0.5 font-figure text-xs text-[var(--accent-ink)]">{due.length}</span>
        </h2>
        <Link href="/calls" className="inline-flex items-center gap-1 text-sm font-bold text-ink-muted hover:text-ink">
          {isAr ? "كل المكالمات" : "All calls"} <ArrowUpRight size={13} />
        </Link>
      </div>
      {/* Capped and scrolling: on the desk the calendar below is the main thing on screen. */}
      <ul className="max-h-[30vh] divide-y divide-line overflow-y-auto">
        {due.map((r) => (
          <CallRow
            key={r.id}
            reminder={r}
            meUid={user?.uid || ""}
            todayYmd={today}
            onBook={setBooking}
            onEdit={isAdmin || r.createdBy.uid === user?.uid ? setEditing : undefined}
          />
        ))}
      </ul>
      <CallBookingHost reminder={booking} onClose={() => setBooking(null)} />
      {editing && (
        <CallReminderDialog
          isOpen={true}
          onClose={() => setEditing(null)}
          patient={{ id: editing.patientId, name: editing.patientName }}
          source={editing.source}
          editing={editing}
        />
      )}
    </section>
  );
}
