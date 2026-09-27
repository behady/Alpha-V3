"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { getDocs, query, where } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

/**
 * This week against last week, for the one question the funnel cannot answer: did the last
 * change make the bot better or worse?
 *
 * Seven numbers, each with its previous-seven-days value beside it. Every figure comes from a
 * record the bot already writes as it works (conversations, misses, the model's flight
 * recorder, staff thumbs, bookings with source whatsapp_bot), so there is nothing new to keep
 * in sync. Read it on Monday, before choosing what to fix; read it again the Monday after.
 */

const WEEK = 7 * 86400000;

interface Week {
  chats: number;
  aiChats: number;
  handoffs: number;
  booked: number;
  misses: number;
  aiCalls: number;
  down: number;
  up: number;
}

const EMPTY: Week = { chats: 0, aiChats: 0, handoffs: 0, booked: 0, misses: 0, aiCalls: 0, down: 0, up: 0 };

export default function BotWeekCard() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const [now, setNow] = useState<Week | null>(null);
  const [prev, setPrev] = useState<Week>(EMPTY);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const t0 = Date.now();
      const since = t0 - 2 * WEEK;
      const sinceDate = new Date(since);
      const [convs, misses, debug, fb, appts] = await Promise.all([
        getDocs(query(getClinicCollection("whatsapp_conversations"), where("lastMessageAt", ">=", since))).catch(() => null),
        getDocs(query(getClinicCollection("bot_misses"), where("atMs", ">=", since))).catch(() => null),
        getDocs(query(getClinicCollection("ai_debug"), where("createdAt", ">=", sinceDate))).catch(() => null),
        getDocs(query(getClinicCollection("bot_feedback"), where("atMs", ">=", since))).catch(() => null),
        getDocs(query(getClinicCollection("appointments"), where("source", "==", "whatsapp_bot"))).catch(() => null),
      ]);
      if (cancelled) return;
      const thisWeek: Week = { ...EMPTY };
      const lastWeek: Week = { ...EMPTY };
      /** Which week a timestamp falls in, or null when it is older than both. */
      const weekOf = (ms: number): Week | null => (ms >= t0 - WEEK ? thisWeek : ms >= since ? lastWeek : null);
      for (const d of convs?.docs ?? []) {
        const c = d.data();
        if (String(c.phone || "").startsWith("play_") || d.id.startsWith("play_")) continue;
        const w = weekOf(Number(c.lastMessageAt) || 0);
        if (!w) continue;
        w.chats += 1;
        if (c.aiUsed === true) w.aiChats += 1;
        if (c.outcome === "handoff") w.handoffs += 1;
      }
      for (const d of misses?.docs ?? []) {
        const w = weekOf(Number(d.data().atMs) || 0);
        if (w) w.misses += 1;
      }
      for (const d of debug?.docs ?? []) {
        // Only the model's own answers: the guard entries (-stray/-drug) describe the same call.
        if (/-(stray|drug)$/.test(d.id)) continue;
        const w = weekOf((d.data().createdAt?.seconds ?? 0) * 1000);
        if (w) w.aiCalls += 1;
      }
      for (const d of fb?.docs ?? []) {
        const x = d.data();
        const w = weekOf(Number(x.atMs) || 0);
        if (!w) continue;
        if (x.verdict === "down") w.down += 1;
        else w.up += 1;
      }
      for (const d of appts?.docs ?? []) {
        const w = weekOf((d.data().createdAt?.seconds ?? 0) * 1000);
        if (w) w.booked += 1;
      }
      setNow(thisWeek);
      setPrev(lastWeek);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!now) return null;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const rows: Array<{ label: string; cur: number; was: number; unit?: string; lowerIsBetter?: boolean }> = [
    { label: isAr ? "محادثات" : "Chats", cur: now.chats, was: prev.chats },
    { label: isAr ? "البوت خلّصها لوحده" : "Handled without a person", cur: pct(now.chats - now.handoffs, now.chats), was: pct(prev.chats - prev.handoffs, prev.chats), unit: "%" },
    { label: isAr ? "حجز" : "Booked by the bot", cur: now.booked, was: prev.booked },
    { label: isAr ? "مفهمش" : "Misses", cur: now.misses, was: prev.misses, lowerIsBetter: true },
    { label: isAr ? "ردود الذكاء (كريدت)" : "AI answers (credits)", cur: now.aiCalls, was: prev.aiCalls, lowerIsBetter: true },
    { label: isAr ? "👎 من الفريق" : "👎 from staff", cur: now.down, was: prev.down, lowerIsBetter: true },
    { label: isAr ? "👍 من الفريق" : "👍 from staff", cur: now.up, was: prev.up },
  ];

  return (
    <section className="bg-surface rounded-2xl border border-line shadow-sm p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <Activity size={16} className="text-ink-body" />
        <h2 className="text-sm font-black text-ink">{isAr ? "الأسبوع ده مقابل اللي فات" : "This week vs last week"}</h2>
      </div>
      <p className="text-xs text-ink-muted font-bold mb-3">
        {isAr ? "الأرقام دي هي اللي بتقول إذا كان آخر تعديل حسّن البوت ولا لأ." : "These are the numbers that say whether the last change helped."}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {rows.map((r) => {
          const delta = r.cur - r.was;
          const good = delta === 0 ? null : r.lowerIsBetter ? delta < 0 : delta > 0;
          return (
            <div key={r.label} className="rounded-xl bg-surface-subtle px-3 py-2">
              <p className="text-[10px] font-bold text-ink-muted leading-tight min-h-[2.2em]">{r.label}</p>
              <p className="text-xl font-black text-ink tabular-nums" style={{ fontFamily: "var(--font-serif, inherit)" }}>
                {r.cur}
                {r.unit || ""}
              </p>
              <p className="text-[11px] font-bold tabular-nums" style={{ color: good === null ? "var(--ink-muted, #8a8a8a)" : good ? "#1f7a4d" : "#b3261e" }}>
                {delta === 0 ? (isAr ? "زي ما هو" : "same") : `${delta > 0 ? "+" : ""}${delta}${r.unit || ""}`}
                <span className="text-ink-muted font-semibold"> · {isAr ? "كان" : "was"} {r.was}{r.unit || ""}</span>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
