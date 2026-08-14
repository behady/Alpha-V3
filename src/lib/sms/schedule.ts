import { clinicTimeZone, instantAtHourInTimeZone } from "@/lib/clinicDate";
import { isScheduledEvent, type SmsEventType, type SmsSettings } from "./config";

/**
 * When a queued text is allowed to leave the phone.
 *
 * Both halves of the answer live here — the server stamping a message, and the phone deciding
 * whether to pick it up — because they have to agree exactly, and because keeping them free of any
 * Firestore import means they can be tested without a database.
 */

/**
 * The `sendAfter` stamp for a message of this type, or `undefined` for "as soon as a phone sees it".
 *
 * Reminders are held until the hour the clinic chose. That is the whole point of the setting, and
 * it is safe because a reminder for tomorrow does not care whether it goes at 06:00 or 14:00.
 *
 * Everything else is a reaction to something a staff member just did and is never held. A
 * cancellation sat on until the afternoon is worse than no message at all — by then the patient may
 * already be on their way in.
 *
 * An hour that has already passed today resolves to "now" rather than to tomorrow: a clinic set to
 * 08:00 that books something at noon wants the text today.
 */
export function sendAfterFor(type: SmsEventType, settings: SmsSettings, now = new Date()): string | undefined {
  if (!isScheduledEvent(type)) return undefined;
  const due = instantAtHourInTimeZone(clinicTimeZone(), settings.sendHour, now);
  return due.getTime() > now.getTime() ? due.toISOString() : undefined;
}

/**
 * Whether a queued message is due.
 *
 * A missing or unparseable stamp means "now". Refusing to send on a malformed timestamp would
 * strand the message forever with nothing on screen to explain why, and the failure that matters
 * here is a patient never being told.
 */
export function isDue(message: { sendAfter?: string }, now = Date.now()): boolean {
  if (!message.sendAfter) return true;
  const due = Date.parse(message.sendAfter);
  return !Number.isFinite(due) || due <= now;
}
