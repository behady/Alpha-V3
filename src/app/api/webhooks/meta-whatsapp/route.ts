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
  // The deploy marker: which build is actually serving. Guessing at Vercel's rollout timing
  // has burned real debugging hours — a probe that "still fails" against a stale deploy reads
  // exactly like a broken fix. Poll this until it changes, then trust the next probe.
  return new Response("Forbidden", {
    status: 403,
    headers: { "x-build": process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown" },
  });
}

interface InboundMessage {
  phoneNumberId: string;
  from: string;
  text: string;
  fromMe: boolean;
  /**
   * The message carried a photo, video, voice note or document instead of text.
   *
   * These used to be dropped on the floor: no text meant no reply AND no flag, so a photo of a
   * swollen face at 1am reached nobody and left no trace anyone would see. A caption is used as
   * the text when there is one; without a caption the assistant cannot read the message, which is
   * exactly why a person has to.
   */
  media?: "image" | "video" | "audio" | "document" | "sticker" | "location" | "contacts";
}

/** WhatsApp message types that carry no words the assistant can act on. */
const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker", "location", "contacts"] as const;

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
        // Interactive reply IDS before anything else: our buttons and list rows carry the same
        // digits a typed answer would be, so a tap and a keystroke are indistinguishable to the
        // conversation engine — the titles are only what the patient read.
        const type = String(m?.type || "");
        const media = MEDIA_TYPES.includes(type as (typeof MEDIA_TYPES)[number])
          ? (type as InboundMessage["media"])
          : undefined;
        const text = String(
          m?.interactive?.button_reply?.id ??
            m?.interactive?.list_reply?.id ??
            m?.text?.body ??
            m?.button?.text ??
            m?.interactive?.list_reply?.title ??
            m?.interactive?.button_reply?.title ??
            // A captioned photo is a message with words in it, wherever WhatsApp puts them.
            m?.image?.caption ??
            m?.video?.caption ??
            m?.document?.caption ??
            ""
        ).trim();
        // Media with no caption still counts as a message: it needs an answer and a person, and
        // dropping it here is why photos of swollen faces reached nobody.
        if (from && (text || media)) out.push({ phoneNumberId, from, text, fromMe: false, media });
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
    let lastBot: Awaited<ReturnType<typeof respondToPatientMessage>> | null = null;

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
      lastBot = await respondToPatientMessage({
        clinicId,
        chatId: msg.from,
        phone: msg.from,
        text: msg.text,
        media: msg.media,
      });
    }

    // The outcome rides on the response, as the Wapilot webhook's does. Its absence here meant a
    // test could only poll blind — and a blind poll that POSTs is a message flood, which is not a
    // hypothetical: thirteen duplicate day-lists reached a real phone finding this out.
    return NextResponse.json({
      ok: true,
      handled: messages.length,
      ...(lastBot ? { bot: lastBot.status, why: lastBot.reason } : {}),
    });
  } catch (error) {
    reportServerError("[meta-whatsapp] Failed to handle payload:", error);
    // 200 regardless: Meta retries on non-200, and a retried message helps nothing.
    await recordUnparsed("", null, "exception");
    return NextResponse.json({ ok: true, error: "handled" });
  }
}
