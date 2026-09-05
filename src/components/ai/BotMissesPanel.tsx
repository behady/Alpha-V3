"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Settings2 } from "lucide-react";
import { onSnapshot, query, where } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

/**
 * What the WhatsApp assistant could not answer, from real patients.
 *
 * Every question the bot handed to a person, re-asked, or gave up on is recorded as it happened.
 * This is the list that decides what to improve next: a question that shows up ten times is a
 * fact worth writing into Settings, a word worth teaching the bot, or a menu item worth adding.
 * Until this existed the only way to learn what patients ask was to imagine it.
 */

interface Miss {
  id: string;
  text: string;
  reason: string;
  atMs: number;
  patientName?: string;
}

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The reasons, in the order a clinic can act on them. */
const GROUPS: Array<{ keys: string[]; en: string; ar: string; hint: { en: string; ar: string } }> = [
  {
    keys: ["walk_in_unknown", "installments_unknown", "offers_unknown", "parking_unknown", "insurance_unknown", "duration_unknown", "aftercare_unknown"],
    en: "Needs an answer in Settings",
    ar: "محتاج إجابة في الإعدادات",
    hint: { en: "Fill the matching box in Settings → WhatsApp and these answer themselves, free.", ar: "املا الخانة المناسبة في الإعدادات ← واتساب وهيتردوا لوحدهم ببلاش." },
  },
  {
    keys: ["ai_handoff_other", "gave_up", "reprompt"],
    en: "Bot didn't understand",
    ar: "البوت مفهمش",
    hint: { en: "Questions with no route yet. If one repeats, it's worth a keyword or a fact.", ar: "أسئلة ملهاش طريق لسه. لو سؤال بيتكرر يبقى يستاهل كلمة أو إجابة جاهزة." },
  },
  {
    keys: ["ai_handoff_staff"],
    en: "Asked about a specific dentist",
    ar: "سأل عن دكتور معين",
    hint: { en: "Always goes to a person — by your rule.", ar: "دايماً بيروح لموظف — القاعدة بتاعتك." },
  },
  {
    keys: ["asked_for_human", "booking_abandoned"],
    en: "Wanted a person",
    ar: "طلب يكلم حد",
    hint: { en: "Fine as it is. Worth a look if it's high — the bot may be getting in the way.", ar: "تمام كده. بس لو الرقم عالي، يمكن البوت بيقف في الطريق." },
  },
];

function ago(ms: number, isAr: boolean): string {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return isAr ? "النهارده" : "today";
  if (days === 1) return isAr ? "امبارح" : "yesterday";
  return isAr ? `من ${days} يوم` : `${days}d ago`;
}

export default function BotMissesPanel() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const [rows, setRows] = useState<Miss[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(getClinicCollection("bot_misses"), where("atMs", ">=", Date.now() - WINDOW_MS));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Miss)).sort((a, b) => b.atMs - a.atMs));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [user]);

  const grouped = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, items: rows.filter((r) => g.keys.includes(r.reason)) })).filter((g) => g.items.length > 0),
    [rows]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-ink-muted font-bold max-w-2xl leading-relaxed">
          {isAr
            ? "كل سؤال البوت معرفش يرد عليه في آخر ٣٠ يوم، من مرضى حقيقيين. اللي بيتكرر هنا هو اللي يستاهل يتحسن."
            : "Every question the bot couldn't answer in the last 30 days, from real patients. Whatever repeats here is what's worth improving next."}
        </p>
        <Link
          href="/settings?tab=whatsapp"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors"
        >
          <Settings2 size={14} />
          {isAr ? "إعدادات الواتساب" : "WhatsApp settings"}
        </Link>
      </div>

      {loading ? null : rows.length === 0 ? (
        <div className="text-center py-16 bg-surface rounded-2xl border border-dashed border-line">
          <Bot className="mx-auto mb-2 text-slate-300" size={28} />
          <p className="text-slate-400 font-bold text-sm">
            {isAr ? "مفيش أسئلة البوت وقع فيها لسه 👌" : "Nothing the bot has stumbled on yet 👌"}
          </p>
        </div>
      ) : (
        grouped.map((g) => (
          <section key={g.en} className="bg-surface rounded-2xl border border-line shadow-sm p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-black text-ink">{isAr ? g.ar : g.en}</h2>
              <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-surface-muted text-ink-body">{g.items.length}</span>
            </div>
            <p className="text-xs text-ink-muted font-bold mb-3">{isAr ? g.hint.ar : g.hint.en}</p>
            <ul className="space-y-1.5">
              {g.items.slice(0, 12).map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 text-sm">
                  <span className="text-[10px] font-bold text-slate-400 shrink-0 w-16">{ago(m.atMs, isAr)}</span>
                  <span className="text-ink font-medium bg-surface-subtle rounded-lg px-3 py-1.5 flex-1" dir="auto">
                    {m.text}
                  </span>
                </li>
              ))}
              {g.items.length > 12 && (
                <li className="text-[11px] font-bold text-ink-muted pl-[4.75rem]">
                  {isAr ? `و ${g.items.length - 12} كمان` : `and ${g.items.length - 12} more`}
                </li>
              )}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
