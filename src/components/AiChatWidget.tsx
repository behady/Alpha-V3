"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, Send, Loader2, Trash2, Zap, AlertTriangle, GraduationCap, Sparkles, MessageCircle, LifeBuoy, Bug, Lightbulb, Camera, ImagePlus } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useTutorial } from "@/context/TutorialContext";
import { hasFeature, getAiCreditLimit } from "@/lib/subscriptions";
import { getClinicDoc } from "@/lib/db-utils";
import { auth } from "@/lib/firebase";
import { handleManualWhatsApp } from "@/lib/whatsappManual";
import { printAssistantDocument } from "@/lib/assistantDocumentPdf";
import { installErrorBreadcrumbs, getErrorBreadcrumbs } from "@/lib/errorBreadcrumbs";
import { TUTORIALS, tutorialsFor } from "@/lib/tutorials";
import { RECEPTIONIST_NAME } from "@/lib/receptionist";
import AvatarFace from "@/components/appointments/AvatarFace";
import AssistantMarkdown from "@/components/ai/AssistantMarkdown";
import { onSnapshot } from "firebase/firestore";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  /** Data-URL of an image the user attached to this message — rendered as a thumbnail. */
  image?: string;
}

/**
 * A destructive action the assistant has staged but not performed. The summary comes from the
 * stored document, not from the model's description of it, so what is shown here is the record
 * that will actually be deleted.
 */
interface PendingAction {
  id: string;
  kind: "delete";
  collection: string;
  documentId: string;
  summary: Record<string, unknown>;
}

/**
 * A support ticket the assistant has composed but NOT sent. It renders as a card the user reads,
 * and only their Send button reaches /api/support/ticket — where the screenshot and recent error
 * logs are attached, because only this browser has them.
 */
interface TicketDraft {
  kind: "bug" | "feature";
  title: string;
  description: string;
  steps?: string;
  contactNumber: string;
}

type AssistantMode = "normal" | "trainer" | "support";

/**
 * "Cancel the tutorial", as typed at the chat in either language.
 *
 * Matched locally, before any request: cancelling a lesson must be instant and free, not a model
 * round-trip that spends a credit deciding what "خلاص" means. Word-boundary-ish on purpose — the
 * words appear alone or in short phrases ("cancel it", "وقف الشرح"), and a longer sentence that
 * merely contains one ("how do I cancel an appointment?") only matches while a tutorial is
 * actually running, where reading it as "stop the lesson" is the safer of the two readings.
 */
const CANCEL_TUTORIAL_RE = /(cancel|stop|end|quit|إلغاء|الغاء|الغيه|إلغيه|وقف|أوقف|اوقف|خلاص|كفاية)/i;

