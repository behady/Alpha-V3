"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
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
  /** Cursor for the next page of older messages. Null once there are none left. */
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** How many are actually waiting, counted by the server — not the length of the page on screen. */
  const [queuedCount, setQueuedCount] = useState(0);
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


  const txt = useSettingsText("sms");

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
      setOlderCursor(data.nextCursor ?? null);
      setQueuedCount(Number(data.queued) || 0);
    } catch (e) {
      console.error("Could not load paired phones", e);
    }
  }, [authedFetch, clinicId]);

  /**
   * Fetch the next page and append it.
   *
   * Only older messages are ever fetched this way: the newest page arrives with the screen, and
   * a clinic opening this page is asking "did today's reminders go out", not "show me everything
   * since we started". Reading the whole outbox to answer the first question is what this
   * replaced.
   */
  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await authedFetch(
        `/api/sms/devices?clinicId=${encodeURIComponent(clinicId || "")}&cursor=${encodeURIComponent(olderCursor)}`
      );
      setMessages((prev) => [...prev, ...(data.messages || [])]);
      setOlderCursor(data.nextCursor ?? null);
    } catch (e) {
      console.error("Could not load older messages", e);
    } finally {
      setLoadingOlder(false);
    }
  }, [authedFetch, clinicId, olderCursor, loadingOlder]);

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

  /**
   * What the rail says.
   *
   * Four states, not two. A phone that is paired but has not checked in is the one worth naming:
   * the clinic believes SMS is working, the queue quietly stops moving, and the first anyone hears
   * about it is a patient who was never reminded.
   */
  const line = (() => {
    const usable = devices.filter((d) => d.enabled);
    const alive = usable.find((d) => d.alive);
    if (!settings.enabled) {
      return { live: false, badge: txt.railOffBadge, headline: txt.railOff, detail: txt.railOffDetail };
    }
    if (usable.length === 0) {
      return { live: false, badge: txt.railNoPhoneBadge, headline: txt.railNoPhone, detail: txt.railNoPhoneDetail };
    }
    if (!alive) {
      return { live: false, badge: txt.railStalledBadge, headline: txt.railStalled, detail: txt.railStalledDetail };
    }
    return {
      live: true,
      badge: txt.railLiveBadge,
      headline: txt.railLive.replace("{phone}", alive.name || ""),
      detail: txt.railLiveDetail,
    };
  })();

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
    queued: { label: txt.statusQueued, className: "bg-surface-muted text-ink-body border-line" },
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
      {/* SMS leaves through a phone sitting in the clinic, and that phone can be paired and
          still not be checking in. When it stops, the queue stops with it and nothing says so
          until a patient does not turn up. So it is the first thing on the page, not a pill
          three cards down. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <MessagesSquare size={12} />
              {txt.title}
            </p>
            <p className="text-lg font-bold leading-snug text-white sm:text-xl">{line.headline}</p>
            <p className="max-w-md text-[13px] leading-relaxed text-white/55">{line.detail}</p>
          </div>

          <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                line.live ? "bg-white/12 text-white" : "bg-amber-400/20 text-amber-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${line.live ? "bg-emerald-400" : "bg-amber-400"}`} />
              {line.badge}
            </span>
            {queuedCount > 0 && (
              <span className="text-[11px] font-semibold text-white/45">
                <span className="font-figure text-[15px] text-white/80">{queuedCount}</span>{" "}
                {txt.railWaiting}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cost, stated before the switch rather than after the phone bill. Amber means the same
          thing here as on the WhatsApp page: a consequence that costs you. */}
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

      <label className="mt-5 flex items-center justify-between gap-4 cursor-pointer rounded-2xl border border-line bg-slate-50/80 px-4 py-3.5">
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
            className={`inline-block h-6 w-6 transform rounded-full bg-surface transition-transform ${
              settings.enabled ? "translate-x-7" : "translate-x-1"
            }`}
          />
        </button>
      </label>

      {/* Channel */}
      <section className="space-y-1">
        <h3 className="text-lg font-black text-ink flex items-center gap-3">
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
                    : "border-slate-100 bg-surface-subtle hover:border-line-strong hover:bg-surface"
                }`}
              >
                <span className={`block text-sm font-black ${active ? "text-primary-700" : "text-ink-body"}`}>{label}</span>
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
      </section>

      {/* When the reminder goes out */}
      <section className="space-y-1">
        <h3 className="text-lg font-black text-ink flex items-center gap-3">
          <Clock className="text-primary-500" size={20} /> {txt.hourTitle}
        </h3>
        <p className="text-xs font-bold text-ink-muted mt-2 leading-relaxed">{txt.hourHint}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={settings.sendHour}
            onChange={(e) => void save({ ...settings, sendHour: Number(e.target.value) })}
            className="py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-black text-slate-800 outline-none focus:bg-surface focus:border-primary-500"
          >
            {Array.from({ length: MAX_SEND_HOUR - MIN_SEND_HOUR + 1 }, (_, i) => MIN_SEND_HOUR + i).map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
          <span className="text-xs font-bold text-slate-400 flex-1 min-w-[14rem] leading-relaxed">{txt.hourLate}</span>
        </div>
      </section>

      {/* Which messages, and what they say */}
      <section className="space-y-1">
        <h3 className="text-lg font-black text-ink flex items-center gap-3">
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
          <p className="text-xs font-bold text-ink-body leading-relaxed">{txt.optOutHint}</p>
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
                  on ? "border-line bg-surface" : "border-slate-100 bg-slate-50/70"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-black ${on ? "text-ink" : "text-ink-muted"}`}>
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
                      className={`inline-block h-5 w-5 transform rounded-full bg-surface transition-transform ${
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
                      className="mt-3 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-slate-800 outline-none focus:bg-surface focus:border-primary-500 resize-y"
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
                        className="text-xs font-black text-ink-muted hover:text-slate-800 underline underline-offset-2"
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
      </section>

      {/* Devices */}
      <section className="space-y-1">
        <h3 className="text-lg font-black text-ink flex items-center gap-3">
          <Smartphone className="text-primary-500" size={20} /> {txt.devicesTitle}
        </h3>

        <div className="mt-4">
          {pairingCode ? (
            <div className="rounded-2xl border-2 border-primary-300 bg-primary-50 p-5 text-center">
              <p className="text-4xl font-black tracking-[0.35em] text-primary-800 select-all" dir="ltr">
                {pairingCode}
              </p>
              <p className="mt-3 text-xs font-bold text-ink-body leading-relaxed">{txt.pairIntro}</p>
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

        <p className="mt-3 text-xs font-bold text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3 leading-relaxed">
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
                  device.enabled ? "border-line bg-surface" : "border-line bg-surface-subtle opacity-60"
                }`}
              >
                <Smartphone size={20} className={device.alive ? "text-primary-500" : "text-slate-300"} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-ink truncate">
                    {device.name}
                    {/* Three states, not two. A phone can be switched on and still not be
                        checking in — flat, out of signal, or killed by battery saver — and that
                        is the case worth surfacing, because the queue silently stops moving. */}
                    {!device.enabled ? (
                      <span className="ms-2 text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-200 text-ink-muted">
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
      </section>

      {/* Queue */}
      <section className="space-y-1">
        <h3 className="text-lg font-black text-ink flex items-center gap-3">
          <Clock className="text-primary-500" size={20} /> {txt.queueTitle}
        </h3>
        <p className="text-xs font-bold text-slate-400 mt-2 leading-relaxed">{txt.queueNote}</p>

        <div className="mt-4 space-y-2">
          {messages.length === 0 ? (
            <p className="text-sm font-bold text-slate-400 text-center py-6">{txt.queueEmpty}</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="flex items-center gap-3 rounded-xl border border-line bg-slate-50/60 px-4 py-3">
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

          {olderCursor && (
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="w-full rounded-xl border border-line py-3 text-[13px] font-bold text-ink-body transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-50"
            >
              {loadingOlder ? txt.queueLoadingOlder : txt.queueShowOlder}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
