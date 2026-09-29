"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, setDoc } from "firebase/firestore";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { getClinicDoc } from "@/lib/db-utils";
import { isUnlocked } from "@/lib/featureCatalog";
import { logActivity } from "@/lib/logger";
import { PRIVATE_PAYER_ID, parsePayers } from "@/lib/payers";
import { WHATSAPP_SETTINGS_DOC_REF } from "@/types/whatsapp";
import {
  SETUP_FACT_KEYS,
  answersFromSettings,
  clampAnswerMode,
  insuranceFactFrom,
  normalizeLink,
  whatsappDocFromAnswers,
  type AnswerMode,
  type SetupFactKey,
  type WhatsAppAllowance,
  type WhatsAppAnswers,
} from "@/lib/setupWizard";

/**
 * Setup step: decide what the clinic's WhatsApp does, one plain question at a time.
 *
 * Every question maps to exactly one switch that already exists on Settings → WhatsApp / Bot, and
 * the answers are prefilled from what is stored — so this is a guided door into those screens, not
 * a second copy of them. Nothing is written until the last screen, which reads the answers back as
 * sentences ("patients get a reminder the day before") before one Save.
 *
 * Questions about things the plan does not include are not asked; the summary says they are
 * locked instead of pretending they were answered.
 */

type QuestionId = "messages" | "recall" | "reviews" | "reviewLink" | "answerMode" | "strangers" | "confirm" | "persona" | "facts" | "summary";

