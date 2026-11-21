"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquarePlus, Send } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { REQUEST_MAX, type ClinicRequestView, type TaskStatus } from "@/lib/platformTasks";

/**
 * "Ask Alpha for a change" — the top of the Help page, for the clinic's owner and admins only.
 *
 * What they write lands on the platform owner's Tasks list (superadmin console). Underneath,
 * their own past requests with how far each got, so nobody has to phone to ask.
 */
const WORDS = {
  en: {
    title: "Ask for a change",
    sub: "Need something in the system done differently? Write it here and it goes straight to the Alpha team.",
    ph: "What would you like changed or added?",
    send: "Send",
    sent: "Sent. You can follow it below.",
    failed: "Could not send.",
    yours: "Your requests",
    stage: { todo: "Received", doing: "Working on it", built: "Ready, going live soon", live: "Done" } as Record<TaskStatus, string>,
    doneOn: "done {d}",
  },
  ar: {
    title: "اطلب تعديل",
    sub: "محتاج حاجة في السيستم تشتغل بشكل مختلف؟ اكتبها هنا وهتوصل لفريق ألفا على طول.",
    ph: "عايز تغيّر أو تضيف إيه؟",
    send: "إرسال",
    sent: "اتبعت. تقدر تتابعه تحت.",
    failed: "تعذّر الإرسال.",
    yours: "طلباتك",
    stage: { todo: "وصل", doing: "بنشتغل عليه", built: "جاهز وهيتفعل قريب", live: "اتنفذ" } as Record<TaskStatus, string>,
    doneOn: "اتنفذ {d}",
  },
};

const STAGE_TONE: Record<TaskStatus, string> = {
  todo: "border-line text-ink-muted",
  doing: "border-amber-300 text-amber-800 bg-amber-50",
  built: "border-indigo-200 text-indigo-700 bg-indigo-50",
  live: "border-emerald-200 text-emerald-700 bg-emerald-50",
};

async function call(method: "GET" | "POST", clinicId: string, body?: Record<string, unknown>) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { ok: false, error: "Session expired" } as { ok: boolean; error?: string; items?: ClinicRequestView[]; item?: ClinicRequestView };
  const url = method === "GET" ? `/api/tasks/request?clinicId=${encodeURIComponent(clinicId)}` : "/api/tasks/request";
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify({ ...body, clinicId }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ...data, ok: res.ok && data?.ok === true } as { ok: boolean; error?: string; items?: ClinicRequestView[]; item?: ClinicRequestView };
}

export default function ClinicRequests() {
  const { clinicId, isAdmin } = useClinic();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const w = isAr ? WORDS.ar : WORDS.en;
  const { showToast } = useUI();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ClinicRequestView[]>([]);

  const load = useCallback(async () => {
    if (!clinicId) return;
    const res = await call("GET", clinicId);
    if (res.ok && res.items) setItems(res.items);
  }, [clinicId]);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  if (!isAdmin || !clinicId) return null;

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" });

  const send = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    const res = await call("POST", clinicId, { text });
    setBusy(false);
    if (!res.ok || !res.item) { showToast(res.error || w.failed, "error"); return; }
    setItems((prev) => [res.item!, ...prev]);
    setText("");
    showToast(w.sent, "success");
  };

  return (
    <section className="mb-10 rounded-3xl border border-line bg-surface p-5 md:p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ink-slab text-white">
          <MessageSquarePlus size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-black tracking-tight text-ink">{w.title}</h2>
          <p className="mt-0.5 text-sm font-semibold text-ink-muted">{w.sub}</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-4 flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={w.ph}
          rows={3}
          maxLength={REQUEST_MAX}
          dir="auto"
          className="w-full resize-y rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={busy || text.trim().length < 3}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 self-end rounded-xl bg-ink-slab px-5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden className="rtl:-scale-x-100" />} {w.send}
        </button>
      </form>

      {items.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-ink-muted">{w.yours}</h3>
          <ul className="divide-y divide-line">
            {items.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 flex-1 text-sm font-bold text-ink" dir="auto">{r.title}</span>
                <span className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
                  {r.createdAt && <span>{fmt(r.createdAt)}</span>}
                  <span className={`rounded-full border px-2.5 py-0.5 font-bold ${STAGE_TONE[r.status]}`}>
                    {r.status === "live" && r.liveAt ? w.doneOn.replace("{d}", fmt(r.liveAt)) : w.stage[r.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
