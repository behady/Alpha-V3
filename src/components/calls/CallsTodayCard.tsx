"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, StickyNote } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { dueOnCard, filterForView, type CallReminder } from "@/lib/callReminders";
import { useOpenCallReminders } from "@/lib/useOpenCallReminders";
import { useOwnStaffRow } from "@/lib/useOwnStaffRow";
import CallRow from "@/components/calls/CallRow";
import CallBookingHost from "@/components/calls/CallBookingHost";
import CallReminderDialog from "@/components/calls/CallReminderDialog";

/**
 * "ملاحظات النهارده": today's notes (calls and reminders) and the overdue ones, on the dashboard.
 *
 * Only MY notes: for me by name, or for my role at my branch. The owner's rule (2026-11-11): nobody
 * sees a colleague's notes on their dashboard — everyone's list lives on the Notes page. Hidden when
 * I have nothing due.
 */

export default function CallsTodayCard() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { rows } = useOpenCallReminders();
  const [booking, setBooking] = useState<CallReminder | null>(null);
  const [editing, setEditing] = useState<CallReminder | null>(null);
  const { isAdmin, role } = useClinic();
  const { row: staffRow } = useOwnStaffRow();
  const uid = user?.uid || "";
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
  const me = { uid, role, branchIds: staffRow?.branchIds ?? null };
  const shown = filterForView(due, "mine", me);

  if (shown.length === 0 && !booking && !editing) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={isAr ? "ملاحظات النهارده" : "Today's notes"}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-black text-ink">
          <StickyNote size={17} aria-hidden="true" /> {isAr ? "ملاحظات النهارده" : "Today's notes"}
          <span className="rounded-full bg-accent px-2 py-0.5 font-figure text-xs text-ink-on-accent">{shown.length}</span>
        </h2>
        <Link href="/notes" className="inline-flex items-center gap-1 text-sm font-bold text-ink-muted hover:text-ink">
          {isAr ? "كل الملاحظات" : "All notes"} <ArrowUpRight size={13} />
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="py-5 text-center text-sm font-semibold text-ink-muted">{isAr ? "مفيش حاجة ليك النهارده." : "Nothing for you today."}</p>
      ) : (
        /* Capped and scrolling: on the desk the calendar below is the main thing on screen. */
        <ul className="mt-3 max-h-[30vh] divide-y divide-line overflow-y-auto">
          {shown.map((r) => (
            <CallRow
              key={r.id}
              reminder={r}
              meUid={uid}
              todayYmd={today}
              onBook={setBooking}
              onEdit={isAdmin || r.createdBy.uid === uid ? setEditing : undefined}
            />
          ))}
        </ul>
      )}
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
