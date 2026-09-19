/**
 * Tell a clinic's staff something, on whatever devices they have.
 *
 * This is now a thin front door onto `deliverClinicNotification`, which does the real work: it
 * decides whether the clinic wants this alert at all, who it is addressed to, whether any of them
 * have muted it for themselves, whether it is quiet hours, and writes the bell row that makes the
 * dashboard's notification icon a record rather than an ornament.
 *
 * The signature is unchanged so that every existing caller keeps working, with one addition that
 * every caller should pass: `event`, a `notificationCatalog` id. Without it a send is *ungated* —
 * it goes out no matter what the clinic has switched off — which is deliberate, so that an alert
 * added in a hurry is noisy rather than silently dropped, and equally deliberate that
 * `npm run test:notify` lists every ungated call site so the list can only shrink.
 *
 * Fire-and-forget by design: a notification is a courtesy about something that already happened,
 * so failing to deliver one must never fail the thing itself.
 */

import {
  deliverClinicNotification,
  type DeliverResult,
} from "@/lib/notificationDelivery";

export interface ClinicPushOptions {
  /**
   * A `notificationCatalog` event id. Supplying it is what makes the alert controllable from
   * Settings → Notifications, per-person mutable, quiet-hours aware, and visible in the bell.
   */
  event?: string;
  /** Only staff with one of these roles. Ignored when `event` names its own audience. */
  roles?: string[];
  /** Exactly these people, bypassing the role filter (still clinic staff only). */
  uids?: string[];
  /** Android notification channel id, so a phone can mute one category. */
  channel?: string;
  /** String map delivered with the message; `screen` tells the app what to open. */
  data?: Record<string, string>;
  /** Where the bell row goes on tap. Derived from `data.screen` when omitted. */
  actionUrl?: string;
}

export async function sendClinicPush(
  clinicId: string,
  notification: { title: string; body: string },
  options: ClinicPushOptions = {}
): Promise<DeliverResult> {
  return deliverClinicNotification(clinicId, notification, options);
}

export { readAlertPreferences, readClinicMembers, clinicHourNow } from "@/lib/notificationDelivery";
