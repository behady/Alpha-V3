"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import type { BotScript } from "@/types/whatsapp";
import { parseTriggers, cleanScripts } from "@/lib/bot/scripts";

/**
 * The clinic's own scripts: "when a patient says any of these words, send exactly this".
 *
 * This is the scripted bot's memory that the clinic owns. The built-in answers cover the
 * questions every dental clinic gets; these cover the ones only THIS clinic gets — the pediatric
 * question, the whitening brand, the elevator that is out of order. Free: a script never calls
 * the model. The editor saves as you leave a field, like the rest of the WhatsApp settings, and
 * a row with no trigger or no reply is kept on screen but never goes live (lib/bot/scripts.ts
 * drops it on the way to the server).
 */
export default function BotScriptsEditor({
  scripts,
  onChange,
}: {
  scripts: BotScript[];
  onChange: (next: BotScript[]) => void;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const [open, setOpen] = useState<string | null>(null);
  /** The trigger box is edited as one string and split on the way out. */
  const [triggerDrafts, setTriggerDrafts] = useState<Record<string, string>>({});

  const txt = {
    title: ar ? "الردود المكتوبة (السكريبتات)" : "Your scripts",
    hint: ar
      ? "لما المريض يكتب أي كلمة من الكلمات دي، البوت يرد بالنص ده بالظبط. ببلاش — مفيش ذكاء اصطناعي. الأطول تطابقاً يكسب لو اتطابق أكتر من سكريبت."
      : "When a patient writes any of these words, the bot sends this exact text. Free — no AI involved. If several scripts match, the most specific trigger wins.",
    add: ar ? "سكريبت جديد" : "New script",
    name: ar ? "اسم للقائمة (للفريق بس)" : "Name (staff only)",
    namePh: ar ? "مثال: أطفال، تبييض، الأسانسير" : "e.g. Kids, Whitening, Elevator",
    triggers: ar ? "الكلمات اللي تشغّله (افصل بفاصلة)" : "Trigger words (comma-separated)",
    triggersPh: ar ? "مثال: اطفال, طفل, ابني, بنتي" : "e.g. kids, child, my son, my daughter",
    reply: ar ? "الرد اللي يتبعت" : "Reply to send",
    replyPh: ar
      ? "مثال: أيوه بنستقبل الأطفال من سن 3 سنين 🦷 د. سارة متخصصة أطفال وموجودة السبت والتلات."
      : "e.g. Yes, we see children from age 3 🦷 Dr Sara is our pediatric dentist, Saturdays and Tuesdays.",
    on: ar ? "شغّال" : "On",
    off: ar ? "موقوف" : "Off",
    empty: ar ? "لسه مفيش سكريبتات. ابدأ بالأسئلة اللي بتتكرر عليكم." : "No scripts yet. Start with the questions you get every week.",
    incomplete: ar ? "ناقص كلمات أو رد — مش هيشتغل لحد ما يتكمل." : "Missing triggers or a reply — not live until both are filled.",
    remove: ar ? "حذف" : "Delete",
  };

  const update = (id: string, patch: Partial<BotScript>) => {
    onChange(scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const add = () => {
    const id = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    onChange([...scripts, { id, triggers: [], reply: "" }]);
    setOpen(id);
  };

  const remove = (id: string) => {
    onChange(scripts.filter((s) => s.id !== id));
    if (open === id) setOpen(null);
  };

  const liveIds = new Set(cleanScripts(scripts).map((s) => s.id));

  return (
    <div className="space-y-3 pt-4 mt-2 border-t border-line">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-ink-body">{txt.title}</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-body">{txt.hint}</p>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-black text-ink-on-accent transition-colors hover:bg-accent-strong"
        >
          <Plus size={14} /> {txt.add}
        </button>
      </div>

      {scripts.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-xs font-bold text-ink-muted">{txt.empty}</p>
      )}

      <div className="space-y-2">
        {scripts.map((s) => {
          const isOpen = open === s.id;
          const live = liveIds.has(s.id) && s.enabled !== false;
          const label = s.title?.trim() || s.triggers[0] || (ar ? "بدون اسم" : "Untitled");
          return (
            <div key={s.id} className="rounded-xl border border-line bg-surface-subtle">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : s.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-start"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${live ? "bg-emerald-500" : "bg-line-strong"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-ink">{label}</span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {s.triggers.length ? s.triggers.join(" · ") : txt.incomplete}
                  </span>
                </span>
                {isOpen ? <ChevronUp size={16} className="text-ink-muted" /> : <ChevronDown size={16} className="text-ink-muted" />}
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-line px-4 py-4">
                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-ink">{txt.name}</span>
                    <input
                      type="text"
                      value={s.title ?? ""}
                      placeholder={txt.namePh}
                      onChange={(e) => update(s.id, { title: e.target.value })}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-ink">{txt.triggers}</span>
                    <input
                      type="text"
                      value={triggerDrafts[s.id] ?? s.triggers.join(", ")}
                      placeholder={txt.triggersPh}
                      onChange={(e) => setTriggerDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                      onBlur={(e) => {
                        update(s.id, { triggers: parseTriggers(e.target.value) });
                        setTriggerDrafts((d) => {
                          const { [s.id]: _dropped, ...rest } = d;
                          return rest;
                        });
                      }}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-ink">{txt.reply}</span>
                    <textarea
                      rows={3}
                      value={s.reply}
                      placeholder={txt.replyPh}
                      onChange={(e) => update(s.id, { reply: e.target.value })}
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-ink">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-line-strong"
                        checked={s.enabled !== false}
                        onChange={(e) => update(s.id, { enabled: e.target.checked })}
                      />
                      {s.enabled !== false ? txt.on : txt.off}
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(s.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      <Trash2 size={14} /> {txt.remove}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
