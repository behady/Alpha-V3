"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, RotateCcw, Send } from "lucide-react";
import { auth } from "@/lib/firebase";
import { currentClinicId } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";

/**
 * A chat with the clinic's own bot, inside Settings.
 *
 * Until this existed the only way to hear the bot was to text the clinic's WhatsApp from a
 * phone — and every coaching tweak needed the phone again. Here the owner types as a patient
 * would, sees exactly what would have gone out (buttons included, as tappable chips), edits the
 * coaching notes above, and tries again. Real credits are used; nothing reaches a patient.
 */

interface Chip {
  id: string;
  title: string;
}
interface Msg {
  role: "me" | "bot";
  text: string;
  reason?: string;
  chips?: Chip[];
}

type Structure = {
  body?: string;
  buttons?: Chip[];
  list?: { sections?: Array<{ rows?: Chip[] }>; rows?: Chip[] };
};

function chipsOf(s?: Structure | null): Chip[] {
  if (!s) return [];
  if (Array.isArray(s.buttons) && s.buttons.length) return s.buttons.map((b) => ({ id: b.id, title: b.title }));
  const rows = s.list?.rows ?? s.list?.sections?.flatMap((x) => x.rows ?? []) ?? [];
  return rows.map((r) => ({ id: r.id, title: r.title }));
}

export default function BotPlayground() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs.length, busy]);

  const call = async (payload: Record<string, unknown>) => {
    const u = auth.currentUser;
    if (!u) throw new Error("not signed in");
    const idToken = await u.getIdToken();
    const res = await fetch("/api/admin/bot-playground", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ clinicId: currentClinicId(), ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    return json as { status: string; text?: string; reason?: string; structure?: Structure };
  };

  const send = async (t: string) => {
    const line = t.trim();
    if (!line || busy) return;
    setText("");
    setError(null);
    setMsgs((m) => [...m, { role: "me", text: line }]);
    setBusy(true);
    try {
      const out = await call({ text: line });
      if (out.status === "replied" && out.text) {
        setMsgs((m) => [...m, { role: "bot", text: out.text!, reason: out.reason, chips: chipsOf(out.structure) }]);
      } else {
        setMsgs((m) => [
          ...m,
          {
            role: "bot",
            text: isAr ? `(البوت سكت — السبب: ${out.reason})` : `(the bot stayed silent — reason: ${out.reason})`,
            reason: out.reason,
          },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await call({ reset: true });
      setMsgs([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-4 mt-2 border-t border-line space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-ink-body">{isAr ? "جرّب البوت بنفسك" : "Try the bot yourself"}</p>
          <p className="text-xs text-ink-muted leading-relaxed max-w-2xl">
            {isAr
              ? "اكتب زي ما المريض بيكتب. ده نفس البوت بنفس الإعدادات والكريدت، بس مفيش حاجة بتتبعت لأي مريض. عدّل التعليمات فوق وجرّب تاني."
              : "Type as a patient would. Same bot, same settings, same credits — nothing reaches a patient. Edit the coaching above and try again."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-ink-muted hover:text-ink disabled:opacity-50"
        >
          <RotateCcw size={13} /> {isAr ? "ابدأ محادثة جديدة" : "Start over"}
        </button>
      </div>

      <div className="rounded-2xl border border-line bg-surface-subtle p-3 sm:p-4 max-h-[28rem] overflow-y-auto space-y-3" dir="rtl">
        {msgs.length === 0 && (
          <p className="text-xs text-slate-400 font-bold text-center py-6">
            <Bot className="mx-auto mb-2 text-slate-300" size={22} />
            {isAr ? "ابدأ بـ «السلام عليكم» أو «التقويم بكام»" : "Start with a greeting or a price question"}
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "me" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] space-y-2`}>
              <div
                className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "me" ? "bg-ink text-surface rounded-tr-sm" : "bg-surface border border-line text-ink rounded-tl-sm"
                }`}
                dir="auto"
              >
                {m.text}
              </div>
              {m.chips && m.chips.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.chips.slice(0, 10).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void send(c.id)}
                      className="px-3 py-1 rounded-full border border-line bg-surface text-xs font-bold text-ink-body hover:bg-surface-muted disabled:opacity-50"
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
              {m.reason && <p className="text-[10px] text-slate-400 font-mono">{m.reason}</p>}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-slate-400 font-bold">{isAr ? "البوت بيكتب…" : "Bot is typing…"}</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="text-xs font-bold text-danger">{error}</p>}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          dir="auto"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30"
          placeholder={isAr ? "اكتب رسالة زي المريض…" : "Type a message as the patient…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-ink text-surface text-xs font-black disabled:opacity-40"
        >
          <Send size={13} /> {isAr ? "ابعت" : "Send"}
        </button>
      </form>
    </div>
  );
}
