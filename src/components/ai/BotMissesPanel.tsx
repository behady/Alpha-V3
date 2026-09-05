"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, BookOpen, Check, GraduationCap, Settings2, Trash2 } from "lucide-react";
import { deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import BotFunnelCard from "./BotFunnelCard";

/**
 * How the WhatsApp assistant gets better: what it missed, what staff taught it, what worked.
 *
 * Three lists on one tab, in the order a clinic acts on them. The misses are the questions the
 * bot handed to a person or gave up on — a repeat here is a fact worth writing. The learned
 * answers are what a staff member typed back on a handed-off thread, waiting for one tap of
 * approval before the model may reuse them. The playbook is what the weekly review distilled
 * from real conversations that booked versus went quiet — editable, because the owner knows
 * things thirty chats cannot.
 */

interface Miss {
  id: string;
  text: string;
  reason: string;
  atMs: number;
  patientName?: string;
}

interface Knowledge {
  id: string;
  question: string;
  answer: string;
  status: "pending" | "approved";
  staffName?: string;
  atMs: number;
}

interface Playbook {
  text?: string;
  editedText?: string;
  generatedAt?: { seconds: number } | null;
  stats?: { conversations: number; booked: number; handoff: number; quiet: number };
  threshold?: number;
}

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The reasons, in the order a clinic can act on them. */
const GROUPS: Array<{ keys: string[]; en: string; ar: string; hint: { en: string; ar: string } }> = [
  {
    keys: ["walk_in_unknown", "installments_unknown", "offers_unknown", "parking_unknown", "insurance_unknown", "duration_unknown", "aftercare_unknown", "objection_price_unknown", "objection_competitor_unknown"],
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
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [playbookDraft, setPlaybookDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    const unsubK = onSnapshot(
      getClinicCollection("bot_knowledge"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Knowledge));
        // Pending first, newest first inside each group.
        list.sort((a, b) => (a.status === b.status ? b.atMs - a.atMs : a.status === "pending" ? -1 : 1));
        setKnowledge(list);
      },
      () => {}
    );
    const unsubP = onSnapshot(getClinicDoc("settings", "bot_playbook"), (snap) => setPlaybook((snap.data() as Playbook) || {}), () => {});
    return () => {
      unsub();
      unsubK();
      unsubP();
    };
  }, [user]);

  const grouped = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, items: rows.filter((r) => g.keys.includes(r.reason)) })).filter((g) => g.items.length > 0),
    [rows]
  );

  const approve = async (k: Knowledge) => {
    setBusy(k.id);
    try {
      const answer = (drafts[k.id] ?? k.answer).trim();
      await updateDoc(doc(getClinicCollection("bot_knowledge"), k.id), { answer, status: "approved", approvedAt: Date.now(), approvedBy: user?.uid || null });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (k: Knowledge) => {
    setBusy(k.id);
    try {
      await deleteDoc(doc(getClinicCollection("bot_knowledge"), k.id));
    } finally {
      setBusy(null);
    }
  };
  const savePlaybook = async () => {
    if (playbookDraft === null) return;
    setBusy("playbook");
    try {
      await setDoc(getClinicDoc("settings", "bot_playbook"), { editedText: playbookDraft.trim(), editedAt: Date.now() }, { merge: true });
      setPlaybookDraft(null);
    } finally {
      setBusy(null);
    }
  };

  const pending = knowledge.filter((k) => k.status === "pending");
  const approved = knowledge.filter((k) => k.status === "approved");
  const stats = playbook?.stats;
  const threshold = playbook?.threshold || 50;
  const playbookText = playbook?.editedText || playbook?.text || "";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-ink-muted font-bold max-w-2xl leading-relaxed">
          {isAr
            ? "هنا البوت بيتعلم: اللي معرفش يرد عليه، الإجابات اللي فريقك كتبها، وخلاصة اللي بينجح مع مرضاك."
            : "This is where the bot learns: what it couldn't answer, the answers your team wrote, and what works with your patients."}
        </p>
        <Link
          href="/settings?tab=whatsapp"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors"
        >
          <Settings2 size={14} />
          {isAr ? "إعدادات الواتساب وتعليمات البوت" : "WhatsApp settings & coaching"}
        </Link>
      </div>

      <BotFunnelCard />

      {/* Learned answers: what staff typed on a handed-off thread, awaiting one tap. */}
      <section className="bg-surface rounded-2xl border border-line shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap size={16} className="text-ink-body" />
          <h2 className="text-sm font-black text-ink">{isAr ? "إجابات اتعلمها من فريقك" : "Answers learned from your team"}</h2>
          {pending.length > 0 && (
            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-warning-tint text-warning">{pending.length} {isAr ? "مستنية اعتماد" : "pending"}</span>
          )}
        </div>
        <p className="text-xs text-ink-muted font-bold mb-3">
          {isAr
            ? "لما موظف يرد على سؤال البوت حوّله، الرد بيظهر هنا. اعتمده (أو عدّله الأول) والبوت هيستخدمه المرة الجاية لوحده."
            : "When a staff member answers a question the bot handed over, the reply lands here. Approve it (edit first if you like) and the bot uses it next time by itself."}
        </p>
        {knowledge.length === 0 ? (
          <p className="text-xs text-slate-400 font-bold py-3">{isAr ? "لسه مفيش إجابات من الفريق." : "No staff answers yet."}</p>
        ) : (
          <ul className="space-y-3">
            {[...pending, ...approved].slice(0, 30).map((k) => (
              <li key={k.id} className={`rounded-xl border p-3 ${k.status === "pending" ? "border-warning/30 bg-warning-tint/30" : "border-line bg-surface-subtle"}`}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="text-sm font-bold text-ink" dir="auto">س: {k.question}</p>
                  <span className="text-[10px] font-bold text-slate-400">{k.staffName ? `${k.staffName} · ` : ""}{ago(k.atMs, isAr)}</span>
                </div>
                {k.status === "pending" ? (
                  <textarea
                    dir="auto"
                    rows={2}
                    className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink resize-y"
                    value={drafts[k.id] ?? k.answer}
                    onChange={(e) => setDrafts((d) => ({ ...d, [k.id]: e.target.value }))}
                  />
                ) : (
                  <p className="mt-1 text-sm text-ink-body" dir="auto">ج: {k.answer}</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {k.status === "pending" && (
                    <button
                      type="button"
                      disabled={busy === k.id}
                      onClick={() => void approve(k)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-surface text-xs font-black disabled:opacity-50"
                    >
                      <Check size={13} /> {isAr ? "اعتمد" : "Approve"}
                    </button>
                  )}
                  {k.status === "approved" && <span className="text-[11px] font-black text-success">{isAr ? "معتمد ✓" : "Approved ✓"}</span>}
                  <button
                    type="button"
                    disabled={busy === k.id}
                    onClick={() => void remove(k)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-ink-muted hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={13} /> {isAr ? "حذف" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The playbook: distilled weekly from real outcomes, editable by the owner. */}
      <section className="bg-surface rounded-2xl border border-line shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={16} className="text-ink-body" />
          <h2 className="text-sm font-black text-ink">{isAr ? "كتيب المبيعات (بيتعلم من النتايج)" : "Sales playbook (learned from outcomes)"}</h2>
        </div>
        <p className="text-xs text-ink-muted font-bold mb-3">
          {stats
            ? isAr
              ? `آخر ٣٠ يوم: ${stats.conversations} محادثة بالذكاء الاصطناعي — ${stats.booked} اتحجزت، ${stats.quiet} سكتت، ${stats.handoff} اتحوّلت لموظف.`
              : `Last 30 days: ${stats.conversations} AI conversations — ${stats.booked} booked, ${stats.quiet} went quiet, ${stats.handoff} handed to a person.`
            : isAr
              ? "بيتجمع كل أسبوع من المحادثات الحقيقية. لسه مفيش إحصائيات."
              : "Compiled weekly from real conversations. No statistics yet."}
          {stats && stats.conversations < threshold
            ? isAr
              ? ` بيتكتب أول ما يوصل ${threshold} محادثة (${stats.conversations}/${threshold}).`
              : ` Written once there are ${threshold} conversations (${stats.conversations}/${threshold}).`
            : ""}
        </p>
        {playbookText || playbookDraft !== null ? (
          <>
            <textarea
              dir="auto"
              rows={8}
              className="w-full rounded-lg border border-line bg-surface-subtle px-3 py-2 text-sm text-ink resize-y leading-relaxed"
              value={playbookDraft ?? playbookText}
              onChange={(e) => setPlaybookDraft(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                disabled={playbookDraft === null || busy === "playbook"}
                onClick={() => void savePlaybook()}
                className="px-3 py-1.5 rounded-lg bg-ink text-surface text-xs font-black disabled:opacity-40"
              >
                {isAr ? "حفظ تعديلي" : "Save my edit"}
              </button>
              {playbook?.generatedAt && (
                <span className="text-[11px] text-slate-400 font-bold">
                  {isAr ? "اتكتب تلقائياً " : "Generated "}{ago(playbook.generatedAt.seconds * 1000, isAr)}
                  {playbook?.editedText ? (isAr ? " · معدّل بواسطتك" : " · edited by you") : ""}
                </span>
              )}
            </div>
          </>
        ) : (
          <button type="button" onClick={() => setPlaybookDraft("")} className="text-xs font-bold text-ink-body underline">
            {isAr ? "اكتب كتيب مبيعات بنفسك دلوقتي" : "Write a playbook yourself now"}
          </button>
        )}
      </section>

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
