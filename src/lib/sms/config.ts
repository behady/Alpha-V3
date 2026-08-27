/**
 * Shapes, defaults and message-cost arithmetic for phone-sent SMS.
 *
 * Deliberately free of any server-only import. The settings screen is a client component and needs
 * these same types and the segment counter; when the Firestore Admin SDK was reachable from this
 * file, importing it in the browser dragged `firebase-admin` and `@google-cloud/storage` into the
 * client bundle and the build failed outright. Reading a clinic's settings lives next door in
 * `serverConfig.ts`.
 */

/**
 * Clinic settings for reminders sent as SMS by the clinic's own phone.
 *
 * Why a phone and not a gateway: an SMS gateway needs a business account, a registered sender ID
 * and a per-message contract — the same paperwork wall that keeps most Egyptian clinics off the
 * official WhatsApp Business API. A clinic already owns a phone with a SIM in it. The Android app
 * signs in to this system, picks up reminders the server has queued, and sends them from that SIM
 * as ordinary text messages. Nothing new to sign up for, and the patient sees the clinic's own
 * number.
 *
 * What that trades away, stated plainly because a clinic should decide with its eyes open:
 *   - Each message costs whatever the SIM's tariff charges. This is not free like WhatsApp.
 *   - The phone has to be on, in signal, and not have the app killed by battery optimisation.
 *   - Carriers watch for bulk sending from consumer SIMs and can throttle or block a number that
 *     looks like a marketing blaster.
 *   - SMS has no delivery receipt the patient sees, and no read receipt at all.
 */
export type ReminderChannel = "whatsapp" | "sms" | "both";

/**
 * The moments a patient can be texted about.
 *
 * These mirror the WhatsApp template names exactly (`new` / `edit` / `cancel` / `invoice` /
 * `reminder24h`) so that a clinic switching channels gets the same set of messages rather than
 * having to learn a second vocabulary.
 *
 * They divide into two kinds, and the difference decides when they are sent:
 *
 *   - `reminder24h` is *scheduled*. It is queued by the nightly sweep and held until the hour the
 *     clinic picked, because there is no reason a reminder for tomorrow must go out at dawn.
 *   - The other four are *reactions* to something a staff member just did. A cancellation held back
 *     until the afternoon is worse than useless — the patient may already be travelling — so these
 *     go out on the phone's next poll.
 */
export type SmsEventType = "reminder24h" | "new" | "edit" | "cancel" | "invoice";

export const SMS_EVENT_TYPES: readonly SmsEventType[] = ["reminder24h", "new", "edit", "cancel", "invoice"];

/** Only `reminder24h` waits for the clinic's chosen hour; see `SmsEventType`. */
export function isScheduledEvent(type: SmsEventType): boolean {
  return type === "reminder24h";
}

export interface SmsSettings {
  /** Master switch. Off means nothing is ever queued, whatever the channel says. */
  enabled: boolean;
  /**
   * Which way patient messages go out. `whatsapp` is the default so that turning the feature on
   * is always a deliberate act — an upgrade must never start charging a clinic for texts it did
   * not ask for.
   */
  reminderChannel: ReminderChannel;
  /**
   * Hour of the clinic's day, 0–23, at which held reminders are released.
   *
   * The nightly sweep cannot honour an hour that has already passed by the time it runs, so this
   * is clamped into a range the sweep can always reach — see `clampSendHour`.
   */
  sendHour: number;
  /** Which events are texted about at all. */
  events: Record<SmsEventType, boolean>;
  /** Body per event. Supports the same {{placeholders}} as the WhatsApp templates. */
  templates: Record<SmsEventType, string>;
  /**
   * Add "للإيقاف أرسل إيقاف" to the end of every text.
   *
   * Off by default, and that is a cost decision rather than a policy one. The bodies above are
   * written to land at 63–69 characters of the 70 an Arabic SMS gets, so this footer always pushes
   * them into a second billed segment — it doubles the phone bill for every patient message the
   * clinic sends. A clinic should switch that on knowingly; the settings screen shows the segment
   * count change as soon as it is ticked.
   *
   * The WhatsApp equivalent defaults the other way, because WhatsApp bills nothing per message and
   * the number itself is what is at risk there.
   */
  optOutFooterEnabled: boolean;
}

