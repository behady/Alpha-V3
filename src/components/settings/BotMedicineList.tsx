"use client";

import { useEffect, useState } from "react";
import { Pill, Trash2 } from "lucide-react";
import { onSnapshot, setDoc } from "firebase/firestore";
import { getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import type { BotMedicine } from "@/types/whatsapp";

/**
 * The only medicines the assistant may ever name, and the exact words it must use.
 *
 * The assistant does not write these sentences. It picks one and the clinic's own text goes out
 * as written — the same rule that makes the "ready answers" safe to quote, applied to
 * the one subject where being approximately right is not good enough. Leave the list empty and it
 * names nothing at all: every medicine question goes to the dentist, which is where it went before
 * this screen existed.
 *
 * Before any of them is sent, the assistant asks who the medicine is for, about pregnancy and
 * nursing, about allergies, and about chronic illness or other medicines. That question is not
 * optional and cannot be turned off here — only reworded. An answer that mentions any of those, or
 * that nobody can read as a plain "nothing", reaches the dentist instead.
 */

const DEFAULT_ROWS: Array<{ label: string; whenToUse: string; text: string }> = [
  {
    label: "مسكن عادي بعد الحشو",
    whenToUse: "وجع بسيط بعد حشو أو تنضيف، ومفيش ورم ولا سخونية",
    text: "تقدر تاخد المسكّن اللي متعوّد عليه حسب إرشادات العلبة، بعد الأكل، لمدة يومين بالكتير. لو الوجع استمر أو زاد، لازم الدكتور يشوفه.",
  },
  {
    label: "مضمضة بعد الخلع",
    whenToUse: "بعد خلع، من تاني يوم",
    text: "من تاني يوم بعد الخلع، مضمضة بمية دافية وملح (نص معلقة على كوباية) بعد الأكل وقبل النوم. من غير شفط ولا بصق بقوة أول ٢٤ ساعة.",
  },
];

export default function BotMedicineList() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const [items, setItems] = useState<BotMedicine[]>([]);
  const [screening, setScreening] = useState("");
  const [label, setLabel] = useState("");
  const [whenToUse, setWhenToUse] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      getClinicDoc("settings", "whatsapp"),
      (snap) => {
        const data = snap.data() || {};
        setItems(Array.isArray(data.botMedicines) ? (data.botMedicines as BotMedicine[]) : []);
        setScreening(typeof data.botMedicineScreening === "string" ? data.botMedicineScreening : "");
      },
      () => {}
    );
    return () => unsub();
  }, [user]);

  const write = async (next: BotMedicine[], nextScreening?: string) => {
    setBusy(true);
    setError(null);
    try {
      await setDoc(
        getClinicDoc("settings", "whatsapp"),
        { botMedicines: next, ...(nextScreening === undefined ? {} : { botMedicineScreening: nextScreening }) },
        { merge: true }
      );
    } catch (e) {
      // Written to settings/*, which only an Admin may change — say so instead of failing silently.
      setError(e instanceof Error ? e.message : isAr ? "مش اتحفظ" : "could not save");
    } finally {
      setBusy(false);
    }
  };

  const add = async (row: { label: string; whenToUse: string; text: string }) => {
    if (!row.label.trim() || !row.text.trim() || busy) return;
    const id = `med${Date.now().toString(36)}`;
    await write([
      ...items,
      { id, label: row.label.trim().slice(0, 80), whenToUse: row.whenToUse.trim().slice(0, 200), text: row.text.trim().slice(0, 600) },
    ]);
  };

  return (
    <div className="pt-4 mt-2 border-t border-line space-y-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-ink-body">
        {isAr ? "أدوية البوت مسموح له يقولها" : "Medicines the bot may name"}
      </p>
      <p className="text-xs text-ink-body leading-relaxed max-w-2xl">
        {isAr
          ? "البوت مش بيكتب الكلام ده — بيختار السطر المناسب وبيبعت كلام حضرتك زي ما هو. وقبل ما يبعت أي حاجة، بيسأل المريض الدوا لمين، وفي حمل أو رضاعة، وفي حساسية، وبياخد أدوية تانية ولا لأ — ولو أي إجابة فيها حاجة من دول، بيحوّله للدكتور. سيبها فاضية والبوت مش هيسمّي أي دوا خالص."
          : "The bot does not write these — it picks the right line and sends your words. Before sending any of them it asks who the medicine is for, about pregnancy and nursing, allergies, and other medicines; anything in that answer sends the patient to the dentist instead. Leave the list empty and it names nothing at all."}
      </p>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface-subtle px-3 py-2">
              <span className="h-9 w-9 rounded-lg bg-surface flex items-center justify-center shrink-0 mt-0.5">
                <Pill size={16} className="text-ink-muted" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink truncate" dir="auto">{m.label}</p>
                {m.whenToUse ? <p className="text-[11px] text-ink-muted truncate" dir="auto">{m.whenToUse}</p> : null}
                <p className="text-xs text-ink-body mt-1 leading-relaxed" dir="auto">{m.text}</p>
              </div>
              <button
                type="button"
                onClick={() => void write(items.filter((x) => x.id !== m.id))}
                className="p-1.5 rounded-lg text-ink-muted hover:text-danger shrink-0"
                aria-label="delete"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-3 py-3 space-y-2">
          <p className="text-xs text-ink-muted">
            {isAr ? "ابدأ من دول لو حابب، وعدّل الكلام زي ما تحب:" : "Start from these if you like, and edit the wording:"}
          </p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_ROWS.map((row) => (
              <button
                key={row.label}
                type="button"
                disabled={busy}
                onClick={() => void add(row)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-subtle disabled:opacity-50"
              >
                + {row.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={isAr ? "الاسم في القايمة (مسكن عادي)" : "Name in the list (ordinary painkiller)"}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          dir="auto"
        />
        <input
          value={whenToUse}
          onChange={(e) => setWhenToUse(e.target.value)}
          placeholder={isAr ? "إمتى يتقال (للبوت بس، المريض مش بيشوفه)" : "When to use it (for the bot only)"}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          dir="auto"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={isAr ? "النص اللي هيتبعت للمريض بالحرف — بالجرعة والتحذير" : "The exact words sent to the patient — dose and caution included"}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed"
        dir="auto"
      />
      <button
        type="button"
        disabled={busy || !label.trim() || !text.trim()}
        onClick={async () => {
          await add({ label, whenToUse, text });
          setLabel("");
          setWhenToUse("");
          setText("");
        }}
        className="rounded-lg bg-ink px-4 py-2 text-xs font-black text-surface disabled:opacity-40"
      >
        {isAr ? "إضافة" : "Add"}
      </button>

      <label className="block space-y-1 pt-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-ink-body">
          {isAr ? "الأسئلة اللي بيسألها قبل ما يقول أي دوا" : "The questions asked before any medicine is named"}
        </span>
        <textarea
          value={screening}
          onChange={(e) => setScreening(e.target.value)}
          onBlur={() => void write(items, screening)}
          rows={3}
          placeholder={isAr ? "سيبها فاضية عشان يستخدم الصيغة الجاهزة" : "Leave empty to use the built-in wording"}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed"
          dir="auto"
        />
        <span className="text-[11px] text-ink-muted">
          {isAr
            ? "بتتبعت مرة واحدة في المحادثة قبل أول اقتراح. مينفعش تتلغي — بس تتعاد صياغتها."
            : "Sent once per conversation, before the first suggestion. It cannot be switched off, only reworded."}
        </span>
      </label>

      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
