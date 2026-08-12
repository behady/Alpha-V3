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

export interface SmsSettings {
  /** Master switch. Off means nothing is ever queued, whatever the channel says. */
  enabled: boolean;
  /**
   * Which way the 24h reminder goes out. `whatsapp` is the default so that turning the feature on
   * is always a deliberate act — an upgrade must never start charging a clinic for texts it did
   * not ask for.
   */
  reminderChannel: ReminderChannel;
  /** Body of the reminder text. Supports the same {{placeholders}} as the WhatsApp templates. */
  template: string;
}

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

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  enabled: false,
  reminderChannel: "whatsapp",
  template: DEFAULT_SMS_REMINDER_TEMPLATE,
};

export function isReminderChannel(v: unknown): v is ReminderChannel {
  return v === "whatsapp" || v === "sms" || v === "both";
}

/** Normalise a raw settings document into the shape the rest of the code relies on. */
export function parseSmsSettings(data: Record<string, unknown> | undefined): SmsSettings {
  if (!data) return { ...DEFAULT_SMS_SETTINGS };
  const template =
    typeof data.template === "string" && data.template.trim() ? data.template : DEFAULT_SMS_REMINDER_TEMPLATE;
  return {
    enabled: Boolean(data.enabled),
    reminderChannel: isReminderChannel(data.reminderChannel)
      ? data.reminderChannel
      : DEFAULT_SMS_SETTINGS.reminderChannel,
    template,
  };
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