export default function WhatsAppQuestionsStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { clinic, clinicId } = useClinic();
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";
  const Forward = isRTL ? ArrowLeft : ArrowRight;
  const Back = isRTL ? ArrowRight : ArrowLeft;

  const allowed: WhatsAppAllowance = useMemo(
    () => ({
      messages: isUnlocked(clinic, "whatsappIntegration"),
      bot: isUnlocked(clinic, "whatsappBot"),
      ai: isUnlocked(clinic, "aiChat"),
    }),
    [clinic]
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [a, setA] = useState<WhatsAppAnswers>(() => answersFromSettings(undefined));
  const [reviewUrl, setReviewUrl] = useState("");
  const [hadReviewUrl, setHadReviewUrl] = useState(false);
  const [hadMapsUrl, setHadMapsUrl] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const [wa, info, payers] = await Promise.all([
          getDoc(getClinicDoc(WHATSAPP_SETTINGS_DOC_REF.collection, WHATSAPP_SETTINGS_DOC_REF.docId)),
          getDoc(getClinicDoc("settings", "clinic_info")),
          getDoc(getClinicDoc("settings", "payers")),
        ]);
        if (cancelled) return;
        const next = answersFromSettings(wa.exists() ? (wa.data() as Record<string, unknown>) : undefined);
        next.answerMode = clampAnswerMode(next.answerMode, allowed);
        const infoData = (info.data() ?? {}) as Record<string, unknown>;
        const review = typeof infoData.googleReviewUrl === "string" ? infoData.googleReviewUrl.trim() : "";
        const maps = typeof infoData.googleMapsUrl === "string" ? infoData.googleMapsUrl.trim() : "";
        setHadReviewUrl(Boolean(review));
        setHadMapsUrl(Boolean(maps));
        setReviewUrl(review);
        if (!next.facts.mapsUrl && maps) next.facts.mapsUrl = maps;
        // The insurers the previous step just set up are the answer to "do you take insurance?".
        if (!next.facts.insurance) {
          const names = parsePayers(payers.exists() ? payers.data() : null)
            .filter((p) => p.id !== PRIVATE_PAYER_ID && p.active)
            .map((p) => (ar ? p.nameAr || p.name : p.name));
          next.facts.insurance = insuranceFactFrom(names, ar ? "ar" : "en");
        }
        setA(next);
      } catch {
        // Unknown state reads as the recommended defaults; the summary shows exactly what will be saved.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const botOn = clampAnswerMode(a.answerMode, allowed) !== "off";

  /** The questions that apply, recomputed as answers change ("no bot" removes the bot questions). */
  const questions: QuestionId[] = useMemo(() => {
    const q: QuestionId[] = [];
    if (allowed.messages) {
      q.push("messages");
      if (a.autoMessages) {
        q.push("recall", "reviews");
        if (a.reviews && !hadReviewUrl) q.push("reviewLink");
      }
    }
    if (allowed.bot) {
      q.push("answerMode");
      if (botOn) q.push("strangers", "confirm", "persona", "facts");
    }
    q.push("summary");
    return q;
  }, [allowed, a.autoMessages, a.reviews, hadReviewUrl, botOn]);

  const current = questions[Math.min(index, questions.length - 1)];
  const next = () => setIndex((i) => Math.min(i + 1, questions.length - 1));
  const back = () => setIndex((i) => Math.max(i - 1, 0));
  /** A yes/no answer moves on by itself — one tap per question. */
  const answer = (patch: Partial<WhatsAppAnswers>) => {
    setA((prev) => ({ ...prev, ...patch }));
    // After the state update the question list may have grown or shrunk; advancing by position
    // is still right because every question an answer adds or removes comes after it.
    setIndex((i) => i + 1);
  };
  const setFact = (k: SetupFactKey, v: string) => setA((prev) => ({ ...prev, facts: { ...prev.facts, [k]: v } }));

  const t = {
    progress: (n: number, of: number) => (ar ? `سؤال ${n} من ${of}` : `Question ${n} of ${of}`),
    yes: ar ? "أيوه" : "Yes",
    no: ar ? "لأ" : "No",
    next: ar ? "التالي" : "Next",
    back: ar ? "رجوع" : "Back",
    skip: ar ? "تعدّي الخطوة دي" : "Skip this step",
    save: ar ? "حفظ وابدأ" : "Save & start",
    saved: ar ? "تم الحفظ" : "Saved",
    failed: ar ? "فشل الحفظ. جرّب تاني." : "Save failed. Try again.",
    recommended: ar ? "مقترح" : "Recommended",
    nothing: ar
      ? "باقة العيادة مش فيها رسائل واتساب ولا البوت، فمفيش حاجة تتظبط هنا دلوقتي."
      : "This clinic's plan includes neither WhatsApp messages nor the bot, so there is nothing to set here yet.",
  };

  const Q: Record<Exclude<QuestionId, "summary" | "facts">, { title: string; why: string }> = {
    messages: {
      title: ar
        ? "تحب المريض يوصله واتساب لما يحجز، وتذكير قبل ميعاده بيوم، وفاتورته بعد الزيارة؟"
        : "Should patients get a WhatsApp when they book, a reminder the day before, and their invoice after the visit?",
      why: ar ? "ده أكتر حاجة بتقلل المواعيد اللي بتضيع." : "This is what cuts missed appointments the most.",
    },
    recall: {
      title: ar
        ? "المريض اللي بقاله ٦ شهور ماجاش — نبعتله رسالة تفكّره بالكشف الدوري؟"
        : "Should patients who haven't visited in 6 months get a message inviting them back for a check-up?",
      why: ar ? "بترجّع مرضى قدام نسيوا، ومش بتتبعت أبداً لحد طلب يوقف الرسايل." : "It brings back patients who forgot, and is never sent to anyone who asked to stop.",
    },
    reviews: {
      title: ar
        ? "تاني يوم بعد الزيارة، نطلب من المريض يقيّمكم على جوجل؟"
        : "The day after a visit, should we ask the patient to rate you on Google?",
      why: ar ? "التقييمات بتجيب مرضى جداد من البحث والخريطة." : "Reviews bring new patients from search and Maps.",
    },
    reviewLink: {
      title: ar ? "حط لينك التقييم بتاع العيادة على جوجل" : "Paste the clinic's Google review link",
      why: ar
        ? "من غيره الرسالة مش هتتبعت. تلاقيه في Google Business Profile ← «اطلب تقييمات». تقدر تسيبه فاضي وتحطه بعدين من الإعدادات."
        : "Without it the message is not sent. Find it in Google Business Profile → Ask for reviews. You can leave it empty and add it later in Settings.",
    },
    answerMode: {
      title: ar ? "لما مريض يكتب على واتساب العيادة، مين يرد عليه؟" : "When a patient writes to the clinic's WhatsApp, who answers?",
      why: ar ? "تقدر تغيّر ده في أي وقت من الإعدادات." : "You can change this at any time in Settings.",
    },
    strangers: {
      title: ar
        ? "يرد كمان على أرقام لسه مش مرضى عندك — زي ناس جاية من إعلان أو لاقت رقمك؟"
        : "Should it also answer numbers that aren't your patients yet — people from an ad, or who found your number?",
      why: ar
        ? "لو بتعمل إعلانات قول أيوه. لو لأ، الأأمن إنه يرد على مرضاك بس."
        : "Say yes if you advertise. Otherwise it is safer to answer only your own patients.",
    },
    confirm: {
      title: ar ? "لما حد يحجز عن طريق واتساب، الميعاد يتأكد على طول؟" : "When someone books through WhatsApp, should the appointment be confirmed straight away?",
      why: ar
        ? "«لأ» يعني الحجز يستنى الاستقبال يراجعه ويأكده. السيستم مش بيحجز ميعادين في نفس الوقت في الحالتين."
        : "“No” means the booking waits for reception to check and confirm it. Either way, the system never double-books a slot.",
    },
    persona: {
      title: ar ? "المساعد يعرّف نفسه باسم إيه؟" : "What name should the assistant introduce itself with?",
      why: ar ? "مثلاً «سارة». سيبه فاضي لو مش عايز اسم." : "For example “Sara”. Leave it empty for no name.",
    },
  };

  const MODE_OPTIONS: Array<{ id: AnswerMode; label: string; hint: string; locked: boolean; rec?: boolean }> = [
    {
      id: "bot",
      label: ar ? "البوت" : "The bot",
      hint: ar ? "بيرد على الأسئلة المعروفة وبيحجز مواعيد. مجاني." : "Answers the common questions and books appointments. Free.",
      locked: !allowed.bot,
      rec: true,
    },
    {
      id: "both",
      label: ar ? "البوت + الذكاء الاصطناعي" : "Bot + AI",
      hint: ar ? "البوت الأول، والذكاء الاصطناعي يرد على اللي البوت مايعرفوش. بيستهلك رصيد." : "The bot first; AI answers what the bot can't. Uses AI credits.",
      locked: !allowed.bot || !allowed.ai,
    },
    {
      id: "ai",
      label: ar ? "الذكاء الاصطناعي" : "AI",
      hint: ar ? "بيتكلم زي موظف استقبال ويقود المحادثة للحجز. بيستهلك رصيد." : "Talks like a receptionist and leads the chat to a booking. Uses AI credits.",
      locked: !allowed.bot || !allowed.ai,
    },
    {
      id: "off",
      label: ar ? "محدش — الفريق يرد بنفسه" : "Nobody — the team answers",
      hint: ar ? "الرسايل تتجمع في «المحادثات»." : "Messages collect in Chats.",
      locked: false,
    },
  ];

  const FACTS: Record<SetupFactKey, { label: string; placeholder: string }> = {
    consultation: {
      label: ar ? "الكشف بكام؟" : "What does a consultation cost?",
      placeholder: ar ? "الكشف ٢٠٠ جنيه وبيتخصم من العلاج" : "200 EGP, deducted from the treatment",
    },
    installments: {
      label: ar ? "فيه تقسيط؟" : "Do you offer instalments?",
      placeholder: ar ? "أيوه، على ٣ أو ٦ شهور للزراعة والتقويم" : "Yes, over 3 or 6 months for implants and braces",
    },
    walkIn: {
      label: ar ? "ينفع ييجي من غير ميعاد؟" : "Can patients walk in without an appointment?",
      placeholder: ar ? "ينفع، بس الأولوية للي حاجز" : "Yes, but booked patients go first",
    },
    parking: {
      label: ar ? "فيه ركنة؟ والمدخل فين؟" : "Is there parking? Where's the entrance?",
      placeholder: ar ? "فيه جراج تحت العمارة، الدور التالت" : "Garage under the building, 3rd floor",
    },
    mapsUrl: {
      label: ar ? "لينك مكان العيادة على جوجل ماب" : "The clinic's Google Maps link",
      placeholder: "https://maps.app.goo.gl/…",
    },
    insurance: {
      label: ar ? "بتتعاملوا مع تأمين؟" : "Which insurance do you accept?",
      placeholder: ar ? "بنتعامل مع AXA وميدنت" : "We work with AXA and MedNet",
    },
  };

  const save = async () => {
    setSaving(true);
    try {
      const doc = whatsappDocFromAnswers(a, allowed);
      await setDoc(
        getClinicDoc(WHATSAPP_SETTINGS_DOC_REF.collection, WHATSAPP_SETTINGS_DOC_REF.docId),
        { ...doc, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      // The two links belong to the clinic profile; fill them there only if they were empty, so
      // this never overwrites what someone set on the profile screen.
      const profile: Record<string, string> = {};
      if (!hadReviewUrl && reviewUrl.trim()) profile.googleReviewUrl = normalizeLink(reviewUrl);
      if (!hadMapsUrl && a.facts.mapsUrl.trim() && botOn) profile.googleMapsUrl = normalizeLink(a.facts.mapsUrl);
      if (Object.keys(profile).length > 0) {
        await setDoc(getClinicDoc("settings", "clinic_info"), { ...profile, updatedAt: new Date().toISOString() }, { merge: true });
      }
      await logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, "WhatsApp settings updated (setup)", "settings/whatsapp");
      showToast(t.saved, "success");
      onDone();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  if (!clinicId || loading) {
    return (
      <div className="flex items-center justify-center py-10 text-ink-muted">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (!allowed.messages && !allowed.bot) {
    return (
      <div className="space-y-5">
        <p className="flex items-center gap-2 text-sm font-bold text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3">
          <Lock size={15} className="text-ink-muted" /> {t.nothing}
        </p>
        <div className="flex justify-end">
          <PrimaryButton onClick={onSkip}>{t.save}</PrimaryButton>
        </div>
      </div>
    );
  }

  const asked: QuestionId[] = questions.filter((q) => q !== "summary");
  const position = asked.indexOf(current) + 1;
  const inputCls =
    "w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all";

  return (
    <div className="space-y-6">
      {current !== "summary" && (
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-black uppercase tracking-widest text-ink-muted">{t.progress(position, asked.length)}</span>
          <span className="flex-1 h-1 rounded-full bg-surface-muted overflow-hidden">
            <span className="block h-full bg-ink-slab transition-all" style={{ width: `${(position / asked.length) * 100}%` }} />
          </span>
        </div>
      )}

      {/* ---------- yes / no questions ---------- */}
      {(current === "messages" || current === "recall" || current === "reviews" || current === "strangers" || current === "confirm") && (
        <YesNo
          title={Q[current].title}
          why={Q[current].why}
          value={
            current === "messages" ? a.autoMessages
            : current === "recall" ? a.recall
            : current === "reviews" ? a.reviews
            : current === "strangers" ? a.answerStrangers
            : a.autoConfirm
          }
          yes={t.yes}
          no={t.no}
          onAnswer={(v) =>
            answer(
              current === "messages" ? { autoMessages: v }
              : current === "recall" ? { recall: v }
              : current === "reviews" ? { reviews: v }
              : current === "strangers" ? { answerStrangers: v }
              : { autoConfirm: v }
            )
          }
        />
      )}

      {current === "reviewLink" && (
        <div className="space-y-4">
          <Heading title={Q.reviewLink.title} why={Q.reviewLink.why} />
          <input type="url" dir="ltr" value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/r/…" className={inputCls} />
        </div>
      )}

      {current === "answerMode" && (
        <div className="space-y-4">
          <Heading title={Q.answerMode.title} why={Q.answerMode.why} />
          <div className="grid gap-2 sm:grid-cols-2">
            {MODE_OPTIONS.map((opt) => {
              const active = clampAnswerMode(a.answerMode, allowed) === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  disabled={opt.locked}
                  onClick={() => answer({ answerMode: opt.id })}
                  className={`text-start rounded-xl border px-4 py-3 transition-colors ${
                    active ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line bg-surface-subtle hover:bg-surface-muted"
                  } ${opt.locked ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-black text-ink">
                    {opt.label}
                    {opt.locked && <Lock size={12} className="text-ink-muted" />}
                    {opt.rec && !opt.locked && (
                      <span className="ms-auto text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">{t.recommended}</span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {current === "persona" && (
        <div className="space-y-4">
          <Heading title={Q.persona.title} why={Q.persona.why} />
          <input type="text" value={a.personaName} maxLength={30} onChange={(e) => setA((p) => ({ ...p, personaName: e.target.value }))} placeholder={ar ? "سارة" : "Sara"} className={inputCls} />
        </div>
      )}

      {current === "facts" && (
        <div className="space-y-4">
          <Heading
            title={ar ? "أكتر أسئلة المرضى بيسألوها" : "The questions patients ask most"}
            why={
              ar
                ? "اكتب الإجابة بكلامك — البوت بيبعتها زي ما هي. أي خانة فاضية، البوت بيقول إن الاستقبال هيرد، ومش بيخمّن أبداً."
                : "Answer in your own words — the bot sends them exactly as written. Leave any box empty and the bot says reception will answer; it never guesses."
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {SETUP_FACT_KEYS.map((k) => (
              <label key={k} className="block">
                <span className="block text-xs font-black text-ink-muted mb-1.5">{FACTS[k].label}</span>
                <input
                  type={k === "mapsUrl" ? "url" : "text"}
                  dir={k === "mapsUrl" ? "ltr" : "auto"}
                  value={a.facts[k]}
                  onChange={(e) => setFact(k, e.target.value)}
                  placeholder={FACTS[k].placeholder}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {current === "summary" && <Summary a={a} allowed={allowed} reviewUrl={reviewUrl} ar={ar} />}

      {/* ---------- navigation ---------- */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <div className="flex items-center gap-4">
          {index > 0 && (
            <button type="button" onClick={back} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-muted hover:text-ink disabled:opacity-50">
              <Back size={15} /> {t.back}
            </button>
          )}
          <button type="button" onClick={onSkip} disabled={saving} className="text-sm font-bold text-ink-muted hover:text-ink disabled:opacity-50">
            {t.skip}
          </button>
        </div>
        {current === "summary" ? (
          <PrimaryButton onClick={() => void save()} busy={saving}>
            {t.save}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={next}>
            {t.next} <Forward size={15} />
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function Heading({ title, why }: { title: string; why: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-ink leading-snug">{title}</h3>
      <p className="text-sm font-medium text-ink-muted mt-1">{why}</p>
    </div>
  );
}

function YesNo({ title, why, value, yes, no, onAnswer }: { title: string; why: string; value: boolean; yes: string; no: string; onAnswer: (v: boolean) => void }) {
  return (
    <div className="space-y-4">
      <Heading title={title} why={why} />
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            onClick={() => onAnswer(v)}
            className={`rounded-xl border px-4 py-3.5 text-base font-black transition-colors ${
              value === v ? "border-accent bg-accent/5 ring-1 ring-accent text-ink" : "border-line bg-surface-subtle text-ink-body hover:bg-surface-muted"
            }`}
          >
            {v ? yes : no}
          </button>
        ))}
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, busy, children }: { onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="bg-accent hover:bg-accent-strong text-ink font-black py-3 px-6 rounded-xl transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/** The answers read back as what will actually happen, before anything is written. */
function Summary({ a, allowed, reviewUrl, ar }: { a: WhatsAppAnswers; allowed: WhatsAppAllowance; reviewUrl: string; ar: boolean }) {
  const mode = clampAnswerMode(a.answerMode, allowed);
  const lines: Array<{ on: boolean; text: string }> = [];
  if (allowed.messages) {
    lines.push({ on: a.autoMessages, text: ar ? "تأكيد الحجز، تذكير قبل الميعاد بيوم، والفاتورة" : "Booking confirmation, reminder the day before, and the invoice" });
    if (a.autoMessages) {
      lines.push({ on: a.recall, text: ar ? "رسالة للي غاب ٦ شهور" : "A message to patients away for 6 months" });
      lines.push({
        on: a.reviews && Boolean(reviewUrl.trim()),
        text: a.reviews && !reviewUrl.trim()
          ? ar ? "طلب تقييم جوجل — مستني لينك التقييم" : "Google review request — waiting for the review link"
          : ar ? "طلب تقييم على جوجل تاني يوم" : "A Google review request the next day",
      });
    }
  } else {
    lines.push({ on: false, text: ar ? "الرسائل الأوتوماتيكية — مش في الباقة" : "Automatic messages — not in your plan" });
  }
  const modeText: Record<AnswerMode, string> = {
    off: ar ? "محدش بيرد أوتوماتيك — الفريق بيرد من «المحادثات»" : "Nobody answers automatically — the team replies from Chats",
    bot: ar ? "البوت بيرد على المرضى" : "The bot answers patients",
    both: ar ? "البوت + الذكاء الاصطناعي بيردوا على المرضى" : "The bot + AI answer patients",
    ai: ar ? "الذكاء الاصطناعي بيرد على المرضى" : "AI answers patients",
  };
  if (allowed.bot) {
    lines.push({ on: mode !== "off", text: modeText[mode] });
    if (mode !== "off") {
      lines.push({ on: a.answerStrangers, text: ar ? "بيرد كمان على الأرقام الجديدة" : "Also answers new numbers" });
      lines.push({
        on: true,
        text: a.autoConfirm
          ? ar ? "حجوزات واتساب بتتأكد على طول" : "WhatsApp bookings are confirmed straight away"
          : ar ? "حجوزات واتساب بتستنى الاستقبال يأكدها" : "WhatsApp bookings wait for reception to confirm",
      });
      const filled = SETUP_FACT_KEYS.filter((k) => a.facts[k].trim()).length;
      lines.push({ on: filled > 0, text: ar ? `${filled} من ${SETUP_FACT_KEYS.length} إجابات جاهزة للبوت` : `${filled} of ${SETUP_FACT_KEYS.length} ready answers for the bot` });
    }
  } else {
    lines.push({ on: false, text: ar ? "البوت — مش في الباقة" : "The bot — not in your plan" });
  }

  return (
    <div className="space-y-4">
      <Heading
        title={ar ? "ده اللي هيحصل" : "Here's what will happen"}
        why={ar ? "راجع وبعدين احفظ. كل حاجة هنا تتغيّر بعدين من الإعدادات ← واتساب." : "Check, then save. Everything here can be changed later in Settings → WhatsApp."}
      />
      <ul className="divide-y divide-line border border-line rounded-2xl overflow-hidden">
        {lines.map((l) => (
          <li key={l.text} className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold ${l.on ? "text-ink" : "text-ink-muted"}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${l.on ? "bg-emerald-500 text-white" : "bg-surface-muted text-ink-faint"}`}>
              {l.on ? <Check size={12} /> : <span className="block w-1.5 h-0.5 bg-current rounded" />}
            </span>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
