import { NextRequest } from "next/server";
import crypto from "node:crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { CLINIC_SECRETS_COLLECTION } from "@/types/whatsappCloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Meta WhatsApp Cloud API verification handshake.
 *
 * Meta sends hub.mode / hub.verify_token / hub.challenge; echo the challenge back as plain text
 * when the token matches META_VERIFY_TOKEN. This runs once when you save the webhook URL.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_VERIFY_TOKEN;

  if (!verifyToken) {
    console.error("[WhatsApp Webhook] META_VERIFY_TOKEN is not set — handshake cannot succeed.");
    return new Response("Forbidden", { status: 403 });
  }

  // Constant-time compare so the token can't be recovered by timing the response.
  const matches =
    token !== null &&
    token.length === verifyToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(verifyToken));

  if (mode === "subscribe" && matches) {
    console.log("[WhatsApp Webhook] Handshake verification successful.");
    return new Response(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[WhatsApp Webhook] Handshake verification failed. Token or mode mismatch.");
  return new Response("Forbidden", { status: 403 });
}

/**
 * Confirms the payload really came from Meta.
 *
 * This endpoint is public and unauthenticated, so without this check anyone who learns the URL
 * could POST fake inbound messages. Meta signs the raw body with the app secret as
 * `sha256=<hmac>` in X-Hub-Signature-256 — the signature is over the exact bytes received, so the
 * body must be read as text and only parsed afterwards.
 */
function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    console.error("[WhatsApp Webhook] META_APP_SECRET is not set — rejecting unverifiable payload.");
    return false;
  }
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);

  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Map an inbound event back to a tenant.
 *
 * Every clinic connects its own number, so the only thing tying a webhook payload to a clinic is
 * the phone_number_id Meta includes in the metadata.
 */
async function findClinicByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  if (!phoneNumberId) return null;
  try {
    const snap = await adminDb()
      .collection(CLINIC_SECRETS_COLLECTION)
      .where("whatsapp.phoneNumberId", "==", phoneNumberId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].id;
  } catch (e) {
    console.warn("[WhatsApp Webhook] Clinic lookup failed", e);
    return null;
  }
}

/**
 * POST: inbound messages, delivery receipts, and status updates.
 *
 * Always returns 200 once the signature checks out — Meta retries with backoff on any non-200 and
 * will eventually disable the subscription, so a bug handling one message must not look like an
 * outage. Failures are logged instead.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!isValidSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    console.warn("[WhatsApp Webhook] Rejected payload with invalid signature.");
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const body = JSON.parse(rawBody);

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const phoneNumberId: string = value.metadata?.phone_number_id ?? "";
        const clinicId = await findClinicByPhoneNumberId(phoneNumberId);

        for (const message of value.messages ?? []) {
          console.log("[WhatsApp Webhook] Inbound message", {
            clinicId: clinicId ?? "(unmapped)",
            phoneNumberId,
            from: message.from,
            type: message.type,
            id: message.id,
          });
        }

        for (const status of value.statuses ?? []) {
          console.log("[WhatsApp Webhook] Status update", {
            clinicId: clinicId ?? "(unmapped)",
            id: status.id,
            status: status.status,
            recipient: status.recipient_id,
          });
        }
      }
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("[WhatsApp Webhook] Error handling payload:", error);
    // Signature already passed, so this is our bug, not a bad caller. 200 stops Meta retrying.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
}
