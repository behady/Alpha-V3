"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { draftRows, mergeDraft, type BriefDraft, type DraftRow } from "@/lib/bot/brief";
import type { BotBrief, BotFacts } from "@/types/whatsapp";

const MAX_TEXT = 3000;

/** Short names for the review list. The editor's own labels are longer sentences. */
const LABELS: Record<string, { ar: string; en: string }> = {
  "facts.whyUs": { ar: "ليه تختارنا", en: "Why us" },
  "facts.consultation": { ar: "الكشف", en: "Consultation" },
  "facts.dentists": { ar: "الأطباء", en: "Your dentists" },
  "facts.walkIn": { ar: "الحضور من غير ميعاد", en: "Walk-ins" },
  "facts.durations": { ar: "الجلسة بتاخد قد ايه", en: "How long appointments take" },
  "facts.sessions": { ar: "عدد الجلسات", en: "Number of sessions" },
  "facts.installments": { ar: "التقسيط", en: "Instalments" },
  "facts.offers": { ar: "العروض والخصومات", en: "Offers and discounts" },
  "facts.offersUntil": { ar: "العرض ساري لغاية", en: "Offer valid until" },
  "facts.insurance": { ar: "التأمين الطبي", en: "Insurance" },
  "facts.notOffered": { ar: "خدمات إحنا مش بنعملها", en: "Treatments you don't offer" },
  "facts.aftercare": { ar: "تعليمات بعد العلاج", en: "Aftercare" },
  "facts.parking": { ar: "الباركن والدخول", en: "Parking and entrance" },
  "facts.mapsUrl": { ar: "لينك اللوكيشن", en: "Map link" },
  "brief.focus": { ar: "يركّز على", en: "Focus on" },
  "brief.tone": { ar: "طريقة الكلام", en: "Tone" },
  "brief.prices": { ar: "الأسعار على واتساب", en: "Prices on WhatsApp" },
  "brief.neverSay": { ar: "ممنوع يتكلم في", en: "Never talk about" },
  "brief.handoffWhen": { ar: "حوّل للاستقبال لما", en: "Always pass to staff when" },
};

/** The brief's two choices arrive as ids; the owner reads them as words. */
const CHOICE_VALUES: Record<string, { ar: string; en: string }> = {
  formal: { ar: "رسمي", en: "Formal" },
  short: { ar: "مختصر", en: "Short" },
  consult: { ar: "بعد الكشف بس", en: "After the consultation" },
};

type Phase = "write" | "review";

/**
 * "Interview me": the owner describes the clinic once, the AI drafts the answer boxes, and the
 * owner ticks what to keep. Nothing is written until Apply, and Apply is one save done by the
 * caller. Rows that would replace something the owner already wrote start unticked.
 */
