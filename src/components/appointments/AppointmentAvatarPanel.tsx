"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  X, Send, Loader2, PencilLine, Zap, Sparkles, Lock, Wallet, CalendarClock, Stethoscope, FolderOpen,
  LogIn, MessageCircle, Mic, MicOff, Volume2, VolumeX, CalendarDays, Search, Radio, RadioTower,
} from "lucide-react";
import { onSnapshot, query, where, getDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { handleManualWhatsApp } from "@/lib/whatsappManual";
import { printAssistantDocument } from "@/lib/assistantDocumentPdf";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { hasFeature, getAiCreditLimit } from "@/lib/subscriptions";
import { getAppointmentStageLabel } from "@/lib/appointmentStages";
import { toSpeechText, pickVoice, trimForSpeech } from "@/lib/speechText";
import { RECEPTIONIST_NAME, findWakeCommand, isUsableCommand } from "@/lib/receptionist";
import AvatarFace, { type AvatarState } from "./AvatarFace";
import PendingActionCard, { type PendingAction } from "./PendingActionCard";
import AssistantMarkdown from "@/components/ai/AssistantMarkdown";/**
 * The AI receptionist — the alternative to AppointmentSidePanel.
 *
 * Props mirror the editor panel exactly (plus onSwitchToEditor/onAppointmentReplaced) so the two
 * are interchangeable at every mount site and switching between them cannot shift the layout.
 *
 * Everything the assistant can actually change — status, reschedule, payment, WhatsApp — goes
 * through a confirmation card first (see PendingActionCard). Nothing in this panel writes on its
 * own initiative.
 */

interface AppointmentAvatarPanelProps {
  selectedAppointment: any | null;
  onClose: () => void;
  onEditFull: (appt: any) => void;
  onDelete: (id: string) => void;
  onSaveBooking?: (data: any) => Promise<void>;
  onQuickPay?: (patientId: string, patientName: string) => void;
  doctorsList: any[];
  servicesList?: any[];
  /** Flips this panel back to the editor without a trip to Settings. */
  onSwitchToEditor?: () => void;
  /**
   * Called after a reschedule is confirmed, with the freshly-created appointment. A reschedule
   * leaves the original document where it was (marked Rescheduled) and books a new one for the
   * new time — without this, confirming would leave the panel staring at the old, now-inert
   * record instead of following the patient to where they actually ended up.
   */
  onAppointmentReplaced?: (newAppointment: any) => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function AppointmentAvatarPanel({
  selectedAppointment,
  onClose,
  onSwitchToEditor,
  onAppointmentReplaced,
}: AppointmentAvatarPanelProps) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const { clinic, clinicId } = useClinic();
  const { setReceptionPanelActive } = useUI();
  const router = useRouter();
  const isAr = language === "ar";

  // Tells the floating Gemini bubble to step aside while this panel occupies the corner.
  useEffect(() => {
    setReceptionPanelActive(true);
    return () => setReceptionPanelActive(false);
  }, [setReceptionPanelActive]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [patientLedger, setPatientLedger] = useState<any[]>([]);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resolvingAction, setResolvingAction] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const [speechInputSupported, setSpeechInputSupported] = useState(false);
  const [speechOutputSupported, setSpeechOutputSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>("");

  const [isFetchingVoice, setIsFetchingVoice] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  /** True after she has been called by name with nothing following — the next utterance is the request. */
  const [awaitingCommand, setAwaitingCommand] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Per-session audio reuse: the same sentence is never paid for twice. */
  const audioCache = useRef<Map<string, string>>(new Map());

  // Hands-free runs from event callbacks that close over their creation-time scope, so the live
  // values have to be readable through refs rather than state.
  const handsFreeRef = useRef(false);
  const awaitingCommandRef = useRef(false);
  const wakeRecognitionRef = useRef<any>(null);
  const busyRef = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Always the current sendMessage.
   *
   * A recognition object outlives the render that created it, so its callback would otherwise keep
   * calling the version of sendMessage captured at that moment — along with the appointment that
   * was open then. Switching patients and saying "Alpha, check him in" would have acted on the
   * previous one. Reading through a ref means the command always lands on what is on screen now.
   */
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});

  const receptionistName = isAr ? RECEPTIONIST_NAME.ar : RECEPTIONIST_NAME.en;

  const canUseAi = hasFeature(clinic, "aiChat");
  const creditLimit = getAiCreditLimit(clinic);
  const monthKey = new Date().toISOString().slice(0, 7);
  const remainingCredits = Math.max(0, creditLimit - creditsUsed);

  // Fetching the voice keeps her thinking, not idle: the reply is already on screen, and an idle
  // face during the few seconds of generation reads as "finished" when she is about to speak.
  const avatarState: AvatarState = isListening
    ? "listening"
    : isLoading || isFetchingVoice
      ? "thinking"
      : isSpeaking
        ? "speaking"
        : "idle";

  /**
   * Voice, built on the browser's own speech APIs — no dependency, no per-message cost.
   *
   * Reply-reading is opt-in and starts OFF. This panel sits beside a schedule a receptionist works
   * from all day, often with other patients in earshot — a balance or a phone number read aloud by
   * default is a real privacy problem, not a nice-to-have toggle. Listening (the microphone) has no
   * such concern, since nothing is heard until the mic button is actually pressed, so it needs no
   * separate opt-in.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechInputSupported(!!SpeechRecognitionCtor);
    setSpeechOutputSupported("speechSynthesis" in window);
    try {
      setVoiceReplyEnabled(localStorage.getItem("receptionVoiceReplyEnabled") === "true");
      setVoiceURI(localStorage.getItem("receptionVoiceURI") || "");
      // Hands-free is deliberately NOT restored from storage: an always-on microphone should be
      // something a person switches on for this shift, not something that silently resumes because
      // it was on once before.
    } catch {
      /* ignore */
    }

    if (!("speechSynthesis" in window)) return;
    // getVoices() is empty on the first call in every browser — the list arrives asynchronously and
    // fires `voiceschanged`. Reading it once at mount meant the first reply always fell back to the
    // system default voice regardless of what was actually installed. Listening also means a voice
    // installed in Windows while this page is open shows up without a reload.
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  /** Voices that can actually pronounce the current interface language. */
  const availableVoices = useMemo(
    () => voices.filter((v) => v.lang?.toLowerCase().startsWith(isAr ? "ar" : "en")),
    [voices, isAr]
  );

  /** The saved choice if it is still installed, otherwise the best-ranked one for this language. */
  const activeVoice = useMemo(() => {
    const saved = availableVoices.find((v) => v.voiceURI === voiceURI);
    return saved || pickVoice(voices, isAr);
  }, [availableVoices, voiceURI, voices, isAr]);

  const toggleVoiceReply = () => {
    setVoiceReplyEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("receptionVoiceReplyEnabled", String(next));
      } catch {
        /* ignore */
      }
      if (!next) stopSpeaking();
      return next;
    });
  };

  /** Stops whatever is currently being said, from either source. */
  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
  };

  /** The device's own voice — now the fallback, used when the server voice is unavailable. */
  const speakOnDevice = (spoken: string) => {
    if (!speechOutputSupported || typeof window === "undefined") return;
    // Speaking Arabic with an English voice is mangled noise, not an accent. Staying silent is the
    // honest outcome; the panel says which language has no voice installed rather than faking it.
    if (!activeVoice) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.voice = activeVoice;
      utterance.lang = activeVoice.lang;

      // The legacy Windows SAPI voices (David/Zira/Mark) are markedly easier to follow a little
      // slower; the modern neural ones already pace themselves and sound wrong when slowed.
      const isNeural = /natural|online|google|premium|enhanced/i.test(activeVoice.name);
      utterance.rate = isNeural ? 1 : 0.95;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Speech synthesis failed:", e);
    }
  };

  /**
   * Speaks a reply, preferring the server voice.
   *
   * The server voice is the point of this: it sounds the same on every clinic PC and it can speak
   * Egyptian Arabic, which a typical Windows machine cannot at all. It costs a fraction of a cent
   * per reply and takes a few seconds, so the avatar stays in its thinking state until the audio is
   * ready rather than pretending to talk over silence.
   *
   * Identical text is reused from a per-session cache — confirmations like "Payment recorded." recur
   * all day, and there is no reason to buy the same sentence twice.
   */
  const speak = async (text: string) => {
    if (!voiceReplyEnabled || typeof window === "undefined") return;

    // Read what a person would say, not what the model typed — see lib/speechText. Without this the
    // engine announces "white heavy check mark", "star star", and "two thousand twenty six dash
    // zero eight dash sixteen".
    const spoken = trimForSpeech(toSpeechText(text, isAr));
    if (!spoken) return;

    stopSpeaking();

    const cacheKey = `${isAr ? "ar" : "en"}::${spoken}`;
    const cached = audioCache.current.get(cacheKey);
    if (cached) {
      playAudio(cached);
      return;
    }

    setIsFetchingVoice(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Not signed in.");

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicId, text: spoken, language: isAr ? "ar" : "en" }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.error || `Speech service returned ${response.status}`);
      }

      const data = await response.json();
      const src = `data:${data.mimeType || "audio/wav"};base64,${data.audio}`;
      audioCache.current.set(cacheKey, src);
      playAudio(src);
    } catch (e) {
      // Never leave the user in silence because the server voice failed — fall back to whatever the
      // browser has. In Arabic there is usually nothing, which is exactly why the server voice
      // exists, so this quietly does nothing there rather than mispronouncing it in English.
      console.warn("Server voice unavailable, falling back to the device voice:", e);
      speakOnDevice(spoken);
    } finally {
      setIsFetchingVoice(false);
    }
  };

  const playAudio = (src: string) => {
    try {
      const audio = new Audio(src);
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      void audio.play().catch(() => setIsSpeaking(false));
    } catch (e) {
      console.error("Could not play the generated audio:", e);
      setIsSpeaking(false);
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
      return;
    }
    if (!speechInputSupported || typeof window === "undefined" || isLoading) return;

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = isAr ? "ar-EG" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = (event: any) => {
      setIsListening(false);
      // "aborted"/"no-speech" happen on ordinary stop or silence — not worth surfacing as an error.
      if (event?.error && event.error !== "aborted" && event.error !== "no-speech") {
        setMessages((prev) => [...prev, {
          id: `verr-${Date.now()}`,
          role: "assistant",
          content: `⚠️ ${isAr ? "تعذر استخدام الميكروفون." : "Could not use the microphone."} (${event.error})`,
        }]);
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      let transcript = "";
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      setInput(transcript);
      if (isFinal && transcript.trim()) {
        recognition.stop();
        sendMessage(transcript);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error("Speech recognition failed to start:", e);
      setIsListening(false);
    }
  };

  /**
   * Hands-free: she listens for her name and acts on whatever follows.
   *
   * Three things make this work rather than misfire:
   *
   * 1. The microphone is SUSPENDED whenever she is thinking or speaking. Without that she hears her
   *    own reply, and a reply containing her name would summon her in an endless loop.
   * 2. Only final transcripts are considered. Interim results change word by word and would fire
   *    on half-heard fragments.
   * 3. Recognition is restarted when it ends. Browsers stop it after a stretch of silence, so a
   *    "continuous" listener that is not restarted quietly dies after a minute and looks broken.
   */
  const stopWakeLoop = () => {
    if (restartTimer.current) {
      clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
    const recognition = wakeRecognitionRef.current;
    wakeRecognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      try { recognition.stop(); } catch { /* already stopped */ }
    }
    setIsListening(false);
  };

  const startWakeLoop = () => {
    if (typeof window === "undefined" || !handsFreeRef.current || busyRef.current) return;
    if (wakeRecognitionRef.current) return;

    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = isAr ? "ar-EG" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      if (busyRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const heard = String(result[0]?.transcript || "").trim();
        if (!heard) continue;

        if (awaitingCommandRef.current) {
          // She was called by name a moment ago; this utterance is the actual request.
          awaitingCommandRef.current = false;
          setAwaitingCommand(false);
          if (isUsableCommand(heard)) {
            busyRef.current = true;
            stopWakeLoop();
            void sendMessageRef.current(heard);
          }
          return;
        }

        const { matched, command } = findWakeCommand(heard);
        if (!matched) continue;

        if (isUsableCommand(command)) {
          busyRef.current = true;
          stopWakeLoop();
          void sendMessageRef.current(command);
        } else {
          // Called with nothing after it — acknowledge and wait rather than guessing.
          awaitingCommandRef.current = true;
          setAwaitingCommand(true);
        }
        return;
      }
    };

    recognition.onerror = (event: any) => {
      // "no-speech"/"aborted" are the normal rhythm of a long-running listener, not faults.
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        handsFreeRef.current = false;
        setHandsFree(false);
        setMessages((prev) => [...prev, {
          id: `mic-${Date.now()}`,
          role: "assistant",
          content: `⚠️ ${isAr ? "لم يُسمح باستخدام الميكروفون، فتم إيقاف وضع الاستماع." : "Microphone permission was refused, so hands-free is off."}`,
        }]);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      wakeRecognitionRef.current = null;
      // Browsers end recognition on their own schedule; restart unless something else owns the mic.
      if (handsFreeRef.current && !busyRef.current) {
        restartTimer.current = setTimeout(() => startWakeLoop(), 400);
      }
    };

    wakeRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      wakeRecognitionRef.current = null;
    }
  };

  const toggleHandsFree = () => {
    const next = !handsFree;
    setHandsFree(next);
    handsFreeRef.current = next;
    awaitingCommandRef.current = false;
    setAwaitingCommand(false);
    try { localStorage.setItem("receptionHandsFree", String(next)); } catch { /* ignore */ }
    if (next) startWakeLoop();
    else stopWakeLoop();
  };

  // She must not listen to herself. While a turn is in flight or audio is playing the microphone is
  // released entirely, then handed back once she is quiet again.
  useEffect(() => {
    const busy = isLoading || isFetchingVoice || isSpeaking;
    busyRef.current = busy;
    if (!handsFreeRef.current) return;
    if (busy) stopWakeLoop();
    else if (!wakeRecognitionRef.current) restartTimer.current = setTimeout(() => startWakeLoop(), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isFetchingVoice, isSpeaking]);

  // Neither the microphone nor a reply already being read aloud should survive switching to a
  // different patient, or leaving the panel — both would otherwise keep running against a
  // conversation that is no longer on screen.
  useEffect(() => {
    return () => {
      stopListening();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [selectedAppointment?.id]);

  /**
   * Closing the panel must close the microphone.
   *
   * Hands-free is the one feature here with a consequence that outlives the component: a recognition
   * object left running would keep an open mic on a screen the user has navigated away from, with
   * no indicator anywhere to say so.
   */
  useEffect(() => {
    return () => {
      handsFreeRef.current = false;
      stopWakeLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live credit meter, same source the floating chat widget reads.
  useEffect(() => {
    if (!clinicId || !canUseAi) return;
    const unsub = onSnapshot(getClinicDoc("ai_usage", monthKey), (snap) => {
      setCreditsUsed(snap.exists() ? Number(snap.data()?.creditsUsed) || 0 : 0);
    });
    return () => unsub();
  }, [clinicId, monthKey, canUseAi]);

  // The patient's ledger, so the panel can state the balance without spending a credit to ask.
  useEffect(() => {
    if (!selectedAppointment?.patientId) {
      setPatientLedger([]);
      return;
    }
    const q = query(
      getClinicCollection("ledger"),
      where("patientId", "==", selectedAppointment.patientId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setPatientLedger(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (error) => console.error("Ledger query error:", error)
    );
    return () => unsub();
  }, [selectedAppointment?.patientId]);

  /**
   * A conversation is about one appointment — carrying it to the next would let the assistant
   * answer about the previous patient with total confidence.
   *
   * Except when the switch was the assistant's own doing: opening an appointment it just found, or
   * following a reschedule to the new record. Wiping the thread there would delete the very
   * exchange that caused the switch, including the "✅ Moved…" confirmation, a step before the
   * user has read it.
   */
  const selfInitiatedSwitch = useRef(false);
  useEffect(() => {
    if (selfInitiatedSwitch.current) {
      selfInitiatedSwitch.current = false;
      setPendingAction(null);
      return;
    }
    setMessages([]);
    setInput("");
    // A card staged against the previous appointment must not survive into this one, where it
    // would sit above a different patient's name still describing the old record.
    setPendingAction(null);
  }, [selectedAppointment?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => () => { if (speakTimer.current) clearTimeout(speakTimer.current); }, []);

  /** Same arithmetic the editor panel's summary uses, so the two can never disagree. */
  const balance = useMemo(() => {
    const totalCost = patientLedger
      .filter((e) => e.type === "procedure")
      .reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
    const totalPaid = patientLedger
      .filter((e) => e.type === "payment")
      .reduce((sum, e) => sum + (Number(e.paid) || 0), 0);
    return { totalCost, totalPaid, remaining: totalCost - totalPaid };
  }, [patientLedger]);

  const handleResolveAction = async (decision: "approve" | "reject") => {
    if (!pendingAction || resolvingAction) return;
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

      // Approved but unsent, because this clinic has no WhatsApp gateway. The server already
      // words `data.message` accordingly; this is what actually opens WhatsApp.
      if (data.manual?.phone && data.manual?.text) {
        handleManualWhatsApp({ phone: data.manual.phone, text: data.manual.text });
      }

      setMessages((prev) => [...prev, {
        id: `r-${Date.now()}`,
        role: "assistant",
        content:
          decision === "approve"
            ? `✅ ${data.message || (isAr ? "تم." : "Done.")}`
            : (isAr ? "تم الإلغاء — لم يتغير شيء." : "Cancelled — nothing changed."),
      }]);
      setPendingAction(null);

      // A reschedule leaves the original document behind (now marked Rescheduled) and books a
      // new one — follow the patient there rather than leaving the panel pointed at the old,
      // now-inert record.
      if (decision === "approve" && data.newAppointmentId && onAppointmentReplaced) {
        try {
          const newSnap = await getDoc(getClinicDoc("appointments", data.newAppointmentId));
          if (newSnap.exists()) {
            selfInitiatedSwitch.current = true;
            onAppointmentReplaced({ id: newSnap.id, ...newSnap.data() });
          }
        } catch (e) {
          console.error("Could not load the new appointment after reschedule:", e);
        }
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        id: `re-${Date.now()}`,
        role: "assistant",
        content: `⚠️ ${err.message || (isAr ? "حدث خطأ" : "Something went wrong")}`,
      }]);
      // Cleared either way: a failed confirmation must not leave a button that still looks live.
      setPendingAction(null);
    } finally {
      setResolvingAction(false);
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    // No appointment open is a valid state now — that is when it helps you find one.
    if (!trimmed || isLoading) return;

    setInput("");
    setIsLoading(true);
    setIsSpeaking(false);
    // Asking something new supersedes whatever was staged; leaving the old card up would let a
    // stale preview be approved after the conversation moved on.
    setPendingAction(null);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          mode: "reception",
          // Which surface is asking. This panel can navigate, swap the appointment on screen and
          // print, so it declares the full web capability set.
          client: "web-reception",
          appointmentId: selectedAppointment?.id || "",
          clinicId,
          prompt: trimmed,
          userName: user?.name,
          history,
          // Tells the assistant to answer in one short sentence, because a spoken reply's
          // generation time scales with its length.
          voiceMode: voiceReplyEnabled || handsFree,
        }),
      });

      if (!response.ok) {
        // The server explains every one of its failures in `error`. Swallowing that and printing a
        // generic "could not reach the assistant" turns a one-line fix into a debugging session, so
        // whatever it said is shown verbatim, with the status code, rather than summarised away.
        let detail = "";
        try {
          const errBody = await response.json();
          if (typeof errBody?.error === "string") detail = errBody.error;
        } catch {
          /* not JSON — fall through to the status-only message */
        }
        console.error("[reception assistant] HTTP", response.status, detail);

        if (response.status === 429) {
          throw new Error(isAr ? "انتهى رصيد الذكاء الاصطناعي لهذا الشهر." : "Monthly AI credits are used up.");
        }
        throw new Error(
          detail
            ? `${detail} (${response.status})`
            : (isAr ? `تعذر الوصول للمساعد (${response.status})` : `Could not reach the assistant (${response.status})`)
        );
      }

      const data = await response.json();
      const reply = data.reply || "…";

      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: reply }]);

      if (voiceReplyEnabled) {
        // speak() drives isSpeaking itself, from the audio's real play/ended events — more accurate
        // than a length-based guess, and it means the mouth stops the instant the audio does.
        // Not awaited: the reply is already on screen and should not wait on audio generation.
        void speak(reply);
      } else {
        // No audio: the mouth still moves for roughly as long as the answer would take to read, so
        // a reply doesn't finish "speaking" before the user has looked at it.
        setIsSpeaking(true);
        if (speakTimer.current) clearTimeout(speakTimer.current);
        speakTimer.current = setTimeout(() => setIsSpeaking(false), Math.min(6000, 900 + reply.length * 22));
      }

      // The server stages actions rather than performing them; nothing has happened until this
      // card is answered.
      if (data.pendingAction) setPendingAction(data.pendingAction as PendingAction);

      // The assistant found an appointment and is putting it on screen. Keep the conversation —
      // the exchange that led here is the context for whatever they ask next.
      if (data.selectAppointmentId && onAppointmentReplaced) {
        try {
          const snap = await getDoc(getClinicDoc("appointments", data.selectAppointmentId));
          if (snap.exists()) {
            selfInitiatedSwitch.current = true;
            onAppointmentReplaced({ id: snap.id, ...snap.data() });
          }
        } catch (e) {
          console.error("Could not open the appointment the assistant found:", e);
        }
      }

      if (data.navigateTo) router.push(data.navigateTo);

      // The other thing the route can end a turn with. Reception's tool list does not currently
      // include trigger_pdf_generation, so this should never fire — but the list is one edit away
      // from including it, and an unhandled key here means the panel says a document is being
      // prepared and none ever is. Honouring it costs one call; discovering it silently does
      // nothing costs a support ticket.
      if (data.triggerPdf?.title && data.triggerPdf?.content) {
        printAssistantDocument({
          title: String(data.triggerPdf.title),
          content: String(data.triggerPdf.content),
          ar: isAr,
          clinicName: clinic?.name,
        });
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "assistant", content: `⚠️ ${err.message || (isAr ? "حدث خطأ" : "Something went wrong")}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Kept pointing at the newest sendMessage on every render, so the hands-free callback always
  // acts on the appointment currently on screen. See the ref's declaration.
  sendMessageRef.current = sendMessage;

  const shellClass =
    "bg-white/80 backdrop-blur-3xl border border-white/60 shadow-[0_8px_40px_rgba(0,0,0,0.04)] rounded-[2rem] flex flex-col h-full min-h-0 overflow-hidden transition-all duration-300";

  const flipButton = onSwitchToEditor ? (
    <button
      onClick={onSwitchToEditor}
      title={isAr ? "التبديل إلى محرر التفاصيل" : "Switch to the details editor"}
      className="p-2 text-slate-400 hover:text-teal-700 hover:bg-teal-50 rounded-full transition-colors"
    >
      <PencilLine size={17} />
    </button>
  ) : null;

  // Off by default — see the note above the voice hooks. The tooltip carries the privacy caveat
  // since there is no room for a persistent banner in a panel this size.
  // Always offered now: the server generates the audio, so this no longer depends on the browser
  // having a usable voice of its own.
  const voiceReplyButton = (
    <button
      onClick={toggleVoiceReply}
      title={
        voiceReplyEnabled
          ? (isAr ? "إيقاف قراءة الردود بصوت عالٍ" : "Turn off reading replies aloud")
          : (isAr ? "قراءة الردود بصوت عالٍ (تجنب ذلك أمام مرضى آخرين)" : "Read replies aloud (avoid this with other patients nearby)")
      }
      className={`p-2 rounded-full transition-colors ${voiceReplyEnabled ? "text-teal-600 bg-teal-50 hover:bg-teal-100" : "text-slate-400 hover:text-teal-700 hover:bg-teal-50"}`}
    >
      {voiceReplyEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
    </button>
  );

  /**
   * Hands-free. Off every time the panel loads, and never restored automatically.
   *
   * The icon is a filled, coloured state rather than a subtle one because an open microphone at a
   * reception desk must never be ambiguous — see the banner it turns on below.
   */
  const handsFreeButton = speechInputSupported ? (
    <button
      onClick={toggleHandsFree}
      title={
        handsFree
          ? (isAr ? `إيقاف الاستماع المستمر` : "Stop hands-free listening")
          : (isAr ? `الاستماع المستمر — ناديها باسم ${receptionistName}` : `Hands-free — call her by saying "${receptionistName}"`)
      }
      className={`p-2 rounded-full transition-colors ${handsFree ? "text-rose-600 bg-rose-50 hover:bg-rose-100" : "text-slate-400 hover:text-teal-700 hover:bg-teal-50"}`}
    >
      {handsFree ? <Radio size={17} /> : <RadioTower size={17} />}
    </button>
  ) : null;

  // --- Plan does not include the assistant ---------------------------------------------------
  if (!canUseAi) {
    return (
      <div className="w-full h-full shrink-0 flex flex-col gap-4 z-20">
        <div className={shellClass}>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-10">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
              <Lock size={26} />
            </div>
            <h3 className="font-black text-slate-700 text-sm">
              {isAr ? "مساعد الاستقبال غير متاح في باقتك" : "Not included in your plan"}
            </h3>
            <p className="text-xs font-bold text-slate-400 mt-2 max-w-[240px]">
              {isAr
                ? "مساعد الاستقبال متاح في باقات Pro و Premium."
                : "The reception assistant is available on the Pro and Premium plans."}
            </p>
            {onSwitchToEditor && (
              <button
                onClick={onSwitchToEditor}
                className="mt-6 text-xs font-bold text-white bg-[#1A2130] hover:bg-slate-800 px-4 py-2.5 rounded-xl flex items-center gap-1.5 transition-colors shadow-md"
              >
                <PencilLine size={14} /> {isAr ? "افتح المحرر" : "Open the editor"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Active ---------------------------------------------------------------------------------
  /** With a patient on screen the useful shortcuts are about them; without one they are lookups. */
  const chips = selectedAppointment
    ? [
        { icon: Wallet, label: isAr ? "كم المتبقي؟" : "What's owed?", prompt: isAr ? "كم المبلغ المتبقي على هذا المريض؟" : "What is this patient's outstanding balance?" },
        { icon: Stethoscope, label: isAr ? "آخر زيارة" : "Last visit", prompt: isAr ? "ما الذي تم في آخر زيارة لهذا المريض؟" : "What happened at this patient's last visit?" },
        { icon: CalendarClock, label: isAr ? "أوقات متاحة" : "Free slots", prompt: isAr ? "ما هي الأوقات المتاحة لهذا الطبيب في هذا اليوم؟" : "What times are free for this dentist on this day?" },
        { icon: LogIn, label: isAr ? "تسجيل حضور" : "Check in", prompt: isAr ? "سجّل حضور هذا المريض" : "Check this patient in" },
        { icon: MessageCircle, label: isAr ? "أرسل تذكير" : "Send reminder", prompt: isAr ? "أرسل رسالة واتساب لتأكيد الموعد" : "Send the appointment confirmation WhatsApp message" },
        { icon: FolderOpen, label: isAr ? "افتح الملف" : "Open file", prompt: isAr ? "افتح ملف هذا المريض" : "Open this patient's file" },
      ]
    : [
        { icon: CalendarDays, label: isAr ? "مواعيد اليوم" : "Today", prompt: isAr ? "ما هي مواعيد اليوم؟" : "Which appointments are booked today?" },
        { icon: CalendarClock, label: isAr ? "مواعيد الغد" : "Tomorrow", prompt: isAr ? "ما هي مواعيد الغد؟" : "Which appointments are booked tomorrow?" },
        { icon: Search, label: isAr ? "ابحث عن مريض" : "Find a patient", prompt: isAr ? "ابحث لي عن موعد مريض بالاسم" : "Help me find a patient's appointment by name" },
      ];

  const stageLabel = selectedAppointment
    ? getAppointmentStageLabel(selectedAppointment.status || "Scheduled", language)
    : "";

  /**
   * Once there is something to read, the conversation is the panel and Alpha steps aside.
   *
   * At 112px plus her status chips she held ~182px of a column that only had ~260px left for the
   * thread itself — so the twentieth message was still budgeting for a portrait. Shrunk into a
   * single row she keeps every state animation, which matters because that motion is the only
   * signal that a turn is in flight.
   */
  const conversationActive = messages.length > 0 || !!pendingAction || isLoading;

  const creditsPill = (
    <span
      title={isAr ? "الرصيد المتبقي" : "Remaining AI credits"}
      className={`text-[11px] font-black px-1.5 py-1 rounded-full flex items-center gap-0.5 border shrink-0 me-1 ${
        remainingCredits < creditLimit * 0.1
          ? "bg-rose-50 text-rose-600 border-rose-200"
          : "bg-slate-50 text-slate-500 border-slate-200"
      }`}
    >
      <Zap size={10} /> {remainingCredits}
    </span>
  );

  const statusChips = selectedAppointment ? (
    <>
      <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">
        {stageLabel}
      </span>
      {selectedAppointment.treatment && (
        <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100 shrink-0">
          {selectedAppointment.treatment}
        </span>
      )}
      <span
        className={`text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border shrink-0 ${
          balance.remaining > 0
            ? "bg-rose-50 text-rose-600 border-rose-100"
            : "bg-emerald-50 text-emerald-700 border-emerald-100"
        }`}
      >
        {balance.remaining > 0
          ? `${isAr ? "متبقي" : "Owes"} ${balance.remaining.toLocaleString()} ${isAr ? "ج.م" : "EGP"}`
          : isAr ? "لا مستحقات" : "Settled"}
      </span>
    </>
  ) : null;

  return (
    <div className="w-full h-full shrink-0 flex flex-col gap-4 z-20">
      <div className={shellClass}>
        {/* Header */}
        <div className="shrink-0 px-5 py-4 flex items-center justify-between border-b border-white/40">
          {selectedAppointment ? (
            <div
              className="flex items-center gap-3 cursor-pointer group min-w-0"
              onClick={() => selectedAppointment.patientId && router.push(`/patients/${selectedAppointment.patientId}`)}
              title={isAr ? "عرض الملف الشخصي" : "View profile"}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-teal-700 bg-teal-50 text-base shadow-sm border border-teal-100 group-hover:bg-teal-100 group-hover:scale-105 transition-all shrink-0">
                {(selectedAppointment.patientName || "").substring(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 title={selectedAppointment.patientName} className="font-extrabold text-slate-800 text-lg leading-tight truncate group-hover:text-teal-700 transition-colors">
                  {selectedAppointment.patientName}
                </h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5 truncate">
                  {isAr ? selectedAppointment.time?.replace("AM", "ص").replace("PM", "م") : selectedAppointment.time}
                  {" • "}
                  {selectedAppointment.date}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-teal-700 bg-teal-50 shadow-sm border border-teal-100 shrink-0">
                <Sparkles size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="font-extrabold text-slate-800 text-lg leading-tight truncate">
                  {receptionistName}
                </h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5 truncate">
                  {isAr ? "لا يوجد موعد مفتوح" : "No appointment open"}
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center shrink-0">
            {/* Credits used to sit above the composer, costing a whole row at the busiest point in
                the panel. It is status, so it lives with the other status here. */}
            {creditsPill}
            {handsFreeButton}
            {voiceReplyButton}
            {flipButton}
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* An open microphone in a room with patients in it is never allowed to be a subtle icon. */}
        {handsFree && (
          <div className="shrink-0 px-4 py-2 bg-rose-50 border-b border-rose-100 flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
            </span>
            <p className="text-xs font-bold text-rose-700 leading-tight">
              {awaitingCommand
                ? (isAr ? `${receptionistName} تسمعك — تفضل.` : `${receptionistName} is listening — go ahead.`)
                : (isAr
                    ? `الميكروفون مفتوح. قل "${receptionistName}" متبوعاً بطلبك.`
                    : `Microphone is open. Say "${receptionistName}" followed by your request.`)}
            </p>
          </div>
        )}

        {/* Avatar + at-a-glance facts. Computed locally from records already loaded — no credit. */}
        {conversationActive ? (
          /* Talking: one row, ~62px. She keeps every state animation at 40px. */
          <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-200/60">
            <AvatarFace state={avatarState} size={40} />
            {statusChips ? (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0">
                {statusChips}
              </div>
            ) : (
              <span className="text-sm font-bold text-slate-400 truncate">{receptionistName}</span>
            )}
          </div>
        ) : (
          /* Nothing said yet: she is the greeting, at full size. */
          <div className="shrink-0 flex flex-col items-center pt-5 pb-4 px-5 border-b border-slate-200/60">
            <AvatarFace state={avatarState} size={112} />
            {statusChips ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">{statusChips}</div>
            ) : (
              <p className="mt-3 text-xs font-bold text-slate-400 text-center max-w-[260px]">
                {isAr
                  ? "اسألني عن أي موعد — سأبحث عنه وأفتحه لك."
                  : "Ask me about any appointment — I'll find it and open it for you."}
              </p>
            )}
          </div>
        )}

        {/* Conversation */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200/60 px-4 py-3 shadow-sm">
              <p className="text-sm leading-relaxed text-slate-700">
                {selectedAppointment
                  ? (isAr
                      ? `أهلاً ${user?.name || ""}، أنا ${receptionistName}. أمامي موعد ${selectedAppointment.patientName}. اسألني عن حسابه أو زياراته السابقة أو الأوقات المتاحة.`
                      : `Hi ${user?.name || "there"} — I'm ${receptionistName}. I've got ${selectedAppointment.patientName} in front of me. Ask me about the balance, past visits, or what times are free.`)
                  : (isAr
                      ? `أهلاً ${user?.name || ""}، أنا ${receptionistName}. لا يوجد موعد مفتوح. اطلب مني البحث عن مريض بالاسم، أو عرض مواعيد اليوم — وسأفتح الموعد الذي تقصده.`
                      : `Hi ${user?.name || "there"} — I'm ${receptionistName}. Nothing is open right now. Ask me to look up a patient by name, or show you today's bookings, and I'll open the one you mean.`)}
              </p>
              <p className="text-xs font-bold text-slate-400 mt-2">
                {selectedAppointment
                  ? (isAr
                      ? "يمكنني أيضاً تأكيد الحضور، تغيير الموعد، تسجيل دفعة أو إرسال رسالة — وسأعرض عليك التأكيد أولاً دائماً."
                      : "I can also check them in, move the appointment, record a payment or send a message — always showing you a confirmation first.")
                  : (isAr
                      ? "لتغيير أي شيء، افتح الموعد أولاً."
                      : "To change anything, I need the appointment open first.")}
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  msg.role === "user"
                    ? "bg-[#1A2130] text-white rounded-tr-sm whitespace-pre-wrap"
                    : "bg-white text-slate-700 border border-slate-200/60 rounded-tl-sm"
                }`}
              >
                {/* Only what the user typed stays literal. The model's reply is Markdown, and
                    whitespace-pre-wrap must not survive on that branch — see AssistantMarkdown. */}
                {msg.role === "user" ? msg.content : <AssistantMarkdown content={msg.content} isRTL={isAr} />}
              </div>
            </div>
          ))}

          {pendingAction && (
            <PendingActionCard
              action={pendingAction}
              isAr={isAr}
              resolving={resolvingAction}
              onResolve={handleResolveAction}
            />
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200/60 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                <Loader2 className="animate-spin text-teal-500" size={16} />
              </div>
            </div>
          )}
          <div ref={threadEndRef} className="h-1" />
        </div>

        {/* Suggestions */}
        <div className="shrink-0 px-4 pb-2 pt-1 flex gap-2 overflow-x-auto no-scrollbar">
          {chips.map((chip) => (
            <button
              key={chip.label}
              disabled={isLoading}
              onClick={() => sendMessage(chip.prompt)}
              className="text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50/50 disabled:opacity-50 px-3 py-2 rounded-full flex items-center gap-1.5 transition-all shadow-sm shrink-0 whitespace-nowrap"
            >
              <chip.icon size={14} className="shrink-0" /> {chip.label}
            </button>
          ))}
        </div>

        {/* Composer */}
        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-slate-100">
          {/* The device-voice picker that used to sit here is gone: the voice now comes from the
              server, so it is identical on every clinic PC and no longer something to configure
              per machine. The browser's own voice remains only as a silent fallback. */}
          {voiceReplyEnabled && (
            <p className="mb-2 px-1 text-xs font-bold text-slate-400 leading-relaxed">
              {isFetchingVoice
                ? (isAr ? "جاري تجهيز الصوت..." : "Preparing the voice…")
                : (isAr ? "الصوت من النظام — نفس الصوت على كل الأجهزة." : "Voice comes from the system — identical on every device.")}
            </p>
          )}

          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-500/10 transition-all"
          >
            {speechInputSupported && (
              <button
                type="button"
                onClick={toggleListening}
                disabled={isLoading}
                title={isListening ? (isAr ? "إيقاف الاستماع" : "Stop listening") : (isAr ? "تحدث بدلاً من الكتابة" : "Speak instead of typing")}
                className={`absolute start-2 p-2 rounded-lg transition-all disabled:opacity-40 ${
                  isListening ? "text-rose-600 bg-rose-50" : "text-slate-400 hover:text-teal-700 hover:bg-teal-50"
                }`}
              >
                {isListening ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isListening
                  ? (isAr ? "أستمع..." : "Listening...")
                  : (isAr ? "اسأل عن هذا الموعد..." : "Ask about this appointment...")
              }
              disabled={isLoading}
              dir={isAr ? "rtl" : "ltr"}
              className={`w-full bg-transparent border-none text-sm font-medium py-3.5 pe-12 focus:outline-none text-slate-700 placeholder:text-slate-400 ${speechInputSupported ? "ps-11" : "ps-4"}`}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute end-2 text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 p-2 rounded-lg transition-all"
            >
              {isLoading ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} className={isAr ? "rotate-180" : ""} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
