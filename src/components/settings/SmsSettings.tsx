"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Save,
  Smartphone,
  Trash2,
  Wallet,
} from "lucide-react";
import { getDoc, setDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { getClinicDoc } from "@/lib/db-utils";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import {
  DEFAULT_SMS_SETTINGS,
  DEFAULT_SMS_TEMPLATES,
  MAX_SEND_HOUR,
  MIN_SEND_HOUR,
  SMS_EVENT_TYPES,
  measureSms,
  parseSmsSettings,
  type ReminderChannel,
  type SmsEventType,
  type SmsSettings as SmsSettingsShape,
} from "@/lib/sms/config";
import { withSmsOptOutFooter } from "@/lib/patientMessaging";

interface Device {
  deviceId: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt?: string;
  enabled: boolean;
  /** Computed server-side, so this screen cannot disagree with the nightly job. */
  alive: boolean;
  /** True when the server can wake this phone, so messages go out in seconds. */
  instant?: boolean;
}

/** Matches MAX_SMS_ATTEMPTS in the Android worker. Three tries, then it stops. */
const MAX_SMS_ATTEMPTS = 3;

interface QueueMessage {
  id: string;
  to: string;
  text: string;
  status: "queued" | "sending" | "sent" | "failed";
  patientName?: string;
  createdAt: string;
  sentAt?: string;
  error?: string;
  attempts: number;
}

export default function SmsSettings() {
  const { language } = useLanguage();
  const { clinicId } = useClinic();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";

  const [settings, setSettings] = useState<SmsSettingsShape>(DEFAULT_SMS_SETTINGS);
  /** What is stored, so an edited message body can be told apart from a saved one. */
  const [storedSettings, setStoredSettings] = useState<SmsSettingsShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);

  // Measured with the opt-out footer included when it is on, because that is what will actually
  // be sent and billed. Showing the bare body here would under-report every message by a whole
  // segment — the one number a clinic uses to decide whether it can afford this feature.
  const costs = useMemo(() => {
    const out = {} as Record<SmsEventType, ReturnType<typeof measureSms>>;
    for (const type of SMS_EVENT_TYPES) {
      out[type] = measureSms(
        withSmsOptOutFooter(settings.templates[type] || "", settings.optOutFooterEnabled === true)
      );
    }
    return out;
  }, [settings.templates, settings.optOutFooterEnabled]);

  const txt = {
    title: isAr ? "الرسائل النصية من هاتف العيادة" : "SMS from the clinic's phone",
    intro: isAr
      ? "يرسل هاتف العيادة تذكيرات المواعيد كرسائل نصية عادية من شريحته، دون الحاجة إلى بوابة رسائل أو أوراق رسمية. النظام يجهّز الرسالة، والهاتف يرسلها."
      : "The clinic's own phone sends appointment reminders as ordinary text messages from its SIM — no messaging gateway, no paperwork. The system prepares each message; the phone sends it.",
    costWarnTitle: isAr ? "اقرأ هذا قبل التفعيل" : "Read this before turning it on",
    costWarn1: isAr
      ? "كل رسالة تُحتسب على رصيد الشريحة. هذه الخاصية ليست مجانية مثل واتساب."
      : "Every message is billed to the SIM. This is not free the way WhatsApp is.",
    costWarn2: isAr
      ? "يجب أن يظل الهاتف مفتوحاً، متصلاً بالشبكة، والتطبيق غير موقوف من إعدادات توفير البطارية."
      : "The phone must stay on, in signal, and the app must not be killed by battery saver.",
    costWarn3: isAr
      ? "الرسالة التي تحتوي على حرف عربي واحد تُحتسب ٧٠ حرفاً بدل ١٦٠ — النص الطويل يعني رسائل متعددة."
      : "A message containing a single Arabic character fits 70 characters instead of 160 — a long body means several billed messages.",
    costWarn4: isAr
      ? "شركات المحمول قد تقيّد الشرائح العادية التي ترسل رسائل كثيرة متشابهة."
      : "Carriers may restrict a consumer SIM that sends a lot of similar messages.",
    enable: isAr ? "تفعيل الإرسال من الهاتف" : "Send from the clinic phone",
    optOutTitle: isAr ? "سطر إيقاف الرسائل" : "Opt-out line",
    optOutToggle: isAr
      ? "إضافة «للإيقاف أرسل إيقاف» في آخر كل رسالة نصية"
      : "Add \"reply to stop\" to the end of every text message",
    optOutHint: isAr
      ? "لما المريض يرد بكلمة «إيقاف» بتتوقف عنه رسائل الواتساب والنصية مع بعض."
      : "A patient who replies with the stop word is switched off for both SMS and WhatsApp together.",
    optOutCost: isAr
      ? "انتبه: القوالب الافتراضية مكتوبة لتدخل في رسالة واحدة (٧٠ حرفاً). السطر ده بيزوّدها لرسالتين — يعني ضعف الفاتورة. شوف عدّاد الرسائل تحت بعد ما تفعّله."
      : "Careful: the default bodies are written to fit one billed message (70 characters). This line pushes them into two — double the bill. Watch the segment counter below after you switch it on.",
    channelTitle: isAr ? "كيف تصل رسائل العيادة للمريض" : "How the clinic's messages reach the patient",
    channelWhatsapp: isAr ? "واتساب فقط" : "WhatsApp only",
    channelWhatsappHint: isAr ? "الوضع الحالي. لا تُرسل أي رسالة نصية." : "What happens today. No text messages are sent.",
    channelSms: isAr ? "رسالة نصية فقط" : "SMS only",
    channelSmsHint: isAr ? "لكل مريض، حتى من لا يستخدم واتساب." : "Reaches every patient, including those with no WhatsApp.",
    channelBoth: isAr ? "الاثنان معاً" : "Both",
    channelBothHint: isAr
      ? "المريض يستقبل رسالتين عن نفس الموعد، وتُحتسب تكلفة الرسالة النصية."
      : "The patient gets two messages about the same appointment, and you pay for the SMS.",
    templateTitle: isAr ? "متى تُرسل الرسائل ونصها" : "Which messages go out, and what they say",
    templateHint: isAr
      ? "المتغيرات المتاحة: {{patient_name}} و {{clinic_name}} و {{date}} و {{time}} و {{doctor}}. لرسالة الدفع أيضاً {{amount}} و {{balance}}."
      : "Placeholders: {{patient_name}}, {{clinic_name}}, {{date}}, {{time}}, {{doctor}}. The payment message also has {{amount}} and {{balance}}.",
    resetTemplate: isAr ? "استعادة النص الافتراضي" : "Reset to default",
    hourTitle: isAr ? "ساعة إرسال التذكير" : "When the reminder goes out",
    hourHint: isAr
      ? "يجهّز النظام تذكيرات الغد فجراً، ويحتفظ بها الهاتف حتى الساعة التي تختارها. هذا يخصّ التذكير فقط — رسائل الحجز والتغيير والإلغاء والدفع تُرسل فور حدوثها."
      : "The system prepares tomorrow's reminders before dawn, and the phone holds them until the hour you pick. This applies to the reminder only — booking, change, cancellation and payment messages go out the moment they happen.",
    hourLate: isAr
      ? "الهاتف يفحص القائمة كل ١٥ دقيقة، لذلك قد تصل الرسالة بعد الساعة المختارة بدقائق."
      : "The phone checks the queue every 15 minutes, so a message may land a few minutes after the hour you picked.",
    eventOn: isAr ? "مفعّلة" : "On",
    eventOff: isAr ? "متوقفة" : "Off",
    allOff: isAr
      ? "لم تختر أي رسالة — لن يُرسل الهاتف شيئاً."
      : "No message is switched on — the phone has nothing to send.",
    save: isAr ? "حفظ" : "Save",
    saved: isAr ? "تم الحفظ" : "Saved",
    segments: isAr ? "رسالة مُحتسبة" : "billed messages",
    characters: isAr ? "حرف" : "characters",
    devicesTitle: isAr ? "الهواتف المُرسِلة" : "Sending phones",
    noDevices: isAr
      ? "لا يوجد هاتف يرسل حالياً. لن تُرسل أي رسالة نصية حتى تُفعّل الإرسال على هاتف العيادة."
      : "No phone is sending. No text messages will go out until you turn the sender on, on the clinic phone.",
    pairButton: isAr ? "ربط هاتف بكود" : "Pair a phone with a code",
    pairIntro: isAr
      ? "اكتب هذا الكود في تطبيق ألفا على هاتف العيادة: المزيد ← الرسائل النصية ← «ربط بالكود». صالح لمدة ١٠ دقائق ولمرة واحدة."
      : "Type this code into the Alpha app on the clinic phone: More → Text messages → \"Pair with code\". Valid for 10 minutes, one use.",
    pairWaiting: isAr ? "في انتظار الهاتف…" : "Waiting for the phone…",
    howToAdd: isAr
      ? "لإضافة هاتف: افتح تطبيق ألفا على هاتف العيادة، ثم «المزيد»، وفعّل «هذا الهاتف يرسل التذكيرات». سيظهر هنا خلال دقائق."
      : "To add a phone: open the Alpha app on the clinic phone, go to More, and switch on \"Send reminders from this phone\". It appears here within a few minutes.",
    unpair: isAr ? "إيقاف" : "Stop",
    unpairConfirm: isAr
      ? "إيقاف هذا الهاتف عن الإرسال؟"
      : "Stop this phone from sending?",
    revoked: isAr ? "موقوف" : "Stopped",
    aliveNow: isAr ? "يعمل الآن" : "Sending",
    notSeen: isAr ? "غير متصل" : "Not checking in",
    lastSeen: isAr ? "آخر اتصال" : "Last checked in",
    instantOn: isAr ? "إرسال فوري" : "Instant",
    instantOff: isAr ? "كل ١٥ دقيقة" : "Every 15 min",
    instantOffHint: isAr
      ? "هذا الهاتف يحتاج تحديث التطبيق (٤.٨ أو أحدث). بعد التحديث انتظر فحصاً واحداً ليصبح الإرسال فورياً."
      : "This phone needs app 4.8 or newer. After updating, wait for one check-in and sending becomes instant.",
    never: isAr ? "لم يحدث" : "never",
    queueTitle: isAr ? "آخر الرسائل" : "Recent messages",
    queueEmpty: isAr ? "لا توجد رسائل بعد." : "Nothing in the queue yet.",
    statusQueued: isAr ? "في الانتظار" : "Waiting",
    statusSending: isAr ? "مع الهاتف" : "With the phone",
    statusSent: isAr ? "أُرسلت" : "Sent",
    statusFailed: isAr ? "فشلت" : "Failed",
    statusRetrying: isAr ? "إعادة المحاولة" : "Retrying",
    queueNote: isAr
      ? "«في الانتظار» تعني أن النظام جهّز الرسالة ولم يحاول الهاتف إرسالها بعد. «إعادة المحاولة» تعني أنه حاول ورفضتها الشبكة، وسيحاول مرة أخرى — والسبب مكتوب تحت الرسالة. لا تُعتبر مُرسلة إلا عندما يؤكد الهاتف ذلك."
      : "\"Waiting\" means the phone has not tried yet. \"Retrying\" means it tried, the network refused, and it will try again — the reason is written under the message. It only counts as sent once the phone confirms it.",
    inAppHint: isAr
      ? "أنت تفتح النظام من داخل تطبيق ألفا على هذا الهاتف، لذلك يمكنك ربطه مباشرة."
      : "You are viewing this inside the Alpha app on this phone, so you can pair it directly.",
  };

  const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error(isAr ? "انتهت الجلسة" : "Session expired");
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Request failed");
    return data;
  }, [isAr]);

  const loadDevices = useCallback(async () => {
    try {
      const data = await authedFetch(`/api/sms/devices?clinicId=${encodeURIComponent(clinicId || "")}`);
      setDevices(data.devices || []);
      setMessages(data.messages || []);
    } catch (e) {
      console.error("Could not load paired phones", e);
    }
  }, [authedFetch, clinicId]);

  useEffect(() => {
    if (!clinicId) return;
    (async () => {
      try {
        const snap = await getDoc(getClinicDoc("settings", "sms"));
        // The same parser the server uses, so this screen can never show a clinic something
        // different from what the nightly job will act on — including the migration of a
        // hand-edited reminder saved before per-event templates existed.
        if (snap.exists()) {
          const parsed = parseSmsSettings(snap.data() || {});
          setSettings(parsed);
          setStoredSettings(parsed);
        } else {
          setStoredSettings(DEFAULT_SMS_SETTINGS);
        }
      } catch (e) {
        console.error("Could not load SMS settings", e);
      } finally {
        setLoading(false);
      }
      void loadDevices();
    })();
  }, [clinicId, loadDevices]);

  /**
   * Every switch on this screen saves the moment it is clicked; only the message bodies wait for
   * the Save button. So the unsaved state is exactly the difference between what is typed and
   * what is stored — an SMS body rewritten and then abandoned is real work lost.
   */
  useDirtyFlag(
    "sms",
    storedSettings !== null && JSON.stringify(settings) !== JSON.stringify(storedSettings)
  );

  const save = async (next: SmsSettingsShape) => {
    setSaving(true);
    try {
      await setDoc(
        getClinicDoc("settings", "sms"),
        {
          ...next,
          // Mirrors the reminder body into the old single-template field. Nothing reads it any
          // more, but the document is left self-consistent rather than carrying a stale copy of a
          // message the clinic has since rewritten.
          template: next.templates.reminder24h,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setSettings(next);
      setStoredSettings(next);
      showToast(txt.saved, "success");
    } catch (e) {
      console.error("Could not save SMS settings", e);
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const generatePairingCode = async () => {
    if (!clinicId) return;
    setPairingBusy(true);
    try {
      const data = await authedFetch("/api/sms/pairing-code", {
        method: "POST",
        body: JSON.stringify({ clinicId }),
      });
      setPairingCode(String(data.code));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create a code", "error");
    } finally {
      setPairingBusy(false);
    }
  };

  // While a code is on screen, watch for the phone to appear — the whole point of pairing is
  // that it shows up the second the code is typed, so the person is not left wondering.
  useEffect(() => {
    if (!pairingCode) return;
    const timer = setInterval(() => void loadDevices(), 4000);
    const expiry = setTimeout(() => setPairingCode(null), 10 * 60 * 1000);
    return () => {
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }, [pairingCode, loadDevices]);

  // The code's job is done the moment the phone shows up.
  useEffect(() => {
    if (pairingCode && devices.some((d) => d.enabled)) setPairingCode(null);
  }, [devices, pairingCode]);

  const unpair = async (device: Device) => {
    if (!(await confirm(txt.unpairConfirm))) return;
    try {
      await authedFetch(
        `/api/sms/devices?deviceId=${encodeURIComponent(device.deviceId)}&clinicId=${encodeURIComponent(clinicId || "")}`,
        { method: "DELETE" }
      );
      void loadDevices();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not unpair", "error");
    }
  };

  // Switched on AND checking in. A phone that is enabled but silent cannot collect the queue, so
  // counting it as active here would hide the exact problem this screen exists to show.
  const activeDevices = devices.filter((d) => d.enabled && d.alive);
  const smsSelected = settings.reminderChannel === "sms" || settings.reminderChannel === "both";

  const formatWhen = (iso?: string) => {
    if (!iso) return txt.never;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return txt.never;
    return d.toLocaleString(isAr ? "ar-EG" : "en-US", { dateStyle: "short", timeStyle: "short" });
  };

  /**
   * Each event says plainly *when* it fires, not just what it is called. "Appointment moved" alone
   * leaves a clinic guessing whether it costs them a message every time somebody nudges a booking
   * by five minutes, and that guess decides whether they dare turn it on.
   */
  const eventMeta: Record<SmsEventType, { label: string; hint: string }> = {
    reminder24h: {
      label: isAr ? "تذكير الموعد" : "Appointment reminder",
      hint: isAr ? "قبل الموعد بيوم، في الساعة المختارة أعلاه." : "The day before, at the hour set above.",
    },
    new: {
      label: isAr ? "تأكيد الحجز" : "Booking confirmed",
      hint: isAr ? "فور حجز الموعد." : "The moment an appointment is booked.",
    },
    edit: {
      label: isAr ? "تغيير الموعد" : "Appointment moved",
      hint: isAr ? "عند تغيير التاريخ أو الوقت أو الطبيب." : "When the date, time or doctor changes.",
    },
    cancel: {
      label: isAr ? "إلغاء الموعد" : "Appointment cancelled",
      hint: isAr ? "عند إلغاء الموعد." : "When an appointment is cancelled.",
    },
    invoice: {
      label: isAr ? "تأكيد استلام الدفع" : "Payment received",
      hint: isAr ? "عند تسجيل دفعة — وليس عند إضافة علاج." : "When a payment is recorded — not when work is charged.",
    },
  };

  const hourLabel = (hour: number) =>
    new Date(2000, 0, 1, hour, 0).toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

  const anyEventOn = SMS_EVENT_TYPES.some((type) => settings.events[type]);

  const statusMeta: Record<QueueMessage["status"], { label: string; className: string }> = {
    queued: { label: txt.statusQueued, className: "bg-slate-100 text-slate-600 border-slate-200" },
    sending: { label: txt.statusSending, className: "bg-amber-50 text-amber-700 border-amber-200" },
    sent: { label: txt.statusSent, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failed: { label: txt.statusFailed, className: "bg-rose-50 text-rose-700 border-rose-200" },
  };

  /**
   * The badge for one queued message.
   *
   * A failed send does not stay failed: the phone records why, puts the message
   * back on the queue and tries again, up to three times. That left a row which
   * had been tried and refused looking identical to one nothing had touched —
   * both grey, both "Waiting" — with the reason printed underneath contradicting
   * the badge above it. A message on its way round again says so, and says which
   * attempt it is on.
   */
  const badgeFor = (message: QueueMessage) => {
    if (message.status === "queued" && message.attempts > 0) {
      return {
        label: `${txt.statusRetrying} ${message.attempts}/${MAX_SMS_ATTEMPTS}`,
        className: "bg-amber-50 text-amber-700 border-amber-200",
      };
    }
    return statusMeta[message.status];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={26} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in max-w-5xl mx-auto">
      {/* What this is */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
          <MessagesSquare className="text-primary-500" /> {txt.title}
        </h3>
        <p className="text-sm font-medium text-slate-500 mt-2 leading-relaxed">{txt.intro}</p>

        {/* The costs, stated before the switch rather than after the phone bill. */}
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-amber-700 flex items-center gap-2">
            <AlertTriangle size={14} /> {txt.costWarnTitle}
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {[txt.costWarn1, txt.costWarn2, txt.costWarn3, txt.costWarn4].map((line) => (
              <li key={line} className="text-xs font-bold text-amber-900 leading-relaxed flex gap-2">
                <span className="text-amber-500 shrink-0">•</span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <label className="mt-5 flex items-center justify-between gap-4 cursor-pointer rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5">
          <span className="text-sm font-black text-slate-800 flex items-center gap-2">
            <Smartphone size={16} className="text-slate-400" /> {txt.enable}
          </span>
          <button
            type="button"
            onClick={() => void save({ ...settings, enabled: !settings.enabled })}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors shrink-0 ${
              settings.enabled ? "bg-primary-500" : "bg-slate-200"
            }`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                settings.enabled ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </label>
      </div>

      {/* Channel */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <MessageCircle className="text-primary-500" size={20} /> {txt.channelTitle}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          {(
            [
              ["whatsapp", txt.channelWhatsapp, txt.channelWhatsappHint],
              ["sms", txt.channelSms, txt.channelSmsHint],
              ["both", txt.channelBoth, txt.channelBothHint],
            ] as [ReminderChannel, string, string][]
          ).map(([key, label, hint]) => {
            const active = settings.reminderChannel === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => void save({ ...settings, reminderChannel: key })}
                className={`p-5 rounded-3xl border-2 text-center transition-all ${
                  active
                    ? "border-primary-500 bg-primary-50 shadow-md scale-[1.02]"
                    : "border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <span className={`block text-sm font-black ${active ? "text-primary-700" : "text-slate-600"}`}>{label}</span>
                <span className="block text-xs font-bold text-slate-400 mt-2 leading-relaxed">{hint}</span>
              </button>
            );
          })}
        </div>

        {/* A channel that cannot actually deliver is worth saying out loud. */}
        {smsSelected && !settings.enabled && (
          <p className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            {isAr
              ? "اخترت الرسائل النصية لكن الإرسال من الهاتف غير مفعّل — لن تُرسل أي رسالة."
              : "SMS is selected but sending from the phone is switched off — no text will go out."}
          </p>
        )}
        {smsSelected && settings.enabled && activeDevices.length === 0 && (
          <p className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            {txt.noDevices}
          </p>
        )}
      </div>

      {/* When the reminder goes out */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <Clock className="text-primary-500" size={20} /> {txt.hourTitle}
        </h3>
        <p className="text-xs font-bold text-slate-500 mt-2 leading-relaxed">{txt.hourHint}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={settings.sendHour}
            onChange={(e) => void save({ ...settings, sendHour: Number(e.target.value) })}
            className="py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 outline-none focus:bg-white focus:border-primary-500"
          >
            {Array.from({ length: MAX_SEND_HOUR - MIN_SEND_HOUR + 1 }, (_, i) => MIN_SEND_HOUR + i).map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
          <span className="text-xs font-bold text-slate-400 flex-1 min-w-[14rem] leading-relaxed">{txt.hourLate}</span>
        </div>
      </div>

      {/* Which messages, and what they say */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <Wallet className="text-primary-500" size={20} /> {txt.templateTitle}
        </h3>
        <p className="text-xs font-bold text-slate-400 mt-2 leading-relaxed">{txt.templateHint}</p>

        {settings.enabled && smsSelected && !anyEventOn && (
          <p className="mt-4 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            {txt.allOff}
          </p>
        )}

        {/* Above the per-event bodies, because switching it on changes the segment count printed
            against every one of them — and that number is the whole argument. */}
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-800">{txt.optOutTitle}</p>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm font-bold text-amber-950 leading-relaxed">{txt.optOutToggle}</span>
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500 shrink-0"
              checked={settings.optOutFooterEnabled === true}
              onChange={(e) => void save({ ...settings, optOutFooterEnabled: e.target.checked })}
            />
          </label>
          <p className="text-xs font-bold text-slate-600 leading-relaxed">{txt.optOutHint}</p>
          <p className="text-xs text-amber-900 leading-relaxed">{txt.optOutCost}</p>
        </div>

        <div className="mt-5 space-y-3">
          {SMS_EVENT_TYPES.map((type) => {
            const on = settings.events[type] === true;
            const cost = costs[type];
            return (
              <div
                key={type}
                className={`rounded-2xl border p-4 transition-colors ${
                  on ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/70"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-black ${on ? "text-slate-900" : "text-slate-500"}`}>
                      {eventMeta[type].label}
                    </p>
                    <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">{eventMeta[type].hint}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void save({ ...settings, events: { ...settings.events, [type]: !on } })}
                    aria-label={`${eventMeta[type].label} — ${on ? txt.eventOn : txt.eventOff}`}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 ${
                      on ? "bg-primary-500" : "bg-slate-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        on ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {/* The body is only worth showing for a message that will actually be sent. */}
                {on && (
                  <>
                    <textarea
                      value={settings.templates[type]}
                      onChange={(e) =>
                        setSettings({ ...settings, templates: { ...settings.templates, [type]: e.target.value } })
                      }
                      rows={2}
                      className="mt-3 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 resize-y"
                    />
                    {/* Live cost, because it is otherwise invisible until the bill arrives. */}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span
                        className={`text-xs font-black px-3 py-1.5 rounded-lg border ${
                          cost.segments > 1
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {cost.segments} {txt.segments}
                      </span>
                      <span className="text-xs font-bold text-slate-400">
                        {cost.characters} {txt.characters} · {cost.encoding}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            templates: { ...settings.templates, [type]: DEFAULT_SMS_TEMPLATES[type] },
                          })
                        }
                        className="text-xs font-black text-slate-500 hover:text-slate-800 underline underline-offset-2"
                      >
                        {txt.resetTemplate}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void save(settings)}
          disabled={saving}
          className="mt-5 ms-auto flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {txt.save}
        </button>
      </div>

      {/* Devices */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <Smartphone className="text-primary-500" size={20} /> {txt.devicesTitle}
        </h3>

        <div className="mt-4">
          {pairingCode ? (
            <div className="rounded-2xl border-2 border-primary-300 bg-primary-50 p-5 text-center">
              <p className="text-4xl font-black tracking-[0.35em] text-primary-800 select-all" dir="ltr">
                {pairingCode}
              </p>
              <p className="mt-3 text-xs font-bold text-slate-600 leading-relaxed">{txt.pairIntro}</p>
              <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-primary-600 animate-pulse">
                {txt.pairWaiting}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void generatePairingCode()}
              disabled={pairingBusy}
              className="w-full rounded-2xl bg-slate-900 hover:bg-slate-800 text-white py-3.5 text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-all"
            >
              {pairingBusy ? "…" : txt.pairButton}
            </button>
          )}
        </div>

        <p className="mt-3 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 leading-relaxed">
          {txt.howToAdd}
        </p>

        <div className="mt-5 space-y-3">
          {devices.length === 0 ? (
            <p className="text-sm font-bold text-slate-400 text-center py-6">{txt.noDevices}</p>
          ) : (
            devices.map((device) => (
              <div
                key={device.deviceId}
                className={`flex items-center gap-4 rounded-2xl border p-4 ${
                  device.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-60"
                }`}
              >
                <Smartphone size={20} className={device.alive ? "text-primary-500" : "text-slate-300"} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 truncate">
                    {device.name}
                    {/* Three states, not two. A phone can be switched on and still not be
                        checking in — flat, out of signal, or killed by battery saver — and that
                        is the case worth surfacing, because the queue silently stops moving. */}
                    {!device.enabled ? (
                      <span className="ms-2 text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-200 text-slate-500">
                        {txt.revoked}
                      </span>
                    ) : device.alive ? (
                      <span className="ms-2 text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">
                        {txt.aliveNow}
                      </span>
                    ) : (
                      <span className="ms-2 text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                        {txt.notSeen}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                    {txt.lastSeen}: {formatWhen(device.lastSeenAt)}
                  </p>
                  {device.enabled && device.alive && (
                    <p
                      className={`text-[11px] font-black mt-0.5 ${
                        device.instant ? "text-emerald-600" : "text-amber-700"
                      }`}
                    >
                      {device.instant ? `⚡ ${txt.instantOn}` : `🕒 ${txt.instantOff}`}
                      {!device.instant && (
                        <span className="block font-bold text-slate-400 mt-0.5">
                          {txt.instantOffHint}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                {device.enabled && (
                  <button
                    type="button"
                    onClick={() => void unpair(device)}
                    className="p-2 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition-colors"
                    title={txt.unpair}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Queue */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <Clock className="text-primary-500" size={20} /> {txt.queueTitle}
        </h3>
        <p className="text-xs font-bold text-slate-400 mt-2 leading-relaxed">{txt.queueNote}</p>

        <div className="mt-4 space-y-2">
          {messages.length === 0 ? (
            <p className="text-sm font-bold text-slate-400 text-center py-6">{txt.queueEmpty}</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <span className={`text-[10px] font-black px-2 py-1 rounded-md border shrink-0 ${badgeFor(message).className}`}>
                  {badgeFor(message).label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">
                    {message.patientName || message.to}
                  </p>
                  <p className="text-[11px] font-medium text-slate-400 truncate">{message.text}</p>
                  {message.error && <p className="text-[11px] font-bold text-rose-500 truncate">{message.error}</p>}
                </div>
                <span className="text-[11px] font-bold text-slate-400 shrink-0">
                  {formatWhen(message.sentAt || message.createdAt)}
                </span>
                {message.status === "sent" && <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