export default function InterviewDialog({
  open,
  onClose,
  clinicId,
  facts,
  brief,
  onApply,
  isAr,
}: {
  open: boolean;
  onClose: () => void;
  clinicId: string;
  facts?: BotFacts;
  brief?: BotBrief;
  onApply: (result: { botFacts: BotFacts; botBrief: BotBrief }) => void;
  isAr: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("write");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // A reply that lands after the dialog was closed belongs to nobody: closing bumps this.
  const requestId = useRef(0);

  const t = {
    title: isAr ? "احكيلنا عن عيادتك" : "Interview me",
    prompt: isAr ? "اكتب عن عيادتك بكلامك" : "Tell us about your clinic in your own words",
    example: isAr
      ? "مثال: عيادتنا في مدينة نصر، الكشف ٢٠٠ جنيه وبيتخصم من العلاج. د. أحمد أخصائي زراعة وعنده ١٠ سنين خبرة. بنقسّط التقويم على ٦ شهور. مش بنعمل جراحة فكين. عايزين نركّز على الزراعة، ومتقولش أسعار على واتساب."
      : "e.g. We're in Nasr City. The consultation is 200 EGP, deducted from treatment. Dr. Ahmed does implants, 10 years' experience. Braces can be paid over 6 months. We don't do jaw surgery. We want to focus on implants, and no prices on WhatsApp.",
    hint: isAr
      ? "بياخد ١ كريدت. الذكاء الاصطناعي بياخد اللي انت كتبته بس، ومفيش حاجة بتتحفظ غير لما تراجع وتدوس «تطبيق»."
      : "Uses 1 AI credit. The AI only takes what you wrote, and nothing is saved until you review it and press Apply.",
    draftIt: isAr ? "جهّز الإجابات" : "Draft my answers",
    reviewHint: isAr
      ? "علّم على اللي عايز تحفظه. الخانات اللي فيها كلام بالفعل بتبدأ من غير علامة."
      : "Tick what you want to keep. Boxes that already hold something start unticked.",
    replaces: isAr ? "بدل:" : "Replaces:",
    nothing: isAr ? "ملقيناش حاجة جديدة في كلامك تتحط في الخانات." : "Nothing in your text adds to what is already filled in.",
    back: isAr ? "رجوع" : "Back",
    cancel: isAr ? "إلغاء" : "Cancel",
    close: isAr ? "إغلاق" : "Close",
    apply: (n: number) => (isAr ? `تطبيق (${n.toLocaleString("ar-EG")})` : `Apply (${n})`),
    errText: isAr ? "اكتب من حرف لحد ٣٬٠٠٠ حرف." : "Write between 1 and 3,000 characters.",
    errAuth: isAr ? "سجّل دخول تاني وجرّب." : "Sign in again and try once more.",
    errForbidden: isAr
      ? "دي لمدير العيادة بس، ومحتاجة إضافة المساعد الذكي."
      : "Only a clinic Admin can use this, and it needs the AI Assistant add-on.",
    errCredits: isAr ? "رصيد الذكاء الاصطناعي بتاع الشهر ده خلص." : "This month's AI credits are used up.",
    errFailed: isAr
      ? "الذكاء الاصطناعي معرفش يقرا الكلام ده. مفيش كريدت اتخصم — جرّب تاني."
      : "The AI could not read that. No credit was used — try again.",
  };

  // Closing keeps the typed text (the owner may reopen to try again) and drops everything else.
  const close = useCallback(() => {
    requestId.current += 1;
    setPhase("write");
    setBusy(false);
    setError("");
    setDraft(null);
    setRows([]);
    setTicked(new Set());
    onClose();
  }, [onClose]);

  // Escape closes, like the page's other dialogs.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const errorFor = (status: number) =>
    status === 400 ? t.errText : status === 401 ? t.errAuth : status === 403 ? t.errForbidden : status === 429 ? t.errCredits : t.errFailed;

  const submit = async () => {
    const body = text.trim();
    if (!body || body.length > MAX_TEXT || busy) return;
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const u = auth.currentUser;
      if (!u) throw Object.assign(new Error("auth"), { status: 401 });
      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/brief-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, text: body }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; draft?: BriefDraft };
      if (id !== requestId.current) return;
      if (!res.ok || !data.ok || !data.draft) {
        setError(errorFor(res.status));
        return;
      }
      const next = draftRows(data.draft, facts, brief);
      setDraft(data.draft);
      setRows(next);
      setTicked(new Set(next.filter((r) => !r.old).map((r) => r.key)));
      setPhase("review");
    } catch (e) {
      if (id !== requestId.current) return;
      const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
      setError(errorFor(status));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = () => {
    if (!draft || ticked.size === 0) return;
    onApply(mergeDraft(facts, brief, draft, ticked));
    close();
  };

  const label = (key: string) => (isAr ? LABELS[key]?.ar : LABELS[key]?.en) ?? key;
  const shown = (key: string, value: string) => {
    if (key !== "brief.tone" && key !== "brief.prices") return value;
    const c = CHOICE_VALUES[value];
    return c ? (isAr ? c.ar : c.en) : value;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      dir={isAr ? "rtl" : "ltr"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-dialog-title"
        className="flex max-h-[90dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="interview-dialog-title" className="text-lg font-black text-ink">
              {t.title}
            </h2>
            <p className="mt-0.5 text-xs font-medium leading-relaxed text-ink-muted">{phase === "write" ? t.hint : t.reviewHint}</p>
          </div>
          <button type="button" onClick={close} aria-label={t.close} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === "write" ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-bold text-ink">{t.prompt}</span>
              <textarea
                rows={8}
                dir="auto"
                maxLength={MAX_TEXT}
                disabled={busy}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30 resize-y disabled:opacity-60"
                placeholder={t.example}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <span className="block text-end font-figure text-[11px] tabular-nums text-ink-muted" dir="ltr">
                {text.length} / {MAX_TEXT}
              </span>
            </label>
          ) : rows.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-body">{t.nothing}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.key}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-subtle px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong"
                      checked={ticked.has(row.key)}
                      onChange={() => toggle(row.key)}
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-xs font-black text-ink">{label(row.key)}</span>
                      <span className="block whitespace-pre-wrap break-words text-sm text-ink-body" dir="auto">
                        {shown(row.key, row.value)}
                      </span>
                      {row.old && (
                        <span className="block break-words text-xs text-ink-muted" dir="auto">
                          {t.replaces} {shown(row.key, row.old)}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-3 rounded-xl border border-warn/25 bg-warn-tint px-3 py-2 text-xs font-bold text-warn">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          {phase === "write" ? (
            <>
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-bold text-ink-body hover:border-ink hover:text-ink"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !text.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-ink-slab px-4 py-2.5 text-sm font-bold text-white hover:bg-ink disabled:opacity-50"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {t.draftIt}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setPhase("write");
                  setError("");
                }}
                className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-bold text-ink-body hover:border-ink hover:text-ink"
              >
                {t.back}
              </button>
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={ticked.size === 0}
                  className="rounded-xl bg-ink-slab px-4 py-2.5 text-sm font-bold text-white hover:bg-ink disabled:opacity-50"
                >
                  {t.apply(ticked.size)}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
