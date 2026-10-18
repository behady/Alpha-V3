"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { appendOptOutFooter, WHATSAPP_OPT_OUT_FOOTER_BILINGUAL } from "@/lib/patientMessaging";
import {
  BROADCAST_MAX_DAILY,
  BROADCAST_TEMPLATES,
  BROADCAST_WINDOW,
  RECOMMENDED_DAILY_LIMIT,
  checkBroadcastMessage,
  firstNameOf,
  hasBlockingIssue,
  planBroadcastDays,
  type BroadcastCheck,
  type BroadcastReview,
  type BroadcastSummary,
} from "@/lib/broadcast/shared";

/**
 * WhatsApp → Broadcast: one message to every patient, written here, sent slowly by the server.
 *
 * The page is built around one worry the owner named: "how do we do this without the number
 * getting banned". So it explains the ban before it offers the button, checks the message twice
 * (free rules as you type, the AI on request), and shows the pace in days, not messages, because
 * "1,250 patients over two weeks" is the sentence that makes the slowness feel deliberate.
 */

type Line = {
  onGateway: boolean;
  officialChannel: boolean;
  state: string;
  phone: string | null;
  daysLinked: number | null;
  dailyCap: number | null;
  sentToday: number | null;
  queued: number | null;
  autoSending: boolean;
};

type Overview = {
  line: Line;
  problem: { en: string; ar: string } | null;
  clinicName?: string;
  audience?: { count: number; totalPatients: number; excludedOptedOut: number; excludedDuplicates: number; excludedNoPhone: number };
  broadcasts: BroadcastSummary[];
};

const SAMPLE_NAME = "محمد أحمد";
const TOKENS: { token: string; en: string; ar: string }[] = [
  { token: "{{first_name}}", en: "First name", ar: "الاسم الأول" },
  { token: "{{patient_name}}", en: "Full name", ar: "الاسم بالكامل" },
  { token: "{{clinic_name}}", en: "Clinic name", ar: "اسم العيادة" },
];
const DAILY_CHOICES = [30, 50, 100, 150].filter((n) => n <= BROADCAST_MAX_DAILY);

async function call<T>(body: Record<string, unknown>, path = "/api/broadcasts"): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || "Request failed") as Error & { ar?: string };
    err.ar = data.errorAr;
    throw err;
  }
  return data as T;
}

const nf = (n: number, isAr: boolean) => n.toLocaleString(isAr ? "ar-EG" : "en-GB");

function addDays(days: number, isAr: boolean): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, days - 1));
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "long" });
}

