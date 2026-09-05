import { adminDb } from "@/lib/firebaseAdmin";
import { CLINIC_SECRETS_COLLECTION } from "@/types/wapilot";

/**
 * The official WhatsApp Cloud API, per clinic.
 *
 * This is the drop-proof path Wapilot is not: Meta hosts the session, so there is no QR to
 * re-scan, no linked device to fall off, and — the reason it exists in this codebase at all —
 * inbound messages carry the sender's real phone number, so the entire `@lid` identification
 * problem (see lib/whatsappLid) simply does not arise here.
 *
 * Credentials live in `clinic_secrets/{clinicId}.metaWhatsapp`, the same server-only collection
 * Wapilot's do — no client rule can read a token that sends as the clinic. A clinic may have both
 * configured during a migration; which one actually sends is the caller's choice, not this
 * module's.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
export const META_WA_SECRET_FIELD = "metaWhatsapp";

export interface MetaWhatsappConfig {
  /** The Cloud API phone-number id that sends and receives. Not the phone number itself. */
  phoneNumberId: string;
  /** The WhatsApp Business Account id, for template management. */
  wabaId: string;
  /** System-user token. Never expires when generated as one; see the setup in Business settings. */
  token: string;
}

type CacheEntry = { config: MetaWhatsappConfig | null; at: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 60_000;

function configFromStored(data: Record<string, unknown> | undefined): MetaWhatsappConfig | null {
  if (!data) return null;
  const phoneNumberId = typeof data.phoneNumberId === "string" ? data.phoneNumberId.trim() : "";
  const wabaId = typeof data.wabaId === "string" ? data.wabaId.trim() : "";
  const token = typeof data.token === "string" ? data.token.trim() : "";
  if (!phoneNumberId || !token) return null;
  return { phoneNumberId, wabaId, token };
}

/** The clinic's official-API credentials, or null when it is not on the official API. */
export async function loadMetaWhatsappConfig(
  clinicId: string,
  forceRefresh = false
): Promise<MetaWhatsappConfig | null> {
  const key = String(clinicId || "").trim();
  if (!key) return null;

  const now = Date.now();
  if (!forceRefresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.config;
  }

  let config: MetaWhatsappConfig | null = null;
  try {
    const snap = await adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(key).get();
    if (snap.exists) {
      config = configFromStored((snap.data() || {})[META_WA_SECRET_FIELD] as Record<string, unknown>);
    }
  } catch (e) {
    console.warn("loadMetaWhatsappConfig: read failed", e);
  }

  cache.set(key, { config, at: now });
  return config;
}

export function clearMetaWhatsappConfigCache(clinicId?: string): void {
  if (clinicId) cache.delete(String(clinicId).trim());
  else cache.clear();
}

/**
 * Which clinic owns an inbound message.
 *
 * Meta calls ONE webhook url for the whole app, and names the receiving number only as a
 * `phone_number_id` in the payload — so unlike the Wapilot webhook, the clinic cannot come from
 * the url. It is resolved by finding the clinic whose stored config holds that phone-number id.
 *
 * `clinic_secrets` is queried across documents; the field is nested, so this reads the id map
 * maintained alongside the secret rather than scanning every secret doc. See
 * `indexMetaPhoneNumber`, which keeps that map in step whenever a clinic's number is saved.
 */
export async function clinicIdForPhoneNumberId(phoneNumberId: string): Promise<string> {
  const pid = String(phoneNumberId || "").trim();
  if (!pid) return "";
  try {
    const snap = await adminDb().collection("meta_wa_numbers").doc(pid).get();
    if (snap.exists) {
      const cid = snap.data()?.clinicId;
      if (typeof cid === "string" && cid.trim()) return cid.trim();
    }
  } catch (e) {
    console.warn("clinicIdForPhoneNumberId: lookup failed", e);
  }
  return "";
}

/**
 * Point a phone-number id at a clinic, so inbound webhooks can be routed.
 *
 * A tiny public-keyed index (`meta_wa_numbers/{phoneNumberId} -> { clinicId }`) rather than a
 * scan of the secret collection: the webhook runs on every inbound message and must not read
 * every clinic's secret to find one match. The id itself is not sensitive — it is useless without
 * the token, which stays in `clinic_secrets`.
 */
export async function indexMetaPhoneNumber(clinicId: string, phoneNumberId: string): Promise<void> {
  const pid = String(phoneNumberId || "").trim();
  const cid = String(clinicId || "").trim();
  if (!pid || !cid) return;
  await adminDb().collection("meta_wa_numbers").doc(pid).set({ clinicId: cid });
}

export interface MetaSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a plain text message through the Cloud API.
 *
 * `to` is a real phone number in international digits — the official API has no `@lid` to contend
 * with. A message outside the 24-hour service window will be rejected by Meta unless it is a
 * template; that policy lives with the caller, which knows whether it is answering the patient
 * (free-form, in-window) or starting a conversation (must be a template).
 */
export async function sendMetaWhatsappText(args: {
  config: MetaWhatsappConfig;
  to: string;
  text: string;
}): Promise<MetaSendResult> {
  const digits = String(args.to || "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "invalid_phone" };

  try {
    const res = await fetch(`${GRAPH}/${args.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: digits,
        type: "text",
        text: { preview_url: false, body: args.text },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    const messageId = data?.messages?.[0]?.id;
    return { ok: true, messageId: typeof messageId === "string" ? messageId : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

/** Whether any clinic is on the official API — used to decide if a migration path is live. */
export async function anyClinicOnMeta(): Promise<boolean> {
  try {
    const snap = await adminDb().collection("meta_wa_numbers").limit(1).get();
    return !snap.empty;
  } catch {
    return false;
  }
}

/**
 * A structured message: tap-to-answer instead of type-a-digit.
 *
 * Only the official API renders these. `buttons` becomes WhatsApp reply buttons (max 3, titles
 * <=20 chars); `list` becomes a list message (max 10 rows, titles <=24 chars). The ids come back
 * verbatim in the webhook's interactive reply, and ours are the same digits a typed answer would
 * be — so the conversation engine cannot tell a tap from a keystroke, which is the point: the
 * Wapilot channel falls back to the numbered-text version of the same message and both channels
 * stay one state machine.
 */
export interface MetaInteractive {
  body: string;
  buttons?: Array<{ id: string; title: string }>;
  list?: {
    buttonLabel: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  };
}

export async function sendMetaWhatsappInteractive(args: {
  config: MetaWhatsappConfig;
  to: string;
  message: MetaInteractive;
}): Promise<MetaSendResult> {
  const digits = String(args.to || "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "invalid_phone" };
  const { body, buttons, list } = args.message;

  // WhatsApp rejects over-length parts with an opaque 400; trim here so a long clinic name can
  // never break the whole message.
  const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1) + "…" : v);

  let interactive: Record<string, unknown>;
  if (buttons?.length) {
    interactive = {
      type: "button",
      body: { text: clip(body, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: clip(b.title, 20) },
        })),
      },
    };
  } else if (list?.rows.length) {
    interactive = {
      type: "list",
      body: { text: clip(body, 1024) },
      action: {
        button: clip(list.buttonLabel, 20),
        sections: [
          {
            rows: list.rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: clip(r.title, 24),
              ...(r.description ? { description: clip(r.description, 72) } : {}),
            })),
          },
        ],
      },
    };
  } else {
    return sendMetaWhatsappText({ config: args.config, to: args.to, text: body });
  }

  try {
    const res = await fetch(`${GRAPH}/${args.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: digits,
        type: "interactive",
        interactive,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    const messageId = data?.messages?.[0]?.id;
    return { ok: true, messageId: typeof messageId === "string" ? messageId : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}

/**
 * The pre-approved utility templates, one per business-initiated message kind.
 *
 * WhatsApp only delivers free-form text inside the 24-hour window a patient's own message opens;
 * outside it, the API answers "accepted" and drops the message silently — verified live, at the
 * cost of a confused debugging hour. Reminders and staff-triggered notifications are exactly the
 * messages that go out unprompted, so on this channel they are ALWAYS sent as templates: slightly
 * plainer than the clinic's custom bodies, but delivered every time, which is the property a
 * reminder exists for. Bot replies stay free-form — they are always answers, always in-window.
 *
 * Registered on the WABA as `alpha_*_ar` (Arabic, UTILITY). Params are positional {{1}}..{{n}}.
 */
export const META_TEMPLATE_FOR_KIND: Record<string, { name: string; paramCount: number }> = {
  new: { name: "alpha_appt_new_ar", paramCount: 3 }, // clinic, date, time
  edit: { name: "alpha_appt_edit_ar", paramCount: 3 }, // clinic, date, time
  cancel: { name: "alpha_appt_cancel_ar", paramCount: 2 }, // clinic, date
  reminder24h: { name: "alpha_appt_reminder_ar", paramCount: 3 }, // clinic, date, time
  invoice: { name: "alpha_payment_ar", paramCount: 3 }, // amount, clinic, balance
  // Reminder with "تأكيد الحضور" / "تعديل الميعاد" quick-reply buttons. Same params; the tap
  // comes back as the button label, which the assistant already reads as confirm / reschedule.
  reminder24h_btn: { name: "alpha_appt_reminder_btn_ar", paramCount: 3 }, // clinic, date, time
  recall: { name: "alpha_recall_ar", paramCount: 1 }, // clinic
  review: { name: "alpha_review_ar", paramCount: 2 }, // clinic, link
};

/** Send one of the registered templates. Throws nothing; the result carries the error. */
export async function sendMetaTemplate(args: {
  config: MetaWhatsappConfig;
  to: string;
  templateName: string;
  params: string[];
}): Promise<MetaSendResult> {
  const digits = String(args.to || "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "invalid_phone" };

  try {
    const res = await fetch(`${GRAPH}/${args.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: digits,
        type: "template",
        template: {
          name: args.templateName,
          language: { code: "ar" },
          components: args.params.length
            ? [{ type: "body", parameters: args.params.map((text) => ({ type: "text", text })) }]
            : [],
        },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    const messageId = data?.messages?.[0]?.id;
    return { ok: true, messageId: typeof messageId === "string" ? messageId : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send_failed" };
  }
}
