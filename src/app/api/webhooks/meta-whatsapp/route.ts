import { NextRequest, NextResponse, after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { respondToPatientMessage } from "@/lib/bot/respond";
import { recordThreadMessage } from "@/lib/bot/thread";
import { applyInboundOptOut } from "@/lib/optOutInbound";
import { isOptOutReply } from "@/lib/patientMessaging";
import { clinicIdForPhoneNumberId } from "@/lib/metaWhatsapp";
import { reportServerError } from "@/lib/server/reportError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
 * Room for the reply to finish AFTER the response has gone back to Meta.
 *
 * The webhook answers in milliseconds; the work scheduled with after() is what needs the budget,
 * and the model's slow tail is what it is spent on. Without this the platform default cuts the
 * background work off mid-turn and the patient gets nothing at all.
 */
export const maxDuration = 60;

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

/**
 * Has this exact WhatsApp message already been handled?
 *
 * Meta redelivers a webhook it did not get a prompt 200 for, and a redelivery carries the SAME
 * message id — so without this, one slow turn becomes two identical replies on the patient's
 * phone. The AI path can legitimately take ten seconds, which puts the whole webhook near Meta's
 * patience, so the guard is what makes waiting for a good answer safe.
 *
 * `create()` rather than `set()`: it fails if the document exists, which makes the check and the
 * claim one atomic operation. Two concurrent deliveries cannot both win.
 */
async function claimMessage(clinicId: string, messageId: string): Promise<boolean> {
  if (!messageId) return true; // nothing to dedupe on; better to answer than to drop
  try {
    await adminClinicCollection(clinicId, "whatsapp_seen")
      .doc(messageId.replace(/[/\\]/g, "_").slice(0, 200))
      .create({ at: FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false; // already claimed by an earlier delivery of the same message
  }
}

interface InboundMessage {
  phoneNumberId: string;
  from: string;
  text: string;
  fromMe: boolean;
  /** WhatsApp's own id for this message, used to refuse a redelivery. */
  messageId: string;
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
        const messageId = String(m?.id || "");
        if (from && (text || media)) out.push({ phoneNumberId, from, text, fromMe: false, media, messageId });
      }
    }
  }
  return out;
}

/** The patient's message, into the chat thread staff read. Never allowed to fail the webhook. */
async function rememberInbound(clinicId: string, msg: InboundMessage): Promise<void> {
  await recordThreadMessage(clinicId, msg.from, {
    direction: "in",
    author: "patient",
    text: msg.text,
    media: msg.media,
    messageId: msg.messageId,
    channel: "meta",
  }).catch((e) => console.warn("[meta-whatsapp] thread write failed:", e));
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
    let queued = 0;
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
        await rememberInbound(clinicId, msg);
        await applyInboundOptOut({ clinicId, phone: msg.from, text: msg.text, channel: "whatsapp" });
        continue;
      }

      // A redelivery of something already answered. Claimed after the opt-out check so a repeated
      // "stop" is always honoured, and before the assistant so it can never answer twice.
      // Claimed BEFORE the response goes out, so a retry arriving while the first turn is still
      // being composed is refused rather than racing it.
      if (!(await claimMessage(clinicId, msg.messageId))) {
        lastBot = { status: "skipped", reason: "duplicate_delivery" };
        continue;
      }

      // Into the thread before anything decides whether to answer: a message the bot is switched
      // off for, or refuses to answer, is still a message the clinic received.
      await rememberInbound(clinicId, msg);

      /*
       * Answering happens after the response, not before it.
       *
       * Meta is owed a prompt 200 and the assistant is not always quick: the model's latency has a
       * long tail (measured at 2.9s, 8.2s and 12.2s for the same question), and making the
       * webhook wait for it meant either discarding good answers at the timeout or holding Meta
       * long enough to be redelivered. Neither is necessary — the reply is sent through the Cloud
       * API as its own outbound call, so nothing about it needs to be in this response. Meta gets
       * its 200 immediately and the patient gets a real answer a few seconds later, which is what
       * a WhatsApp conversation looks like anyway.
       *
       * Safe only because the message id above is already claimed: a retry cannot start a second
       * copy of this work.
       */
      queued += 1;
      after(async () => {
        try {
          await respondToPatientMessage({
            clinicId,
            chatId: msg.from,
            phone: msg.from,
            text: msg.text,
            media: msg.media,
          });
        } catch (e) {
          // Nothing is waiting on this promise any more, so an error here would otherwise vanish.
          reportServerError("[meta-whatsapp] Background reply failed:", e);
          await recordUnparsed(clinicId, { from: msg.from, text: msg.text.slice(0, 200) }, "reply_failed");
        }
      });
    }

    /*
     * The reply is no longer composed by the time this returns, so the outcome cannot ride on the
     * response any more. It is written to the conversation document instead — `lastReason` on
     * whatsapp_conversations/{phoneKey} — which is where a probe should read it from.
     *
     * `duplicate_delivery` is still reported here, because that decision IS made synchronously
     * and is the one a retry needs to see.
     */
    return NextResponse.json({
      ok: true,
      handled: messages.length,
      queued,
      ...(lastBot ? { bot: lastBot.status, why: lastBot.reason } : {}),
    });
  } catch (error) {
    reportServerError("[meta-whatsapp] Failed to handle payload:", error);
    // 200 regardless: Meta retries on non-200, and a retried message helps nothing.
    await recordUnparsed("", null, "exception");
    return NextResponse.json({ ok: true, error: "handled" });
  }
}