export default function BroadcastPanel() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const { clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const t = (en: string, ar: string) => (isAr ? ar : en);
  const errText = (e: unknown) => {
    const err = e as Error & { ar?: string };
    return (isAr && err.ar) || err.message || String(e);
  };

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [versions, setVersions] = useState<string[]>([""]);
  const [active, setActive] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(RECOMMENDED_DAILY_LIMIT);
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [review, setReview] = useState<{ forText: string; data: BroadcastReview } | null>(null);
  const [explainOpen, setExplainOpen] = useState(true);
  const [failures, setFailures] = useState<{ id: string; rows: { name: string; phone: string; error: string }[] } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const text = versions[active] || "";
  const clinicName = overview?.clinicName || "";

  const load = useCallback(
    async (light = false) => {
      if (!clinicId) return;
      try {
        const data = await call<Overview>({ clinicId, action: light ? "list" : "overview" });
        setOverview((prev) => (light && prev ? { ...prev, ...data, audience: prev.audience, clinicName: prev.clinicName } : data));
        setLoadError("");
      } catch (e) {
        if (!light) setLoadError(errText(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clinicId, isAr]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const running = overview?.broadcasts.find((b) => b.status === "running" || b.status === "paused") || null;

  // While one is going, the progress moves on its own: refresh quietly.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, [running, load]);

  const checks = useMemo(() => checkBroadcastMessage(text), [text]);
  const allChecks = useMemo(() => versions.map((v) => checkBroadcastMessage(v)), [versions]);
  const blocked = allChecks.some((c) => hasBlockingIssue(c)) || versions.every((v) => !v.trim());

  const preview = useMemo(() => {
    if (!text.trim()) return "";
    const merged = text
      .split("{{first_name}}").join(firstNameOf(SAMPLE_NAME))
      .split("{{patient_name}}").join(SAMPLE_NAME)
      .split("{{clinic_name}}").join(clinicName || t("Your clinic", "عيادتك"));
    return appendOptOutFooter(merged, WHATSAPP_OPT_OUT_FOOTER_BILINGUAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, clinicName, isAr]);

  const audienceCount = overview?.audience?.count ?? 0;
  const plan = useMemo(
    () => planBroadcastDays(audienceCount, dailyLimit, overview?.line.daysLinked ?? null),
    [audienceCount, dailyLimit, overview?.line.daysLinked]
  );

  const setText = (value: string) => setVersions((vs) => vs.map((v, i) => (i === active ? value : v)));

  const pickTemplate = async (id: string) => {
    const tpl = BROADCAST_TEMPLATES.find((x) => x.id === id);
    const body = tpl ? tpl.body[isAr ? "ar" : "en"] : "";
    if (text.trim() && text.trim() !== body) {
      const ok = await confirm(t("Replace what you wrote with this template?", "تستبدل اللي كتبته بالقالب ده؟"), {
        confirmLabel: t("Replace", "استبدال"),
        cancelLabel: t("Keep mine", "سيب بتاعي"),
      });
      if (!ok) return;
    }
    setText(body);
    if (tpl && !name.trim()) setName(isAr ? tpl.ar : tpl.en);
    setReview(null);
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const insertToken = (token: string) => {
    const el = textRef.current;
    if (!el) return setText(text + token);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const runReview = async () => {
    if (!text.trim()) return;
    setBusy("review");
    try {
      const data = await call<{ review: BroadcastReview }>(
        { clinicId, text, language: isAr ? "ar" : "en", audienceSize: audienceCount },
        "/api/broadcasts/review"
      );
      setReview({ forText: text, data: data.review });
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusy("");
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) return showToast(t("Type your own mobile number first.", "اكتب رقم موبايلك الأول."), "error");
    setBusy("test");
    try {
      await call({ clinicId, action: "test", phone: testPhone, text });
      showToast(t("Test sent — check your WhatsApp.", "اتبعتت رسالة تجربة — شوف الواتساب بتاعك."), "success");
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusy("");
    }
  };

  const launch = async () => {
    const days = plan.length;
    const ok = await confirm(
      t(
        `Send "${name.trim()}" to ${nf(audienceCount, false)} patients? At most ${dailyLimit} a day, ${BROADCAST_WINDOW.startHour}:00–${BROADCAST_WINDOW.endHour}:00, about ${days} days. You can pause or cancel at any time.`,
        `تبعت "${name.trim()}" لـ ${nf(audienceCount, true)} مريض؟ بحد أقصى ${nf(dailyLimit, true)} في اليوم، من ${BROADCAST_WINDOW.startHour} الصبح لـ ${BROADCAST_WINDOW.endHour - 12} بالليل، حوالي ${nf(days, true)} يوم. تقدر توقفها أو تلغيها في أي وقت.`
      ),
      { title: t("Start the broadcast", "بدء الرسالة الجماعية"), confirmLabel: t("Start sending", "ابدأ الإرسال") }
    );
    if (!ok) return;
    setBusy("launch");
    try {
      await call({ clinicId, action: "create", name, versions: versions.filter((v) => v.trim()), dailyLimit });
      showToast(t("Started. The first messages leave within ten minutes.", "بدأت. أول رسايل هتطلع خلال ١٠ دقايق."), "success");
      setVersions([""]);
      setActive(0);
      setName("");
      setReview(null);
      await load();
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusy("");
    }
  };

  const steer = async (b: BroadcastSummary, action: "pause" | "resume" | "cancel") => {
    if (action === "cancel") {
      const ok = await confirm(
        t(`Cancel "${b.name}"? The ${b.total - b.sent - b.skipped - b.failed} patients not reached yet will not get it.`, `تلغي "${b.name}"؟ الـ ${nf(b.total - b.sent - b.skipped - b.failed, true)} مريض اللي لسه موصلتلهمش مش هتوصلهم.`),
        { tone: "danger", confirmLabel: t("Cancel broadcast", "إلغاء الرسالة"), cancelLabel: t("Keep it", "سيبها") }
      );
      if (!ok) return;
    }
    setBusy(`${action}:${b.id}`);
    try {
      await call({ clinicId, action, id: b.id });
      await load(true);
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusy("");
    }
  };

  const showFailures = async (b: BroadcastSummary) => {
    if (failures?.id === b.id) return setFailures(null);
    try {
      const data = await call<{ rows: { name: string; phone: string; error: string }[] }>({ clinicId, action: "failures", id: b.id });
      setFailures({ id: b.id, rows: data.rows });
    } catch (e) {
      showToast(errText(e), "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-ink-muted">
        <Loader2 size={16} className="animate-spin" /> {t("Loading your patient list…", "بنجهز قايمة المرضى…")}
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="rounded-2xl border border-danger/25 bg-danger-tint p-5 text-sm font-semibold text-danger">
        {loadError}
        <button onClick={() => void load()} className="ms-3 underline">
          {t("Try again", "جرّب تاني")}
        </button>
      </div>
    );
  }

  const line = overview?.line;
  const problem = overview?.problem;
  const audience = overview?.audience;
  const reviewStale = review && review.forText !== text;

  return (
    <div className="space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* ---------- The slab: who gets it, and the number it leaves from ---------- */}
      <section className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/50">{t("One message, every patient", "رسالة واحدة لكل المرضى")}</p>
            <p className="mt-2 font-figure text-5xl font-semibold leading-none sm:text-6xl">{nf(audience?.count ?? 0, isAr)}</p>
            <p className="mt-2 text-sm text-white/70">
              {t("patients will receive it", "مريض هتوصلهم الرسالة")}
              {audience && audience.totalPatients > audience.count && (
                <span className="text-white/45">
                  {" · "}
                  {t(`of ${nf(audience.totalPatients, false)} on file`, `من ${nf(audience.totalPatients, true)} متسجلين`)}
                </span>
              )}
            </p>
          </div>
          <div className="min-w-[220px] text-sm">
            <LineBadge line={line} isAr={isAr} />
          </div>
        </div>
        {audience && (audience.excludedOptedOut + audience.excludedDuplicates + audience.excludedNoPhone > 0) && (
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-4 text-xs text-white/55">
            {audience.excludedOptedOut > 0 && <span>{t(`${audience.excludedOptedOut} asked to stop — left out`, `${nf(audience.excludedOptedOut, true)} طلبوا إيقاف — متشالين`)}</span>}
            {audience.excludedDuplicates > 0 && (
              <span>{t(`${audience.excludedDuplicates} share a number with another patient — one message per number`, `${nf(audience.excludedDuplicates, true)} رقمهم مكرر مع مريض تاني — رسالة واحدة لكل رقم`)}</span>
            )}
            {audience.excludedNoPhone > 0 && <span>{t(`${audience.excludedNoPhone} have no mobile number`, `${nf(audience.excludedNoPhone, true)} ملهمش رقم موبايل`)}</span>}
          </div>
        )}
      </section>

      {problem && (
        <div className="flex gap-3 rounded-2xl border border-warn/30 bg-warn-tint px-5 py-4 text-sm text-ink">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="font-semibold">{isAr ? problem.ar : problem.en}</p>
        </div>
      )}

      {/* ---------- Why this page is careful ---------- */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <button onClick={() => setExplainOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start">
          <span className="flex items-center gap-2.5 text-sm font-black text-ink">
            <ShieldCheck size={18} />
            {t("Read this first: how a WhatsApp number gets banned", "اقرا ده الأول: إزاي رقم الواتساب بيتقفل")}
          </span>
          <ChevronDown size={16} className={`text-ink-muted transition-transform ${explainOpen ? "rotate-180" : ""}`} />
        </button>
        {explainOpen && <SafetyExplainer isAr={isAr} />}
      </section>

      {/* ---------- Writing ---------- */}
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <div>
            <p className="text-xs font-bold text-ink-muted">{t("Start from a template, or write your own", "ابدأ من قالب، أو اكتب رسالتك")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BROADCAST_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => void pickTemplate(tpl.id)}
                  className="rounded-full border border-line px-3.5 py-1.5 text-xs font-bold text-ink hover:border-ink"
                >
                  {isAr ? tpl.ar : tpl.en}
                </button>
              ))}
              <button
                onClick={() => void pickTemplate("")}
                className="rounded-full border border-dashed border-line px-3.5 py-1.5 text-xs font-bold text-ink-muted hover:border-ink hover:text-ink"
              >
                {t("Blank", "فاضية")}
              </button>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-ink-muted">{t("Name (only you see it)", "اسم الرسالة (ليك انت بس)")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("e.g. Fifth Settlement opening", "مثلاً: افتتاح فرع التجمع")}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 text-sm font-semibold text-ink outline-none focus:border-accent focus:bg-surface"
            />
          </label>

          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              {versions.map((_, i) => (
                <span key={i} className="inline-flex items-center">
                  <button
                    onClick={() => setActive(i)}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${i === active ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink"}`}
                  >
                    {t(`Version ${i + 1}`, `النسخة ${i + 1}`)}
                    {hasBlockingIssue(allChecks[i]) && <span className="ms-1.5 inline-block h-1.5 w-1.5 rounded-full bg-danger align-middle" />}
                  </button>
                  {versions.length > 1 && i === active && (
                    <button
                      aria-label={t("Remove this version", "شيل النسخة دي")}
                      onClick={() => {
                        setVersions((vs) => vs.filter((_, j) => j !== i));
                        setActive(0);
                      }}
                      className="ms-0.5 rounded-full p-1 text-ink-faint hover:text-danger"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
              {versions.length < 3 && (
                <button
                  onClick={() => {
                    setVersions((vs) => [...vs, vs[active] || ""]);
                    setActive(versions.length);
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-ink-muted hover:text-ink"
                >
                  <Plus size={12} /> {t("Another version", "نسخة تانية")}
                </button>
              )}
            </div>
            {versions.length > 1 && (
              <p className="mt-1.5 text-[11px] text-ink-muted">
                {t(
                  "Patients get the versions in turn. Different wording for the same news looks less like a machine.",
                  "المرضى بيستلموا النسخ بالدور. نفس الخبر بكلام مختلف بيبان أقل إنه آلي."
                )}
              </p>
            )}
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              dir="auto"
              placeholder={t("Write the message patients will receive…", "اكتب الرسالة اللي هتوصل للمرضى…")}
              className="mt-2 w-full resize-y rounded-xl border border-line bg-surface-subtle px-4 py-3 text-[15px] leading-7 text-ink outline-none focus:border-accent focus:bg-surface"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-ink-muted">{t("Insert:", "إضافة:")}</span>
              {TOKENS.map((tok) => (
                <button
                  key={tok.token}
                  onClick={() => insertToken(tok.token)}
                  className="rounded-lg border border-line bg-surface-subtle px-2 py-1 text-[11px] font-bold text-ink hover:border-ink"
                >
                  {isAr ? tok.ar : tok.en}
                </button>
              ))}
              <span className="ms-auto text-[11px] text-ink-faint">{nf(Array.from(text).length, isAr)} {t("characters", "حرف")}</span>
            </div>
          </div>

          <ChecksList checks={checks} isAr={isAr} />

          {/* The AI's read */}
          <div className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-black text-ink">
                  <Sparkles size={16} /> {t("Ask the AI to check it", "خلي الذكاء الاصطناعي يراجعها")}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {t("Reads it like a patient would, rates the ban risk, and suggests a safer wording.", "بيقراها كأنه مريض، ويقيّم خطر قفل الرقم، ويقترح صياغة أأمن.")}
                </p>
              </div>
              <button
                onClick={() => void runReview()}
                disabled={!text.trim() || busy === "review"}
                className="flex items-center gap-2 rounded-xl bg-ink-slab px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-ink-strong disabled:opacity-50"
              >
                {busy === "review" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {review ? t("Check again", "راجع تاني") : t("Check message", "راجع الرسالة")}
              </button>
            </div>
            {review && (
              <ReviewView
                review={review.data}
                stale={!!reviewStale}
                isAr={isAr}
                canAddVersion={versions.length < 3}
                onUse={() => {
                  setText(review.data.improved);
                  setReview({ ...review, forText: review.data.improved });
                }}
                onAddVersion={() => {
                  setVersions((vs) => [...vs, review.data.improved]);
                  setActive(versions.length);
                }}
              />
            )}
          </div>
        </div>

        {/* Preview + plan */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-[#efeae2] p-4 dark:bg-surface-muted">
            <p className="mb-2 text-[11px] font-bold text-ink-muted">{t(`What ${firstNameOf(SAMPLE_NAME)} will see`, `اللي ${firstNameOf(SAMPLE_NAME)} هيشوفه`)}</p>
            {preview ? (
              <div dir="auto" className="ms-auto max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-se-sm bg-[#d9fdd3] px-3.5 py-2.5 text-[14px] leading-6 text-[#111b21] shadow-sm">
                {preview}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-ink-muted">{t("The preview appears as you write.", "المعاينة بتظهر وانت بتكتب.")}</p>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <div>
              <p className="text-sm font-black text-ink">{t("How fast", "السرعة")}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{t("The most it may send in one day.", "أقصى عدد يتبعت في اليوم.")}</p>
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {DAILY_CHOICES.map((n) => (
                  <button
                    key={n}
                    onClick={() => setDailyLimit(n)}
                    className={`rounded-xl border py-2 text-sm font-bold ${dailyLimit === n ? "border-ink-slab bg-ink-slab text-white" : "border-line text-ink hover:border-ink"}`}
                  >
                    {nf(n, isAr)}
                    {n === RECOMMENDED_DAILY_LIMIT && <span className={`block text-[9px] font-semibold ${dailyLimit === n ? "text-white/70" : "text-ink-muted"}`}>{t("advised", "مقترح")}</span>}
                  </button>
                ))}
              </div>
            </div>
            {audienceCount > 0 && (
              <div className="rounded-xl bg-surface-subtle p-3.5">
                <p className="font-figure text-3xl font-semibold leading-none text-ink">
                  {nf(plan.length, isAr)} <span className="font-sans text-sm font-bold text-ink-muted">{t("days", "يوم")}</span>
                </p>
                <p className="mt-1.5 text-xs text-ink-muted">
                  {t(`Finishes around ${addDays(plan.length, false)}.`, `هتخلص تقريباً يوم ${addDays(plan.length, true)}.`)}{" "}
                  {line?.daysLinked === null || line?.daysLinked === undefined
                    ? t(
                        `Counted from the day you link the number: it starts at ${plan[0] ?? 0} a day and speeds up over its first week.`,
                        `محسوبة من يوم ما تربط الرقم: بيبدأ بـ ${nf(plan[0] ?? 0, true)} في اليوم ويسرّع على مدار أول أسبوع.`
                      )
                    : line.daysLinked < 6
                      ? t(
                          `The number was linked recently, so it starts at ${plan[0] ?? 0} a day and speeds up over its first week.`,
                          `الرقم مربوط من قريب، فبيبدأ بـ ${nf(plan[0] ?? 0, true)} في اليوم ويسرّع على مدار أول أسبوع.`
                        )
                      : ""}
                </p>
                <PlanBars plan={plan} />
              </div>
            )}
            <div>
              <p className="text-sm font-black text-ink">{t("Send yourself a test", "ابعت لنفسك تجربة")}</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  inputMode="tel"
                  dir="ltr"
                  placeholder="01xxxxxxxxx"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface-subtle px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-accent focus:bg-surface"
                />
                <button
                  onClick={() => void sendTest()}
                  disabled={busy === "test" || !!problem || hasBlockingIssue(checks)}
                  className="rounded-xl border border-line px-3.5 text-sm font-bold text-ink hover:border-ink disabled:opacity-50"
                >
                  {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : t("Send", "ابعت")}
                </button>
              </div>
            </div>
            <button
              onClick={() => void launch()}
              disabled={blocked || !name.trim() || !!problem || !!running || audienceCount === 0 || busy === "launch"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-sm font-black text-ink-on-accent shadow-sm transition hover:bg-accent-strong disabled:opacity-40"
            >
              {busy === "launch" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {t(`Send to ${nf(audienceCount, false)} patients`, `ابعت لـ ${nf(audienceCount, true)} مريض`)}
            </button>
            {(running || blocked || !name.trim()) && (
              <p className="text-center text-[11px] text-ink-muted">
                {running
                  ? t("One broadcast at a time — the one below is still going.", "رسالة جماعية واحدة في المرة — اللي تحت لسه شغالة.")
                  : versions.every((v) => !v.trim())
                    ? t("Write the message first.", "اكتب الرسالة الأول.")
                  : blocked
                    ? t("Fix the red items first.", "صلّح النقط الحمرا الأول.")
                    : t("Give it a name.", "اكتب اسم للرسالة.")}
              </p>
            )}
          </div>
        </aside>
      </section>

      {/* ---------- Broadcasts ---------- */}
      {overview && overview.broadcasts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-ink">{t("Broadcasts", "الرسائل الجماعية")}</h3>
            <button onClick={() => void load(true)} className="flex items-center gap-1.5 text-xs font-bold text-ink-muted hover:text-ink">
              <RefreshCw size={13} /> {t("Refresh", "تحديث")}
            </button>
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {overview.broadcasts.map((b) => {
              const done = b.sent + b.skipped + b.failed;
              const pct = b.total ? Math.round((done / b.total) * 100) : 0;
              return (
                <div key={b.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-ink">{b.name}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        <StatusWord b={b} isAr={isAr} />
                        {" · "}
                        {t(`${nf(b.sent, false)} sent of ${nf(b.total, false)}`, `اتبعت ${nf(b.sent, true)} من ${nf(b.total, true)}`)}
                        {" · "}
                        {t(`up to ${b.dailyLimit}/day`, `حتى ${nf(b.dailyLimit, true)} في اليوم`)}
                        {(b.failed > 0 || b.skipped > 0) && (
                          <>
                            {" · "}
                            <button onClick={() => void showFailures(b)} className="underline">
                              {t(`${b.failed + b.skipped} not sent`, `${nf(b.failed + b.skipped, true)} متبعتتش`)}
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                    {(b.status === "running" || b.status === "paused") && (
                      <div className="flex items-center gap-2">
                        {b.status === "running" ? (
                          <button
                            onClick={() => void steer(b, "pause")}
                            disabled={!!busy}
                            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-ink hover:border-ink disabled:opacity-50"
                          >
                            <Pause size={13} /> {t("Pause", "إيقاف مؤقت")}
                          </button>
                        ) : (
                          <button
                            onClick={() => void steer(b, "resume")}
                            disabled={!!busy}
                            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-bold text-ink hover:border-ink disabled:opacity-50"
                          >
                            <Play size={13} /> {t("Resume", "كمّل")}
                          </button>
                        )}
                        <button
                          onClick={() => void steer(b, "cancel")}
                          disabled={!!busy}
                          className="rounded-xl px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger-tint disabled:opacity-50"
                        >
                          {t("Cancel", "إلغاء")}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full rounded-full bg-ink-slab transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  {b.status === "paused" && b.pausedReason && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-warn">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      {pausedReasonText(b.pausedReason, isAr)}
                    </p>
                  )}
                  {failures?.id === b.id && (
                    <div className="mt-3 max-h-56 overflow-auto rounded-xl bg-surface-subtle p-3 text-xs">
                      {failures.rows.length === 0 ? (
                        <p className="text-ink-muted">{t("Nothing to show.", "مفيش حاجة.")}</p>
                      ) : (
                        failures.rows.map((r, i) => (
                          <p key={i} className="flex justify-between gap-3 py-0.5">
                            <span className="font-semibold text-ink">{r.name || "—"}</span>
                            <span dir="ltr" className="text-ink-muted">{r.phone}</span>
                            <span className="text-ink-muted">{r.error}</span>
                          </p>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function pausedReasonText(reason: string, isAr: boolean): string {
  if (reason === "restricted") {
    return isAr
      ? "واتساب قيّد الرقم، فالسيستم وقّف الإرسال علشان يحميه. افتح واتساب على موبايل العيادة وشوف التحذير قبل ما تكمّل."
      : "WhatsApp restricted the number, so sending stopped to protect it. Check the clinic phone for a warning before resuming.";
  }
  if (reason === "disconnected") {
    return isAr ? "رقم العيادة اتفصل. امسح الـ QR تاني من الإعدادات وبعدين كمّل." : "The clinic's number disconnected. Scan the QR again in Settings, then resume.";
  }
  if (reason === "errors") {
    return isAr ? "حصلت أخطاء إرسال متتالية، فوقفنا احتياطي. جرّب تكمّل بعد شوية." : "Several sends failed in a row, so it paused as a precaution. Try resuming in a while.";
  }
  return reason;
}

function StatusWord({ b, isAr }: { b: BroadcastSummary; isAr: boolean }) {
  const map: Record<string, [string, string, string]> = {
    running: ["Sending", "شغالة", "text-ok"],
    paused: ["Paused", "متوقفة", "text-warn"],
    done: ["Finished", "خلصت", "text-ink"],
    cancelled: ["Cancelled", "اتلغت", "text-ink-muted"],
  };
  const [en, ar, cls] = map[b.status] || [b.status, b.status, "text-ink"];
  return <span className={`font-bold ${cls}`}>{isAr ? ar : en}</span>;
}

function LineBadge({ line, isAr }: { line: Line | undefined; isAr: boolean }) {
  if (!line) return null;
  const connected = line.onGateway && line.state === "open";
  const dot = connected ? "bg-emerald-400" : line.state === "restricted" ? "bg-red-400" : "bg-amber-400";
  const label = connected
    ? isAr ? "رقم العيادة متصل" : "Clinic number connected"
    : line.state === "restricted"
      ? isAr ? "الرقم مقيّد" : "Number restricted"
      : isAr ? "رقم العيادة مش مربوط" : "Clinic number not linked";
  return (
    <div className="space-y-1.5 rounded-2xl border border-white/10 px-4 py-3">
      <p className="flex items-center gap-2 font-bold">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
      </p>
      {line.phone && (
        <p dir="ltr" className="text-white/60 rtl:text-right">
          +{line.phone.replace(/\D/g, "")}
        </p>
      )}
      {connected && line.daysLinked !== null && (
        <p className="text-xs text-white/55">
          {isAr ? `مربوط من ${line.daysLinked} يوم` : `Linked ${line.daysLinked} day${line.daysLinked === 1 ? "" : "s"} ago`}
          {line.dailyCap !== null && (isAr ? ` · المسموح النهارده ${line.dailyCap}` : ` · today's allowance ${line.dailyCap}`)}
        </p>
      )}
    </div>
  );
}

function ChecksList({ checks, isAr }: { checks: BroadcastCheck[]; isAr: boolean }) {
  if (checks.length === 1 && checks[0].id === "empty") return null;
  const order = { block: 0, warn: 1, good: 2 } as const;
  return (
    <ul className="space-y-1.5">
      {[...checks].sort((a, b) => order[a.level] - order[b.level]).map((c) => (
        <li key={c.id} className="flex items-start gap-2 text-[13px] leading-5">
          {c.level === "block" ? (
            <XCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          ) : c.level === "warn" ? (
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          ) : (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
          )}
          <span className={c.level === "block" ? "font-semibold text-danger" : c.level === "warn" ? "text-ink" : "text-ink-muted"}>{isAr ? c.ar : c.en}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewView(props: {
  review: BroadcastReview;
  stale: boolean;
  isAr: boolean;
  canAddVersion: boolean;
  onUse: () => void;
  onAddVersion: () => void;
}) {
  const { review, stale, isAr, canAddVersion, onUse, onAddVersion } = props;
  const t = (en: string, ar: string) => (isAr ? ar : en);
  const verdict = {
    safe: { en: "Safe to send", ar: "آمنة للإرسال", cls: "bg-ok-tint text-ok" },
    caution: { en: "Send with care", ar: "ابعت بحذر", cls: "bg-warn-tint text-warn" },
    risky: { en: "Risky — change it first", ar: "خطر — عدّلها الأول", cls: "bg-danger-tint text-danger" },
  }[review.verdict];
  return (
    <div className={`mt-4 space-y-3 border-t border-line pt-4 ${stale ? "opacity-60" : ""}`}>
      {stale && <p className="text-[11px] font-bold text-ink-muted">{t("You changed the message since this check.", "انت غيرت الرسالة من بعد المراجعة دي.")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-black ${verdict.cls}`}>{isAr ? verdict.ar : verdict.en}</span>
        <span className="font-figure text-2xl font-semibold text-ink">
          {review.score}
          <span className="font-sans text-xs font-bold text-ink-muted">/100</span>
        </span>
      </div>
      {review.summary && <p className="text-sm text-ink">{review.summary}</p>}
      {review.issues.length > 0 && (
        <ul className="space-y-2">
          {review.issues.map((i, k) => (
            <li key={k} className="text-[13px] leading-5">
              <span className={`me-1.5 font-black ${i.severity === "high" ? "text-danger" : i.severity === "medium" ? "text-warn" : "text-ink-muted"}`}>•</span>
              <span className="font-semibold text-ink">{i.problem}</span>
              {i.fix && <span className="text-ink-muted"> — {i.fix}</span>}
            </li>
          ))}
        </ul>
      )}
      {review.improved && (
        <div className="rounded-xl bg-surface-subtle p-3.5">
          <p className="text-[11px] font-bold text-ink-muted">{t("Suggested wording", "الصياغة المقترحة")}</p>
          <p dir="auto" className="mt-1.5 whitespace-pre-wrap text-[14px] leading-6 text-ink">{review.improved}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onUse} className="rounded-xl bg-ink-slab px-3.5 py-1.5 text-xs font-bold text-white hover:bg-ink-strong">
              {t("Use this", "استخدم دي")}
            </button>
            {canAddVersion && (
              <button onClick={onAddVersion} className="rounded-xl border border-line px-3.5 py-1.5 text-xs font-bold text-ink hover:border-ink">
                {t("Add as another version", "ضيفها كنسخة تانية")}
              </button>
            )}
          </div>
        </div>
      )}
      {review.tips.length > 0 && (
        <ul className="space-y-1 text-xs text-ink-muted">
          {review.tips.map((tip, k) => (
            <li key={k}>— {tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanBars({ plan }: { plan: number[] }) {
  if (plan.length < 2) return null;
  const max = Math.max(...plan);
  const shown = plan.slice(0, 21);
  return (
    <div className="mt-3 flex h-10 items-end gap-[3px]" aria-hidden>
      {shown.map((n, i) => (
        <div key={i} className="flex-1 rounded-t-sm bg-ink-slab/80" style={{ height: `${Math.max(8, (n / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function SafetyExplainer({ isAr }: { isAr: boolean }) {
  const points = isAr
    ? {
        ban: [
          ["القفل نهائي.", "لما واتساب يقفل رقم بسبب سبام، مفيش طريقة مضمونة ترجعه. الرقم اللي المرضى عارفينه بيروح، ومعاه كل المحادثات."],
          ["القفل مبيحصلش من أول رسالة.", "واتساب بيحسب للرقم \"سمعة\" على مدار أيام: كام واحد عمل بلوك أو بلّغ، كام واحد رد، الرقم جديد ولا قديم، وبيبعت قد إيه فجأة. الأول بييجي تقييد مؤقت أو تحذير، والقفل النهائي بيحصل لما ده يتكرر."],
          ["اللي بيقفل الأرقام:", "رسالة واحدة بالظبط لمئات الناس في وقت قصير، لينكات في أول رسالة، ناس كتير تعمل بلوك أو تبلّغ، ورقم لسه مربوط جديد يبعت كتير."],
        ],
        system: [
          "بيبعت من ١٠ الصبح لـ ٩ بالليل بس، وبين كل رسالة والتانية من ١٠ لـ ٣٠ ثانية — زي موظفة بتبعت بإيدها.",
          "الرقم الجديد بيبدأ بعدد قليل في اليوم ويزود على مدار أسبوع، وبيسيب ربع المسموح للتذكيرات والتأكيدات.",
          "اللي طلب إيقاف قبل كده مش هيوصله حاجة، واللي يبعت STOP دلوقتي بيتشال فوراً.",
          "رسالة واحدة بس لكل رقم، حتى لو العيلة كلها متسجلة عليه.",
          "الأرقام اللي ملهاش واتساب بتتساب، وكل مريض بيتسلّم عليه باسمه.",
          "لو واتساب قيّد الرقم، السيستم بيوقف الإرسال كله لوحده ومبيكملش غير لما انت تقول.",
        ],
        you: [
          "ابعت من رقم العيادة القديم اللي المرضى عارفينه وحافظينه، مش شريحة جديدة.",
          "رد على كل اللي بيرد في نفس اليوم — الردود هي أكبر حماية للرقم.",
          "افتح واتساب على موبايل العيادة كل يوم وانت الرسالة شغالة، ولو ظهر أي تحذير دوس \"إيقاف مؤقت\" هنا.",
        ],
      }
    : {
        ban: [
          ["A ban is permanent.", "When WhatsApp bans a number for spam there is no dependable way back. The number your patients know is gone, and its chats with it."],
          ["It does not happen on the first message.", "WhatsApp scores a number over days: how many people block or report it, how many reply, how old it is, and how suddenly it sends a lot. Temporary restrictions and warnings come first; the permanent ban comes when that keeps happening."],
          ["What gets numbers banned:", "the same text to hundreds of people in a short time, links in a first message, many blocks or reports, and a newly linked number sending a lot."],
        ],
        system: [
          "Sends only from 10:00 to 21:00, with 10–30 seconds between messages — like a receptionist sending by hand.",
          "A newly linked number starts with a few a day and speeds up over a week, leaving a quarter of the allowance for reminders and confirmations.",
          "Anyone who asked to stop gets nothing, and anyone who replies STOP now is removed at once.",
          "One message per number, even when a whole family is registered on it.",
          "Numbers without WhatsApp are skipped, and every patient is greeted by name.",
          "If WhatsApp restricts the number, the system stops all sending by itself and does not restart until you say so.",
        ],
        you: [
          "Send from the clinic's old number that patients already know and have saved — not a new SIM.",
          "Answer everyone who replies the same day. Replies are the strongest protection a number has.",
          "Open WhatsApp on the clinic phone every day while it runs; if a warning appears, press Pause here.",
        ],
      };
  return (
    <div className="grid gap-6 border-t border-line px-5 py-5 md:grid-cols-3">
      <div className="space-y-3">
        {points.ban.map(([head, body]) => (
          <p key={head} className="text-[13px] leading-6 text-ink-body">
            <span className="font-black text-ink">{head}</span> {body}
          </p>
        ))}
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-ink">{isAr ? "السيستم بيحميك إزاي" : "How the system protects you"}</p>
        <ul className="mt-2 space-y-2">
          {points.system.map((p) => (
            <li key={p} className="flex gap-2 text-[13px] leading-5 text-ink-body">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" /> {p}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-ink">{isAr ? "المطلوب منك" : "What you do"}</p>
        <ul className="mt-2 space-y-2">
          {points.you.map((p) => (
            <li key={p} className="flex gap-2 text-[13px] leading-5 text-ink-body">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" /> {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