/**
 * The nightly sweep runs at 03:00 UTC, which is 05:00 or 06:00 in Cairo depending on summer time.
 * An hour earlier than this could not be honoured on the day it was queued, and silently sending
 * at the wrong time is worse than refusing the setting.
 */
export const MIN_SEND_HOUR = 6;
/** Past this, a "reminder for tomorrow" is close enough to tomorrow to be a different message. */
export const MAX_SEND_HOUR = 22;

export function clampSendHour(hour: unknown): number {
  const n = Math.trunc(Number(hour));
  if (!Number.isFinite(n)) return DEFAULT_SEND_HOUR;
  return Math.min(MAX_SEND_HOUR, Math.max(MIN_SEND_HOUR, n));
}

/** Mid-morning: the clinic is open, and it is not so early that a phone is still charging. */
export const DEFAULT_SEND_HOUR = 10;

/**
 * The default SMS reminder.
 *
 * Deliberately short and free of emoji. An SMS carrying any Arabic character is billed as UCS-2,
 * which fits 70 characters per message instead of 160 — and emoji force UCS-2 even in an English
 * message. A decorated template like the WhatsApp ones would quietly cost a clinic four or five
 * messages per patient per day.
 */
export const DEFAULT_SMS_REMINDER_TEMPLATE =
  "تذكير: موعدك في {{clinic_name}} غدًا {{date}} الساعة {{time}}.";

/**
 * The starting body for each event.
 *
 * All of them are free of emoji, and all of them stay inside one billed message even once a long
 * clinic name is substituted in — checked against "مركز ألفا لطب الأسنان" (21 characters), which
 * leaves each body at 63–69 of the 70 an Arabic message gets. The phrasing is terse for that
 * reason: an earlier draft that read "تم تغيير موعدك في {{clinic_name}} إلى..." came to 71 and
 * would have doubled the cost of every reschedule.
 *
 * The WhatsApp versions of these are decorated with headings and icons because that costs nothing
 * there; copying that style across would roughly triple a clinic's phone bill.
 */
export const DEFAULT_SMS_TEMPLATES: Record<SmsEventType, string> = {
  reminder24h: DEFAULT_SMS_REMINDER_TEMPLATE,
  new: "تم حجز موعدك {{date}} الساعة {{time}} — {{clinic_name}}",
  edit: "تغيّر موعدك إلى {{date}} الساعة {{time}} — {{clinic_name}}",
  cancel: "أُلغي موعدك يوم {{date}} — {{clinic_name}}. للحجز تواصل معنا.",
  invoice: "استلمنا {{amount}} جنيه. المتبقي {{balance}} جنيه. {{clinic_name}}",
};

/**
 * Which events are on out of the box.
 *
 * Only the reminder, because that is what this feature was built for and what a clinic turning SMS
 * on is expecting to pay for. Switching the master toggle on must never quietly start charging for
 * a text on every booking, reschedule, cancellation and payment — that is four times the volume
 * nobody agreed to. The other four are one tap away in Settings.
 */
export const DEFAULT_SMS_EVENTS: Record<SmsEventType, boolean> = {
  reminder24h: true,
  new: false,
  edit: false,
  cancel: false,
  invoice: false,
};

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  enabled: false,
  reminderChannel: "whatsapp",
  sendHour: DEFAULT_SEND_HOUR,
  events: { ...DEFAULT_SMS_EVENTS },
  templates: { ...DEFAULT_SMS_TEMPLATES },
  optOutFooterEnabled: false,
};

export function isReminderChannel(v: unknown): v is ReminderChannel {
  return v === "whatsapp" || v === "sms" || v === "both";
}

/**
 * Normalise a raw settings document into the shape the rest of the code relies on.
 *
 * Clinics that configured SMS before events existed have a single `template` field and no
 * `templates` map. That body is theirs — very likely edited by hand — so it is carried across as
 * the reminder rather than being silently replaced by the default.
 */
