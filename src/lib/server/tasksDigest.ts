import { adminDb } from "@/lib/firebaseAdmin";
import { loadPlatformWapilotConfig } from "@/lib/wapilotConfig";
import { sendWapilotText } from "@/lib/whatsapp";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { buildDigest, cairoNow, digestDue, digestFromDoc, taskFromDoc, type DigestSettings } from "@/lib/platformTasks";

/**
 * The platform owner's morning WhatsApp about the Tasks list: what is late, due today, due in
 * the next three days, and which clinic requests nobody has opened.
 *
 * Sent from the platform alerts line (Alpha's own number), to the one phone saved on the Tasks
 * tab. The phone lives in Firestore, never in code: the repository is public. The settings doc
 * sits in `platform_task_settings`, a collection the rules never open, so only the superadmin
 * routes read it. No clinic data is involved.
 */
export const TASKS_COLLECTION = "platform_tasks";
export const DIGEST_DOC = () => adminDb().collection("platform_task_settings").doc("digest");

export async function loadDigestSettings(): Promise<DigestSettings> {
  return digestFromDoc((await DIGEST_DOC().get()).data());
}

export type DigestResult =
  | { sent: true; to: string }
  | { sent: false; reason: "not_due" | "nothing_to_say" | "no_phone" | "line_not_configured" | "send_failed"; error?: string };

/**
 * `force` is the "Send now" button: it ignores the hour and the once-a-day mark, and sends even
 * on a quiet day (saying so) so the owner can see the line works.
 */
export async function runTasksDigest(opts: { force?: boolean; at?: Date } = {}): Promise<DigestResult> {
  const at = opts.at ?? new Date();
  const settings = await loadDigestSettings();
  if (!opts.force && !digestDue(settings, at)) return { sent: false, reason: "not_due" };

  const to = normalizeToE164AssumingCountry(settings.phone);
  if (!to || to.replace(/\D/g, "").length < 8) return { sent: false, reason: "no_phone" };

  const { day } = cairoNow(at);
  const snap = await adminDb().collection(TASKS_COLLECTION).limit(500).get();
  const tasks = snap.docs.map((d) => taskFromDoc(d.id, d.data()));
  let text = buildDigest(tasks, day);

  if (!text) {
    if (!opts.force) {
      // A quiet day: mark it done so the job does not look again every hour.
      await DIGEST_DOC().set({ lastSentDay: day }, { merge: true });
      return { sent: false, reason: "nothing_to_say" };
    }
    text = "☀️ *Your plan*\nNothing open on the Tasks list. Enjoy the day.";
  }

  const config = await loadPlatformWapilotConfig();
  if (config.source !== "platform" || !config.instanceId || !config.token) {
    return { sent: false, reason: "line_not_configured" };
  }

  // Claim the day before sending, so two overlapping runs cannot both send.
  if (!opts.force) {
    const claimed = await adminDb().runTransaction(async (tx) => {
      const fresh = digestFromDoc((await tx.get(DIGEST_DOC())).data());
      if (fresh.lastSentDay === day) return false;
      tx.set(DIGEST_DOC(), { lastSentDay: day }, { merge: true });
      return true;
    });
    if (!claimed) return { sent: false, reason: "not_due" };
  }

  try {
    await sendWapilotText(config, to, text, { priority: "staff" });
    await DIGEST_DOC().set({ lastResult: { ok: true, at: at.toISOString() } }, { merge: true });
    return { sent: true, to };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Give the day back so the next hourly run tries again.
    const patch: Record<string, unknown> = { lastResult: { ok: false, error: message.slice(0, 300), at: at.toISOString() } };
    if (!opts.force) patch.lastSentDay = settings.lastSentDay;
    await DIGEST_DOC().set(patch, { merge: true }).catch(() => {});
    return { sent: false, reason: "send_failed", error: message };
  }
}
