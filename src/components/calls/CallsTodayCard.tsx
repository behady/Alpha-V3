"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, StickyNote } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { dueOnCard, filterForView, parseCardView, type CallReminder, type CardView } from "@/lib/callReminders";
import { useOpenCallReminders } from "@/lib/useOpenCallReminders";
import { useOwnStaffRow } from "@/lib/useOwnStaffRow";
import CallRow from "@/components/calls/CallRow";
import CallBookingHost from "@/components/calls/CallBookingHost";
import CallReminderDialog from "@/components/calls/CallReminderDialog";

/**
 * "ملاحظات النهارده": today's notes (calls and reminders) and the overdue ones, on the dashboard.
 *
 * Opens on "Mine" — notes for me by name, or for my role at my branch — with a switch to everyone's
 * or one colleague's, so the desk can still cover for someone who is off. The choice is remembered
 * per person on this device. Hidden only when nobody has a note due.
 */

const viewKey = (uid: string) => `alpha.notesCardView.${uid || "anon"}`;

function readView(uid: string): CardView {
  try {
    return parseCardView(window.localStorage.getItem(viewKey(uid)));
  } catch {
    return "mine";
  }
}

const CHIP = "h-8 rounded-full px-3 text-xs font-bold transition-colors";

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
  // The choice made on this screen, for the person who made it; otherwise their remembered one.
  // (The card renders nothing until the notes load, so reading storage here cannot mismatch SSR.)
  const [picked, setPicked] = useState<{ uid: string; view: CardView } | null>(null);
  const view: CardView = picked && picked.uid === uid ? picked.view : readView(uid);
  const setView = (v: CardView) => {
    setPicked({ uid, view: v });
    try {
      window.localStorage.setItem(viewKey(uid), v);
    } catch {
      /* Private mode: the choice lasts until the page closes. */
    }
  };
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
  const shown = filterForView(due, view, me);

  // Colleagues with a note due today, for the person picker; a remembered person stays listed.
  const peopleMap = new Map<string, string>();
  for (const r of due) if (r.recipient.kind === "person" && r.recipient.uid !== uid) peopleMap.set(r.recipient.uid, r.recipient.name);
  const people = [...peopleMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const pickedPerson = view.startsWith("person:") ? view.slice("person:".length) : "";

  if (due.length === 0 && !booking && !editing) return null;

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

      {/* Whose notes: mine, everyone's, or one colleague's. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={isAr ? "ملاحظات مين" : "Whose notes"}>
        {(
          [
            { id: "mine", ar: "بتوعي", en: "Mine" },
            { id: "all", ar: "الكل", en: "All" },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={view === o.id}
            onClick={() => setView(o.id)}
            className={`${CHIP} ${view === o.id ? "bg-ink text-white" : "border border-line bg-surface text-ink-muted hover:text-ink"}`}
          >
            {isAr ? o.ar : o.en}
          </button>
        ))}
        {(people.length > 0 || pickedPerson) && (
          <select
            value={pickedPerson ? view : ""}
            onChange={(e) => setView(e.target.value ? parseCardView(e.target.value) : "mine")}
            aria-label={isAr ? "ملاحظات شخص معيّن" : "One person's notes"}
            className={`${CHIP} max-w-[11rem] border outline-none ${pickedPerson ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-muted"}`}
          >
            <option value="">{isAr ? "شخص…" : "Person…"}</option>
            {people.map(([id, name]) => (
              <option key={id} value={`person:${id}`}>
                {name}
              </option>
            ))}
            {pickedPerson && !people.some(([id]) => id === pickedPerson) && <option value={view}>{isAr ? "اللي اخترته" : "Chosen person"}</option>}
          </select>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="py-5 text-center text-sm font-semibold text-ink-muted">
          {view === "mine" ? (isAr ? "مفيش حاجة ليك النهارده." : "Nothing for you today.") : isAr ? "مفيش ملاحظات هنا النهارده." : "No notes here today."}
        </p>
      ) : (
        /* Capped and scrolling: on the desk the calendar below is the main thing on screen. */
        <ul className="max-h-[30vh] divide-y divide-line overflow-y-auto">
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
