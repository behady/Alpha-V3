"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { onSnapshot, query, Timestamp, where } from "firebase/firestore";
import PermissionGuard from "@/components/PermissionGuard";
import PageHeader from "@/components/dashboard/PageHeader";
import CallRow from "@/components/calls/CallRow";
import CallBookingHost from "@/components/calls/CallBookingHost";
import CallReminderDialog from "@/components/calls/CallReminderDialog";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection } from "@/lib/db-utils";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { useOpenCallReminders } from "@/lib/useOpenCallReminders";
import {
  CALL_REMINDERS_COLLECTION,
  REMINDER_ROLES,
  arabicDayMonth,
  callsTab,
  cairoInstant,
  recipientLabel,
  reminderFromDoc,
  sortForCard,
  type CallReminder,
} from "@/lib/callReminders";
import { callReminderErrorText, deleteCallReminder } from "@/lib/callRemindersApi";

/**
 * Every call reminder: today's, the late ones, the coming ones, and the ones handled. The
 * notification's link (?id=…) opens the right tab with that call highlighted.
 */

type Tab = "today" | "late" | "upcoming" | "done";
const TABS: { id: Tab; ar: string; en: string }[] = [
  { id: "today", ar: "النهارده", en: "Today" },
  { id: "upcoming", ar: "الجاية", en: "Upcoming" },
  { id: "late", ar: "متأخرة", en: "Late" },
  { id: "done", ar: "اتعملت", en: "Done" },
];
const STATUS_WORDS: Record<CallReminder["status"], [string, string]> = {
  open: ["Planned", "مستنية"],
  done: ["Done", "اتعملت"],
  rescheduled: ["Call again", "اتأجلت"],
  booked: ["Booked", "اتحجز"],
};
const FIELD = "rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-ink";

