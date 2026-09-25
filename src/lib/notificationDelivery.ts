/**
 * Who a clinic's alert reaches, and by which route. The web half.
 *
 * Every alert in the app now passes through `deliverClinicNotification`, which is the only place
 * that answers four questions: is this alert switched on, who is it addressed to, has any of those
 * people muted it for themselves, and is it quiet hours. Answering them in one place is the point.
 * They used to be answered at each of twenty-odd call sites, independently, and the results
 * disagreed — most visibly in the two bugs described in `notificationCatalog.ts`.
 *
 * The Cloud Functions half is `functions/clinicPush.js`, which does the same thing against the
 * same catalogue and the same documents. Any change here that changes behaviour belongs there too.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb, adminMessaging } from "@/lib/firebaseAdmin";
import {
  isMutedFor,
  notifyEvent,
  pushAllowedNow,
  resolveNotify,
  type AlertPreferences,
  type NotifyRole,
} from "@/lib/notificationCatalog";

/** The clinic's own day, for quiet hours. Same default as the Cloud Functions package. */
const TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";

export function clinicHourNow(now: Date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      hour12: false,
    }).format(now);
    const n = Number(hour);
    return Number.isFinite(n) ? n % 24 : now.getHours();
  } catch {
    // An unknown timezone name must not be able to stop a notification.
    return now.getHours();
  }
}

/** Where this clinic's answers live. One document, read by both runtimes. */
export async function readAlertPreferences(clinicId: string): Promise<AlertPreferences> {
  try {
    const snap = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
    const prefs = snap.data()?.alertPreferences;
    return prefs && typeof prefs === "object" ? (prefs as AlertPreferences) : {};
  } catch {
    // A clinic whose settings cannot be read gets the catalogue's defaults, which is the same
    // behaviour it had before any of this was configurable. Failing silent here would mean a
    // transient read error silences a patient-is-waiting alert.
    return {};
  }
}

export interface ClinicMember {
  uid: string;
  role: string;
}

/**
 * Everybody who works at this clinic, with their role.
 *
 * Staff rows plus the owner, and the owner has to be added separately because signup does not
 * create one for them: `/api/onboarding/create-clinic` writes the role to `users.clinicRoles` and
 * `clinics/{id}.ownerId`, and nothing writes a staff document. Targeting that read only the staff
 * collection therefore could not see the owner at all — so the 21:00 money digest and every
 * escalation addressed to "Owner, Admin" reached nobody, at every clinic where the owner had not
 * also been added on the Users screen.
 */
export async function readClinicMembers(clinicId: string): Promise<ClinicMember[]> {
  const byUid = new Map<string, ClinicMember>();
  try {
    const staffSnap = await adminClinicCollection(clinicId, "staff").get();
    for (const doc of staffSnap.docs) {
      const uid = String(doc.data()?.uid || "").trim();
      if (!uid) continue;
      byUid.set(uid, { uid, role: String(doc.data()?.role || "").trim() });
    }
  } catch {
    /* Fall through: the owner alone is better than nobody. */
  }
  try {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    const ownerId = String(clinicSnap.data()?.ownerId || "").trim();
    // The owner's staff row, if they have one, may say "Admin" or "Dentist". Ownership outranks
    // it for addressing purposes — an alert sent to "Owner" must reach the person who pays.
    if (ownerId) byUid.set(ownerId, { uid: ownerId, role: "Owner" });
  } catch {
    /* Staff alone. */
  }
  return [...byUid.values()];
}

function matchRoles(members: readonly ClinicMember[], roles: readonly NotifyRole[]): string[] {
  if (roles.length === 0) return [];
  const wanted = new Set<string>(roles);
  // An Owner is an Admin for every other purpose in this app (see lib/permissions), so an alert
  // addressed to Admin reaches the owner too. Not the other way round: "Owner" means the owner.
  const ownerCountsAsAdmin = wanted.has("Admin");
  return members
    .filter((m) => wanted.has(m.role) || (ownerCountsAsAdmin && m.role === "Owner"))
    .map((m) => m.uid);
}

export interface DeliverOptions {
  /** A catalogue id. Without one nothing is gated, which is only for alerts not yet catalogued. */
  event?: string;
  /** Exactly these people, for an alert whose audience is a specific person (an arrival). */
  uids?: string[];
  /** Overrides the catalogue's roles. Only for uncatalogued sends. */
  roles?: string[];
  /** Android notification channel, so a phone can mute one category at the OS level. */
  channel?: string;
  /** Delivered with the push; `screen` tells the app what to open on tap. */
  data?: Record<string, string>;
  /** Where the bell row navigates to. Falls back to the catalogue-free `/` if absent. */
  actionUrl?: string;
}

export interface DeliverResult {
  /** False when the clinic has this alert switched off entirely. */
  raised: boolean;
  bellWritten: boolean;
  pushed: number;
  reason?: "unknown-event" | "off" | "nobody" | "muted" | "quiet" | "no-devices";
}

/**
 * Raise one alert: write the bell row, push to the phones, or neither.
 *
 * Fire-and-forget by design, like the helper it replaces. A notification is a courtesy about
 * something that already happened, so failing to deliver one must never fail the thing itself —
 * every error is swallowed and nothing here is awaited on a critical path.
 */
