"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, PhoneCall } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { dueOnCard, type CallReminder } from "@/lib/callReminders";
import { useOpenCallReminders } from "@/lib/useOpenCallReminders";
import CallRow from "@/components/calls/CallRow";
import CallBookingHost from "@/components/calls/CallBookingHost";

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
  // Read once per mount: the card orders by each call's own time, not by the moment of render.
  const [nowMs] = useState(() => Date.now());

  const today = ymdInTimeZone(clinicTimeZone(), new Date(nowMs));
  const due = dueOnCard(rows, nowMs, today);
  if (due.length === 0 && !booking) return null;

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
      <ul className="divide-y divide-line">
        {due.map((r) => (
          <CallRow key={r.id} reminder={r} meUid={user?.uid || ""} todayYmd={today} onBook={setBooking} />
        ))}
      </ul>
      <CallBookingHost reminder={booking} onClose={() => setBooking(null)} />
    </section>
  );
}