function CallsPageInner() {
  const { user } = useAuth();
  const { isAdmin } = useClinic();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const { matches } = useActiveBranch();
  const params = useSearchParams();
  const isAr = language === "ar";
  const meUid = user?.uid || "";
  const today = ymdInTimeZone(clinicTimeZone(), new Date());

  const { rows: open } = useOpenCallReminders();
  const [tab, setTab] = useState<Tab>("today");
  const [who, setWho] = useState("");
  const [search, setSearch] = useState("");
  /** How far back the Done tab reaches; the open tabs show every open call. */
  const [from, setFrom] = useState(() => shiftDays(today, -30));
  const [to, setTo] = useState("");
  const [handled, setHandled] = useState<CallReminder[]>([]);
  const [booking, setBooking] = useState<CallReminder | null>(null);
  const [editing, setEditing] = useState<CallReminder | null>(null);
  const highlightId = params.get("id") || "";

  // Handled calls since the chosen day: one range on handledAt, the rest filtered here.
  useEffect(() => {
    const start = Timestamp.fromDate(cairoInstant(from || shiftDays(today, -30), "00:00"));
    return onSnapshot(
      query(getClinicCollection(CALL_REMINDERS_COLLECTION), where("handledAt", ">=", start)),
      (snap) => setHandled(snap.docs.map((d) => reminderFromDoc(d.id, d.data())).filter((r) => matches(r.branchId))),
      () => setHandled([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  // A link from a notification opens the tab that holds that call.
  useEffect(() => {
    if (!highlightId) return;
    const hit = [...open, ...handled].find((r) => r.id === highlightId);
    if (!hit) return;
    setTab(callsTab(hit, Date.now(), today));
    window.setTimeout(() => document.getElementById(`call-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, open.length, handled.length]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...open, ...handled]) if (r.recipient.kind === "person") m.set(r.recipient.uid, r.recipient.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [open, handled]);

  const passes = (r: CallReminder) => {
    if (who) {
      const [kind, value] = who.split(":");
      if (kind === "person" && !(r.recipient.kind === "person" && r.recipient.uid === value)) return false;
      if (kind === "role" && !(r.recipient.kind === "role" && r.recipient.role === value)) return false;
    }
    if (search.trim() && !r.patientName.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (to && r.date > to) return false;
    return true;
  };

  const shown = useMemo(() => {
    if (tab === "done") {
      // Only the owner and admins read everybody's finished calls; the rest see their own.
      const mine = isAdmin ? handled : handled.filter((r) => r.handledBy?.uid === meUid || r.createdBy.uid === meUid);
      return mine.filter((r) => r.status !== "open").filter(passes).sort((a, b) => (b.handledAtMs ?? 0) - (a.handledAtMs ?? 0));
    }
    return sortForCard(open.filter((r) => callsTab(r, Date.now(), today) === tab).filter(passes), Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, open, handled, who, search, from, to, isAdmin, meUid]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { today: 0, late: 0, upcoming: 0, done: 0 };
    for (const r of open) c[callsTab(r, Date.now(), today)] += 1;
    return c;
  }, [open, today]);

  const remove = async (r: CallReminder) => {
    if (!window.confirm(isAr ? `تمسح تذكير ${r.patientName}؟` : `Delete the reminder for ${r.patientName}?`)) return;
    try {
      await deleteCallReminder(r.id);
      showToast(isAr ? "التذكير اتمسح" : "Reminder deleted", "success");
    } catch (e) {
      showToast(callReminderErrorText(e, isAr), "error");
    }
  };
  const dayText = (ms: number) =>
    isAr ? arabicDayMonth(ms) : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Cairo" });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 pb-24 pt-2" dir={isAr ? "rtl" : "ltr"}>
      <PageHeader compact title={isAr ? "المكالمات" : "Calls"} />

      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-surface p-1 md:flex" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-xl px-1 py-2 text-[13px] font-bold transition-colors md:shrink-0 md:px-4 md:text-sm ${tab === t.id ? "bg-ink text-white" : "text-ink-muted hover:text-ink"}`}
          >
            {isAr ? t.ar : t.en}
            {t.id !== "done" && counts[t.id] > 0 && <span className="ms-1 font-figure text-[11px] opacity-80 md:ms-1.5 md:text-sm md:opacity-100">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      {/* Phone: search on its own line, then the person and the date side by side. */}
      <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAr ? "دوّر باسم المريض" : "Search patient"} className={`${FIELD} col-span-2 min-w-0 md:flex-1`} />
        <select value={who} onChange={(e) => setWho(e.target.value)} className={`${FIELD} min-w-0 md:w-52`}>
          <option value="">{isAr ? "الكل" : "Everyone"}</option>
          {people.map(([uid, name]) => (
            <option key={uid} value={`person:${uid}`}>{name}</option>
          ))}
          {REMINDER_ROLES.map((role) => (
            <option key={role} value={`role:${role}`}>{recipientLabel({ kind: "role", role }, isAr)}</option>
          ))}
        </select>
        {/* "From" only bounds the Done tab, so it only shows there. */}
        {tab === "done" && (
          <label className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-ink-muted">
            {isAr ? "من" : "From"}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
          </label>
        )}
        <label className={`flex min-w-0 items-center gap-1.5 text-xs font-bold text-ink-muted ${tab === "done" ? "col-span-2 md:col-span-1" : ""}`}>
          {isAr ? "لحد" : "To"}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
        </label>
      </div>

      <section className="rounded-2xl border border-line bg-surface px-4">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm font-semibold text-ink-muted">{isAr ? "مفيش مكالمات هنا." : "No calls here."}</p>
        ) : tab === "done" ? (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id} id={`call-${r.id}`} className={`py-3 text-sm ${r.id === highlightId ? "rounded-xl bg-accent/15 px-2" : ""}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/patients/${encodeURIComponent(r.patientId)}`} className="font-bold text-ink hover:underline">{r.patientName}</Link>
                  <span className="text-xs font-bold text-ink-muted">
                    {isAr ? STATUS_WORDS[r.status][1] : STATUS_WORDS[r.status][0]} · {r.handledBy?.name || ""} · {r.handledAtMs ? dayText(r.handledAtMs) : ""}
                  </span>
                </div>
                <p className="font-semibold text-ink-body">{r.reason}</p>
                {r.note && <p className="text-xs font-semibold text-ink-muted">{r.note}</p>}
                <p className="text-xs font-semibold text-ink-faint">
                  {isAr ? "اتعمل بواسطة" : "Set by"} {r.createdBy.name} · {dayText(r.createdAtMs)} · {recipientLabel(r.recipient, isAr)}
                  {r.previousId && (
                    <> · <Link href={`/calls?id=${r.previousId}`} className="underline">{isAr ? "المكالمة اللي قبلها" : "previous call"}</Link></>
                  )}
                  {r.nextId && (
                    <> · <Link href={`/calls?id=${r.nextId}`} className="underline">{isAr ? "المكالمة الجاية" : "next call"}</Link></>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <CallRow
                key={r.id}
                reminder={r}
                meUid={meUid}
                todayYmd={today}
                onBook={setBooking}
                onDelete={isAdmin || r.createdBy.uid === meUid ? (x) => void remove(x) : undefined}
                onEdit={isAdmin || r.createdBy.uid === meUid ? setEditing : undefined}
                highlighted={r.id === highlightId}
              />
            ))}
          </ul>
        )}
      </section>

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
    </div>
  );
}

function shiftDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export default function CallsPage() {
  return (
    <PermissionGuard permission="access.patients">
      <Suspense fallback={null}>
        <CallsPageInner />
      </Suspense>
    </PermissionGuard>
  );
}
