import { NextRequest, NextResponse } from "next/server";
import { applyInboundOptOut } from "@/lib/optOutInbound";
import { reportServerError } from "@/lib/server/reportError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound WhatsApp replies from the gateway, for the one purpose of honouring "STOP".
 *
 * Every automated patient message now ends with a line telling the patient how to stop them (see
 * lib/patientMessaging). That line is only worth printing if this endpoint exists: a patient who
 * asks to be left alone and is messaged anyway reports the number, and a reported number is how a
 * clinic loses WhatsApp contact with all of its patients at once.
 *
 * Deliberately *not* a general inbound-message handler. It reads a reply, decides whether it is a
 * stop request, and does nothing else — no auto-replies, no conversation state, no storing of
 * message content beyond the request itself. Anything more is a product decision nobody has made.
 *
 * ── Routing ──────────────────────────────────────────────────────────────────────────────────
 * The clinic comes from the URL, not the payload: `?clinicId=<id>&token=<secret>`. Wapilot's
 * webhook field takes a full URL, so pointing each clinic's instance at its own one costs nothing
 * and removes the need to reverse-engineer which of the payload's ids identifies the tenant. It
 * also means this keeps working if the gateway changes its body format.
 *
 * ── Payload ──────────────────────────────────────────────────────────────────────────────────
 * The *body* shape is read defensively, because the gateway's exact field names are not
 * documented anywhere we control. Both known shapes are handled, an unrecognised one is logged in
 * full rather than dropped, and the endpoint always answers 200: a gateway that receives an error
 * retries, and a retried STOP is not more stop.
 */

/** `201012345678@c.us`, `+20 101 234 5678`, `201012345678` — all the same person. */
function cleanPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.split("@")[0].trim();
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Pull `{ phone, text }` out of whatever arrived.
 *
 * Covers the Wapilot v2 shape (`from` / `chat_id` with `body` or `text`), the Meta Cloud API
 * shape (`entry[].changes[].value.messages[]`), and the flat shape several gateways post. Returns
 * null when none of them fit, which is the signal to log the body and move on.
 */
function extractReply(body: unknown): { phone: string; text: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;

  // Meta Cloud API.
  const metaMessage = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (metaMessage) {
    const phone = cleanPhone(metaMessage.from);
    const text = firstString(metaMessage.text?.body, metaMessage.button?.text, metaMessage.body);
    if (phone && text) return { phone, text };
  }

  // Wapilot and the flat gateways: the message may be at the root or one level down.
  const m = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, any>;
  const msg = (m.message && typeof m.message === "object" ? m.message : m) as Record<string, any>;

  const phone = cleanPhone(
    firstString(msg.from, msg.chat_id, msg.chatId, msg.author, msg.sender, m.from, m.chat_id, b.from)
  );
  const text = firstString(
    typeof msg.body === "string" ? msg.body : "",
    typeof msg.text === "string" ? msg.text : "",
    msg.text?.body,
    msg.message,
    m.body,
    b.body
  );

  if (phone && text) return { phone, text };
  return null;
}

/**
 * A message the clinic itself sent must never be read as the patient opting out.
 *
 * Gateways commonly post both directions to the same webhook, and the outgoing copy carries the
 * patient's number as the chat it belongs to. Without this, the opt-out footer on an outgoing
 * message could opt the patient out of everything the moment it was sent.
 */
function isFromMe(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, any>;
  const candidates = [
    b?.data?.message?.fromMe,
    b?.data?.fromMe,
    b?.message?.fromMe,
    b?.fromMe,
    b?.from_me,
    b?.data?.from_me,
  ];
  return candidates.some((v) => v === true || v === "true");
}

export async function POST(request: NextRequest) {
  const clinicId = request.nextUrl.searchParams.get("clinicId")?.trim() || "";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  const expected = process.env.WHATSAPP_INBOUND_TOKEN?.trim() || "";

  // Fails closed. Without a secret configured, anyone who found the URL could switch a clinic's
  // patients out of their own appointment reminders — reversible by staff, but only once someone
  // notices, and "the reminders stopped" is exactly the failure nobody reports quickly.
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);

    if (isFromMe(body)) return NextResponse.json({ ok: true, ignored: "outgoing" });

    const reply = extractReply(body);
    if (!reply) {
      // Not an error: most posts here are delivery receipts and presence updates. Logged at a
      // level someone will actually find, because this is also what a changed payload format
      // looks like, and the first real STOP being silently unparsed is the failure that matters.
      console.warn(
        "[whatsapp-inbound] No message found in payload:",
        JSON.stringify(body ?? null).slice(0, 2000)
      );
      return NextResponse.json({ ok: true, ignored: "no_message" });
    }

    const result = await applyInboundOptOut({
      clinicId,
      phone: reply.phone,
      text: reply.text,
      channel: "whatsapp",
    });

    if (result.status === "unknown_number") {
      console.warn(`[whatsapp-inbound] Opt-out from a number with no patient record: ${result.phone}`);
    }

    return NextResponse.json({ ok: true, result: result.status });
  } catch (error) {
    reportServerError("[whatsapp-inbound] Failed to handle payload:", error);
    // Still 200: an error response makes the gateway redeliver, and redelivering a stop request
    // achieves nothing except another failed attempt.
    return NextResponse.json({ ok: true, error: "handled" });
  }
}

/**
 * Some gateways verify a webhook with a GET before they will save it, echoing a challenge
 * parameter. Answering that costs nothing and makes the URL paste-able into more dashboards.
 */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || request.nextUrl.searchParams.get("challenge");
  if (challenge) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  return NextResponse.json({ ok: true });
}