export default function AiChatWidget() {
  const { clinic, clinicId, isAdmin } = useClinic();
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const { receptionPanelActive } = useUI();
  const { activeTutorial, startTutorial, cancelTutorial } = useTutorial();
  const isAr = language === "ar";
  const router = useRouter();
  const alphaName = isAr ? RECEPTIONIST_NAME.ar : RECEPTIONIST_NAME.en;

  /**
   * Which corner this widget lives in.
   *
   * It normally sits opposite the reading direction (bottom-right in LTR). The reception assistant
   * fills that same corner with its composer, so while that panel is open this moves to the other
   * side — hiding it would take away the clinic-wide assistant on the one screen people use most.
   */
  const onFarSide = receptionPanelActive ? !isRTL : isRTL;
  const cornerClass = onFarSide ? "left-4 sm:left-6" : "right-4 sm:right-6";
  const launcherCornerClass = onFarSide ? "left-5" : "right-5";

  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [resolvingAction, setResolvingAction] = useState(false);

  const [assistantMode, setAssistantMode] = useState<AssistantMode>("normal");
  const [attachScreenshot, setAttachScreenshot] = useState(true);
  const [sendingTicket, setSendingTicket] = useState(false);

  /**
   * Three hats, three conversations.
   *
   * Each mode keeps its own thread and its own staged cards. Switching hats mid-thought must not
   * bleed a support triage into the trainer's lesson chat, and a delete-confirmation staged in
   * normal mode has to still be there when the user comes back to normal mode. Every async
   * handler captures the mode it STARTED in, so a reply that arrives after the user switched
   * hats lands in the thread that asked for it, not the one on screen.
   */
  const [threads, setThreads] = useState<Record<AssistantMode, ChatMessage[]>>({
    normal: [], trainer: [], support: [],
  });
  const [pendingActions, setPendingActions] = useState<Record<AssistantMode, PendingAction | null>>({
    normal: null, trainer: null, support: null,
  });
  const [ticketDrafts, setTicketDrafts] = useState<Record<AssistantMode, TicketDraft | null>>({
    normal: null, trainer: null, support: null,
  });
  /** Which mode's request is in flight — the spinner shows only in that mode's thread. */
  const [loadingMode, setLoadingMode] = useState<AssistantMode | null>(null);

  const messages = threads[assistantMode];
  const pendingAction = pendingActions[assistantMode];
  const ticketDraft = ticketDrafts[assistantMode];
  const isLoading = loadingMode !== null;

  const pushMessage = (mode: AssistantMode, msg: ChatMessage) =>
    setThreads((prev) => ({ ...prev, [mode]: [...prev[mode], msg] }));
  const setPendingFor = (mode: AssistantMode, v: PendingAction | null) =>
    setPendingActions((prev) => ({ ...prev, [mode]: v }));
  const setDraftFor = (mode: AssistantMode, v: TicketDraft | null) =>
    setTicketDrafts((prev) => ({ ...prev, [mode]: v }));

  /**
   * An image staged in the composer, as a data-URL — an X-ray, a photo, a screenshot. Sent with
   * the next message; the server prices an image turn at 3 credits, which the preview chip says
   * out loud. Composer-level, not per-mode: it belongs to the message being typed, not a thread.
   */
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Error breadcrumbs start collecting the moment the dashboard loads — a bug report filed an
  // hour later carries whatever fired in between. The chosen mode survives reloads.
  useEffect(() => {
    installErrorBreadcrumbs();
    try {
      const saved = localStorage.getItem("alphaAssistantMode");
      if (saved === "trainer" || saved === "support") setAssistantMode(saved);
    } catch { /* default stands */ }
  }, []);

  const switchMode = (m: AssistantMode) => {
    setAssistantMode(m);
    try { localStorage.setItem("alphaAssistantMode", m); } catch { /* fine */ }
  };

  const canUseAi = hasFeature(clinic, "aiChat");
  const totalLimit = getAiCreditLimit(clinic);
  const monthKey = new Date().toISOString().slice(0, 7);

  // Listen to live monthly credit usage for this clinic
  useEffect(() => {
    if (!clinicId || !canUseAi) return;

    const unsub = onSnapshot(getClinicDoc("ai_usage", monthKey), (snap) => {
      if (snap.exists()) {
        setCreditsUsed(Number(snap.data()?.creditsUsed) || 0);
      } else {
        setCreditsUsed(0);
      }
    });

    return () => unsub();
  }, [clinicId, monthKey, canUseAi]);

  const remainingCredits = Math.max(0, totalLimit - creditsUsed);
  const lowCredits = remainingCredits < totalLimit * 0.1;

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isLoading]);

  if (!canUseAi) return null;

  /**
   * A lesson owns the screen. The launcher orb sits exactly where the tutorial's instruction card
   * needs to be on a phone, and a chat panel over a walkthrough would cover the thing the ring is
   * pointing at. Cancelling is the overlay's job (its button, or Escape) while this is hidden.
   */
  if (activeTutorial) return null;

  const handleResolveAction = async (decision: "approve" | "reject") => {
    if (!pendingAction || resolvingAction) return;
    // Everything below lands in the thread whose card was tapped, even if the user switches
    // hats while the request runs.
    const mode = assistantMode;
    setResolvingAction(true);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");

      const response = await fetch("/api/gemini/confirm-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicId, actionId: pendingAction.id, decision, userName: user?.name }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not complete that action.");

      // A staged WhatsApp message on a clinic with no gateway comes back approved but unsent,
      // carrying the composed text. Offer to open WhatsApp instead of claiming it went out.
      if (data.manual?.phone && data.manual?.text) {
        handleManualWhatsApp({ phone: data.manual.phone, text: data.manual.text });
      }

      pushMessage(mode, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          decision !== "approve"
            ? (isAr ? "تم الإلغاء. لم يتم حذف أي شيء." : "Cancelled — nothing was deleted.")
            : data.manual
              ? (isAr
                  ? "✅ الرسالة جاهزة — افتح واتساب من التنبيه عشان تبعتها."
                  : "✅ Message ready — open WhatsApp from the prompt to send it.")
              : (isAr ? "✅ تم تنفيذ الطلب." : "✅ Done."),
        timestamp: new Date(),
      });
      setPendingFor(mode, null);
    } catch (err: any) {
      pushMessage(mode, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${err.message || (isAr ? "حدث خطأ غير متوقع" : "An unexpected error occurred")}`,
        timestamp: new Date(),
      });
      // Clear either way: a failed confirmation must not leave a button that looks actionable.
      setPendingFor(mode, null);
    } finally {
      setResolvingAction(false);
    }
  };

  /**
   * Stages a picked image, downscaled in the browser before it goes anywhere.
   *
   * A phone photo is 5–15 MB, and both the model API and the request body have limits an
   * unscaled upload would trip; ~1600px JPEG keeps an X-ray or a screenshot perfectly readable
   * at a fraction of the size. The input's value is cleared so picking the same file twice in a
   * row still fires the change event.
   */
  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPendingImage(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  };

  /**
   * A JPEG of what the user is looking at, for the bug ticket.
   *
   * html2canvas is imported on demand — it is a heavy library and this is its only use in the
   * widget. Scaled to ~1280px wide and compressed: the shot rides inside a Firestore document
   * and an email, not an art gallery. Any failure returns "" — a ticket must never die on its
   * attachment.
   */
  const captureScreenshot = async (): Promise<string> => {
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        scale: Math.min(1, 1280 / Math.max(1, window.innerWidth)),
      });
      return canvas.toDataURL("image/jpeg", 0.65);
    } catch {
      return "";
    }
  };

  const handleSendTicket = async () => {
    if (!ticketDraft || sendingTicket) return;
    const mode = assistantMode;
    const draft = ticketDraft;
    setSendingTicket(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");

      let screenshot = "";
      if (attachScreenshot) {
        // The panel would sit in its own screenshot, covering the very screen being reported —
        // so it steps aside for the shot and comes straight back.
        setIsOpen(false);
        await new Promise((r) => setTimeout(r, 400));
        screenshot = await captureScreenshot();
        setIsOpen(true);
      }

      const response = await fetch("/api/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          clinicId,
          kind: draft.kind,
          title: draft.title,
          description: draft.description,
          steps: draft.steps || "",
          contactNumber: draft.contactNumber,
          screenshot,
          errors: getErrorBreadcrumbs(),
          route: window.location.pathname,
          userAgent: navigator.userAgent,
          userName: user?.name,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not send the ticket.");

      const sentLine = data.emailSent
        ? (isAr
            ? `✅ اتبعت للدعم الفني — التذكرة رقم ${data.ticketId}. هيتواصلوا معاك على ${draft.contactNumber}.`
            : `✅ Sent to the support team — ticket ${data.ticketId}. They'll reach you on ${draft.contactNumber}.`)
        : (isAr
            ? `✅ اتسجلت للدعم الفني — التذكرة رقم ${data.ticketId}. هيشوفوها في النظام وهيتواصلوا معاك على ${draft.contactNumber}.`
            : `✅ Logged for the support team — ticket ${data.ticketId}. They'll see it in the system and reach you on ${draft.contactNumber}.`);
      pushMessage(mode, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: sentLine,
        timestamp: new Date(),
      });
      setDraftFor(mode, null);
    } catch (err: any) {
      // The draft stays on screen: unlike a destructive action, retrying a ticket is safe, and
      // losing a composed report to a network blip would mean dictating it all over again.
      pushMessage(mode, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${err.message || (isAr ? "تعذر الإرسال — جرب تاني." : "Could not send — try again.")}`,
        timestamp: new Date(),
      });
    } finally {
      setSendingTicket(false);
    }
  };

  /** Starts a lesson from the menu — no model, no credit, the ring appears immediately. */
  const handleStartLesson = (id: string) => {
    const mode = assistantMode;
    const tutorial = TUTORIALS.find((t) => t.id === id);
    if (!startTutorial(id) || !tutorial) return;
    pushMessage(mode, {
      id: Date.now().toString(),
      role: "assistant",
      content: isAr
        ? `يلا بينا — درس "${tutorial.title.ar}". امشي ورا الدايرة النابضة، ولو حبيت توقف اضغط إلغاء أو Esc.`
        : `Let's go — "${tutorial.title.en}". Follow the pulsing ring; press Cancel or Esc any time to stop.`,
      timestamp: new Date(),
    });
    setIsOpen(false);
  };

  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = customText || inputMessage;
    // An attached image alone is a legitimate message; the question is implied.
    const image = customText ? null : pendingImage;
    if ((!textToSend.trim() && !image) || isLoading) return;

    // The mode this message belongs to — the reply lands here even if the user switches hats
    // while it is in flight, and the history sent is this thread's, not whichever is on screen.
    const mode = assistantMode;
    const outgoingHistory = threads[mode].map(m => ({ role: m.role, parts: [{ text: m.content }] }));

    setInputMessage("");
    setPendingImage(null);
    setLoadingMode(mode);

    const prompt = textToSend.trim()
      || (isAr ? "اشرحلي الصورة دي." : "Analyze this image for me.");

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: prompt,
      timestamp: new Date(),
      ...(image ? { image } : {}),
    };
    pushMessage(mode, userMsg);

    try {
      // The API verifies this token and derives the caller's identity from it, so userId is no
      // longer sent in the body — the server would ignore it anyway.
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          prompt,
          ...(image ? { image } : {}),
          clinicId,
          userName: user?.name,
          // Tells the route which surface is asking, so it only offers the model tools this
          // client can actually carry out. Without it the floating widget is offered
          // 'open_appointment', whose whole job is to fill an appointment panel this widget
          // does not have — the model calls it, the server answers "Opened Khaled's 4 PM",
          // and nothing appears.
          client: "web-widget",
          // Which hat the assistant wears this turn — normal chat, patient trainer, or support
          // triage. Same brain and tools; the mode shifts emphasis server-side.
          assistantMode: mode,
          history: outgoingHistory
        })
      });

      if (!response.ok) {
         if (response.status === 429) {
           throw new Error(isAr ? "لقد استنفدت رصيد الذكاء الاصطناعي لهذا الشهر. يرجى الترقية." : "Monthly AI credit limit reached. Please upgrade.");
         } else if (response.status === 403) {
           throw new Error(isAr ? "ميزة الذكاء الاصطناعي غير متوفرة في باقتك الحالية." : "AI feature requires Pro or Premium tier.");
         }
         throw new Error("Failed to process with Gemini AI");
      }

      const data = await response.json();

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || "...",
        timestamp: new Date(),
      };

      pushMessage(mode, assistantMsg);

      // The server stages deletions rather than performing them; nothing is removed until this
      // prompt is answered.
      if (data.pendingAction) setPendingFor(mode, data.pendingAction as PendingAction);

      /**
       * Everything below is the assistant asking THIS client to do something.
       *
       * The route can end a turn with `navigateTo`, `triggerPdf` or `startTutorial` instead of a
       * plain answer, and this widget used to read only `reply` and `pendingAction` — so "Opening
       * Ahmed's file…" printed in the bubble and the screen never changed. Every key the server
       * can return has to be honoured here, or honestly refused; silently dropping one is the
       * worst of the three.
       */
      if (typeof data.navigateTo === "string" && data.navigateTo) {
        // Closed on purpose: the panel is a large overlay, and leaving it up means "open the
        // patient's file" ends with the file hidden behind the thing that opened it. The
        // conversation is kept in state, so reopening resumes it.
        setIsOpen(false);
        router.push(data.navigateTo);
      }

      if (data.triggerPdf?.title && data.triggerPdf?.content) {
        printAssistantDocument({
          title: String(data.triggerPdf.title),
          content: String(data.triggerPdf.content),
          ar: isAr,
          clinicName: clinic?.name,
        });
      }

      // The model chose a lesson. Close the panel so the ring owns the screen.
      if (typeof data.startTutorial?.id === "string") {
        if (startTutorial(data.startTutorial.id)) setIsOpen(false);
      }

      // A composed support ticket. Rendered as a card; nothing leaves until the user hits Send.
      if (data.ticketDraft?.title && (data.ticketDraft.kind === "bug" || data.ticketDraft.kind === "feature")) {
        setDraftFor(mode, data.ticketDraft as TicketDraft);
        // A screenshot usually helps a bug and rarely helps a wish.
        setAttachScreenshot(data.ticketDraft.kind === "bug");
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${err.message || (isAr ? "حدث خطأ غير متوقع" : "An unexpected error occurred")}`,
        timestamp: new Date(),
      };
      pushMessage(mode, errorMsg);
    } finally {
      setLoadingMode(null);
    }
  };

  /**
   * Intercepts a typed "cancel" while a lesson runs — locally, instantly, and without a credit.
   * (Unreachable while the widget is hidden during a tutorial, but kept for the moment the panel
   * returns before state settles, and it documents the contract: cancelling is never billable.)
   */
  const submitMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (activeTutorial && CANCEL_TUTORIAL_RE.test(inputMessage)) {
      cancelTutorial();
      setInputMessage("");
      pushMessage(assistantMode, {
        id: Date.now().toString(),
        role: "assistant",
        content: isAr ? "تم إيقاف الدرس." : "Tutorial cancelled.",
        timestamp: new Date(),
      });
      return;
    }
    void handleSendMessage(e);
  };

  const suggestionPrompts: { label: string; prompt: string }[] = isAr
    ? [
        { label: "مواعيد النهارده", prompt: "ايه مواعيد النهارده؟" },
        { label: "دخل الشهر", prompt: "اعمللي ملخص مالي للشهر ده" },
        { label: "افتح ملف مريض", prompt: "افتح ملف المريض " },
      ]
    : [
        { label: "Today's appointments", prompt: "What are today's appointments?" },
        { label: "This month's revenue", prompt: "Give me a financial summary for this month" },
        { label: "Open a patient's file", prompt: "Open the file of patient " },
      ];

  return (
    <>
      {/* Floating launcher — the same orb as the reception assistant, at coat-pocket size.
          Below lg the mobile bottom nav bar (fixed bottom-4, h-16, z-[80], opaque) owns the
          bottom 80px of the screen; bottom-5 sat entirely behind it, which is why the
          assistant never appeared on phones or tablets. bottom-24 clears the bar. */}
      <div className={`fixed bottom-24 lg:bottom-5 ${launcherCornerClass} z-50 transition-all duration-300`}>
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          title={alphaName}
          className="relative w-14 h-14 rounded-full bg-white/80 backdrop-blur-3xl border border-white/60 shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95"
        >
          <AvatarFace state={isLoading ? "thinking" : "idle"} size={44} />
          {lowCredits && (
            <span className="absolute -top-0.5 -end-0.5 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-white animate-pulse" />
          )}
        </button>
      </div>

      {/* The assistant panel — same glass shell as the reception panel beside the schedule. */}
      {isOpen && (
        <div
          className={`fixed bottom-44 lg:bottom-24 ${cornerClass} z-50 w-[calc(100vw-2rem)] sm:w-[400px] h-[560px] max-h-[calc(100dvh-13rem)] lg:max-h-[75vh] bg-white/80 backdrop-blur-3xl border border-white/60 shadow-[0_8px_40px_rgba(0,0,0,0.12)] rounded-[2rem] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200`}
          dir={isRTL ? "rtl" : "ltr"}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-slate-200/60">
            <div className="shrink-0">
              <AvatarFace state={isLoading ? "thinking" : "idle"} size={36} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-black text-sm text-slate-800 tracking-tight truncate">{alphaName}</h3>
              <p className="text-[10px] font-bold text-teal-600">
                {isAr ? "مساعدة العيادة" : "Clinic assistant"}
              </p>
            </div>
            <span
              title={isAr ? "رصيد الذكاء الاصطناعي المتبقي هذا الشهر" : "AI credits left this month"}
              className={`text-[10px] font-black px-2 py-1 rounded-full flex items-center gap-1 tabular-nums shrink-0 ${
                lowCredits ? "bg-rose-50 text-rose-600 border border-rose-200" : "bg-teal-50 text-teal-700 border border-teal-100"
              }`}
            >
              <Zap size={10} />
              {remainingCredits}
            </span>
            <button
              onClick={() => {
                setThreads((prev) => ({ ...prev, [assistantMode]: [] }));
                setPendingFor(assistantMode, null);
                setDraftFor(assistantMode, null);
                setPendingImage(null);
              }}
              title={isAr ? "مسح المحادثة" : "Clear chat"}
              className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors shrink-0"
            >
              <Trash2 size={15} />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {/* Mode switcher — one assistant, three hats. The mode shifts the persona server-side. */}
          <div className="shrink-0 px-4 pt-2.5 pb-1.5 flex gap-1.5 border-b border-slate-200/40">
            {([
              { id: "normal" as const, label: isAr ? "مساعدة" : "Assist", icon: MessageCircle },
              { id: "trainer" as const, label: isAr ? "تدريب" : "Trainer", icon: GraduationCap },
              { id: "support" as const, label: isAr ? "الدعم" : "Support", icon: LifeBuoy },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => switchMode(m.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-full text-[11px] font-black transition-colors ${
                  assistantMode === m.id
                    ? "bg-teal-600 text-white shadow-sm shadow-teal-600/20"
                    : "bg-white/70 text-slate-500 border border-slate-200 hover:text-teal-700 hover:border-teal-300"
                }`}
              >
                <m.icon size={12} />
                {m.label}
              </button>
            ))}
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="py-4 px-1 space-y-4">
                <div className="text-center space-y-2">
                  <div className="flex justify-center">
                    <AvatarFace state="idle" size={72} />
                  </div>
                  <h4 className="font-black text-slate-800 text-sm tracking-tight">
                    {isAr ? `أنا ${alphaName} — تحت أمرك.` : `I'm ${alphaName} — at your service.`}
                  </h4>
                  <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                    {assistantMode === "trainer"
                      ? (isAr
                          ? "وضع التدريب — اختار درس من تحت، أو اسألني «ازاي أعمل...» وأنا أوريك على الشاشة نفسها."
                          : "Trainer mode — pick a lesson below, or ask me \"how do I…\" and I'll show you on the real screen.")
                      : assistantMode === "support"
                        ? (isAr
                            ? "وضع الدعم — احكيلي المشكلة. هشوف الأول هي غلطة بيانات ولا عطل حقيقي، ولو عطل هجهزلك بلاغ للدعم الفني."
                            : "Support mode — tell me what's wrong. I'll check whether it's a data slip or a real fault, and if it's a fault I'll prepare a ticket for the support team.")
                        : (isAr
                            ? "اسألني عن المرضى والمواعيد والفلوس، أو خليني أعلّمك النظام خطوة بخطوة."
                            : "Ask me about patients, appointments and money — or let me teach you the system, step by step.")}
                  </p>
                </div>

                {/* Support mode: the two doors straight into a ticket. Real prompts, sent as typed. */}
                {assistantMode === "support" && (
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => void handleSendMessage(undefined, isAr ? "عايز أبلغ عن مشكلة في النظام" : "I want to report a bug in the system")}
                      className="text-start text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50/50 px-3 py-2 rounded-xl transition-colors flex items-center gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"><Bug size={11} /></span>
                      {isAr ? "أبلغ عن مشكلة" : "Report a bug"}
                    </button>
                    <button
                      onClick={() => void handleSendMessage(undefined, isAr ? "عندي اقتراح لميزة جديدة في النظام" : "I have an idea for a new feature")}
                      className="text-start text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/50 px-3 py-2 rounded-xl transition-colors flex items-center gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Lightbulb size={11} /></span>
                      {isAr ? "اقترح ميزة جديدة" : "Request a feature"}
                    </button>
                  </div>
                )}

                {/* Try-asking chips: each one is a real prompt, sent as typed. */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1">
                    <Sparkles size={10} /> {isAr ? "جرّب تسأل" : "Try asking"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestionPrompts.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => {
                          // The open-a-patient prompt needs a name typed after it, so it fills
                          // the composer instead of firing incomplete.
                          if (s.prompt.endsWith(" ")) setInputMessage(s.prompt);
                          else void handleSendMessage(undefined, s.prompt);
                        }}
                        className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50/50 px-3 py-1.5 rounded-full transition-colors"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lessons: start instantly, cost nothing, and point at the real screen. */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1">
                    <GraduationCap size={11} /> {isAr ? "علّمني" : "Teach me"}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {/* Only lessons this person can finish. A settings lesson offered to a
                        receptionist rings a tab their role cannot open and stalls on step one. */}
                    {tutorialsFor(isAdmin, user?.permissions).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleStartLesson(t.id)}
                        className="text-start text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50/50 px-3 py-2 rounded-xl transition-colors flex items-center gap-2"
                      >
                        <span className="w-5 h-5 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                          <GraduationCap size={11} />
                        </span>
                        {isAr ? t.title.ar : t.title.en}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                  msg.role === "user"
                    ? "bg-ink-slab text-white rounded-tr-sm whitespace-pre-wrap"
                    : "bg-white text-slate-700 border border-slate-200/60 rounded-tl-sm"
                }`}>
                  {/* An attached image renders above its caption, like any messenger. */}
                  {msg.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={msg.image} alt="" className="rounded-lg mb-2 max-h-44 w-auto" />
                  )}
                  {/* Same split as the appointment panel: typed text literal, model reply parsed. */}
                  {msg.role === "user" ? msg.content : <AssistantMarkdown content={msg.content} isRTL={isRTL} />}
                </div>
              </div>
            ))}
            {pendingAction && (
              <div className="flex justify-start">
                <div className="max-w-[90%] bg-white border border-rose-200 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
                  <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center gap-2">
                    <AlertTriangle size={13} className="text-rose-600 shrink-0" />
                    <p className="text-[11px] font-black uppercase tracking-widest text-rose-600">
                      {isAr ? "تأكيد الحذف" : "Confirm deletion"}
                    </p>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-[12px] text-slate-600 leading-relaxed">
                      {isAr
                        ? "سيتم حذف هذا السجل نهائياً. راجع التفاصيل قبل التأكيد:"
                        : "This record will be permanently deleted. Check the details before confirming:"}
                    </p>
                    <div className="rounded-xl bg-slate-50 border border-slate-200/60 px-3 py-2 space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {pendingAction.collection}
                      </p>
                      {Object.entries(pendingAction.summary).length === 0 ? (
                        <p className="text-[12px] font-mono text-slate-500">{pendingAction.documentId}</p>
                      ) : (
                        Object.entries(pendingAction.summary).map(([key, value]) => (
                          <div key={key} className="flex gap-2 text-[12px]">
                            <span className="text-slate-400 shrink-0">{key}</span>
                            <span className="font-bold text-slate-700 break-all">{String(value)}</span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleResolveAction("approve")}
                        disabled={resolvingAction}
                        className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                      >
                        {resolvingAction
                          ? (isAr ? "..." : "...")
                          : (isAr ? "حذف" : "Delete")}
                      </button>
                      <button
                        onClick={() => handleResolveAction("reject")}
                        disabled={resolvingAction}
                        className="flex-1 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-200 px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                      >
                        {isAr ? "إلغاء" : "Cancel"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* A composed support ticket. Everything on this card is what actually gets sent. */}
            {ticketDraft && (
              <div className="flex justify-start">
                <div className={`max-w-[92%] bg-white border rounded-2xl rounded-tl-sm shadow-sm overflow-hidden ${ticketDraft.kind === "bug" ? "border-rose-200" : "border-indigo-200"}`}>
                  <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${ticketDraft.kind === "bug" ? "bg-rose-50 border-rose-100" : "bg-indigo-50 border-indigo-100"}`}>
                    {ticketDraft.kind === "bug"
                      ? <Bug size={13} className="text-rose-600 shrink-0" />
                      : <Lightbulb size={13} className="text-indigo-600 shrink-0" />}
                    <p className={`text-[11px] font-black uppercase tracking-widest ${ticketDraft.kind === "bug" ? "text-rose-600" : "text-indigo-600"}`}>
                      {ticketDraft.kind === "bug"
                        ? (isAr ? "بلاغ عن مشكلة — للمراجعة" : "Bug report — review before sending")
                        : (isAr ? "طلب ميزة — للمراجعة" : "Feature request — review before sending")}
                    </p>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-[13px] font-black text-slate-800 leading-snug">{ticketDraft.title}</p>
                    <p className="text-[12px] text-slate-600 leading-relaxed whitespace-pre-wrap">{ticketDraft.description}</p>
                    {ticketDraft.steps && (
                      <div className="rounded-xl bg-slate-50 border border-slate-200/60 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                          {isAr ? "خطوات تكرار المشكلة" : "Steps to reproduce"}
                        </p>
                        <p className="text-[12px] text-slate-600 whitespace-pre-wrap leading-relaxed">{ticketDraft.steps}</p>
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500 space-y-0.5">
                      <p><span className="font-bold text-slate-600">{isAr ? "العيادة:" : "Clinic:"}</span> {clinic?.name || clinicId} <span className="font-mono text-[10px] text-slate-400">({clinicId})</span></p>
                      <p><span className="font-bold text-slate-600">{isAr ? "رقم التواصل:" : "Contact:"}</span> {ticketDraft.contactNumber}</p>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        checked={attachScreenshot}
                        onChange={(e) => setAttachScreenshot(e.target.checked)}
                        className="accent-teal-600 w-3.5 h-3.5"
                      />
                      <Camera size={12} className="text-slate-400" />
                      {isAr ? "إرفاق لقطة من الشاشة الحالية وسجل الأخطاء" : "Attach a screenshot of the current screen + error log"}
                    </label>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => void handleSendTicket()}
                        disabled={sendingTicket}
                        className={`flex-1 disabled:opacity-50 text-white px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98] ${ticketDraft.kind === "bug" ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
                      >
                        {sendingTicket ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال للدعم" : "Send to support")}
                      </button>
                      <button
                        onClick={() => setDraftFor(assistantMode, null)}
                        disabled={sendingTicket}
                        className="flex-1 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-200 px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                      >
                        {isAr ? "تجاهل" : "Discard"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {loadingMode === assistantMode && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200/60 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <Loader2 className="animate-spin text-teal-500" size={16} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-2" />
          </div>

          {/* Input Area */}
          <div className="shrink-0 px-4 pb-4 pt-2 border-t border-slate-100">
            {/* A staged image, shown before it costs anything — an image turn draws 3 credits. */}
            {pendingImage && (
              <div className="flex items-center gap-2.5 mb-2 bg-white border border-slate-200 rounded-xl px-2.5 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingImage} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-slate-100" />
                <span className="text-[11px] font-bold text-slate-600 flex-1 min-w-0 truncate">
                  {isAr ? "الصورة هتتبعت مع رسالتك الجاية" : "Image will be sent with your next message"}
                </span>
                <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                  <Zap size={9} /> 3
                </span>
                <button
                  onClick={() => setPendingImage(null)}
                  className="w-6 h-6 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center transition-colors shrink-0"
                  aria-label={isAr ? "إزالة الصورة" : "Remove image"}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <form onSubmit={submitMessage} className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-500/10 transition-all">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePickImage}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title={isAr ? "إرفاق صورة — أشعة، صورة، لقطة شاشة" : "Attach an image — X-ray, photo, screenshot"}
                className={`absolute start-2 shrink-0 p-2 rounded-lg transition-colors ${pendingImage ? "text-teal-600 bg-teal-50" : "text-slate-400 hover:text-teal-600 hover:bg-teal-50"} disabled:opacity-50`}
              >
                <ImagePlus size={16} />
              </button>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={isAr ? `اسأل ${alphaName}...` : `Ask ${alphaName}...`}
                className="w-full bg-transparent border-none text-sm ps-12 pe-12 py-3.5 focus:outline-none text-slate-700 placeholder:text-slate-400"
                dir={isRTL ? "rtl" : "ltr"}
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={(!inputMessage.trim() && !pendingImage) || isLoading}
                className="absolute end-2 shrink-0 text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:hover:bg-teal-600 p-2 rounded-lg transition-all"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className={isRTL ? "rotate-180" : ""} />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
