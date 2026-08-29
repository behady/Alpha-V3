import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
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

/** Meta verifies a webhook once with a GET carrying a challenge to echo back. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.META_WA_VERIFY_TOKEN?.trim() || "";
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
    const body = await request.json().catch(() => null);
    const messages = extractMessages(body);

    // No messages is normal: most calls are delivery/read status updates. Nothing to do.
    if (messages.length === 0) {
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