export function parseSmsSettings(data: Record<string, unknown> | undefined): SmsSettings {
  if (!data) return { ...DEFAULT_SMS_SETTINGS, events: { ...DEFAULT_SMS_EVENTS }, templates: { ...DEFAULT_SMS_TEMPLATES } };

  const legacyTemplate = typeof data.template === "string" && data.template.trim() ? data.template : "";
  const rawTemplates = (data.templates || {}) as Record<string, unknown>;
  const rawEvents = (data.events || {}) as Record<string, unknown>;

  const templates = {} as Record<SmsEventType, string>;
  const events = {} as Record<SmsEventType, boolean>;

  for (const type of SMS_EVENT_TYPES) {
    const stored = rawTemplates[type];
    const fallback = type === "reminder24h" && legacyTemplate ? legacyTemplate : DEFAULT_SMS_TEMPLATES[type];
    templates[type] = typeof stored === "string" && stored.trim() ? stored : fallback;
    events[type] = typeof rawEvents[type] === "boolean" ? (rawEvents[type] as boolean) : DEFAULT_SMS_EVENTS[type];
  }

  return {
    enabled: Boolean(data.enabled),
    reminderChannel: isReminderChannel(data.reminderChannel)
      ? data.reminderChannel
      : DEFAULT_SMS_SETTINGS.reminderChannel,
    sendHour: clampSendHour(data.sendHour),
    events,
    templates,
    optOutFooterEnabled: data.optOutFooterEnabled === true,
  };
}

/** Whether a given event should produce a text at all, given the clinic's settings. */
export function isSmsEventEnabled(settings: SmsSettings, type: SmsEventType): boolean {
  return settings.enabled && channelIncludesSms(settings.reminderChannel) && settings.events[type] === true;
}

export function channelIncludesSms(channel: ReminderChannel): boolean {
  return channel === "sms" || channel === "both";
}

export function channelIncludesWhatsApp(channel: ReminderChannel): boolean {
  return channel === "whatsapp" || channel === "both";
}

/**
 * Characters the GSM 03.38 alphabet can encode. Anything outside it forces the whole message into
 * UCS-2 — one Arabic letter, one curly quote or one emoji is enough.
 */
const GSM7_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** These cost two GSM-7 characters each because they are sent as an escape pair. */
const GSM7_EXTENDED = "^{}\\[~]|€";

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SmsCost {
  encoding: SmsEncoding;
  characters: number;
  /** How many separate messages the carrier will bill for. */
  segments: number;
  /** Characters still free in the current segment. */
  remaining: number;
}

/**
 * How many messages a body will actually be billed as.
 *
 * Shown live in the settings screen because the cost of this feature is entirely invisible
 * otherwise: a clinic types a friendly two-line Arabic reminder, and only finds out it was three
 * texts per patient when the phone bill arrives.
 */
export function measureSms(text: string): SmsCost {
  const chars = Array.from(text);

  let gsmLength = 0;
  let isGsm = true;
  for (const ch of chars) {
    if (GSM7_EXTENDED.includes(ch)) {
      gsmLength += 2;
    } else if (GSM7_CHARS.includes(ch)) {
      gsmLength += 1;
    } else {
      isGsm = false;
      break;
    }
  }

  // UCS-2 counts UTF-16 code units, so an emoji outside the basic plane costs two.
  const length = isGsm ? gsmLength : text.length;
  const single = isGsm ? 160 : 70;
  const multi = isGsm ? 153 : 67;

  if (length === 0) return { encoding: isGsm ? "GSM-7" : "UCS-2", characters: 0, segments: 0, remaining: single };
  if (length <= single) {
    return { encoding: isGsm ? "GSM-7" : "UCS-2", characters: length, segments: 1, remaining: single - length };
  }

  const segments = Math.ceil(length / multi);
  return {
    encoding: isGsm ? "GSM-7" : "UCS-2",
    characters: length,
    segments,
    remaining: segments * multi - length,
  };
}
