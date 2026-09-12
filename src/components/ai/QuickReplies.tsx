"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, deleteDoc, getDoc, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { Loader2, Plus, Search, Settings2, Trash2, X, Zap } from "lucide-react";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import type { BotFacts } from "@/types/whatsapp";

/**
 * Ready answers, one tap away from the message box.
 *
 * Two sources, shown as one list. The clinic's "ready answers" from Settings → WhatsApp are the
 * sentences the bot already quotes verbatim — instalments, parking, the maps link — and a
 * receptionist typing them out again by hand is the waste this removes. Beside them, a list the
 * desk keeps itself: anything said more than twice a day, in the words the desk uses.
 *
 * `{name}` in a reply becomes the patient's first name at insert time, so a saved greeting reads
 * as written to the person and not pasted.
 */

export interface QuickReply {
  id: string;
  title: string;
  text: string;
  /** "facts" rows come from Settings and cannot be edited here; "custom" rows can. */
  source: "facts" | "custom";
}

/** Which ready answers are worth a row, and what to call them. */
const FACT_ROWS: Array<{ key: keyof BotFacts; en: string; ar: string }> = [
  { key: "consultation", en: "Consultation", ar: "الكشف" },
  { key: "mapsUrl", en: "Location link", ar: "اللوكيشن" },
  { key: "parking", en: "Parking", ar: "الباركينج" },
  { key: "walkIn", en: "Walk-ins", ar: "من غير حجز" },
  { key: "installments", en: "Instalments", ar: "التقسيط" },
  { key: "offers", en: "Offers", ar: "العروض" },
  { key: "insurance", en: "Insurance", ar: "التأمين" },
  { key: "durations", en: "How long it takes", ar: "مدة الجلسة" },
  { key: "sessions", en: "Number of sessions", ar: "عدد الجلسات" },
  { key: "aftercare", en: "Aftercare", ar: "التعليمات بعد العلاج" },
  { key: "whyUs", en: "Why us", ar: "ليه إحنا" },
];

const COLLECTION = "whatsapp_quick_replies";

/** First name only: "أحمد طارق" greeted as "أحمد", the way the desk would. */
function firstName(full: string | undefined): string {
  return (full || "").trim().split(/\s+/)[0] || "";
}

export function fillQuickReply(text: string, patientName?: string): string {
  const name = firstName(patientName);
  return text.replace(/\{name\}/g, name).replace(/\s{2,}/g, " ").trim();
}