export async function deliverClinicNotification(
  clinicId: string,
  notification: { title: string; body: string },
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const none: DeliverResult = { raised: false, bellWritten: false, pushed: 0 };
  try {
    const { event, uids = null, roles = null, channel = null, data = null, actionUrl } = options;

    const prefs = event ? await readAlertPreferences(clinicId) : {};
    const resolved = event ? resolveNotify(event, prefs) : null;
    if (event && !resolved) {
      // An id nothing knows is a programming mistake, not a preference. Deliver it rather than
      // dropping it: a silently swallowed alert is far worse than an unconfigurable one.
      console.warn(`deliverClinicNotification: unknown event "${event}" — sending ungated`);
    }
    if (resolved && !resolved.bell && !resolved.push) {
      return { ...none, reason: "off" };
    }

    const members = await readClinicMembers(clinicId);
    const allUids = new Set(members.map((m) => m.uid));

    let targetUids: string[];
    if (uids) {
      // Explicit uids are still checked against this clinic's own people — this helper must never
      // be able to notify another clinic's staff.
      targetUids = [...new Set(uids.map((u) => String(u || "").trim()).filter((u) => allUids.has(u)))];
    } else if (resolved) {
      targetUids = [...new Set(matchRoles(members, resolved.roles))];
    } else {
      const asked = (roles || []) as NotifyRole[];
      targetUids = [...new Set(asked.length > 0 ? matchRoles(members, asked) : members.map((m) => m.uid))];
    }
    if (targetUids.length === 0) return { ...none, reason: "nobody" };

    const db = adminDb();
    const userSnaps = await db.getAll(...targetUids.map((uid) => db.collection("users").doc(uid)));

    // Per-person mutes only ever subtract. Nobody can switch on what their clinic switched off.
    const kept = event
      ? userSnaps.filter(
          (snap) =>
            !isMutedFor(
              event,
              snap.data()?.notificationMutes as Record<string, string[]> | undefined,
              clinicId,
            ),
        )
      : userSnaps;
    if (kept.length === 0) return { ...none, reason: "muted" };

    const audience = kept.map((snap) => snap.id);
    const meta = event ? notifyEvent(event) : undefined;

    let bellWritten = false;
    if (!resolved || resolved.bell) {
      try {
        await adminClinicCollection(clinicId, "notifications").add({
          title: notification.title,
          body: notification.body,
          eventType: event || "generic",
          group: meta?.group || null,
          actionUrl: actionUrl || screenToUrl(data?.screen) || null,
          // Who this row is for. The bell queries on it, so a receptionist never sees the owner's
          // money digest even though every row lives in one clinic-wide collection.
          audience,
          // Read and dismissed are per person, in arrays, for the same reason: one row, many
          // readers. The old single `read` boolean meant whoever opened the bell first marked it
          // read for the entire clinic.
          readBy: [],
          dismissedBy: [],
          createdAt: FieldValue.serverTimestamp(),
        });
        bellWritten = true;
      } catch (error) {
        console.warn("Bell row failed:", error);
      }
    }

    if (event && !pushAllowedNow(event, prefs, clinicHourNow())) {
      // Quiet hours silence the buzz, never the record — the bell row above is already written.
      return { raised: true, bellWritten, pushed: 0, reason: resolved?.push ? "quiet" : "off" };
    }

    const tokenOwner = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const snap of kept) {
      const tokens = snap.data()?.fcmTokens;
      if (!Array.isArray(tokens)) continue;
      for (const token of tokens) {
        if (typeof token === "string" && token) tokenOwner.set(token, snap.ref);
      }
    }
    const tokens = [...tokenOwner.keys()];
    if (tokens.length === 0) return { raised: true, bellWritten, pushed: 0, reason: "no-devices" };

    const dataEntries = Object.entries({
      ...(data || {}),
      ...(channel ? { channel } : {}),
      ...(event ? { event } : {}),
    })
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)] as [string, string]);

    const result = await adminMessaging().sendEachForMulticast({
      tokens,
      notification,
      ...(dataEntries.length > 0 ? { data: Object.fromEntries(dataEntries) } : {}),
      ...(channel ? { android: { notification: { channelId: channel } } } : {}),
    });

    const removals = new Map<FirebaseFirestore.DocumentReference, string[]>();
    result.responses.forEach((response, i) => {
      const code = response.error?.code || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        const owner = tokenOwner.get(tokens[i]);
        if (owner) removals.set(owner, [...(removals.get(owner) || []), tokens[i]]);
      }
    });
    await Promise.all(
      [...removals.entries()].map(([ref, dead]) =>
        ref.update({ fcmTokens: FieldValue.arrayRemove(...dead) }).catch(() => {}),
      ),
    );

    return { raised: true, bellWritten, pushed: result.successCount };
  } catch (error) {
    console.warn("Clinic notification failed:", error);
    return none;
  }
}

/**
 * The bell's link, derived from the `screen` the phone would open.
 *
 * The two apps navigate differently — the phone takes a screen name, the website takes a path —
 * and every caller already supplies the screen name for the push. Mapping it here means a new
 * alert gets a working bell link without its author having to remember to pass two things.
 */
export function screenToUrl(screen: string | undefined): string | null {
  switch (screen) {
    case "day":
      return "/appointments";
    case "chats":
      return "/chats";
    case "leads":
      return "/leads";
    case "money":
      return "/reports";
    case "inventory":
      return "/inventory";
    case "marketing":
      return "/marketing";
    case "settings":
      return "/settings";
    case "lab":
      return "/lab";
    default:
      return null;
  }
}
