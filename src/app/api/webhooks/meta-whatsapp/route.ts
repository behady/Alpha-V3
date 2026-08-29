import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { respondToPatientMessage } from "@/lib/bot/respond";
import { applyInboundOptOut } from "@/lib/optOutInbound";
import { isOptOutReply } from "@/lib/patientMessaging";
import { clinicIdForPhoneNumberId } from "@/lib/metaWhatsapp";
import { reportServerError } from "@/lib/server/reportError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The official WhatsApp Cloud API inbound webhook.
 *
 * Distinct from `/api/webhooks/whatsapp-inbound`, which is Wapilot's. The two gateways will run
 * side by side through the migration — different clinics on different channels — so they get
 * different endpoints rather than one trying to guess which gateway called it.
 *
 * The reason this path exists at all: Meta's payload carries the sender's REAL phone number
 * (`value.messages[].from`), so every `@lid` contortion the Wapilot path needs — echo-learning,
 * self-identification, sending-to-a-lid-that-fails — is simply absent here. A patient is known
 * the instant they write.
 *
 * Order is the same safety property as the Wapilot side: opt-out is honoured before the assistant
 * is ever consulted, so "إيقاف" can never be answered with a menu.
 */

/**
 * The verify token Meta must present in its handshake.
 *
 * Environment variable when set; otherwise the same server-only Meta config document the leads
 * integration already keeps its secrets in. The fallback exists so activating this webhook does
 * not require anyone to touch the Vercel dashboard — the deploy pipeline is `git push`, and a
 * setup step that lives outside it is a setup step that gets missed.
 */
async function expectedVerifyToken(): Promise<string> {
  const fromEnv = process.env.META_WA_VERIFY_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const snap = await adminDb().doc("meta_integrations/config").get();
    const v = snap.exists ? snap.data()?.waVerifyToken : "";
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/**
 * The app secret Meta signs every delivery with (X-Hub-Signature-256 over the raw body).
 *
 * Same doc as the verify token, same env-var escape hatch. The `appSecret` fallback is not a
 * guess: the leads webhook and this one belong to the same Meta app ("Alpha Dental"), and an app
 * has exactly one secret — so if the leads setup already stored it, WhatsApp is covered too.
 */
async function configuredAppSecret(): Promise<string> {
  const fromEnv = process.env.META_WA_APP_SECRET?.trim();
  if (fromEnv) return fromEnv;
  try {
    const snap = await adminDb().doc("meta_integrations/config").get();
    const data = snap.exists ? snap.data() : undefined;
    const v = data?.waAppSecret || data?.appSecret || "";
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Constant-time check of Meta's signature header — the twin of `verifyMetaSignature` in
 * functions/metaLeads.js. Without this check, anyone who learns the endpoint plus a
 * phone_number_id can forge inbound messages: trigger bot replies to arbitrary numbers, or
 * opt real patients out with a fake "إيقاف".
 */
function signatureMatches(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  const header = String(signatureHeader || "");
  if (!header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/** Meta verifies a webhook once with a GET carrying a challenge to echo back. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = await expectedVerifyToken();
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

interface InboundMessage {
  phoneNumberId: string;
  from: string;
  text: string;
  fromMe: boolean;
}

/** Pull the messages out of Meta's nested change payload. Statuses and other changes yield none. */
function extractMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as any)?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change?.value;
      const phoneNumberId = String(value?.metadata?.phone_number_id || "").trim();
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue; // status updates have no `messages`
      for (const m of messages) {
        const from = String(m?.from || "").trim();
        const text = String(
          m?.text?.body ?? m?.button?.text ?? m?.interactive?.list_reply?.title ?? m?.interactive?.button_reply?.title ?? ""
        ).trim();
        if (from && text) out.push({ phoneNumberId, from, text, fromMe: false });
      }
    }
  }
  return out;
}

async function recordUnparsed(clinicId: string, body: unknown, reason: string): Promise<void> {
  if (!clinicId) return;
  try {
    await adminClinicCollection(clinicId, "whatsapp_inbound_debug").add({
      reason: `meta_${reason}`,
      raw: JSON.stringify(body ?? null).slice(0, 4000),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    /* diagnostics must never fail the webhook */
  }
}

export async function POST(request: NextRequest) {
  try {
    // The signature covers the raw bytes, so the body must be read as text BEFORE any JSON
    // parsing — parse-then-restringify would never reproduce Meta's exact serialization.
    const rawBody = await request.text();

    const appSecret = await configuredAppSecret();
    if (appSecret) {
      if (!signatureMatches(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
        // Still 200: Meta retries non-200 responses, and a forged payload retried is still forged.
        return NextResponse.json({ ok: true, ignored: "bad_signature" });
      }
    } else {
      // Processing unsigned is deliberate while the secret is not yet stored — but the gap must
      // stay visible in the logs until scripts/set-wa-app-secret.mjs has been run.
      console.warn("[meta-whatsapp] No app secret configured — accepting webhook WITHOUT signature verification");
    }

    let body: unknown = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    const messages = extractMessages(body);

    // No messages is normal: most calls are delivery/read status updates. But a status carrying
    // an error is a message Meta ACCEPTED and then refused to deliver — the free-form-outside-
    // the-window case — and without recording it, "the API said ok" and "the patient got it"
    // look identical. That exact gap cost a live debugging round.
    if (messages.length === 0) {
      const entries = (body as any)?.entry;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          for (const change of entry?.changes || []) {
            const value = change?.value;
            const pid = String(value?.metadata?.phone_number_id || "").trim();
            for (const st of value?.statuses || []) {
              if (st?.status === "failed" && Array.isArray(st?.errors) && st.errors.length) {
                const cid = await clinicIdForPhoneNumberId(pid);
                await recordUnparsed(
                  cid,
                  { to: st.recipient_id, errors: st.errors },
                  `delivery_failed_${st.errors[0]?.code ?? "unknown"}`
                );
              }
            }
          }
        }
      }
      return NextResponse.json({ ok: true, ignored: "no_message" });
    }

    for (const msg of messages) {
      const clinicId = await clinicIdForPhoneNumberId(msg.phoneNumberId);
      if (!clinicId) {
        // A number we have not mapped to a clinic. Recorded globally-ish is impossible without a
        // clinic, so it goes to console — this only happens if a number is connected in Meta but
        // never saved in the app.
        console.warn(`[meta-whatsapp] No clinic for phone_number_id ${msg.phoneNumberId}`);
        continue;
      }

      // Opt-out first, always — before the assistant is consulted. Meta gives the real phone, so
      // this reaches the patient's actual record with no lid fallback needed.
      if (isOptOutReply(msg.text)) {
        await applyInboundOptOut({ clinicId, phone: msg.from, text: msg.text, channel: "whatsapp" });
        continue;
      }

      // Otherwise it may be a conversation. respondToPatientMessage re-checks every gate and is
      // silent unless the clinic enabled the assistant. chatId and phone are the same here — the
      // real number — which is exactly the simplification the official API buys.
      await respondToPatientMessage({ clinicId, chatId: msg.from, phone: msg.from, text: msg.text });
    }

    return NextResponse.json({ ok: true, handled: messages.length });
  } catch (error) {
    reportServerError("[meta-whatsapp] Failed to handle payload:", error);
    // 200 regardless: Meta retries on non-200, and a retried message helps nothing.
    await recordUnparsed("", null, "exception");
    return NextResponse.json({ ok: true, error: "handled" });
  }
}