export default function QuickReplies({
  isAr,
  patientName,
  onInsert,
  onClose,
}: {
  isAr: boolean;
  patientName?: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [facts, setFacts] = useState<BotFacts>({});
  const [custom, setCustom] = useState<QuickReply[] | null>(null);
  const [q, setQ] = useState("");
  const [managing, setManaging] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(getClinicDoc("settings", "whatsapp"))
      .then((snap) => {
        const f = snap.data()?.botFacts;
        if (f && typeof f === "object") setFacts(f as BotFacts);
      })
      .catch(() => {});
    const unsub = onSnapshot(
      query(getClinicCollection(COLLECTION), orderBy("createdAt", "asc")),
      (snap) =>
        setCustom(
          snap.docs.map((d) => ({
            id: d.id,
            title: String(d.data().title || ""),
            text: String(d.data().text || ""),
            source: "custom" as const,
          }))
        ),
      () => setCustom([])
    );
    return () => unsub();
  }, [user]);

  const rows = useMemo<QuickReply[]>(() => {
    const fromFacts: QuickReply[] = FACT_ROWS.filter((r) => String(facts[r.key] || "").trim()).map((r) => ({
      id: `fact_${r.key}`,
      title: isAr ? r.ar : r.en,
      text: String(facts[r.key]).trim(),
      source: "facts",
    }));
    const all = [...(custom || []), ...fromFacts];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => `${r.title} ${r.text}`.toLowerCase().includes(needle)) : all;
  }, [facts, custom, q, isAr]);

  const add = async () => {
    const title = newTitle.trim();
    const text = newText.trim();
    if (!title || !text || saving) return;
    setSaving(true);
    try {
      await addDoc(getClinicCollection(COLLECTION), {
        title: title.slice(0, 60),
        text: text.slice(0, 1500),
        createdBy: user?.uid || null,
        createdAt: serverTimestamp(),
      });
      setNewTitle("");
      setNewText("");
    } catch (e) {
      console.error("Quick reply save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteDoc(getClinicDoc(COLLECTION, id));
    } catch (e) {
      console.error("Quick reply delete failed:", e);
    }
  };

  return (
    <div className="absolute bottom-full start-3 end-3 mb-1 rounded-2xl bg-surface-subtle dark:bg-slate-900/90 backdrop-blur-xl shadow-xl border border-line dark:border-slate-800 flex flex-col max-h-[60vh] z-20 overflow-hidden transition-colors">
      <div className="px-3 py-2 border-b border-line dark:border-slate-800 flex items-center gap-2 bg-surface dark:bg-slate-900">
        <Zap size={16} className="text-accent dark:text-accent-soft" />
        <span className="text-[13px] font-black text-ink dark:text-slate-100">
          {isAr ? "ردود جاهزة" : "Quick replies"}
        </span>
        <button
          onClick={() => setManaging((v) => !v)}
          className={`ms-auto flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg transition-colors hover:bg-surface-subtle dark:hover:bg-slate-800 ${managing ? "text-accent dark:text-accent-soft" : "text-ink-muted dark:text-slate-400"}`}
        >
          <Settings2 size={14} />
          {managing ? (isAr ? "تم" : "Done") : isAr ? "تعديل" : "Manage"}
        </button>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-surface-subtle dark:hover:bg-slate-800 text-ink-muted dark:text-slate-400 transition-colors">
          <X size={15} />
        </button>
      </div>

      {managing ? (
        <div className="p-3 space-y-2 border-b border-line dark:border-slate-800 bg-surface dark:bg-slate-900/50">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={isAr ? "الاسم المختصر (مثلاً: مواعيد الجمعة)" : "Short name (e.g. Friday hours)"}
            className="w-full rounded-lg border border-line dark:border-slate-700 bg-surface dark:bg-slate-800 px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/50 text-ink dark:text-slate-100 placeholder-ink-faint dark:placeholder-slate-500 transition-all shadow-sm"
            dir="auto"
          />
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={2}
            placeholder={isAr ? "نص الرد… اكتب {name} مكان اسم المريض" : "Reply text… write {name} where the patient's name goes"}
            className="w-full rounded-lg border border-line dark:border-slate-700 bg-surface dark:bg-slate-800 px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none text-ink dark:text-slate-100 placeholder-ink-faint dark:placeholder-slate-500 transition-all shadow-sm"
            dir="auto"
          />
          <button
            onClick={() => void add()}
            disabled={saving || !newTitle.trim() || !newText.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ink text-[12px] font-black disabled:opacity-50 bg-accent dark:bg-accent hover:brightness-110 shadow-sm transition-all"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {isAr ? "أضف رد" : "Add reply"}
          </button>
        </div>
      ) : (
        <div className="px-3 py-2 border-b border-line dark:border-slate-800 bg-surface dark:bg-slate-900/80 backdrop-blur-md">
          <div className="relative">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-ink-muted dark:text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={isAr ? "ابحث في الردود" : "Search replies"}
              className="w-full rounded-full border-0 ps-9 pe-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent/50 bg-surface-subtle dark:bg-slate-800 text-ink dark:text-slate-100 placeholder-ink-faint dark:placeholder-slate-500 transition-all"
            />
          </div>
        </div>
      )}

      <div className="overflow-y-auto">
        {custom === null ? (
          <div className="p-4 flex justify-center text-ink-muted dark:text-slate-400">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-[12px] font-bold text-ink-muted dark:text-slate-400">
            {custom.length === 0 && !Object.values(facts).some(Boolean)
              ? isAr
                ? "مفيش ردود جاهزة لسه. اضغط تعديل وأضف أول رد، أو املأ الإجابات الجاهزة في الإعدادات → واتساب."
                : "No quick replies yet. Click Manage to add one, or fill the ready answers in Settings → WhatsApp."
              : isAr
                ? "مفيش نتايج"
                : "Nothing matches"}
          </p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 px-3 py-2 border-b border-line dark:border-slate-800 last:border-0 hover:bg-surface-subtle dark:hover:bg-slate-800/50 transition-colors">
              <button onClick={() => onInsert(fillQuickReply(r.text, patientName))} className="min-w-0 flex-1 text-start">
                <p className="text-[13px] font-bold truncate text-ink dark:text-slate-100" dir="auto">
                  {r.title}
                  {r.source === "facts" && (
                     <span className="ms-2 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-accent-tint text-accent-strong dark:bg-accent-strong/40 dark:text-accent-soft">
                      {isAr ? "من الإعدادات" : "Settings"}
                    </span>
                  )}
                </p>
                <p className="text-[12px] truncate text-ink-muted dark:text-slate-400 mt-0.5" dir="auto">
                  {fillQuickReply(r.text, patientName)}
                </p>
              </button>
              {managing && r.source === "custom" && (
                <button
                  onClick={() => void remove(r.id)}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-rose-50 dark:hover:bg-rose-900/20 shrink-0 text-[#c0392b] dark:text-[#fc8181] transition-colors"
                  aria-label={isAr ? "حذف" : "Delete"}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
