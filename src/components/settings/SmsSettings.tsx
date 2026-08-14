"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Save,
  Signal,
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
import {
  DEFAULT_SMS_REMINDER_TEMPLATE,
  DEFAULT_SMS_SETTINGS,
  isReminderChannel,
  measureSms,
  type ReminderChannel,
  type SmsSettings as SmsSettingsShape,
} from "@/lib/sms/config";

interface Device {
  deviceId: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt?: string;
  enabled: boolean;
  /** Computed server-side, so this screen cannot disagree with the nightly job. */
  alive: boolean;
}

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [messages, setMessages] = useState<QueueMessage[]>([]);

  const cost = useMemo(() => measureSms(settings.template), [settings.template]);

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
    channelTitle: isAr ? "كيف يصل تذكير الموعد للمريض" : "How the appointment reminder reaches the patient",
    channelWhatsapp: isAr ? "واتساب فقط" : "WhatsApp only",
    channelWhatsappHint: isAr ? "الوضع الحالي. لا تُرسل أي رسالة نصية." : "What happens today. No text messages are sent.",
    channelSms: isAr ? "رسالة نصية فقط" : "SMS only",
    channelSmsHint: isAr ? "لكل مريض، حتى من لا يستخدم واتساب." : "Reaches every patient, including those with no WhatsApp.",
    channelBoth: isAr ? "الاثنان معاً" : "Both",
    channelBothHint: isAr
      ? "المريض يستقبل رسالتين عن نفس الموعد، وتُحتسب تكلفة الرسالة النصية."
      : "The patient gets two messages about the same appointment, and you pay for the SMS.",
    templateTitle: isAr ? "نص الرسالة" : "Message body",
    templateHint: isAr
      ? "المتغيرات المتاحة: {{patient_name}} و {{clinic_name}} و {{date}} و {{time}} و {{doctor}}"
      : "Available placeholders: {{patient_name}}, {{clinic_name}}, {{date}}, {{time}}, {{doctor}}",
    resetTemplate: isAr ? "استعادة النص الافتراضي" : "Reset to default",
    save: isAr ? "حفظ" : "Save",
    saved: isAr ? "تم الحفظ" : "Saved",
    segments: isAr ? "رسالة مُحتسبة" : "billed messages",
    characters: isAr ? "حرف" : "characters",
    devicesTitle: isAr ? "الهواتف المُرسِلة" : "Sending phones",
    noDevices: isAr
      ? "لا يوجد هاتف يرسل حالياً. لن تُرسل أي رسالة نصية حتى تُفعّل الإرسال على هاتف العيادة."
      : "No phone is sending. No text messages will go out until you turn the sender on, on the clinic phone.",
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
    never: isAr ? "لم يحدث" : "never",
    queueTitle: isAr ? "آخر الرسائل" : "Recent messages",
    queueEmpty: isAr ? "لا توجد رسائل بعد." : "Nothing in the queue yet.",
    statusQueued: isAr ? "في الانتظار" : "Waiting",
    statusSending: isAr ? "مع الهاتف" : "With the phone",
    statusSent: isAr ? "أُرسلت" : "Sent",
    statusFailed: isAr ? "فشلت" : "Failed",
    queueNote: isAr
      ? "«في الانتظار» تعني أن النظام جهّز الرسالة ولم يرسلها أحد بعد. لا تُعتبر مُرسلة إلا عندما يؤكد الهاتف ذلك."
      : "\"Waiting\" means the system prepared the message and nobody has sent it yet. It only counts as sent once the phone confirms it.",
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
      const data = await authedFetch("/api/sms/devices");
      setDevices(data.devices || []);
      setMessages(data.messages || []);
    } catch (e) {
      console.error("Could not load paired phones", e);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (!clinicId) return;
    (async () => {
      try {
        const snap = await getDoc(getClinicDoc("settings", "sms"));
        if (snap.exists()) {
          const data = snap.data() || {};
          setSettings({
            enabled: Boolean(data.enabled),
            reminderChannel: isReminderChannel(data.reminderChannel)
              ? data.reminderChannel
              : DEFAULT_SMS_SETTINGS.reminderChannel,
            template:
              typeof data.template === "string" && data.template.trim() ? data.template : DEFAULT_SMS_REMINDER_TEMPLATE,
          });
        }
      } catch (e) {
        console.error("Could not load SMS settings", e);
      } finally {
        setLoading(false);
      }
      void loadDevices();
    })();
  }, [clinicId, loadDevices]);

  const save = async (next: SmsSettingsShape) => {
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", "sms"), { ...next, updatedAt: new Date().toISOString() }, { merge: true });
      setSettings(next);
      showToast(txt.saved, "success");
    } catch (e) {
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const unpair = async (device: Device) => {
    if (!(await confirm(txt.unpairConfirm))) return;
    try {
      await authedFetch(`/api/sms/devices?deviceId=${encodeURIComponent(device.deviceId)}`, { method: "DELETE" });
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

  const statusMeta: Record<QueueMessage["status"], { label: string; className: string }> = {
    queued: { label: txt.statusQueued, className: "bg-slate-100 text-slate-600 border-slate-200" },
    sending: { label: txt.statusSending, className: "bg-amber-50 text-amber-700 border-amber-200" },
    sent: { label: txt.statusSent, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failed: { label: txt.statusFailed, className: "bg-rose-50 text-rose-700 border-rose-200" },
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

      {/* Template */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <Wallet className="text-primary-500" size={20} /> {txt.templateTitle}
        </h3>
        <p className="text-xs font-bold text-slate-400 mt-2">{txt.templateHint}</p>

        <textarea
          value={settings.template}
          onChange={(e) => setSettings({ ...settings, template: e.target.value })}
          rows={4}
          className="mt-3 w-full py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-primary-500 resize-y"
        />

        {/* Live cost, because it is otherwise invisible until the bill arrives. */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className={`text-xs font-black px-3 py-1.5 rounded-lg border ${
              cost.segments > 1 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
            }`}
          >
            {cost.segments} {txt.segments}
          </span>
          <span className="text-xs font-bold text-slate-400">
            {cost.characters} {txt.characters} · {cost.encoding}
          </span>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, template: DEFAULT_SMS_REMINDER_TEMPLATE })}
            className="text-xs font-black text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            {txt.resetTemplate}
          </button>
          <button
            type="button"
            onClick={() => void save(settings)}
            disabled={saving}
            className="ms-auto inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {txt.save}
          </button>
        </div>
      </div>

      {/* Devices */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
          <Smartphone className="text-primary-500" size={20} /> {txt.devicesTitle}
        </h3>

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
                <span className={`text-[10px] font-black px-2 py-1 rounded-md border shrink-0 ${statusMeta[message.status].className}`}>
                  {statusMeta[message.status].label}
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
