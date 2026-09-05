"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { getDocs, query, where } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * The bot's sales funnel, last 30 days.
 *
 * Chats → conversations the model took part in → leads it created → bookings it made → patients
 * who actually sat in the chair, plus the services people asked about and the credits the month
 * has cost. Every number here comes from records the bot writes as it works (conversation
 * outcomes, leads with source WhatsApp, appointments with source whatsapp_bot), so the funnel is
 * a by-product of the work, not a separate log that can drift from it.
 */

const DAYS = 30;

interface Funnel {
  chats: number;
  aiChats: number;
  handoffs: number;
  leads: number;
  booked: number;
  showed: number;
  services: Array<[string, number]>;
  creditsThisMonth: number;
}

export default function BotFunnelCard() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const [f, setF] = useState<Funnel | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const since = Date.now() - DAYS * 86400000;
      const sinceKey = new Date(since).toISOString().slice(0, 10);
      const monthKey = new Date().toISOString().slice(0, 7);
      const [convs, leads, appts, usage] = await Promise.all([
        getDocs(query(getClinicCollection("whatsapp_conversations"), where("lastMessageAt", ">=", since))).catch(() => null),
        getDocs(query(getClinicCollection("leads"), where("source", "==", "WhatsApp"))).catch(() => null),
        getDocs(query(getClinicCollection("appointments"), where("source", "==", "whatsapp_bot"))).catch(() => null),
        getDocs(query(getClinicCollection("ai_usage"), where("monthKey", "==", monthKey))).catch(() => null),
      ]);
      if (cancelled) return;
      const convRows = (convs?.docs ?? []).map((d) => d.data()).filter((c) => !String(c.phone || "").startsWith("play_"));
      const leadRows = (leads?.docs ?? []).map((d) => d.data()).filter((l) => (l.createdAt?.seconds ?? 0) * 1000 >= since);
      const apptRows = (appts?.docs ?? []).map((d) => d.data()).filter((a) => String(a.date || "") >= sinceKey);
      const services = new Map<string, number>();
      for (const a of apptRows) {
        const t = String(a.treatment || "").trim();
        if (t) services.set(t, (services.get(t) || 0) + 1);
      }
      for (const l of leadRows) {
        const t = String(l.interest || "").trim();
        if (t && !l.patientId) services.set(t, (services.get(t) || 0) + 1);
      }
      setF({
        chats: convRows.length,
        aiChats: convRows.filter((c) => c.aiUsed === true).length,
        handoffs: convRows.filter((c) => c.outcome === "handoff").length,
        leads: leadRows.length,
        booked: apptRows.length,
        showed: apptRows.filter((a) => normalizeAppointmentStatus(String(a.status || "")) === "Completed").length,
        services: [...services.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
        creditsThisMonth: (usage?.docs ?? []).reduce((n, d) => n + (Number(d.data().creditsUsed) || 0), 0),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const steps = useMemo(
    () =>
      f
        ? [
            { label: isAr ? "محادثات" : "Chats", n: f.chats },
            { label: isAr ? "الذكاء رد فيها" : "AI-led", n: f.aiChats },
            { label: isAr ? "عملاء محتملين" : "Leads", n: f.leads },
            { label: isAr ? "حجزوا" : "Booked", n: f.booked },
            { label: isAr ? "حضروا" : "Showed up", n: f.showed },
          ]
        : [],
    [f, isAr]
  );

  if (!f) return null;
  const max = Math.max(1, ...steps.map((s) => s.n));
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <section className="bg-surface rounded-2xl border border-line shadow-sm p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp size={16} className="text-ink-body" />
        <h2 className="text-sm font-black text-ink">{isAr ? `قمع المبيعات — آخر ${DAYS} يوم` : `Sales funnel — last ${DAYS} days`}</h2>
      </div>
      <p className="text-xs text-ink-muted font-bold mb-4">
        {isAr
          ? `${pct(f.booked, f.chats)} من المحادثات اتحولت لحجز، و${pct(f.showed, f.booked)} من الحجوزات حضرت. ${f.handoffs} محادثة اتحوّلت لموظف. كريدت الشهر ده: ${f.creditsThisMonth}.`
          : `${pct(f.booked, f.chats)} of chats became a booking, ${pct(f.showed, f.booked)} of bookings showed up. ${f.handoffs} handed to a person. Credits this month: ${f.creditsThisMonth}.`}
      </p>
      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs font-bold text-ink-body">{s.label}</span>
            <div className="flex-1 h-6 rounded-lg bg-surface-subtle overflow-hidden">
              <div className="h-full bg-ink/80 rounded-lg" style={{ width: `${Math.max(2, (s.n / max) * 100)}%` }} />
            </div>
            <span className="w-10 text-right text-sm font-black text-ink tabular-nums">{s.n}</span>
          </div>
        ))}
      </div>
      {f.services.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {f.services.map(([name, n]) => (
            <span key={name} className="px-2.5 py-1 rounded-full bg-surface-subtle border border-line text-[11px] font-bold text-ink-body">
              {name} · {n}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
